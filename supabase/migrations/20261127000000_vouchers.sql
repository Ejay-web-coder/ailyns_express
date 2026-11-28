-- Vouchers and coupons for the special days the admin picks.
--
-- * vouchers: a code with a discount, valid from starts_on to ends_on (whole days, Philippine
--   time). kind 'voucher' is listed for customers at checkout; kind 'coupon' is a secret code the
--   store shares (Facebook post, flyer) that customers type in.
-- * The discount is a peso amount off the items, a percentage of the items (optionally capped), or
--   free delivery (optionally capped). Optional minimum spend, total uses and uses per customer.
--   Cancelled orders don't count as a use.
-- * place_order() takes the code, checks it again and prices the discount itself, so the browser
--   can't pick its own discount. One discount per order: the bigger of the voucher and the
--   first-order welcome discount. Keep in sync with src/lib/vouchers.ts.
-- * check_voucher(): what checkout calls to preview a code before the order is placed.

-- ---------------------------------------------------------------- table
create table public.vouchers (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,20}$'),
  title text not null check (char_length(trim(title)) between 2 and 60),
  kind text not null default 'voucher' check (kind in ('voucher', 'coupon')),
  discount_type text not null check (discount_type in ('amount', 'percent', 'free_delivery')),
  amount numeric(10, 2) not null default 0 check (amount between 0 and 10000),
  max_discount numeric(10, 2) check (max_discount > 0 and max_discount <= 10000),
  min_spend numeric(10, 2) not null default 0 check (min_spend between 0 and 100000),
  starts_on date not null,
  ends_on date not null,
  max_uses integer check (max_uses between 1 and 100000),
  per_customer integer not null default 1 check (per_customer between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (discount_type <> 'amount' or amount > 0),
  check (discount_type <> 'percent' or amount between 1 and 100)
);

create trigger vouchers_touch before update on public.vouchers
  for each row execute function public.touch_updated_at();

alter table public.orders
  add column voucher_id bigint references public.vouchers (id) on delete set null,
  add column voucher_code text;
create index orders_voucher_idx on public.orders (voucher_id);
comment on column public.orders.voucher_code is 'Voucher or coupon code used on this order (kept if the voucher is deleted).';

-- ---------------------------------------------------------------- helpers
create or replace function public.manila_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Manila')::date
$$;

-- What a voucher takes off an order with these item and delivery totals.
create or replace function public.voucher_discount(p_voucher public.vouchers, p_subtotal numeric, p_fee numeric)
returns numeric language sql immutable set search_path = '' as $$
  select round(greatest(0, case p_voucher.discount_type
    when 'amount' then least(p_voucher.amount, p_subtotal)
    when 'percent' then least(p_subtotal * p_voucher.amount / 100, coalesce(p_voucher.max_discount, p_subtotal))
    else least(coalesce(p_fee, 0), coalesce(p_voucher.max_discount, coalesce(p_fee, 0)))
  end), 2)
$$;

-- The voucher behind p_code if this customer can use it on items worth p_subtotal, else an error
-- that says why. p_lock: lock the row, so two orders can't both take the last use.
create or replace function public.usable_voucher(p_code text, p_customer uuid, p_subtotal numeric, p_lock boolean)
returns public.vouchers language plpgsql security definer set search_path = '' as $$
declare
  v public.vouchers;
  v_today date := public.manila_today();
  v_used integer;
begin
  if p_lock then
    select * into v from public.vouchers where code = upper(trim(p_code)) for update;
  else
    select * into v from public.vouchers where code = upper(trim(p_code));
  end if;
  if not found or not v.active then
    raise exception 'That voucher code isn''t valid';
  end if;
  if v_today < v.starts_on then
    raise exception 'This voucher starts on %', to_char(v.starts_on, 'FMMon FMDD, YYYY');
  end if;
  if v_today > v.ends_on then
    raise exception 'This voucher ended on %', to_char(v.ends_on, 'FMMon FMDD, YYYY');
  end if;
  if p_subtotal < v.min_spend then
    raise exception 'Spend at least % on items to use this voucher', public.peso(v.min_spend);
  end if;
  if v.max_uses is not null then
    select count(*) into v_used from public.orders where voucher_id = v.id and status <> 'cancelled';
    if v_used >= v.max_uses then raise exception 'This voucher has been fully claimed'; end if;
  end if;
  select count(*) into v_used
    from public.orders where voucher_id = v.id and customer_id = p_customer and status <> 'cancelled';
  if v_used >= v.per_customer then
    raise exception 'You''ve already used this voucher%',
      case when v.per_customer > 1 then ' ' || v.per_customer || ' times' else '' end;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- customer API
-- Preview for checkout. The order itself is priced again by place_order().
create or replace function public.check_voucher(p_code text, p_subtotal numeric, p_fee numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.vouchers;
begin
  if auth.uid() is null then raise exception 'Please sign in to use a voucher'; end if;
  if coalesce(trim(p_code), '') = '' then raise exception 'Enter a voucher code'; end if;
  v := public.usable_voucher(p_code, auth.uid(), coalesce(p_subtotal, 0), false);
  return jsonb_build_object(
    'id', v.id, 'code', v.code, 'title', v.title, 'kind', v.kind,
    'discount_type', v.discount_type, 'amount', v.amount, 'max_discount', v.max_discount,
    'min_spend', v.min_spend, 'starts_on', v.starts_on, 'ends_on', v.ends_on,
    'discount', public.voucher_discount(v, coalesce(p_subtotal, 0), p_fee)
  );
end $$;

drop function public.place_order(
  jsonb, text, text, text, text, text, text, text, text, double precision, double precision, boolean, numeric
);

-- Same as before (see 20261126180000_distance_delivery_fee.sql) plus p_voucher.
create function public.place_order(
  p_items jsonb,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_city text,
  p_province text,
  p_notes text,
  p_payment text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_pinned boolean default false,
  p_road_km numeric default null,
  p_voucher text default null
) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_item jsonb;
  v_product public.products;
  v_qty integer;
  v_store public.store_settings;
  v_straight double precision;
  v_km numeric(7, 2);
  v_subtotal numeric(10, 2) := 0;
  v_fee numeric(10, 2);
  v_discount numeric(10, 2) := 0;
  v_voucher public.vouchers;
  v_voucher_discount numeric(10, 2);
begin
  if v_uid is null then raise exception 'Please sign in to place an order'; end if;
  if public.my_role() is distinct from 'customer' then
    raise exception 'Only customer accounts can place orders';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = ''
     or coalesce(trim(p_address), '') = '' or coalesce(trim(p_city), '') = '' then
    raise exception 'Name, phone, address and city are required';
  end if;
  if p_payment not in ('cod', 'gcash') then raise exception 'Unknown payment method'; end if;
  if (p_lat is null) <> (p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid drop-off location';
  end if;
  if p_road_km is not null and p_road_km < 0 then raise exception 'Invalid road distance'; end if;

  -- Delivery fee: base fee for the first km, then a rate per extra km started.
  select * into v_store from public.store_settings where id = 1;
  if v_store.lat is not null and p_lat is not null then
    v_straight := public.distance_km(v_store.lat, v_store.lng, p_lat, p_lng);
    v_km := round(
      least(greatest(coalesce(p_road_km::double precision, v_straight * 1.3), v_straight), v_straight * 3)::numeric,
      2
    );
  end if;
  v_fee := coalesce(v_store.delivery_base_fee, 49)
    + case
        when v_km is null then 0
        else ceil(greatest(v_km - v_store.delivery_base_km, 0)) * v_store.delivery_per_km
      end;

  -- First order (ignoring cancelled ones) gets the ₱30 welcome discount.
  if not exists (
    select 1 from public.orders where customer_id = v_uid and status <> 'cancelled'
  ) then
    v_discount := 30;
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_phone, customer_email, address, city, province,
    notes, payment_method, subtotal, delivery_fee, quoted_delivery_fee, delivery_km, discount, total,
    dest_lat, dest_lng
  ) values (
    v_uid, trim(p_name), trim(p_phone), nullif(trim(p_email), ''), trim(p_address), trim(p_city),
    coalesce(trim(p_province), ''), nullif(trim(p_notes), ''), p_payment, 0, v_fee, v_fee, v_km, v_discount, 0,
    case when p_pinned then p_lat end, case when p_pinned then p_lng end
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'Invalid quantity'; end if;

    select * into v_product from public.products
     where id = (v_item ->> 'product_id')::bigint and active
     for update;
    if not found then raise exception 'A product in your cart is no longer available'; end if;
    if v_product.stock < v_qty then
      raise exception 'Only % left of %', v_product.stock, v_product.name;
    end if;

    update public.products set stock = stock - v_qty where id = v_product.id;
    insert into public.order_items (order_id, product_id, name, image, price, quantity)
    values (v_order.id, v_product.id, v_product.name, v_product.image, v_product.price, v_qty);
    v_subtotal := v_subtotal + v_product.price * v_qty;
  end loop;

  -- Voucher or coupon: checked on the real item total. It replaces the welcome discount when it
  -- saves more; otherwise the welcome discount stays and the voucher isn't used up.
  if coalesce(trim(p_voucher), '') <> '' then
    v_voucher := public.usable_voucher(p_voucher, v_uid, v_subtotal, true);
    v_voucher_discount := public.voucher_discount(v_voucher, v_subtotal, v_fee);
    if v_voucher_discount >= v_discount then
      v_discount := v_voucher_discount;
    else
      v_voucher := null;
    end if;
  end if;

  update public.orders
     set subtotal = v_subtotal,
         discount = v_discount,
         voucher_id = v_voucher.id,
         voucher_code = v_voucher.code,
         total = greatest(0, v_subtotal + v_fee - v_discount)
   where id = v_order.id
  returning * into v_order;

  perform public.log_order_event(v_order.id, 'pending', 'Order placed');
  return v_order;
end $$;

-- ---------------------------------------------------------------- access
alter table public.vouchers enable row level security;

-- Customers see vouchers (not coupons) that are on today; admins see everything.
create policy "vouchers: read running, admin all" on public.vouchers
  for select to authenticated
  using (
    (select public.is_admin())
    or (kind = 'voucher' and active and (select public.manila_today()) between starts_on and ends_on)
  );
create policy "vouchers: admin insert" on public.vouchers
  for insert to authenticated with check ((select public.is_admin()));
create policy "vouchers: admin update" on public.vouchers
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "vouchers: admin delete" on public.vouchers
  for delete to authenticated using ((select public.is_admin()));

revoke all on public.vouchers from anon, authenticated;
grant select, insert, update, delete on public.vouchers to authenticated;

alter publication supabase_realtime add table public.vouchers;

revoke execute on function
  public.voucher_discount(public.vouchers, numeric, numeric),
  public.usable_voucher(text, uuid, numeric, boolean)
from public, anon, authenticated;

revoke execute on function
  public.manila_today(),
  public.check_voucher(text, numeric, numeric),
  public.place_order(jsonb, text, text, text, text, text, text, text, text, double precision, double precision, boolean, numeric, text)
from public, anon;
grant execute on function
  public.manila_today(),
  public.check_voucher(text, numeric, numeric),
  public.place_order(jsonb, text, text, text, text, text, text, text, text, double precision, double precision, boolean, numeric, text)
to authenticated;

notify pgrst, 'reload schema';

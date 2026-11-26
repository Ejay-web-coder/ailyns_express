-- Distance-based delivery fee, which the rider can adjust for what they carry.
--
-- * store_settings gets the fee rule the admin sets in Settings: a base fee that covers the first
--   few km, plus a rate for each extra km started. Riders may charge up to rider_fee_max_extra more.
-- * place_order() now takes the drop-off point. It measures the distance from the store pin and
--   prices the delivery itself, so the browser can't pick its own fee. Without a store pin the fee
--   stays the flat base fee, as before.
-- * set_delivery_fee(): the assigned rider (within the cap, with a reason) or an admin changes an
--   open order's fee. The total follows, and the change is logged on the order timeline.

-- ---------------------------------------------------------------- fee rule
alter table public.store_settings
  add column delivery_base_fee numeric(10, 2) not null default 49
    check (delivery_base_fee between 0 and 10000),
  add column delivery_base_km numeric(6, 2) not null default 3
    check (delivery_base_km between 0 and 500),
  add column delivery_per_km numeric(10, 2) not null default 10
    check (delivery_per_km between 0 and 10000),
  add column rider_fee_max_extra numeric(10, 2) not null default 100
    check (rider_fee_max_extra between 0 and 10000);

grant update (delivery_base_fee, delivery_base_km, delivery_per_km, rider_fee_max_extra)
  on public.store_settings to authenticated;

-- ---------------------------------------------------------------- orders
alter table public.orders
  add column delivery_km numeric(7, 2) check (delivery_km >= 0),
  add column quoted_delivery_fee numeric(10, 2),
  add column delivery_fee_note text check (char_length(delivery_fee_note) <= 200);

-- Existing orders were all priced at checkout with the flat fee.
update public.orders set quoted_delivery_fee = delivery_fee where quoted_delivery_fee is null;
alter table public.orders alter column quoted_delivery_fee set not null;

comment on column public.orders.delivery_km is 'Distance from the store used to price the delivery (null: flat fee).';
comment on column public.orders.quoted_delivery_fee is 'Delivery fee worked out at checkout, before any rider or admin adjustment.';
comment on column public.orders.delivery_fee_note is 'Why the delivery fee was last adjusted.';

-- ---------------------------------------------------------------- helpers
-- Great-circle distance in km (same formula as distanceMeters() in src/lib/geo.ts).
create or replace function public.distance_km(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
) returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ))
$$;

create or replace function public.peso(p_amount numeric)
returns text language sql stable set search_path = '' as $$
  select '₱' || to_char(p_amount, 'FM999,999,990.00')
$$;

-- ---------------------------------------------------------------- customer API
drop function public.place_order(jsonb, text, text, text, text, text, text, text, text);

-- p_lat / p_lng: where the delivery goes, either the customer's pin (p_pinned) or their typed
-- address looked up on the map. p_road_km: the road distance the browser routed between the
-- store and that point. It is only trusted between the straight-line distance and 3× it; without
-- it the road is estimated at 1.3× the straight line. Keep in sync with src/lib/fees.ts.
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
  p_road_km numeric default null
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

  update public.orders
     set subtotal = v_subtotal,
         total = greatest(0, v_subtotal + v_fee - v_discount)
   where id = v_order.id
  returning * into v_order;

  perform public.log_order_event(v_order.id, 'pending', 'Order placed');
  return v_order;
end $$;

-- ---------------------------------------------------------------- rider / admin API
-- The assigned rider adjusts the fee for what they're carrying (heavy, bulky, many items, extra
-- stop), up to the checkout fee + rider_fee_max_extra. Admins can set any fee. A reason is always
-- required, and the customer sees it on their order timeline.
create or replace function public.set_delivery_fee(p_order uuid, p_fee numeric, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_admin boolean := public.is_admin();
  v_reason text := nullif(regexp_replace(trim(coalesce(p_reason, '')), '\s+', ' ', 'g'), '');
  v_max numeric(10, 2);
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if not v_admin then
    if v_order.rider_id is distinct from auth.uid() then
      raise exception 'This delivery is not assigned to you';
    end if;
    if not public.is_approved_rider() then raise exception 'Your rider account is not approved yet'; end if;
  end if;
  if v_order.status in ('delivered', 'cancelled') then
    raise exception 'The delivery fee can''t change after the order is %', v_order.status;
  end if;
  if p_fee is null or p_fee < 0 or p_fee > 10000 or p_fee <> round(p_fee, 2) then
    raise exception 'Enter a delivery fee between ₱0 and ₱10,000';
  end if;
  if v_reason is null then raise exception 'Add a reason, for example "2 sacks of rice"'; end if;
  if char_length(v_reason) > 200 then raise exception 'Keep the reason under 200 characters'; end if;

  if not v_admin then
    select v_order.quoted_delivery_fee + s.rider_fee_max_extra into v_max
      from public.store_settings s where s.id = 1;
    v_max := coalesce(v_max, v_order.quoted_delivery_fee);
    if p_fee > v_max then
      raise exception 'Riders can charge at most % for this order. Ask the store if it should be more.',
        public.peso(v_max);
    end if;
  end if;

  if p_fee = v_order.delivery_fee then return; end if;

  update public.orders
     set delivery_fee = p_fee,
         delivery_fee_note = v_reason,
         total = greatest(0, subtotal + p_fee - discount)
   where id = p_order;
  perform public.log_order_event(
    p_order, v_order.status,
    'Delivery fee changed from ' || public.peso(v_order.delivery_fee) || ' to ' || public.peso(p_fee) || ': ' || v_reason
  );
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function
  public.distance_km(double precision, double precision, double precision, double precision),
  public.peso(numeric)
from public, anon, authenticated;

revoke execute on function
  public.place_order(jsonb, text, text, text, text, text, text, text, text, double precision, double precision, boolean, numeric),
  public.set_delivery_fee(uuid, numeric, text)
from public, anon;
grant execute on function
  public.place_order(jsonb, text, text, text, text, text, text, text, text, double precision, double precision, boolean, numeric),
  public.set_delivery_fee(uuid, numeric, text)
to authenticated;

notify pgrst, 'reload schema';

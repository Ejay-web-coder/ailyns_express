-- Customer reviews: star ratings and feedback after delivery.
--
-- * Once an order is delivered, its customer can rate the rider (1-5 stars and an optional note)
--   and each item they got (1-5 stars and an optional comment), all at once through
--   customer_review_order(). They can change it later: sending it again replaces their review.
-- * order_reviews: one per order, for the rider. Seen only by that customer, that rider and admins.
-- * product_reviews: one per product per order. Every signed-in user can read them (they show on
--   the product page) with the reviewer's first name and last initial, never their full name.
-- * Triggers keep products.rating / review_count and profiles.rider_rating / rider_rating_count
--   up to date. A product's rating becomes the average of its reviews once it has any (until then
--   the rating the admin typed stays), and the admin form can't overwrite it after that.
-- * Admins can delete a review (for example abusive text); the averages follow.
--
-- Safe to run again.

-- ---------------------------------------------------------------- averages
alter table public.products
  add column if not exists review_count integer not null default 0 check (review_count >= 0);
alter table public.profiles
  add column if not exists rider_rating numeric(2, 1) check (rider_rating between 1 and 5),
  add column if not exists rider_rating_count integer not null default 0 check (rider_rating_count >= 0);

comment on column public.products.review_count is 'Customer reviews behind products.rating (0 = the rating is the one the admin set).';
comment on column public.profiles.rider_rating is 'Average stars customers gave this rider; null until the first rating.';

-- ---------------------------------------------------------------- tables
create table if not exists public.order_reviews (
  order_id uuid primary key references public.orders (id) on delete cascade,
  rider_id uuid references public.profiles (id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_reviews_rider_idx on public.order_reviews (rider_id, created_at desc);

create table if not exists public.product_reviews (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id bigint not null references public.products (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  reviewer_name text not null default 'Customer' check (char_length(reviewer_name) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, product_id)
);
create index if not exists product_reviews_product_idx on public.product_reviews (product_id, created_at desc);

drop trigger if exists order_reviews_touch on public.order_reviews;
create trigger order_reviews_touch before update on public.order_reviews
  for each row execute function public.touch_updated_at();
drop trigger if exists product_reviews_touch on public.product_reviews;
create trigger product_reviews_touch before update on public.product_reviews
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- keeping the averages
-- products_keep_review_rating() lets only these two functions change a reviewed product's rating.
create or replace function public.refresh_product_rating(p_product bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('ailyns.review_sync', 'on', true);
  update public.products p
     set review_count = s.n,
         rating = coalesce(s.average, p.rating)
    from (
      select count(*)::integer as n, round(avg(rating), 1) as average
        from public.product_reviews where product_id = p_product
    ) s
   where p.id = p_product;
  perform set_config('ailyns.review_sync', '', true);
end $$;

create or replace function public.refresh_rider_rating(p_rider uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles r
     set rider_rating_count = s.n,
         rider_rating = s.average
    from (
      select count(*)::integer as n, round(avg(rating), 1) as average
        from public.order_reviews where rider_id = p_rider
    ) s
   where r.id = p_rider;
end $$;

create or replace function public.product_reviews_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then perform public.refresh_product_rating(old.product_id); end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.product_id is distinct from old.product_id) then
    perform public.refresh_product_rating(new.product_id);
  end if;
  return null;
end $$;

create or replace function public.order_reviews_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and old.rider_id is not null then perform public.refresh_rider_rating(old.rider_id); end if;
  if new.rider_id is not null and (tg_op = 'INSERT' or new.rider_id is distinct from old.rider_id) then
    perform public.refresh_rider_rating(new.rider_id);
  end if;
  return null;
end $$;

drop trigger if exists product_reviews_changed on public.product_reviews;
create trigger product_reviews_changed after insert or update or delete on public.product_reviews
  for each row execute function public.product_reviews_changed();
drop trigger if exists order_reviews_changed on public.order_reviews;
create trigger order_reviews_changed after insert or update or delete on public.order_reviews
  for each row execute function public.order_reviews_changed();

-- The admin's product form sends the rating it loaded; once customers have reviewed a product,
-- their average wins. Nobody but refresh_product_rating() changes review_count.
create or replace function public.products_keep_review_rating()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('ailyns.review_sync', true), '') <> 'on' then
    new.review_count := old.review_count;
    if old.review_count > 0 then new.rating := old.rating; end if;
  end if;
  return new;
end $$;

drop trigger if exists products_keep_review_rating on public.products;
create trigger products_keep_review_rating before update on public.products
  for each row execute function public.products_keep_review_rating();

-- ---------------------------------------------------------------- customer API
-- Rate a delivered order: the rider (p_rider_rating, null = no rider rating) and items
-- (p_items = [{product_id, rating, comment}]). Replaces any earlier review of this order.
create or replace function public.customer_review_order(
  p_order uuid,
  p_rider_rating integer default null,
  p_rider_comment text default null,
  p_items jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_parts text[];
  v_reviewer text;
  v_rider_comment text := nullif(regexp_replace(trim(coalesce(p_rider_comment, '')), '\s+', ' ', 'g'), '');
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_item jsonb;
  v_product bigint;
  v_rating integer;
  v_comment text;
  v_products bigint[] := '{}';
  v_before boolean;
begin
  if v_uid is null then raise exception 'Please sign in again'; end if;
  select * into v_order from public.orders where id = p_order and customer_id = v_uid;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'delivered' then raise exception 'You can rate your order once it''s delivered'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 50 then
    raise exception 'Invalid list of items';
  end if;
  if p_rider_rating is null and jsonb_array_length(v_items) = 0 then
    raise exception 'Rate your rider or at least one item';
  end if;
  if p_rider_rating is not null then
    if v_order.rider_id is null then raise exception 'No rider is linked to this order, so there''s no rider to rate'; end if;
    if p_rider_rating not between 1 and 5 then raise exception 'Give your rider 1 to 5 stars'; end if;
  elsif v_rider_comment is not null then
    raise exception 'Pick a star rating for your rider too';
  end if;
  if char_length(v_rider_comment) > 500 then raise exception 'Keep your note for the rider under 500 characters'; end if;

  -- Shown with item reviews: first name and last initial, e.g. "Maria S.".
  select regexp_split_to_array(trim(coalesce(full_name, '')), '\s+') into v_parts
    from public.profiles where id = v_uid;
  v_reviewer := case
    when coalesce(v_parts[1], '') = '' then 'Customer'
    when cardinality(v_parts) = 1 then left(v_parts[1], 30)
    else left(v_parts[1], 30) || ' ' || upper(left(v_parts[cardinality(v_parts)], 1)) || '.'
  end;

  v_before := exists (select 1 from public.order_reviews where order_id = p_order)
           or exists (select 1 from public.product_reviews where order_id = p_order);

  if p_rider_rating is not null then
    insert into public.order_reviews (order_id, rider_id, rating, comment)
    values (p_order, v_order.rider_id, p_rider_rating, v_rider_comment)
    on conflict (order_id) do update
      set rider_id = excluded.rider_id, rating = excluded.rating, comment = excluded.comment;
  else
    delete from public.order_reviews where order_id = p_order;
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_product := (v_item ->> 'product_id')::bigint;
    v_rating := (v_item ->> 'rating')::integer;
    v_comment := nullif(regexp_replace(trim(coalesce(v_item ->> 'comment', '')), '\s+', ' ', 'g'), '');
    if v_product is null
       or not exists (select 1 from public.order_items where order_id = p_order and product_id = v_product) then
      raise exception 'You can only rate items from this order';
    end if;
    if v_product = any(v_products) then raise exception 'Each item can only be rated once'; end if;
    if v_rating is null or v_rating not between 1 and 5 then raise exception 'Give each item 1 to 5 stars'; end if;
    if char_length(v_comment) > 500 then raise exception 'Keep each comment under 500 characters'; end if;
    insert into public.product_reviews (order_id, product_id, rating, comment, reviewer_name)
    values (p_order, v_product, v_rating, v_comment, v_reviewer)
    on conflict (order_id, product_id) do update
      set rating = excluded.rating, comment = excluded.comment, reviewer_name = excluded.reviewer_name;
    v_products := v_products || v_product;
  end loop;
  delete from public.product_reviews where order_id = p_order and not (product_id = any(v_products));

  perform public.log_order_event(
    p_order, 'delivered',
    case when v_before then 'Customer updated their review: ' else 'Customer left a review: ' end
      || concat_ws(' · ',
           case when p_rider_rating is not null then 'rider ' || p_rider_rating || '★' end,
           case when cardinality(v_products) > 0
             then cardinality(v_products) || case when cardinality(v_products) = 1 then ' item' else ' items' end
                  || ' rated' end)
  );
end $$;

-- ---------------------------------------------------------------- access
alter table public.order_reviews enable row level security;
alter table public.product_reviews enable row level security;

drop policy if exists "order reviews: customer, rider, admin" on public.order_reviews;
create policy "order reviews: customer, rider, admin" on public.order_reviews
  for select to authenticated
  using (
    rider_id = (select auth.uid())
    or (select public.is_admin())
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
  );
drop policy if exists "order reviews: admin delete" on public.order_reviews;
create policy "order reviews: admin delete" on public.order_reviews
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "product reviews: signed-in read" on public.product_reviews;
create policy "product reviews: signed-in read" on public.product_reviews
  for select to authenticated using (true);
drop policy if exists "product reviews: admin delete" on public.product_reviews;
create policy "product reviews: admin delete" on public.product_reviews
  for delete to authenticated using ((select public.is_admin()));

-- Reviews are written only through customer_review_order().
revoke all on public.order_reviews, public.product_reviews from anon, authenticated;
grant select, delete on public.order_reviews, public.product_reviews to authenticated;

revoke execute on function
  public.refresh_product_rating(bigint),
  public.refresh_rider_rating(uuid),
  public.product_reviews_changed(),
  public.order_reviews_changed(),
  public.products_keep_review_rating()
from public, anon, authenticated;
revoke execute on function public.customer_review_order(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.customer_review_order(uuid, integer, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

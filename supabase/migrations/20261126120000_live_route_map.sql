-- Live route map.
--
-- The tracking map draws the route between Ailyn's store, the rider and the customer. The rider's
-- position was already stored; this adds the other two:
--   * store_settings: one row with the store's location, read by everyone signed in, set by admins.
--   * orders.dest_lat / dest_lng: the drop-off pin a customer can set at checkout. Orders without a
--     pin fall back to looking up the typed address in the browser.

alter table public.orders
  add column dest_lat double precision check (dest_lat between -90 and 90),
  add column dest_lng double precision check (dest_lng between -180 and 180);

create table public.store_settings (
  id smallint primary key default 1 check (id = 1),
  address text check (char_length(address) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
insert into public.store_settings (id) values (1);

create trigger store_settings_touch before update on public.store_settings
  for each row execute function public.touch_updated_at();

alter table public.store_settings enable row level security;
create policy "store_settings: read" on public.store_settings
  for select to authenticated using (true);
create policy "store_settings: admin update" on public.store_settings
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.store_settings from anon, authenticated;
grant select on public.store_settings to authenticated;
grant update (address, lat, lng) on public.store_settings to authenticated;

-- Customers can't write to orders directly, so the pin goes through this function.
create or replace function public.customer_set_drop_off(p_order uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid coordinates';
  end if;
  update public.orders
     set dest_lat = p_lat, dest_lng = p_lng
   where id = p_order and customer_id = (select auth.uid())
     and status not in ('delivered', 'cancelled');
  if not found then raise exception 'Order not found'; end if;
end $$;

revoke execute on function public.customer_set_drop_off(uuid, double precision, double precision) from public, anon;
grant execute on function public.customer_set_drop_off(uuid, double precision, double precision) to authenticated;

-- Photo proof of delivery.
--
-- * At the door the rider takes 1-3 photos: the order in the customer's hands (or at the door if the
--   customer would rather not be in the photo). The app shrinks them, stamps the order number and
--   time on them, and uploads them to the private `delivery-proofs` bucket as
--   <customer id>/<order id>/<file>.jpg. Keeping each customer's photos in their own folder means
--   an account deletion can remove them in one go (Storage → delivery-proofs → that folder).
-- * rider_confirm_delivery() checks the photos really were uploaded by this rider for this order,
--   then marks the order delivered and saves the photo paths on it. rider_update_status() no longer
--   accepts 'delivered', so a rider can't skip the photo. Admins can still close an order by hand.
-- * Only the order's customer, its rider and admins can see the photos. Nobody can overwrite or
--   delete them through the app (there are no update/delete policies), so they stay as evidence.
--
-- Safe to run again.

-- ---------------------------------------------------------------- orders
alter table public.orders
  add column if not exists proof_photos text[],
  add column if not exists proof_note text check (char_length(proof_note) <= 200),
  add column if not exists proof_at timestamptz;

comment on column public.orders.proof_photos is 'Storage paths (bucket delivery-proofs) of the rider''s proof-of-delivery photos.';
comment on column public.orders.proof_note is 'Optional note from the rider at drop-off, e.g. who received the order.';
comment on column public.orders.proof_at is 'When the rider confirmed the delivery with photos.';

-- ---------------------------------------------------------------- bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-proofs', 'delivery-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- helpers
-- The order a proof photo belongs to, from its path '<customer id>/<order id>/<file>'.
-- Null for any other shape, so a malformed name can never match an order.
create or replace function public.proof_order_id(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name ~* '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'
    then split_part(p_name, '/', 2)::uuid
  end
$$;

-- Upload: the approved rider assigned to the order, while it is out for delivery, at most 10 files.
create or replace function public.can_upload_delivery_proof(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_approved_rider()
    and exists (
      select 1 from public.orders o
       where o.id = public.proof_order_id(p_name)
         and o.customer_id::text = split_part(p_name, '/', 1)
         and o.rider_id = (select auth.uid())
         and o.status = 'out_for_delivery'
    )
    and (
      select count(*) from storage.objects s
       where s.bucket_id = 'delivery-proofs'
         and s.name like split_part(p_name, '/', 1) || '/' || split_part(p_name, '/', 2) || '/%'
    ) < 10
$$;

-- View: the order's customer, its rider, or an admin.
create or replace function public.can_view_delivery_proof(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders o
     where o.id = public.proof_order_id(p_name)
       and o.customer_id::text = split_part(p_name, '/', 1)
       and (
         o.customer_id = (select auth.uid())
         or o.rider_id = (select auth.uid())
         or public.is_admin()
       )
  )
$$;

-- ---------------------------------------------------------------- storage policies
drop policy if exists "delivery proofs: assigned rider uploads" on storage.objects;
create policy "delivery proofs: assigned rider uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'delivery-proofs' and public.can_upload_delivery_proof(name));

drop policy if exists "delivery proofs: customer, rider and admin view" on storage.objects;
create policy "delivery proofs: customer, rider and admin view" on storage.objects
  for select to authenticated
  using (bucket_id = 'delivery-proofs' and public.can_view_delivery_proof(name));

-- ---------------------------------------------------------------- rider API
create or replace function public.rider_confirm_delivery(p_order uuid, p_photos text[], p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old public.order_status;
  v_count integer := coalesce(cardinality(p_photos), 0);
  v_note text := nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), '');
begin
  if not public.is_approved_rider() then raise exception 'Your rider account is not approved yet'; end if;
  select status into v_old from public.orders where id = p_order and rider_id = v_uid for update;
  if not found then raise exception 'This delivery is not assigned to you'; end if;
  if v_old = 'delivered' then raise exception 'This order is already delivered'; end if;
  if v_old <> 'out_for_delivery' then
    raise exception 'Mark the order as picked up before you deliver it';
  end if;
  if v_count = 0 then raise exception 'Take a photo of the order being handed over first'; end if;
  if v_count > 3 then raise exception 'Add at most 3 photos'; end if;
  if char_length(v_note) > 200 then raise exception 'Keep the note under 200 characters'; end if;
  if (select count(distinct p) from unnest(p_photos) p) <> v_count
     or exists (
       select 1 from unnest(p_photos) as p(name)
        where public.proof_order_id(p.name) is distinct from p_order
           or not exists (
             select 1 from storage.objects s
              where s.bucket_id = 'delivery-proofs' and s.name = p.name and s.owner_id = v_uid::text
           )
     ) then
    raise exception 'A photo didn''t finish uploading. Please try again.';
  end if;

  update public.orders
     set status = 'delivered', proof_photos = p_photos, proof_note = v_note, proof_at = now()
   where id = p_order;
  perform public.log_order_event(
    p_order, 'delivered',
    'Delivered by rider with ' || v_count || case when v_count = 1 then ' photo' else ' photos' end
      || ' as proof' || coalesce(' · ' || v_note, '')
  );
end $$;

-- Riders finish a delivery only through rider_confirm_delivery() (with photos).
create or replace function public.rider_update_status(p_order uuid, p_status public.order_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.order_status;
begin
  select status into v_old from public.orders
   where id = p_order and rider_id = auth.uid() for update;
  if not found then raise exception 'This delivery is not assigned to you'; end if;
  if p_status = 'delivered' then
    raise exception 'Take a proof-of-delivery photo to finish this delivery. If you don''t see the camera button, refresh the app.';
  end if;
  if not (p_status = 'out_for_delivery' and v_old in ('confirmed', 'preparing', 'ready')) then
    raise exception 'Cannot move order from % to %', v_old, p_status;
  end if;
  update public.orders set status = p_status where id = p_order;
  perform public.log_order_event(p_order, p_status, 'Rider picked up the order');
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.proof_order_id(text) from public, anon, authenticated;
revoke execute on function
  public.can_upload_delivery_proof(text),
  public.can_view_delivery_proof(text),
  public.rider_confirm_delivery(uuid, text[], text)
from public, anon;
-- The storage policies run these as the signed-in user.
grant execute on function
  public.can_upload_delivery_proof(text),
  public.can_view_delivery_proof(text),
  public.rider_confirm_delivery(uuid, text[], text)
to authenticated;

notify pgrst, 'reload schema';

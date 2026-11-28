-- GCash QR payments, checked by the admin.
--
-- * Settings → "GCash payments": the admin uploads the store's GCash QR (public bucket
--   `store-assets`) with the account name and number. Until a QR is uploaded, GCash works as
--   before: the customer pays the rider on arrival.
-- * With a QR set, a GCash order starts as payment_status 'unpaid'. The customer places the order
--   first, so the amount is final (delivery fee and voucher included), then scans the QR, pays, and
--   sends the GCash reference number with a screenshot of the receipt (private bucket
--   `payment-proofs`, as <customer id>/<order id>/<file>). The payment is then 'submitted'.
-- * The order stays Pending until the admin compares the reference number on the screenshot with
--   the one the customer typed and with the store's GCash history. Verifying it ('verified') also
--   confirms the order. Not accepting it ('rejected', with a reason the customer sees) lets the
--   customer send a new receipt.
-- * The database won't move a GCash order past Pending until its payment is verified, won't take a
--   reference number that's already on another order, and won't let a customer cancel once they've
--   sent a payment (the admin cancels and refunds instead).
--
-- Safe to run again. Doesn't touch place_order(), so it works with or without the vouchers migration.

-- ---------------------------------------------------------------- store settings
alter table public.store_settings
  add column if not exists gcash_name text check (char_length(gcash_name) <= 80),
  add column if not exists gcash_number text check (char_length(gcash_number) <= 20),
  add column if not exists gcash_qr_path text check (char_length(gcash_qr_path) <= 300);

comment on column public.store_settings.gcash_qr_path is 'Path (bucket store-assets) of the store''s GCash QR. Null = GCash is paid to the rider on arrival.';

grant update (gcash_name, gcash_number, gcash_qr_path) on public.store_settings to authenticated;

-- ---------------------------------------------------------------- orders
alter table public.orders
  add column if not exists payment_status text
    check (payment_status in ('unpaid', 'submitted', 'verified', 'rejected')),
  add column if not exists gcash_reference text check (char_length(gcash_reference) between 6 and 30),
  add column if not exists payment_proof text check (char_length(payment_proof) <= 300),
  add column if not exists payment_submitted_at timestamptz,
  add column if not exists payment_reviewed_at timestamptz,
  add column if not exists payment_reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists payment_note text check (char_length(payment_note) <= 200),
  add column if not exists paid_amount numeric(10, 2) check (paid_amount >= 0);

comment on column public.orders.payment_status is 'GCash QR payment: unpaid → submitted → verified, or rejected (customer resends). Null for cash and for GCash paid to the rider.';
comment on column public.orders.gcash_reference is 'Reference number the customer typed from their GCash receipt (letters and digits only).';
comment on column public.orders.payment_proof is 'Storage path (bucket payment-proofs) of the customer''s receipt screenshot.';
comment on column public.orders.payment_note is 'Why the admin didn''t accept the payment, or an optional note when verifying it.';
comment on column public.orders.paid_amount is 'What the admin received in GCash. The rider collects any rest.';

create index if not exists orders_gcash_reference_idx on public.orders (gcash_reference)
  where gcash_reference is not null;

-- New GCash orders wait for payment once the store has a QR; everything else has no payment status.
create or replace function public.orders_payment_on_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.payment_status := case
    when new.payment_method = 'gcash'
     and exists (select 1 from public.store_settings where id = 1 and gcash_qr_path is not null)
    then 'unpaid'
  end;
  new.gcash_reference := null;
  new.payment_proof := null;
  new.payment_submitted_at := null;
  new.payment_reviewed_at := null;
  new.payment_reviewed_by := null;
  new.payment_note := null;
  new.paid_amount := null;
  return new;
end $$;

drop trigger if exists orders_payment_insert on public.orders;
create trigger orders_payment_insert before insert on public.orders
  for each row execute function public.orders_payment_on_insert();

-- Status changes that would skip the payment check, from any path (admin dropdown, RPCs).
create or replace function public.orders_payment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status not in ('pending', 'cancelled')
       and new.payment_status in ('unpaid', 'submitted', 'rejected') then
      raise exception using message = case new.payment_status
        when 'submitted' then 'Check the customer''s GCash payment first. Verifying it confirms the order.'
        else 'This order is still waiting for the customer''s GCash payment.'
      end;
    end if;
    if new.status = 'cancelled' and old.payment_status in ('submitted', 'verified')
       and public.my_role() = 'customer' then
      raise exception 'You already sent a GCash payment for this order. Message Ailyn''s to cancel it so they can refund you.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_payment_guard on public.orders;
create trigger orders_payment_guard before update on public.orders
  for each row execute function public.orders_payment_guard();

-- ---------------------------------------------------------------- buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public: the store's GCash QR is meant to be shown to every customer.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-assets', 'store-assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- helpers
-- The order a receipt screenshot belongs to, from its path '<customer id>/<order id>/<file>'.
-- Null for any other shape, so a malformed name can never match an order.
create or replace function public.payment_proof_order_id(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'
    then split_part(p_name, '/', 2)::uuid
  end
$$;

-- Upload: the order's own customer, while its GCash payment is due, at most 10 files per order.
create or replace function public.can_upload_payment_proof(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.orders o
       where o.id = public.payment_proof_order_id(p_name)
         and o.customer_id = (select auth.uid())
         and o.customer_id::text = split_part(p_name, '/', 1)
         and o.payment_status in ('unpaid', 'rejected')
         and o.status <> 'cancelled'
    )
    and (
      select count(*) from storage.objects s
       where s.bucket_id = 'payment-proofs'
         and s.name like split_part(p_name, '/', 1) || '/' || split_part(p_name, '/', 2) || '/%'
    ) < 10
$$;

-- View: the order's customer or an admin.
create or replace function public.can_view_payment_proof(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders o
     where o.id = public.payment_proof_order_id(p_name)
       and o.customer_id::text = split_part(p_name, '/', 1)
       and (o.customer_id = (select auth.uid()) or public.is_admin())
  )
$$;

-- ---------------------------------------------------------------- storage policies
drop policy if exists "payment proofs: customer uploads" on storage.objects;
create policy "payment proofs: customer uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and public.can_upload_payment_proof(name));

drop policy if exists "payment proofs: customer and admin view" on storage.objects;
create policy "payment proofs: customer and admin view" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and public.can_view_payment_proof(name));

drop policy if exists "store assets: admin uploads" on storage.objects;
create policy "store assets: admin uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-assets' and public.is_admin());

-- ---------------------------------------------------------------- customer API
create or replace function public.customer_submit_gcash_payment(p_order uuid, p_reference text, p_proof text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_ref text := upper(regexp_replace(coalesce(p_reference, ''), '[^A-Za-z0-9]', '', 'g'));
  v_other text;
begin
  if v_uid is null then raise exception 'Please sign in again'; end if;
  select * into v_order from public.orders where id = p_order and customer_id = v_uid for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_method <> 'gcash' or v_order.payment_status is null then
    raise exception 'This order isn''t paid online with GCash';
  end if;
  if v_order.status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if v_order.payment_status = 'submitted' then
    raise exception 'Your payment is already with Ailyn''s for checking';
  end if;
  if v_order.payment_status = 'verified' then raise exception 'Your payment was already verified'; end if;
  if char_length(v_ref) not between 6 and 30 then
    raise exception 'Type the reference number (Ref No.) from your GCash receipt';
  end if;
  if public.payment_proof_order_id(p_proof) is distinct from p_order
     or split_part(p_proof, '/', 1) <> v_uid::text
     or not exists (
       select 1 from storage.objects s
        where s.bucket_id = 'payment-proofs' and s.name = p_proof and s.owner_id = v_uid::text
     ) then
    raise exception 'Your screenshot didn''t finish uploading. Please try again.';
  end if;
  select code into v_other from public.orders
   where gcash_reference = v_ref and id <> p_order and payment_status in ('submitted', 'verified')
   limit 1;
  if found then
    raise exception 'That reference number is already on another order. Check the Ref No. on your receipt.';
  end if;

  update public.orders
     set payment_status = 'submitted',
         gcash_reference = v_ref,
         payment_proof = p_proof,
         payment_submitted_at = now(),
         payment_note = null,
         payment_reviewed_at = null,
         payment_reviewed_by = null
   where id = p_order;
  perform public.log_order_event(
    p_order, v_order.status, 'GCash payment sent · Ref ' || v_ref || ' · waiting for the store to check it'
  );
end $$;

-- ---------------------------------------------------------------- admin API
-- Verify (confirms a pending order) or don't accept (reason required, the customer resends).
create or replace function public.admin_review_gcash_payment(
  p_order uuid, p_approve boolean, p_amount numeric default null, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_note text := nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), '');
  v_amount numeric(10, 2);
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if v_order.payment_status is distinct from 'submitted' then
    raise exception 'There''s no GCash payment waiting to be checked on this order';
  end if;
  if char_length(v_note) > 200 then raise exception 'Keep the note under 200 characters'; end if;

  if coalesce(p_approve, false) then
    v_amount := round(coalesce(p_amount, v_order.total), 2);
    if v_amount <= 0 or v_amount > 1000000 then
      raise exception 'Enter the amount you received in GCash';
    end if;
    update public.orders
       set payment_status = 'verified',
           paid_amount = v_amount,
           payment_note = v_note,
           payment_reviewed_at = now(),
           payment_reviewed_by = auth.uid(),
           status = case when status = 'pending' then 'confirmed'::public.order_status else status end
     where id = p_order
    returning * into v_order;
    perform public.log_order_event(
      p_order, v_order.status,
      'GCash payment verified · Ref ' || v_order.gcash_reference || ' · ' || public.peso(v_amount) || ' received'
        || case when v_amount < v_order.total
             then ' · ' || public.peso(v_order.total - v_amount) || ' left to pay the rider'
             else '' end
        || coalesce(' · ' || v_note, '')
    );
  else
    if v_note is null then raise exception 'Tell the customer why the payment can''t be accepted'; end if;
    update public.orders
       set payment_status = 'rejected',
           payment_note = v_note,
           payment_reviewed_at = now(),
           payment_reviewed_by = auth.uid()
     where id = p_order;
    perform public.log_order_event(p_order, v_order.status, 'GCash payment not accepted: ' || v_note);
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function
  public.payment_proof_order_id(text),
  public.orders_payment_on_insert(),
  public.orders_payment_guard()
from public, anon, authenticated;
revoke execute on function
  public.can_upload_payment_proof(text),
  public.can_view_payment_proof(text),
  public.customer_submit_gcash_payment(uuid, text, text),
  public.admin_review_gcash_payment(uuid, boolean, numeric, text)
from public, anon;
-- The storage policies run the can_* checks as the signed-in user.
grant execute on function
  public.can_upload_payment_proof(text),
  public.can_view_payment_proof(text),
  public.customer_submit_gcash_payment(uuid, text, text),
  public.admin_review_gcash_payment(uuid, boolean, numeric, text)
to authenticated;

notify pgrst, 'reload schema';

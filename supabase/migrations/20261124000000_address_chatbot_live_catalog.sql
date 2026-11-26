-- Follow-up fixes:
--   * saved delivery address lives on the profile (follows the customer across devices)
--   * products join the realtime publication, so catalog edits reach open sessions live
--   * the chatbot gets real data: admin-managed suggested questions and a question log
--   * one starter product image that no longer resolves is replaced

-- ---------------------------------------------------------------- saved address
alter table public.profiles
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists province text;

grant update (address, city, province) on public.profiles to authenticated;

-- ---------------------------------------------------------------- live catalog
alter publication supabase_realtime add table public.products;

update public.products
   set image = 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=900&q=85'
 where image like '%photo-1571212515416-fca77afa1b1f%';

-- ---------------------------------------------------------------- chatbot
create table public.chat_suggestions (
  id bigint generated always as identity primary key,
  question text not null check (char_length(trim(question)) between 3 and 120),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.chat_logs (
  id bigint generated always as identity primary key,
  customer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) <= 2000),
  product_id bigint references public.products (id) on delete set null,
  matched boolean not null default false,
  created_at timestamptz not null default now()
);
create index chat_logs_created_idx on public.chat_logs (created_at desc);
create index chat_logs_customer_idx on public.chat_logs (customer_id);
create index chat_logs_product_idx on public.chat_logs (product_id);

alter table public.chat_suggestions enable row level security;
alter table public.chat_logs enable row level security;

create policy "chat_suggestions: read active, admin all" on public.chat_suggestions
  for select to authenticated
  using (active or (select public.is_admin()));
create policy "chat_suggestions: admin insert" on public.chat_suggestions
  for insert to authenticated with check ((select public.is_admin()));
create policy "chat_suggestions: admin update" on public.chat_suggestions
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "chat_suggestions: admin delete" on public.chat_suggestions
  for delete to authenticated using ((select public.is_admin()));

-- Customers can only add their own questions; only admins read the log.
create policy "chat_logs: write own" on public.chat_logs
  for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "chat_logs: admin read" on public.chat_logs
  for select to authenticated using ((select public.is_admin()));

revoke all on public.chat_suggestions, public.chat_logs from anon, authenticated;
grant select, insert, update, delete on public.chat_suggestions to authenticated;
grant select, insert on public.chat_logs to authenticated;

insert into public.chat_suggestions (question, sort_order) values
  ('What''s in Chicken Adobo?', 1),
  ('Recommend a meal', 2),
  ('Do you have cooking oil?', 3),
  ('How much is delivery?', 4),
  ('Where is my order?', 5);

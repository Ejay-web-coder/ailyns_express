-- Ailyn AI (Gemini) support.
--
-- The ailyn-chat Edge Function runs as the calling customer and limits how many questions each
-- customer can send per minute and per day by counting their own chat_logs rows. Customers can
-- now read their own questions (only their own); admins keep reading everything.

create policy "chat_logs: read own" on public.chat_logs
  for select to authenticated
  using (customer_id = (select auth.uid()));

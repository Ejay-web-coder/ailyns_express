# Ailyn's Express

Food and grocery delivery with three connected portals:

| Portal | What it does |
| --- | --- |
| **Customer** | Browse food and groceries, check out (cash on delivery, or GCash by scanning the store's QR and sending the receipt), track the order live: status timeline, rider details and rider GPS on the map. |
| **Rider** | Apply with vehicle details, wait for admin approval, set themselves as available, accept open jobs, mark *picked up* → *delivered*, and share live location. |
| **Admin** | Confirm and prepare orders, assign riders, approve or suspend riders, run vouchers and coupons for special days, and manage products and stock, customers and sales reports. |

All three share the same order row, so every change shows up for the others in real time (Supabase Realtime).

```
Customer places order ──► Admin confirms / prepares ──► Rider accepts & picks up ──► Rider delivers
        ▲                                                                                  │
        └──────────── live status timeline + rider location on the customer's map ◄────────┘
```

## Stack

- React 19 + Vite + Tailwind 4 (static SPA, deployable to Vercel)
- Supabase: Auth (email/password, Google), Postgres with RLS, Realtime

## Local development

```bash
cp .env.example .env.local   # fill in your Supabase URL and publishable key
npm install
npm run dev                  # http://localhost:4173
```

## Supabase setup

1. **Database:** apply the SQL files in `supabase/migrations/` in order (SQL editor, `supabase db push`, or the Supabase MCP).
   - `…_ailyns_express_core.sql`: roles, products, orders, order items and events, RLS, RPCs, realtime
   - `…_seed_products.sql`: starter catalog
   - `…_address_chatbot_live_catalog.sql`: saved address on the profile, live product updates, chatbot suggested questions + question log
   - `…_chat_logs_read_own.sql`: customers can read their own chat questions (used by the AI chat's per-customer limit)
   - `…_live_route_map.sql`: the store's location (one row, set by an admin under **Settings → Ailyn's store location**) and the optional drop-off pin customers set at checkout. The live map uses them to draw the route store → rider → customer.
   - `…_delivery_proof_photos.sql`: the private `delivery-proofs` storage bucket and the photo-proof step riders must complete to mark an order delivered (see below). Deploy the frontend **before** running it: once it's applied, the database refuses "delivered" from riders without photos, which an older app version doesn't send.
   - `…_gcash_qr_payments.sql`: GCash QR payments checked by an admin (see below): the public `store-assets` bucket for the store's QR, the private `payment-proofs` bucket for receipt screenshots, the order payment columns and their guards.
   - `…_customer_reviews.sql`: star ratings and feedback for riders and items after delivery (see below), plus the averages on products and rider profiles.
2. **Auth → URL configuration:** set **Site URL** to the production URL (e.g. `https://ailyns-express.vercel.app`) and add it plus `http://localhost:4173` to **Redirect URLs**. Password-reset and email-confirmation links fall back to the Site URL when the redirect isn't on this list, so a leftover `http://localhost:3000` breaks them.
3. **Auth → Providers → Google:** create an OAuth client in Google Cloud Console (APIs & Services → Credentials → OAuth client ID → *Web application*). Add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI, then paste the client ID and secret into Supabase.
4. *(Optional)* Under **Auth → Providers → Email**, turn off "Confirm email" if new users should be able to sign in without confirming their email address first.

### Creating the first admin

Self sign-up can only create **customer** or **rider** accounts. To make an admin, sign up once (any portal), then run:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

### Riders

Riders sign up from the Rider portal (or `/?portal=rider`; admins can copy this link from **Riders**). New riders appear in **Admin → Riders** as *Pending review* until an admin approves them. Approved riders who are available see confirmed, unassigned orders as open jobs.

Signing in with Google from the Rider portal converts a brand-new account into a rider account. An existing customer account that already has orders is never converted.

## Order status flow

`pending` → `confirmed` → `preparing` → `ready` → `out_for_delivery` → `delivered` (or `cancelled`)

- Customers can cancel while the order is `pending`; stock is restored automatically.
- Admins can set any status and assign or unassign approved riders.
- Riders can accept unassigned `confirmed`/`preparing`/`ready` orders, release them before pickup, then move them to `out_for_delivery` and `delivered`. Delivering needs a photo (see below).

### Proof of delivery

At the door, the rider takes 1–3 photos with the phone camera: the order in the customer's hands (with the customer if they agree), or the order at the door if the customer would rather not be photographed. The app shrinks each photo to at most 1600 px, stamps `Ailyn's Express · #<order code> · <date and time>` along the bottom, and uploads it to the private `delivery-proofs` bucket as `<customer id>/<order id>/<file>.jpg`. `rider_confirm_delivery()` checks that the photos were really uploaded by that rider for that order, then marks the order delivered and saves the photo paths and the rider's optional note on it.

- Only the order's customer, its rider and admins can open the photos (signed links that expire after an hour). There are no update or delete policies, so nobody can replace or remove a photo from the app.
- Customers see the photos on their tracking page and in **Order details**. Admins and riders see them in the order details. For admins, a delivered order with no photo (closed by hand) says so.
- Admins can still mark an order delivered without a photo from the admin portal.
- **Account deletion:** deleting the user in Supabase removes their orders but not their files. Also delete their folder (named with their user id) under **Storage → delivery-proofs**.

### GCash payments

An admin uploads the store's GCash QR, account name and number under **Settings → GCash payments**. Until a QR is uploaded, GCash means paying the rider on arrival, as before.

With a QR set, a customer who chooses GCash places the order first (so the total is final), then on the confirmation or tracking page scans the QR, pays, types the GCash reference number (Ref No.) and adds a screenshot of the receipt. The order stays `pending` with payment `submitted` until an admin opens it (**Orders → GCash to check**), compares the Ref No. on the screenshot with the one typed and with the store's GCash history, and either verifies it (this also confirms the order; if less than the total arrived, the rider collects the rest) or doesn't accept it with a reason the customer sees, so they can send a new receipt.

- The database won't move a GCash order past `pending` until its payment is verified, won't take a reference number that's already on another order, and won't let a customer cancel once they've sent a payment. The admin cancels and refunds instead.
- Receipts are in the private `payment-proofs` bucket as `<customer id>/<order id>/<file>`; only that customer and admins can open them. When deleting an account, also delete the user's folder there.
- Unpaid GCash orders don't expire on their own: cancel them from the admin portal.

### Ratings and reviews

Once an order is delivered, the customer can rate it from the tracking page or **My orders → Rate order**: 1–5 stars and an optional note for the rider, and 1–5 stars and an optional comment for each item. Sending it again replaces their review. Everything goes through `customer_review_order()`, which checks the order is theirs and delivered.

- **Items:** reviews show on the product page with the reviewer's first name and last initial. A product's ★ rating becomes the average of its reviews once it has any (the admin's rating field turns read-only then).
- **Riders:** the average shows to customers on the tracking page, to the rider under **History**, and to admins under **Riders**. The note for the rider is seen only by that rider and admins.
- **Admin → Reviews** lists everything newest first, flags 1–2 star reviews, and can delete a review that's abusive or not about the order; the averages update by themselves. New reviews also appear in the notification bell and in the order's details.

All writes to orders go through `SECURITY DEFINER` functions (`place_order`, `admin_update_order_status`, `rider_accept_order`, …). These recompute prices, check stock and enforce the allowed transitions, so the browser can't tamper with totals or skip steps.

## Chatbot ("Ask Ailyn AI")

The customer assistant is powered by **Google Gemini** through the Supabase Edge Function `supabase/functions/ailyn-chat`. For each question the function loads the live catalog (availability, price, ingredients) and the customer's own last 5 orders, then asks Gemini for a short answer, up to 3 product cards and whether to show "Track my order". It answers in the customer's language, including Filipino and Taglish.

- **Setup:** create a key at [Google AI Studio](https://aistudio.google.com/apikey), then in Supabase go to **Edge Functions → Secrets** and add `GEMINI_API_KEY`. The key lives only on the server and is never in the website code. Optional: `GEMINI_MODEL` picks a different model (default `gemini-3.5-flash-lite`).
- **Deploy:** `supabase functions deploy ailyn-chat --no-verify-jwt` (the function checks the signed-in user itself).
- **Privacy:** Gemini gets the question, the catalog and order codes, status, totals and items. It never gets the customer's name, phone number or address.
- **Limits:** 8 questions per minute and 80 per day per customer. This needs the `…_chat_logs_read_own.sql` migration.
- **Fallback:** with no key configured, over the limit or during a Gemini outage, the chat answers from built-in keyword rules (delivery fee, payment, tracking, product lookup), so it never stops working.

Every question is saved to `chat_logs`. Customers can read only their own rows; admins can read all. **Admin → Chatbot** shows question counts, the share of questions the bot understood, top questions and the ones it couldn't answer. Admins also edit the suggested quick-reply questions (`chat_suggestions`) there: add, reorder, hide or delete.

## Installable app (PWA) and screen sizes

The site can be installed like an app on Android, iPhone/iPad, Windows, Mac and Chromebook. The landing page has an **Install app** button and a **Get the app** section. Chrome, Edge and Samsung Internet show a one-tap install dialog; Safari and other browsers get step-by-step instructions for the visitor's device.

- `public/manifest.webmanifest`: app name, colors, icons and home-screen shortcuts (Order, Rider portal, Admin dashboard)
- `public/icons/`: icons made from `branding/app-icon-1024.png`
- `public/sw.js`: service worker, registered only in production builds. Pages always load from the network; static files are cached and refreshed in the background; `public/offline.html` is shown when there's no connection. Supabase calls are never cached. Bump `VERSION` in `sw.js` when you change its caching rules.

Layout tiers (in `src/index.css` and `src/roles.css`): desktop above 1100px, small desktop ≤1100px, tablet ≤850px (bottom tab bar for customers and riders; admin sidebar slides in from the menu button), phone ≤600px, small phone ≤380px.

## Deploying to Vercel

Import the GitHub repo into Vercel (framework preset: Vite) and set the environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

`vercel.json` already rewrites SPA routes to `index.html`.

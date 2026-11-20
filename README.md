# Ailyn's Express

Food and grocery delivery with three connected portals:

| Portal | What it does |
| --- | --- |
| **Customer** | Browse food and groceries, check out (COD / GCash on arrival), track the order live: status timeline, rider details and rider GPS on the map. |
| **Rider** | Apply with vehicle details, wait for admin approval, go online, accept open jobs, mark *picked up* → *delivered*, and share live location. |
| **Admin** | Confirm and prepare orders, assign riders, approve or suspend riders, and manage products, inventory, customers and reports. |

All three share the same order row, so every change shows up for the others in real time (Supabase Realtime).

```
Customer places order ──► Admin confirms / prepares ──► Rider accepts & picks up ──► Rider delivers
        ▲                                                                                  │
        └──────────── live status timeline + rider location on the customer's map ◄────────┘
```

## Stack

- React 19 + Vite + Tailwind 4 (static SPA, deployable to Vercel)
- Supabase: Auth (email/password, Google, Facebook), Postgres with RLS, Realtime

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
2. **Auth → URL configuration:** set **Site URL** to the production URL (e.g. `https://ailyns-express.vercel.app`) and add it plus `http://localhost:4173` to **Redirect URLs**.
3. **Auth → Providers → Google:** create an OAuth client in Google Cloud Console (APIs & Services → Credentials → OAuth client ID → *Web application*). Add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI, then paste the client ID and secret into Supabase.
4. **Auth → Providers → Facebook:** create an app at developers.facebook.com, add *Facebook Login*, set the valid OAuth redirect URI to the same `…/auth/v1/callback`, then paste the App ID and secret into Supabase.
5. *(Optional)* Under **Auth → Providers → Email**, turn off "Confirm email" if new users should be able to sign in without confirming their email address first.

### Creating the first admin

Self sign-up can only create **customer** or **rider** accounts. To make an admin, sign up once (any portal), then run:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

### Riders

Riders sign up from the Rider portal (or `/?portal=rider`; admins can copy this link from **Riders**). New riders appear in **Admin → Riders** as *Pending review* until an admin approves them. Approved riders who are online see confirmed, unassigned orders as open jobs.

Signing in with Google or Facebook from the Rider portal converts a brand-new account into a rider account. An existing customer account that already has orders is never converted.

## Order status flow

`pending` → `confirmed` → `preparing` → `ready` → `out_for_delivery` → `delivered` (or `cancelled`)

- Customers can cancel while the order is `pending`; stock is restored automatically.
- Admins can set any status and assign or unassign approved riders.
- Riders can accept unassigned `confirmed`/`preparing`/`ready` orders, release them before pickup, then move them to `out_for_delivery` and `delivered`.

All writes to orders go through `SECURITY DEFINER` functions (`place_order`, `admin_update_order_status`, `rider_accept_order`, …). These recompute prices, check stock and enforce the allowed transitions, so the browser can't tamper with totals or skip steps.

## Deploying to Vercel

Import the GitHub repo into Vercel (framework preset: Vite) and set the environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

`vercel.json` already rewrites SPA routes to `index.html`.

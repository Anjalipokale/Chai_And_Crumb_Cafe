# Café Ordering Prototype (Astrra Tech assessment)

Customer menu, cart, pickup/delivery checkout, mock payment, order tracking, admin area and delivery-member view.
**Stack:** Node.js + Express, SQLite (better-sqlite3), JWT auth + bcrypt, vanilla JS frontend served by Express (one deployable service).
Why: one service keeps deployment, CORS and HTTPS simple; SQLite needs no setup for a prototype (swap to Postgres for production, see below).

## Run locally
```bash
npm install
cp .env.example .env      # then set JWT_SECRET and PAYMENT_SECRET to long random values
npm run seed              # optional: the server also seeds an empty DB on start
npm start                 # http://localhost:3000
npm test                  # smoke test of the main order flow and access control
```
Environment variables: `PORT, JWT_SECRET, PAYMENT_SECRET, SITE_URL, CORS_ORIGIN, DB_PATH, SERVICE_PINCODES, DELIVERY_FEE, FREE_DELIVERY_ABOVE, ENABLE_MOCK_PAYMENT, BUSINESS_NAME, BUSINESS_CITY, BUSINESS_ADDRESS, BUSINESS_PHONE`.
Set `BUSINESS_*` to accurate details only (they feed the JSON-LD schema).

**Demo logins (test data only)** — Admin `admin@cafe.test / Admin@123`; Delivery `rider1@cafe.test / Rider@123` (also `rider2@cafe.test`). Seed data: 12 menu items and 3 sample orders. Serviceable pincodes: 414001, 414002, 414003.

## Test the main flow
1. Open `/`, add items, choose Delivery, enter pincode `414001` (try `999999` to see the area check), place the order.
2. On the tracking page use **Pay** (mock gateway). Also try *Simulate failure / pending*.
3. `/admin` as Admin: Accept → Preparing → Ready, assign a rider, then log in as rider1 to mark Out for Delivery → Delivered.

## Data model
`users(id,name,email,password_hash,role[admin|delivery])` · `menu_items(id,category,name,description,price,active)` · `orders(id,ref,customer_name,phone,type,address,pincode,subtotal,delivery_fee,total,status,payment_status,payment_id,assigned_to→users,created_at)` · `order_items(order_id→orders,menu_item_id,name,price,qty)` (name/price are snapshots) · `order_events(order_id,status,user_id→users,note,at)` (audit trail: who changed what).

## API
Public: `GET /api/menu`, `POST /api/quote`, `POST /api/orders`, `GET /api/orders/:ref`, `POST /api/mock-gateway/charge`, `POST /api/orders/:ref/verify-payment`.
Auth: `POST /api/auth/login`. Admin: `GET /api/admin/orders|menu|delivery-members`, `POST /api/admin/menu`, `PUT /api/admin/menu/:id` (disable = `active:false`), `PATCH /api/orders/:ref/assign`.
Admin or assigned Delivery: `PATCH /api/orders/:ref/status`. Delivery: `GET /api/delivery/orders`.

## Order stages
Placed, Accepted, Preparing, Ready, Out for Delivery, Delivered, Cancelled — all implemented. Pickup orders skip Out for Delivery. "Reject" is Cancelled from Placed. Transitions are enforced on the server; delivery members may only set Out for Delivery/Delivered on orders assigned to them.

## Security notes
Passwords hashed with bcrypt; JWT (8h) in sessionStorage; secrets only in env; totals and delivery fee computed on the server (client prices are ignored); input validated; parameterised SQL; helmet headers; login throttling; customers track by an unguessable random reference and the public view hides phone/address. Not production-complete: no refunds on cancel, no CSRF needed (bearer tokens) but token-in-storage is XSS-sensitive; the UI uses `textContent`-style DOM building to avoid XSS.

## Payment flow
Mock gateway mirrors Razorpay: the order is created `Pending`; the "gateway" returns `paymentId + signature` (HMAC-SHA256 with a server-only secret); the browser sends these to `/verify-payment`; the server recomputes the HMAC, rejects mismatches, maps success→Paid, failure→Failed, pending→Pending, and is idempotent (a Paid order is never downgraded).
**Real Razorpay:** create the Razorpay order on the server with the amount from our DB; the frontend uses only the public key id; verify `HMAC_SHA256(order_id|payment_id, key_secret)` on the server; also handle the `payment.captured` / `payment.failed` webhook (verify `X-Razorpay-Signature`) because the browser can close before calling us; treat orders as unpaid until verified; never expose the key secret. Set `ENABLE_MOCK_PAYMENT=false` in real deployments.
**Courier (Shiprocket):** not needed for own-staff delivery. For a parcel business it would sit after "Ready": create a Shiprocket order from the order's address and weight, store the AWB/tracking number on the order, and update status from Shiprocket webhooks.

## Deployment (Render free tier example)
1. Push to GitHub. Create a Render *Web Service* from the repo: build `npm install`, start `npm start`. Frontend and API share one URL, so CORS is not needed (`CORS_ORIGIN` stays empty); if the frontend is hosted separately, set `CORS_ORIGIN` to its exact origin.
2. Set env vars in the dashboard (never commit `.env`): `JWT_SECRET`, `PAYMENT_SECRET`, `SITE_URL=https://<your-app>.onrender.com`, `BUSINESS_*`.
3. HTTPS is automatic on Render (managed Let's Encrypt certificates, auto-renewed).
4. **Database caveat:** free web services have an ephemeral disk, so SQLite data resets on redeploy. For persistence, attach a disk and set `DB_PATH` to it, or move to free Postgres (Neon/Supabase). The app re-seeds an empty DB so the demo still works.
5. Custom domain (documented only, nothing purchased): add the domain in the host, create a `CNAME` (subdomain) or `A/ALIAS` (apex) record as shown, wait for DNS, and the host issues the certificate. SSL renewal is automatic; monitor expiry with an uptime checker and keep DNS records unchanged.
**Live URL / API URL:** _fill in after deploying_.

## Troubleshooting a deployment issue
- **500:** read the service logs for the stack trace and request path; reproduce with `curl` against the endpoint; check recent deploys and env vars.
- **502/504:** the process is not listening or crashed — confirm it binds `process.env.PORT`, check the start command, memory limits and boot logs.
- **Failed API request:** browser Network tab (status, response body), then CORS (`CORS_ORIGIN` exact match, https vs http), then auth (expired token → 401).
- **DB connection failure:** verify `DB_PATH`/connection string, disk mount and permissions, migrations ran, and the DB service is up.

## SEO
Done on `/`: unique title and meta description, one H1 with H2 per category and H3 per item, canonical URL, Open Graph tags, server-rendered menu (crawlable without JS), responsive layout, alt text on images with lazy loading and fixed dimensions, `robots.txt` (blocks `/admin`, `/track/`, `/api/`), dynamic `sitemap.xml` built from `SITE_URL`, JSON-LD `CafeOrCoffeeShop` using only values from `BUSINESS_*`. Private pages carry `noindex`.
**Search Console steps:** add a *Domain* property → copy the TXT record → add it at the DNS provider (host `@`) → Verify. Then Sitemaps → submit `sitemap.xml`; URL Inspection → inspect `/` → Request indexing; later check Coverage and Core Web Vitals.
**Local search:** "cafe in Ahilyanagar", "best chai near me Ahilyanagar", "coffee shop home delivery Ahilyanagar", "snacks pickup near Savedi". Claim and verify a Google Business Profile (correct category, hours, photos, menu link to this site) and keep business Name/Address/Phone identical on the website, the profile and directories.

## Status and next steps
Complete: all customer, order, admin, delivery and payment-simulation flows plus tests. Not done: actual deployment/live URLs (add yours), email/SMS notifications, refunds, pagination, per-page SEO beyond the home page, password change UI.
**One issue I faced (write your own before submitting):** describe a real problem you hit while running or deploying, how you investigated it and how you fixed it.

# Masaloo

A React storefront and Node.js/Express API for Masaloo, inspired by the supplied charcoal-and-gold homepage reference. MongoDB stores accounts, products, journal posts, contact messages, newsletter subscriptions, financial records, and wholesale buyers and enquiries. Images and fonts are served locally.

## Start locally

Requires Node.js 22.12 or later within Node 22, and a running MongoDB instance. The supported Node range is recorded in `package.json`; use a reviewed, patched Node 22 release on the host.

```sh
npm install
npm run setup:local
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 4000. Use `127.0.0.1` consistently so cookie sessions and origin checks use the same host.

The local `.env` is already configured for `mongodb://127.0.0.1:27017/masaloo` with a generated session secret. No previous MongoDB connection string was present in the supplied workspace. Replace `MONGODB_URI` locally to use an existing MongoDB or Atlas database. Never commit `.env`.

The first successful development database startup adds six example products and three starter journal posts. Production startup does not insert these retail samples. Product descriptions, prices, stock, and generated packaging are sample content to review before launch. Seeding is marked as completed, so deliberately deleting all products or stories does not repopulate them after a restart.

Without MongoDB in development, visitors can browse a clearly labelled sample catalog and use a device-local cart. Login, signup, contact submissions, subscriptions, and admin writes require a database; these show an error instead of pretending to save. Production startup fails if MongoDB or required indexes cannot initialize; a later outage returns 503 for APIs instead of sample products.

## Create your owner account

Start the site with `npm run dev` and open **http://127.0.0.1:5173/admin/register**. Fill in your name, email, password, and password confirmation. The first account created through this page becomes the store owner and opens the dashboard immediately. Browser-based owner setup is available only on the local computer in development/test mode; it is disabled for a production deployment.

Sign in at **/admin/login** after that. Visiting **/admin** while signed out opens the admin login page. Admin pages use a compact header and dedicated login/registration forms. Passwords are hashed, sessions use HttpOnly cookies, and forms include password visibility and validation.

The first-owner claim uses a unique database record so concurrent requests cannot create multiple initial owners. Owner registration also works if customer accounts already exist; customer registration never grants admin access.

For production setup, or if you prefer the command line, set these fields in your local `.env`:

```dotenv
ADMIN_NAME=Your name
ADMIN_EMAIL=your-email@example.com
ADMIN_PASSWORD=Your-long-unique-password
```

Then run:

```sh
npm run seed:admin
```

Use a password of at least 10 characters and at most 72 UTF-8 bytes. Remove `ADMIN_PASSWORD` from `.env` after creating the owner. The script creates a new owner and refuses to overwrite or promote an existing account. There are no built-in admin credentials.

Sign in at `/admin/login`, then open `/admin`.

| Role | Access |
| --- | --- |
| Owner | Sales, udhari, reports, retail and wholesale products, buyers, bulk enquiries, pricing, stock, journal, inbox, and account role assignment |
| Manager | Sales, udhari, reports, retail and wholesale products, buyers, bulk enquiries, pricing, stock, journal, and inbox |
| Editor | Create, edit, publish, and delete journal posts |
| Customer | Public store, cart, and personal account |
| Pending | Team registration received; dashboard access waits for owner approval |

After an owner exists, team members register at `/admin/register`. New team registrations receive a pending role and see an approval screen. The owner assigns a manager or editor role under **Team & accounts**. The team member can then click **Check access** or sign in again to open the dashboard. Storefront signup at `/account` continues to create a customer. The admin login rejects customer accounts. Owner accounts cannot be downgraded through the dashboard.

## Pages and behaviour

- `/` — homepage with generated hero, featured spices, brand story, collections, and journal previews.
- `/shop` — search, category filters, sorting, price listing, and add to bag.
- `/shop/:id` — product detail, stock status, and related spices.
- `/about` — brand story and values.
- `/contact` — validated enquiries, saved to the admin inbox.
- `/blog` and `/blog/:id` — spice journal and full articles. The admin editor supports daily manual publishing and drafts; automatic daily publishing is not configured.
- `/account` — customer signup and sign-in shared with team members.
- `/admin` — role-protected dashboard.
- `/admin/login` — dedicated admin and team login.
- `/admin/register` — local first-owner setup and subsequent team registrations.

The cart persists on the current device and reads current product prices and stock. Checkout displays a coming-soon notice; no orders or payments are created. A payment gateway and order processing can be added in the next phase. Delivery fees, shipping promises, merchant contact details, policies, and payment-method claims have not been invented.

## Sales and udhari management

Owners and managers have four modules in the admin sidebar. Editors, pending accounts, and customers cannot read or modify financial records.

- **Daily sales:** Record product quantities and the actual price per pack for online orders or offline/shop sales. A receipt can be paid in full, partly paid, or entirely on udhari. Search receipts and filter by dates, channel, or payment status. The CSV export contains the current page, as its button indicates.
- **Udhari ledger:** Add or edit customers, save contact details, and see outstanding and overdue amounts. Each customer has a ledger with bills, previous balances, and payment histories. Repayments are allocated to a selected bill. A new credit customer can also be added while recording a sale.
- **Monthly sales:** Choose a month and sales channel. The chart shows daily online/shop sales, and the annual table shows all twelve months. Click a chart day for its figures. Export the annual monthly table to CSV.
- **Top products:** Rank up to 50 products by sales value or packs sold within a date range. See revenue and quantities separately for online and offline/shop sales, then export the report.

### Recording a sale

Open **Daily sales → Record sale**. Select the channel, sale date, products, quantities, and prices. For any unpaid amount, select an existing customer or add a new customer in the form. A due date is optional. An online order ID or shop receipt number can be saved as a reference; the same nonempty reference cannot be recorded twice within one channel.

Online sales are entered manually until a real order/checkout integration is added. Saving a cart or opening checkout does not create a sale. This register does not change catalog stock: maintain available stock under **Products**. Prices and pack descriptions are saved on the receipt, so later catalog edits or product deletion do not rewrite sales history.

### Managing old udhari and repayments

Open a customer's ledger and choose **Add previous udhari** to bring an existing notebook balance into the system. An opening balance affects customer dues, but does not increase recorded sales or product rankings. Avoid entering the same old debt both as an opening balance and as a historical sale.

To collect a payment, open a bill, select **Record repayment**, and enter its amount, payment date, method (cash, UPI, bank, card, or other), and optional note. The ledger updates immediately and preserves each payment. Payments cannot exceed the remaining amount or be dated before the bill. Saving the same request twice does not duplicate the sale or repayment; a retry with changed details is rejected for review. Concurrent payments cannot overpay a bill.

Owners can cancel an incorrect, fully unpaid bill or opening balance with a reason. Cancelled entries remain visible in history and are excluded from sales and dues. Paid records and recorded payments cannot be deleted or changed through this module. Returns, refunds, taxes, discounts, expenses, and profit accounting are outside this sales register.

### Reading the figures

- **Sales value** uses the original sale date and includes credit sales.
- **Money collected** uses each payment's date, including repayments of previous udhari. It can exceed new sales on a collection-heavy day.
- **Udhari on these sales** is the current unpaid balance of the selected sale cohort, not a historical balance as of the end of that period.
- **Remaining customer udhari** includes current bills and opening balances; **overdue** includes unpaid records whose due date is earlier than today.
- Product sales exclude repayments, opening balances, and cancelled records. Quantities count packs, rather than weight.

Financial values are computed and stored as integer paise. Dates and month boundaries use India time (Asia/Kolkata). No sample financial records are added to the real database.

## Wholesale marketplace

**Wholesale** appears immediately after **Shop** in the main navigation. Its accounts, catalog, prices, and bag are separate from the retail shop and admin accounts.

- `/wholesale` opens registration for a new visitor or the store for a signed-in wholesale buyer.
- `/wholesale/register` accepts a username and password. Registration opens the login page; it does not sign the buyer in automatically.
- `/wholesale/login` signs in an active wholesale buyer and opens `/wholesale/store`.
- `/wholesale/products/:id` shows the spice, price per kg, minimum order, and quantity selection.
- `/wholesale/enquiries` shows the signed-in buyer's enquiries and quotations from the team.

Wholesale usernames are case-insensitive and passwords must contain at least 10 characters. Wholesale sessions use their own HttpOnly cookie, and cannot grant admin access. Product details and wholesale prices require a wholesale login. Bags persist on the current device separately for each wholesale buyer.

### Imported raw-spice catalog

The supplied [Nuts 'n' Spices category](https://www.nutsnspices.in/categories/80689/Spices) was inspected to find its [whole-spice category](https://www.nutsnspices.in/categories/80704/spices-whole). The initial import contains the **25 products exposed on that category's first public page**, rather than the retailer's entire catalog. Names and pack references were extracted from the public page data. Images were downloaded, optimized to WebP, and saved under `public/images/wholesale-*.webp`; the storefront loads these local files. Short descriptions were written for bulk enquiries instead of copying the retailer's marketing text. Provenance is retained for admin review.

**Set your wholesale prices before offering fixed bulk rates.** The source lists retail pack prices, which are retained only as admin reference information. All imported wholesale rates start blank and display **Price on request**. The initial minimum order is an editable 5 kg per product; blank stock means availability must be confirmed. Quantities use whole kg.

The manifest `data/wholesale-catalog.json` seeds the wholesale collection once when the server starts with MongoDB connected. Under **Admin > Wholesale > Products & prices**, owners and managers can add, edit, hide, or delete raw spices; upload local product images; and manage price per kg, minimum quantities, and available kg. Retail product prices are independent.

**Refresh source catalog** fetches the fixed public source page and refreshes source references and unmodified source images. It preserves your prices, minimums, stock, visibility, descriptions, names, and custom images. Refresh is manual and rate-limited. A deleted source product can be imported again by an explicit refresh.

For a development refresh of the checked-in seed manifest and local image assets:

```sh
npm run scrape:wholesale
```

This command updates local assets and the manifest; it does not modify existing database prices. Use the admin refresh to update the connected database.

### Bulk enquiries and quotations

Buyers add spices to their bulk bag and submit their name, phone, and optional business, city, and notes. The API checks current prices, minimum quantities, and stock, and saves an enquiry with price snapshots and a reference. It accepts enquiries containing unpriced items and clearly distinguishes the priced subtotal from an unknown final total. Retrying the same submission does not create a duplicate.

Under **Admin > Wholesale > Bulk enquiries**, owners and managers can mark an enquiry new, contacted, quoted, or closed, provide a quoted total and message visible to the buyer, and keep separate private team notes. **Buyers** allows suspending or restoring wholesale access; suspension revokes existing access on the buyer's next API request.

Submitting or quoting an enquiry does not create a confirmed order, collect payment, reserve stock, or add a financial sale. The financial product picker currently uses the retail catalog; automatic wholesale order and sales integration is a later phase.

## Local images

`public/images/` contains the optimized generated retail WebP assets and locally downloaded wholesale reference images. Original generated PNGs are retained under `assets/generated-originals/`. The original generation files also remain in the Codex image output directory.

Admin uploads use `uploads/` during development, or the configured `UPLOAD_DIR`. Production requires an absolute path on a persistent volume. Both admin uploads and runtime wholesale imports use this storage. Uploads are limited to 5 MB, decoded to verify actual image content, resized, and re-encoded to WebP. Complete files are linked into place without overwriting existing images. The filesystem must support hard links within the upload directory. Existing `/uploads/<filename>` URLs stay unchanged. Missing files and unsafe filenames return 404, and file symlinks are refused. Storage failures return a safe error instead of being labelled invalid image content.

Back up this directory alongside MongoDB. Deleting a catalog item does not delete its image, and replacing images can leave unreferenced files. No automatic cleanup of existing images is performed. No external image hosting is used.

Outfit and Cormorant Garamond fonts are included locally with their SIL Open Font Licenses in `public/fonts/`.

## Build and verification

```sh
npm run build
npm start
```

The Express server serves the built React app and API together at **http://127.0.0.1:4000**. Restart it after changing configuration or building a new frontend.

```sh
npm test
# Build first; browser checks require Microsoft Edge and local MongoDB:
npm run test:browser
# Build first; uses its own temporary server and test database:
npm run test:admin
# Build first; uses a separate server and temporary finance test database:
npm run test:finance
# Build first; uses a separate server and temporary wholesale test database:
npm run test:wholesale
# Build first; exercises production startup using generated local test databases:
npm run test:production
```

All integration/browser checks use generated databases beginning with `masaloo_test_` on local MongoDB, temporary upload folders, and their own local HTTP servers. They do not read `.env` credentials or use the configured storefront database. Cleanup checks the database name and generated temporary directory before removal. The storefront browser check no longer needs a development server. Screenshots are saved in ignored `artifacts/`. Do not point the tests at Atlas or remove their isolation guards.

The production check runs `NODE_ENV=production` against generated local databases and an isolated empty dotenv file. It verifies real startup failures, unique-index failure, port binding, health, cookie flags, deep links, uploaded images after a process restart, and database-loss behavior. Windows signal tests invoke the registered handlers through IPC/process events; native Linux SIGTERM delivery still needs staging verification. File-symlink rejection is tested when the operating system permits creating a test symlink; a permission-based skip must be reported.

Checks cover account signup, password hashing, cookie sessions, role boundaries, product and price changes, hidden products, blog drafts/publishing, image validation, contact messages, newsletter deduplication, foreign-origin rejection, cart persistence, and responsive navigation. Finance checks also cover sales totals, partial payments, previous udhari, payment history, channel reports, top-product rankings, CSV contents, Indian date boundaries, repeat submissions, simultaneous repayments, and unpaid cancellations.

Wholesale checks cover signup followed by explicit login, separate sessions and role boundaries, private prices, local images, bulk quantities, server-calculated enquiry totals, duplicate submission protection, price snapshots, quotations, private team notes, buyer suspension, source refresh preserving admin edits, responsive layouts, and bags kept separate for each buyer.

## Deployment

This project stays in the requested React + Node.js + MongoDB stack and is prepared for a Node host with a persistent disk. It has not been published to Sites hosting, whose Worker runtime does not run this Express/MongoDB server as written.

Railway deployment uses the standard application variables below. No proxy mode, CIDR allowlist, or ingress-verification setting is required. Test commands use isolated local databases and do not deploy or migrate real data.

### Required application configuration

| Variable | Production requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Railway-provided integer port; do not hardcode the public URL's port |
| `MONGODB_URI` | MongoDB/Atlas connection string with the target database explicitly included |
| `JWT_SECRET` | Cryptographically random secret of at least 32 characters; never a placeholder |
| `CLIENT_ORIGIN` | One HTTPS origin, without credentials, a route, query, or fragment; an optional trailing slash is normalized |
| `UPLOAD_DIR` | Absolute directory on mounted persistent storage, for example `/data/uploads` with a volume mounted at `/data` |

Store variables in host settings. Never commit `.env`, connection strings, passwords, or backup archives. Admin seed variables `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are only for a separately approved one-time owner setup if the migrated database has no intended owner; remove them afterward. Routine build/start commands do not create an owner.

Startup validates configuration, the frontend build and required image/font/seed files, upload storage access, MongoDB connectivity, and indexes before listening. Production binds to `0.0.0.0`; development stays on `127.0.0.1`. The `dist/`, `public/`, `data/`, `shared/`, and `server/` runtime files must be included. The wholesale manifest is still seeded once; restore migrated data before first production startup so the application does not seed an empty target ahead of the restore.

`GET /api/health` returns 200 only when the app is ready and a bounded MongoDB ping succeeds. It returns 503 during outages or shutdown; JSON reports `connected`, `unavailable`, or `not configured`, with no connection string. Pings are limited to 1500 ms and concurrent requests share a pending probe. Railway must check the HTTP status, and ongoing monitoring must be configured separately.

SIGTERM/SIGINT mark readiness false, close the HTTP listener, wait for active responses, then disconnect MongoDB. The application deadline is 25 seconds. On deadline expiry it force-closes HTTP connections and exits unsuccessfully. Set Railway's drain allowance to 30 seconds. Native Linux delivery and active-request behavior must be verified in staging before real financial writes are accepted.

### Requests behind Railway

Forwarding headers no longer block API requests. Express keeps `trust proxy=false`, and rate limits use the actual connection address rather than `X-Real-IP`, `X-Forwarded-For`, or `Forwarded`. This requires no proxy setup. Visitors arriving through the same proxy can share the existing login/form rate-limit budget; these are not independent per-visitor limits behind Railway. Counters remain process-local.

After deploying this version, remove any old `PROXY_MODE`, `TRUSTED_PROXY_CIDRS`, and `PROXY_HEADER_VERIFIED` variables in Railway. Leftover values are ignored by the new code. Keep `NODE_ENV`, `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, and `UPLOAD_DIR`; Railway supplies `PORT`. Do not remove the proxy variable from an older deployment before updating its code, because that older version requires it.

Login, role permissions, canonical-origin checks, secure cookies, health checks, and upload validation remain active. Products, blogs, sessions, and health reach their usual handlers when Railway adds forwarding headers. A database outage still returns the appropriate 503.

### Railway build and runtime settings, after approval

- Install: `npm ci --include=dev`, configured with `RAILPACK_NODE_NPM_INSTALL`.
- Build: `npm run build`.
- Start: `npm start`.
- Set `RAILPACK_NODE_VERSION` to a reviewed Node 22 patch at least 22.12.
- Set `RAILPACK_NO_SPA=true` so Railpack runs Express instead of deploying only static pages.
- Set `NODE_ENV=production` and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`.
- Mount the persistent volume at `/data`, and set `UPLOAD_DIR=/data/uploads`. Keep one replica; review current Railway volume constraints and plan costs before provisioning.
- Health path: `/api/health`.
- Use one canonical HTTPS origin for frontend, API and uploads. No cross-origin frontend split is configured. Keep Strict/HttpOnly/Secure cookies and the same-origin CSP.

Keep `NODE_ENV=development` out of Vite dotenv files during a production build. Vite and its React plugin are build-time devDependencies and must be installed before building; runtime packages include Express, Mongoose, Multer and Sharp. Perform a clean dependency installation on Linux so Sharp gets the correct native binaries. Do not upload Windows `node_modules`. Confirm the target filesystem supports the upload writer's same-directory hard links and the configured volume is writable; do not solve permission errors by weakening application validation.

### Migration, backups, updates and rollback

Migration requires separate authorization. Confirm Atlas capacity, database-tool compatibility, database users, TLS, and a restricted IP access list. Railway's static outbound addresses may require a higher plan; do not silently open Atlas to all internet addresses to fit a budget. Pause writes, dump the complete local database, and restore into a fresh target before the app starts. Preserve IDs, password hashes, seed markers, embedded repayments, enquiries and quotations; CSV reports are not database backups. No migration command is part of build or startup.

Copy existing `uploads/` files to the mounted directory using exactly the same filenames. Do not rewrite `/uploads/` references, delete the originals, or store live uploads in Git. Verify file checksums and image availability before and after restart/redeployment. Static `/images/` assets and fonts remain part of the build.

Keep coordinated encrypted database and image backups outside the deployment. Verify actual Atlas backup availability/retention rather than assuming M0 provides it. Configure volume backups and practice restoration to an isolated environment. Rate-limit counters are in memory and reset on process restart.

Before an update, back up data, run checks, and test staging. Volume-backed redeployments may have downtime. Application rollback does not roll back Atlas or uploaded images, and hosting rollbacks may restore older variables. Recheck the database URI, secret and upload mount after rollback. Do not restore an old financial database over newer sales without a separate reconciliation and approval.

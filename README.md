# MMC Career Readiness Grant™ 2027–28 — Official Landing Page & Lead Infrastructure

High-performance, production-ready landing page and full-stack lead capture engine for the **MMC Career Readiness Grant™ 2027–28**.

Engineered for dual-runtime deployment:
1. **Cloudflare Pages & Cloudflare D1 SQL Database** (Serverless edge deployment for production)
2. **Standalone Node.js Server & SQLite WAL** (Zero external dependencies for local development)

---

## 🚀 Cloudflare Production Deployment Guide

### 1. Cloudflare D1 Database
The Cloudflare D1 SQL database is already configured in `wrangler.toml`:
- **Database Name / ID**: `a63cfb65-eb51-4ade-86f7-0154c874fb17`
- **Worker / Pages Binding**: `DB`

#### Apply D1 Schema Migrations:
To execute schema creation on your live Cloudflare D1 database, run:
```bash
npx wrangler d1 migrations apply a63cfb65-eb51-4ade-86f7-0154c874fb17 --remote
```
*(Or run `npm run d1:migrate:remote`)*

The migration file is located in [`migrations/0001_initial.sql`](./migrations/0001_initial.sql) and sets up:
- `leads`: Full lead capture schema, normalization fields, UTM attribution, sync states, and duplicate flags.
- `sync_logs`: Audit trail for every Google Sheets & LeadsZone CRM sync attempt.
- `admin_sessions`: Session token management for the admin portal.
- 10 performance indexes for fast filtering, pagination, and analytics.

---

### 2. Connect GitHub to Cloudflare Pages
1. Go to your **[Cloudflare Dashboard](https://dash.cloudflare.com/)** > **Compute (Workers & Pages)** > **Create** > **Pages** > **Connect to Git**.
2. Select GitHub repository: `https://github.com/connect4adm-sys/event-page.git`
3. Configure build settings:
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: `.`
4. In **Settings** > **Functions** > **D1 database bindings**:
   - Variable name: `DB`
   - D1 database: `a63cfb65-eb51-4ade-86f7-0154c874fb17`
5. In **Settings** > **Environment variables**, configure:
   - `GOOGLE_SHEETS_WEBHOOK_URL`: Your Google Apps Script Webhook URL
   - `CRM_API_URL`: `https://app.leadszone.ai/api/integrate/a46e4428-cb4c-4a0c-98a5-5af15716d4e0/leads`
   - `CRM_PROVIDER`: `LeadsZone`
   - `ADMIN_PASSWORD_HASH`: `scrypt$7f3b89a1c2e406f890123456789abcde$d874a0ddb29944e58cfd9b0db7d42e8aca1e7860b5932aefb014e4e9a51e5d998b0547fd822ce7a26b8022bf68de932b385a3b7fcf397e5cc34d1eae7a6cb779`
   - *(Optional direct override)* `ADMIN_PASSWORD`: Custom administrative password if you prefer plain text configuration.

---

### 3. Custom Domain Setup
To point `event.mymentorcircle.com` to Cloudflare Pages:
1. In your Cloudflare Pages project, go to **Custom domains** > **Set up a custom domain**.
2. Enter `event.mymentorcircle.com`.
3. Cloudflare will automatically manage SSL/TLS and DNS routing.

---

## 🔒 Admin & Analytics Portal

- **Production Admin URL**: `https://event.mymentorcircle.com/admin`
- **Default Administrative Password**: `Mymentorcircle@2026`
- **Features**:
  - Real-time submission counter (today, 7 days, 30 days)
  - Full lead registry with search, status filters, school role filters, and pagination
  - Single-lead manual retry sync to Google Sheets and LeadsZone CRM
  - 1-click batch resync for all pending/failed leads
  - Complete lead export to CSV
  - Grouped geography analysis (submitted cities/districts)
  - Grouped school analysis (applicant density per school)
  - Meta Ads attribution report (UTM parameters & fbclid click IDs)

---

## 💻 Local Development

### Option A: Local Node.js Standalone
```bash
npm start
```
Starts server on `http://127.0.0.1:3000/`. Local SQLite database initialized in `data/leads.db`.

### Option B: Local Cloudflare Pages Dev (with local D1 simulation)
```bash
npm run pages:dev
```
Starts Cloudflare Pages Functions emulator on `http://127.0.0.1:8787/`.
Run migrations locally:
```bash
npm run d1:migrate:local
```

---

## 📁 Repository Structure

```
├── admin/                     # Protected Admin Dashboard & Login HTML
├── css/                       # Clean modular stylesheet (style.css)
├── js/                        # Clean modular script (main.js)
├── functions/                 # Cloudflare Pages Functions (Edge API & D1 integration)
│   ├── _shared.js             # D1 queries, scrypt auth, Sheets & LeadsZone sync
│   ├── admin/
│   │   └── _middleware.js     # Edge session protection for /admin
│   └── api/
│       ├── health.js          # Health check & D1 status
│       ├── leads.js           # Lead submission & async edge sync
│       └── admin/             # Analytics, leads management, reports, & retry APIs
├── migrations/                # Cloudflare D1 SQL Migrations
│   └── 0001_initial.sql       # Schema for leads, sync_logs, and admin_sessions
├── public/images/mmc-grant/   # Centralized, deduplicated image assets
├── src/                       # Local Node.js runtime modules (SQLite fallback)
├── index.html                 # Primary landing page
├── server.js                  # Standalone Node.js server
├── test.js                    # Automated test suite
└── wrangler.toml              # Cloudflare configuration & D1 binding
```

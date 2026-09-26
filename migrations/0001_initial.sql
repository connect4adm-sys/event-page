-- Cloudflare D1 Initial Migration
-- Database: a63cfb65-eb51-4ade-86f7-0154c874fb17

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT UNIQUE NOT NULL,
  idempotency_key TEXT UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  email TEXT,
  email_normalized TEXT,
  school_role TEXT NOT NULL,
  school_role_other TEXT,
  school_name TEXT NOT NULL,
  school_name_normalized TEXT NOT NULL,
  school_city_district TEXT NOT NULL,
  consent INTEGER NOT NULL DEFAULT 1,
  consent_version TEXT NOT NULL DEFAULT 'v1.0-2027',
  landing_page_url TEXT,
  referrer_url TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbclid TEXT,
  lead_status TEXT NOT NULL DEFAULT 'NEW',
  google_sheet_sync_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  google_sheet_synced_at TEXT,
  google_sheet_error TEXT,
  crm_sync_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  crm_record_id TEXT,
  crm_synced_at TEXT,
  crm_error TEXT,
  is_duplicate_suspect INTEGER NOT NULL DEFAULT 0,
  duplicate_reason TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Sync Audit Logs
CREATE TABLE IF NOT EXISTS sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INTEGER,
  attempted_at TEXT NOT NULL
);

-- Admin Sessions
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone_norm ON leads(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_leads_school_role ON leads(school_role);
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(school_city_district);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_leads_gsheet_status ON leads(google_sheet_sync_status);
CREATE INDEX IF NOT EXISTS idx_leads_crm_status ON leads(crm_sync_status);
CREATE INDEX IF NOT EXISTS idx_leads_utm_source ON leads(utm_source);
CREATE INDEX IF NOT EXISTS idx_leads_utm_campaign ON leads(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_sync_logs_lead_id ON sync_logs(lead_id);

-- Cloudflare D1 Migration: Visitor Intelligence & Tracking
-- Database: a63cfb65-eb51-4ade-86f7-0154c874fb17

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  visitor_id TEXT NOT NULL,
  ip_address TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  isp TEXT,
  source_app TEXT,
  channel TEXT,
  source_badge TEXT,
  referrer TEXT,
  landing_url TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbclid TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  screen_resolution TEXT,
  total_duration_sec INTEGER DEFAULT 0,
  max_scroll_depth_pct INTEGER DEFAULT 0,
  sections_viewed TEXT,
  lead_id TEXT,
  is_converted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visitor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  section_id TEXT,
  duration_sec INTEGER DEFAULT 0,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_created ON visitor_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_vid ON visitor_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_campaign ON visitor_sessions(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_sessions_converted ON visitor_sessions(is_converted);
CREATE INDEX IF NOT EXISTS idx_sessions_city ON visitor_sessions(city);
CREATE INDEX IF NOT EXISTS idx_events_session ON visitor_events(session_id);

/**
 * MMC Career Readiness Grant™ 2027–28 — Database Module
 * Uses Node.js 24 built-in node:sqlite (SQLite3 with WAL mode)
 * Primary source of truth for leads, sync logs, and admin sessions.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'leads.db');
const db = new DatabaseSync(DB_PATH);

// Configure SQLite for high concurrency and resilience
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Migration Engine — ensures safe schema updates without data loss
 */
function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const currentVersionRow = db.prepare('SELECT MAX(version) as max_v FROM schema_migrations').get();
  const currentVersion = currentVersionRow && currentVersionRow.max_v ? currentVersionRow.max_v : 0;

  if (currentVersion < 1) {
    db.exec(`
      -- Primary Leads Table
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
        target TEXT NOT NULL, -- 'GOOGLE_SHEETS' or 'CRM'
        status TEXT NOT NULL, -- 'SUCCESS', 'FAILED', 'SKIPPED'
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
    `);

    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
  }

  if (currentVersion < 2) {
    try {
      const colInfo = db.prepare('PRAGMA table_info(leads)').all();
      const hasSessionCol = colInfo.some(c => c.name === 'session_id');
      if (!hasSessionCol) {
        db.exec('ALTER TABLE leads ADD COLUMN session_id TEXT;');
      }
    } catch (e) {
      console.error('[Migration v2 Warning]', e.message);
    }

    db.exec(`
      -- Visitor Sessions Table
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
        sections_viewed TEXT, -- JSON array of { section_id, name, duration_sec, enters_count }
        lead_id TEXT,
        is_converted INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL
      );

      -- Visitor Events Table
      CREATE TABLE IF NOT EXISTS visitor_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        section_id TEXT,
        duration_sec INTEGER DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      -- Indexes for fast querying
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON visitor_sessions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_source ON visitor_sessions(source_app);
      CREATE INDEX IF NOT EXISTS idx_sessions_city ON visitor_sessions(city);
      CREATE INDEX IF NOT EXISTS idx_sessions_converted ON visitor_sessions(is_converted);
      CREATE INDEX IF NOT EXISTS idx_leads_session ON leads(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_session ON visitor_events(session_id);
    `);

    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(new Date().toISOString());
  }
}

initializeSchema();

// -----------------------------------------------------------------------------
// Database Access Functions
// -----------------------------------------------------------------------------

function insertLead(lead) {
  const stmt = db.prepare(`
    INSERT INTO leads (
      lead_id, idempotency_key, full_name, phone, phone_normalized,
      email, email_normalized, school_role, school_role_other,
      school_name, school_name_normalized, school_city_district,
      consent, consent_version, landing_page_url, referrer_url,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
      lead_status, google_sheet_sync_status, crm_sync_status,
      is_duplicate_suspect, duplicate_reason, ip_address, session_id,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `);

  stmt.run(
    lead.lead_id,
    lead.idempotency_key || null,
    lead.full_name,
    lead.phone,
    lead.phone_normalized,
    lead.email || null,
    lead.email_normalized || null,
    lead.school_role,
    lead.school_role_other || null,
    lead.school_name,
    lead.school_name_normalized,
    lead.school_city_district,
    lead.consent ? 1 : 0,
    lead.consent_version || 'v1.0-2027',
    lead.landing_page_url || null,
    lead.referrer_url || null,
    lead.utm_source || null,
    lead.utm_medium || null,
    lead.utm_campaign || null,
    lead.utm_content || null,
    lead.utm_term || null,
    lead.fbclid || null,
    lead.lead_status || 'NEW',
    lead.google_sheet_sync_status || 'NOT_CONFIGURED',
    lead.crm_sync_status || 'NOT_CONFIGURED',
    lead.is_duplicate_suspect ? 1 : 0,
    lead.duplicate_reason || null,
    lead.ip_address || null,
    lead.session_id || null,
    lead.created_at,
    lead.updated_at || lead.created_at
  );

  if (lead.session_id) {
    try {
      linkSessionToLead(lead.session_id, lead.lead_id);
    } catch {}
  }

  return getLeadById(lead.lead_id);
}

function getLeadById(leadId) {
  const stmt = db.prepare('SELECT * FROM leads WHERE lead_id = ?');
  return stmt.get(leadId);
}

function findRecentMatchingLead(phoneNormalized, schoolNormalized, windowMinutes = 15) {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const stmt = db.prepare(`
    SELECT * FROM leads 
    WHERE (phone_normalized = ? OR school_name_normalized = ?) 
      AND created_at >= ?
    ORDER BY created_at DESC 
    LIMIT 1
  `);
  return stmt.get(phoneNormalized, schoolNormalized, cutoff);
}

function listLeads({
  search = '',
  role = '',
  status = '',
  gsheetStatus = '',
  crmStatus = '',
  source = '',
  campaign = '',
  city = '',
  period = '',
  startDate = '',
  endDate = '',
  limit = 20,
  offset = 0,
  sortOrder = 'DESC'
} = {}) {
  let whereClauses = [];
  let params = [];

  if (search) {
    whereClauses.push(`(
      full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR 
      school_name LIKE ? OR school_city_district LIKE ? OR lead_id LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q);
  }

  if (role) {
    whereClauses.push('school_role = ?');
    params.push(role);
  }

  if (status) {
    whereClauses.push('lead_status = ?');
    params.push(status);
  }

  if (gsheetStatus) {
    whereClauses.push('google_sheet_sync_status = ?');
    params.push(gsheetStatus);
  }

  if (crmStatus) {
    whereClauses.push('crm_sync_status = ?');
    params.push(crmStatus);
  }

  if (source) {
    whereClauses.push('utm_source = ?');
    params.push(source);
  }

  if (campaign) {
    whereClauses.push('utm_campaign = ?');
    params.push(campaign);
  }

  if (city) {
    whereClauses.push('school_city_district LIKE ?');
    params.push(`%${city}%`);
  }

  if (period || (startDate && endDate)) {
    const { since, until } = resolveDateBounds({ period, startDate, endDate });
    whereClauses.push('created_at >= ? AND created_at <= ?');
    params.push(since, until);
  } else {
    if (startDate) {
      whereClauses.push('created_at >= ?');
      params.push(startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      whereClauses.push('created_at <= ?');
      params.push(endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`);
    }
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const orderSQL = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM leads ${whereSQL}`);
  const totalRow = countStmt.get(...params);
  const total = totalRow ? totalRow.total : 0;

  const dataStmt = db.prepare(`
    SELECT * FROM leads 
    ${whereSQL} 
    ORDER BY created_at ${orderSQL} 
    LIMIT ? OFFSET ?
  `);
  const leads = dataStmt.all(...params, Number(limit), Number(offset));

  return { leads, total, limit: Number(limit), offset: Number(offset) };
}

function updateLeadStatus(leadId, newStatus) {
  const validStatuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'INELIGIBLE', 'ARCHIVED'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  const stmt = db.prepare(`
    UPDATE leads 
    SET lead_status = ?, updated_at = ? 
    WHERE lead_id = ?
  `);
  stmt.run(newStatus, new Date().toISOString(), leadId);
  return getLeadById(leadId);
}

function updateLeadSyncStatus(leadId, target, status, errorMsg = null, recordId = null) {
  const now = new Date().toISOString();
  if (target === 'GOOGLE_SHEETS') {
    const stmt = db.prepare(`
      UPDATE leads 
      SET google_sheet_sync_status = ?, 
          google_sheet_synced_at = CASE WHEN ? = 'SYNCED' THEN ? ELSE google_sheet_synced_at END,
          google_sheet_error = ?,
          updated_at = ?
      WHERE lead_id = ?
    `);
    stmt.run(status, status, now, errorMsg, now, leadId);
  } else if (target === 'CRM') {
    const stmt = db.prepare(`
      UPDATE leads 
      SET crm_sync_status = ?, 
          crm_record_id = COALESCE(?, crm_record_id),
          crm_synced_at = CASE WHEN ? = 'SYNCED' THEN ? ELSE crm_synced_at END,
          crm_error = ?,
          updated_at = ?
      WHERE lead_id = ?
    `);
    stmt.run(status, recordId, status, now, errorMsg, now, leadId);
  }
}

function addSyncLog(leadId, target, status, errorMessage = null, durationMs = 0) {
  const stmt = db.prepare(`
    INSERT INTO sync_logs (lead_id, target, status, error_message, duration_ms, attempted_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(leadId, target, status, errorMessage, durationMs, new Date().toISOString());
}

function getSyncLogs(leadId = null, limit = 50) {
  if (leadId) {
    const stmt = db.prepare('SELECT * FROM sync_logs WHERE lead_id = ? ORDER BY attempted_at DESC LIMIT ?');
    return stmt.all(leadId, limit);
  }
  const stmt = db.prepare('SELECT * FROM sync_logs ORDER BY attempted_at DESC LIMIT ?');
  return stmt.all(limit);
}

// -----------------------------------------------------------------------------
// Admin Session Storage
// -----------------------------------------------------------------------------

function createAdminSession(token, expiresAt, ipAddress) {
  const stmt = db.prepare(`
    INSERT INTO admin_sessions (token, created_at, expires_at, ip_address)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(token, new Date().toISOString(), expiresAt, ipAddress);
}

function getAdminSession(token) {
  const now = new Date().toISOString();
  const stmt = db.prepare('SELECT * FROM admin_sessions WHERE token = ? AND expires_at > ?');
  return stmt.get(token, now);
}

function deleteAdminSession(token) {
  const stmt = db.prepare('DELETE FROM admin_sessions WHERE token = ?');
  stmt.run(token);
}

function cleanExpiredSessions() {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now);
}

// -----------------------------------------------------------------------------
// System & Database Diagnostics
// -----------------------------------------------------------------------------

function getDatabaseStats() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM leads').get();
  let fileSize = 0;
  try {
    const stat = fs.statSync(DB_PATH);
    fileSize = stat.size;
  } catch {}

  return {
    db_path: DB_PATH,
    total_leads: countRow ? countRow.count : 0,
    file_size_bytes: fileSize,
    file_size_kb: (fileSize / 1024).toFixed(1)
  };
}

// -----------------------------------------------------------------------------
// Visitor Intelligence & Tracking Operations
// -----------------------------------------------------------------------------

function upsertVisitorSession(s) {
  const existing = db.prepare('SELECT id, total_duration_sec, max_scroll_depth_pct, sections_viewed, is_converted, lead_id FROM visitor_sessions WHERE session_id = ?').get(s.session_id);
  
  if (existing) {
    const newDuration = Math.max(existing.total_duration_sec || 0, s.total_duration_sec || 0);
    const newScroll = Math.max(existing.max_scroll_depth_pct || 0, s.max_scroll_depth_pct || 0);
    const isConverted = (s.is_converted || existing.is_converted) ? 1 : 0;
    const leadId = s.lead_id || existing.lead_id || null;
    const sectionsViewed = (s.sections_viewed && s.sections_viewed !== '[]') ? s.sections_viewed : existing.sections_viewed;

    const stmt = db.prepare(`
      UPDATE visitor_sessions SET
        total_duration_sec = ?,
        max_scroll_depth_pct = ?,
        sections_viewed = ?,
        is_converted = ?,
        lead_id = ?,
        last_active_at = ?
      WHERE session_id = ?
    `);
    stmt.run(newDuration, newScroll, sectionsViewed, isConverted, leadId, new Date().toISOString(), s.session_id);
    return getVisitorSessionById(s.session_id);
  }

  const stmt = db.prepare(`
    INSERT INTO visitor_sessions (
      session_id, visitor_id, ip_address, city, region, country, isp,
      source_app, channel, source_badge, referrer, landing_url,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
      device_type, browser, os, screen_resolution,
      total_duration_sec, max_scroll_depth_pct, sections_viewed,
      lead_id, is_converted, created_at, last_active_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  stmt.run(
    s.session_id, s.visitor_id, s.ip_address || null, s.city || 'Unknown City', s.region || '', s.country || 'India', s.isp || '',
    s.source_app || 'Direct', s.channel || 'Direct', s.source_badge || 'DIRECT', s.referrer || null, s.landing_url || null,
    s.utm_source || null, s.utm_medium || null, s.utm_campaign || null, s.utm_content || null, s.utm_term || null, s.fbclid || null,
    s.device_type || 'Desktop', s.browser || 'Browser', s.os || 'OS', s.screen_resolution || null,
    s.total_duration_sec || 0, s.max_scroll_depth_pct || 0, s.sections_viewed || '[]',
    s.lead_id || null, s.is_converted ? 1 : 0, s.created_at || new Date().toISOString(), s.last_active_at || new Date().toISOString()
  );

  return getVisitorSessionById(s.session_id);
}

function updateSessionDurationAndSections(sessionId, durationSec, scrollPct, sectionsJson, leadId = null) {
  const existing = db.prepare('SELECT id, total_duration_sec, max_scroll_depth_pct, is_converted, lead_id FROM visitor_sessions WHERE session_id = ?').get(sessionId);
  if (!existing) return;

  const newDuration = Math.max(existing.total_duration_sec || 0, durationSec || 0);
  const newScroll = Math.max(existing.max_scroll_depth_pct || 0, scrollPct || 0);
  const isConverted = (leadId || existing.is_converted) ? 1 : 0;
  const finalLeadId = leadId || existing.lead_id;

  const stmt = db.prepare(`
    UPDATE visitor_sessions SET
      total_duration_sec = ?,
      max_scroll_depth_pct = ?,
      sections_viewed = COALESCE(?, sections_viewed),
      is_converted = ?,
      lead_id = ?,
      last_active_at = ?
    WHERE session_id = ?
  `);
  stmt.run(newDuration, newScroll, sectionsJson, isConverted, finalLeadId, new Date().toISOString(), sessionId);
}

function linkSessionToLead(sessionId, leadId) {
  if (!sessionId || !leadId) return;
  db.prepare('UPDATE visitor_sessions SET is_converted = 1, lead_id = ? WHERE session_id = ?').run(leadId, sessionId);
}

function recordVisitorEvent(ev) {
  const stmt = db.prepare(`
    INSERT INTO visitor_events (session_id, event_type, section_id, duration_sec, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(ev.session_id, ev.event_type, ev.section_id || null, ev.duration_sec || 0, ev.metadata || null, ev.created_at || new Date().toISOString());
}

function getVisitorSessionById(sessionId) {
  const session = db.prepare('SELECT * FROM visitor_sessions WHERE session_id = ?').get(sessionId);
  if (!session) return null;
  const events = db.prepare('SELECT * FROM visitor_events WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
  let parsedSections = [];
  try {
    parsedSections = typeof session.sections_viewed === 'string' ? JSON.parse(session.sections_viewed || '[]') : (session.sections_viewed || []);
  } catch {
    parsedSections = [];
  }
  return {
    ...session,
    sections_viewed: parsedSections,
    sections_visited: parsedSections,
    events
  };
}

// Helper: Resolve Date Bounds for Periods & Custom Ranges
function resolveDateBounds({ period = '30d', days = null, startDate = null, endDate = null } = {}) {
  const now = new Date();
  let since = null;
  let until = now.toISOString();

  if (startDate || endDate) {
    if (startDate) {
      since = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
    }
    if (endDate) {
      until = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;
    }
    if (!since) {
      since = new Date(Date.now() - 30 * 86400000).toISOString();
    }
    return { since, until };
  }

  const p = (period || '').toLowerCase();
  if (p === 'today' || days === 1) {
    since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  } else if (p === 'yesterday') {
    const todayMidnight = new Date(new Date().setHours(0, 0, 0, 0));
    since = new Date(todayMidnight.getTime() - 86400000).toISOString();
    until = new Date(todayMidnight.getTime() - 1).toISOString();
  } else if (p === '7d' || p === '7days' || days === 7) {
    since = new Date(Date.now() - 7 * 86400000).toISOString();
  } else if (p === '30d' || p === '30days' || days === 30) {
    since = new Date(Date.now() - 30 * 86400000).toISOString();
  } else if (p === 'all' || p === 'all_time' || p === 'alltime' || p === 'maximum') {
    since = '2020-01-01T00:00:00.000Z';
  } else if (p === '6m' || p === '6months' || days === 180) {
    since = new Date(Date.now() - 180 * 86400000).toISOString();
  } else if (days && Number.isFinite(days)) {
    since = new Date(Date.now() - days * 86400000).toISOString();
  } else {
    since = new Date(Date.now() - 30 * 86400000).toISOString();
  }

  return { since, until };
}

function listVisitorSessions({
  search = '',
  source = '',
  city = '',
  converted = '',
  device = '',
  period = '',
  startDate = '',
  endDate = '',
  limit = 25,
  offset = 0,
  sortOrder = 'DESC'
} = {}) {
  let whereClauses = [];
  let params = [];

  if (period || startDate || endDate) {
    const { since, until } = resolveDateBounds({ period, startDate, endDate });
    whereClauses.push('created_at >= ? AND created_at <= ?');
    params.push(since, until);
  }

  if (search) {
    whereClauses.push(`(
      session_id LIKE ? OR visitor_id LIKE ? OR city LIKE ? OR region LIKE ? OR 
      source_app LIKE ? OR utm_campaign LIKE ? OR browser LIKE ? OR lead_id LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q, q, q);
  }

  if (source) {
    whereClauses.push('source_app LIKE ?');
    params.push(`%${source}%`);
  }

  if (city) {
    whereClauses.push('city LIKE ?');
    params.push(`%${city}%`);
  }

  if (converted !== '') {
    whereClauses.push('is_converted = ?');
    params.push(converted === '1' || converted === true ? 1 : 0);
  }

  if (device) {
    whereClauses.push('device_type = ?');
    params.push(device);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const orderSQL = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM visitor_sessions ${whereSQL}`);
  const totalRow = countStmt.get(...params);
  const total = totalRow ? totalRow.total : 0;

  const dataStmt = db.prepare(`
    SELECT * FROM visitor_sessions 
    ${whereSQL} 
    ORDER BY created_at ${orderSQL} 
    LIMIT ? OFFSET ?
  `);
  const sessions = dataStmt.all(...params, Number(limit), Number(offset));

  return { sessions, total, limit: Number(limit), offset: Number(offset) };
}

function getVisitorTrackingSummary(options = 30, sectionNameMap = {}) {
  let opts = {};
  if (typeof options === 'number') {
    opts = { days: options };
  } else if (typeof options === 'object' && options !== null) {
    opts = options;
  }

  const { since, until } = resolveDateBounds(opts);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  // 1. Overall Visitor KPIs
  const totalVisitorsRow = db.prepare('SELECT COUNT(DISTINCT visitor_id) as total_visitors, COUNT(*) as total_sessions FROM visitor_sessions WHERE created_at >= ? AND created_at <= ?').get(since, until);
  const todayVisitorsRow = db.prepare('SELECT COUNT(DISTINCT visitor_id) as today_visitors, COUNT(*) as today_sessions FROM visitor_sessions WHERE created_at >= ?').get(todayStart);
  
  const avgMetricsRow = db.prepare(`
    SELECT 
      AVG(total_duration_sec) as avg_duration,
      AVG(max_scroll_depth_pct) as avg_scroll,
      SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END) as total_conversions
    FROM visitor_sessions
    WHERE created_at >= ? AND created_at <= ?
  `).get(since, until);

  const totalVisitors = totalVisitorsRow?.total_visitors || 0;
  const totalSessions = totalVisitorsRow?.total_sessions || 0;
  const todayVisitors = todayVisitorsRow?.today_visitors || 0;
  const todaySessions = todayVisitorsRow?.today_sessions || 0;
  const avgDuration = Math.round(avgMetricsRow?.avg_duration || 0);
  const avgScroll = Math.round(avgMetricsRow?.avg_scroll || 0);
  const totalConversions = avgMetricsRow?.total_conversions || 0;
  const conversionRate = totalSessions > 0 ? ((totalConversions / totalSessions) * 100).toFixed(1) : '0.0';

  // 2. Traffic Source Breakdown
  const sourceRows = db.prepare(`
    SELECT 
      source_app, channel, source_badge,
      COUNT(*) as session_count,
      COUNT(DISTINCT visitor_id) as unique_visitors,
      SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END) as conversions,
      AVG(total_duration_sec) as avg_duration
    FROM visitor_sessions 
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY source_app
    ORDER BY session_count DESC
    LIMIT 10
  `).all(since, until);

  // 3. Location / City Breakdown
  const cityRows = db.prepare(`
    SELECT 
      city, region, country,
      COUNT(*) as visitor_count,
      SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END) as conversions,
      AVG(total_duration_sec) as avg_duration
    FROM visitor_sessions 
    WHERE created_at >= ? AND created_at <= ? AND city IS NOT NULL AND city != ''
    GROUP BY city, region
    ORDER BY visitor_count DESC
    LIMIT 10
  `).all(since, until);

  // 4. Section Dwell-Time Aggregation
  const sessionSectionsRows = db.prepare(`
    SELECT sections_viewed FROM visitor_sessions 
    WHERE created_at >= ? AND created_at <= ? AND sections_viewed IS NOT NULL AND sections_viewed != ''
  `).all(since, until);

  const sectionAggregates = {};
  sessionSectionsRows.forEach(row => {
    try {
      const arr = JSON.parse(row.sections_viewed);
      if (Array.isArray(arr)) {
        arr.forEach(item => {
          const sid = item.section_id || 'unknown';
          if (!sectionAggregates[sid]) {
            sectionAggregates[sid] = {
              section_id: sid,
              name: sectionNameMap[sid] || item.name || sid,
              total_dwell_sec: 0,
              session_views_count: 0
            };
          }
          sectionAggregates[sid].total_dwell_sec += (item.duration_sec || 0);
          sectionAggregates[sid].session_views_count += 1;
        });
      }
    } catch {}
  });

  const sectionBreakdown = Object.values(sectionAggregates)
    .map(s => ({
      ...s,
      avg_dwell_sec: s.session_views_count > 0 ? Math.round(s.total_dwell_sec / s.session_views_count) : 0
    }))
    .sort((a, b) => b.total_dwell_sec - a.total_dwell_sec);

  // 5. Daily Trend
  const trendRows = db.prepare(`
    SELECT 
      SUBSTR(created_at, 1, 10) as day, 
      COUNT(DISTINCT visitor_id) as visitors,
      COUNT(*) as sessions,
      SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END) as conversions
    FROM visitor_sessions 
    WHERE created_at >= ? AND created_at <= ? 
    GROUP BY day 
    ORDER BY day ASC
  `).all(since, until);

  return {
    sinceDate: since,
    untilDate: until,
    totalVisitors,
    totalSessions,
    todayVisitors,
    todaySessions,
    avgDuration,
    avgScroll,
    totalConversions,
    conversionRate: Number(conversionRate),
    sources: sourceRows,
    cities: cityRows,
    topCities: cityRows,
    sections: sectionBreakdown,
    sectionHeatmap: sectionBreakdown,
    trend: trendRows
  };
}

function deleteLead(leadId) {
  db.prepare('DELETE FROM sync_logs WHERE lead_id = ?').run(leadId);
  const result = db.prepare('DELETE FROM leads WHERE lead_id = ?').run(leadId);
  return result.changes > 0;
}

function purgeTestDummyData() {
  db.exec(`
    DELETE FROM sync_logs;
    DELETE FROM leads;
    DELETE FROM visitor_events;
    DELETE FROM visitor_sessions;
  `);
  return { success: true, message: 'All test dummy leads, logs, and sessions purged successfully.' };
}

module.exports = {
  db,
  insertLead,
  getLeadById,
  deleteLead,
  findRecentMatchingLead,
  listLeads,
  updateLeadStatus,
  updateLeadSyncStatus,
  addSyncLog,
  getSyncLogs,
  createAdminSession,
  getAdminSession,
  deleteAdminSession,
  cleanExpiredSessions,
  getDatabaseStats,
  upsertVisitorSession,
  updateSessionDurationAndSections,
  linkSessionToLead,
  recordVisitorEvent,
  getVisitorSessionById,
  listVisitorSessions,
  getVisitorTrackingSummary,
  resolveDateBounds,
  purgeTestDummyData
};

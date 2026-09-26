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
      is_duplicate_suspect, duplicate_reason, ip_address,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
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
    lead.created_at,
    lead.updated_at || lead.created_at
  );

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

  if (startDate) {
    whereClauses.push('created_at >= ?');
    params.push(startDate);
  }

  if (endDate) {
    whereClauses.push('created_at <= ?');
    params.push(endDate);
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

function getSyncLogs(leadId) {
  const stmt = db.prepare('SELECT * FROM sync_logs WHERE lead_id = ? ORDER BY attempted_at DESC');
  return stmt.all(leadId);
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

module.exports = {
  db,
  insertLead,
  getLeadById,
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
  getDatabaseStats
};

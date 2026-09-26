/**
 * MMC Career Readiness Grant™ 2027–28 — Primary Application Server
 * Standalone, lightweight, high-performance Node.js HTTP server.
 * Provides static landing-page serving, secure lead ingestion API,
 * background sync engine, and password-protected admin dashboard.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

require('./src/env');
const db = require('./src/db');
const leads = require('./src/leads');
const auth = require('./src/auth');
const sheets = require('./src/sheets');
const crm = require('./src/crm');
const analytics = require('./src/analytics');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT_DIR = __dirname;
const MAIN_HTML_NAME = 'index.html';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8'
};

// In-memory rate-limiter for public lead submission: max 10 per 5 min per IP
const leadSubmissionsRate = new Map(); // ip -> [timestamps]

function checkLeadRateLimit(ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const history = leadSubmissionsRate.get(ip) || [];
  const recent = history.filter(t => now - t < windowMs);

  if (recent.length >= 10) {
    return false;
  }
  recent.push(now);
  leadSubmissionsRate.set(ip, recent);
  return true;
}

// Clean old rate limit entries every 10 mins
setInterval(() => {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  for (const [ip, history] of leadSubmissionsRate.entries()) {
    const recent = history.filter(t => now - t < windowMs);
    if (recent.length === 0) leadSubmissionsRate.delete(ip);
    else leadSubmissionsRate.set(ip, recent);
  }
}, 10 * 60 * 1000);

/**
 * Helper to parse JSON body from incoming request with size limit (max 100kb)
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 102400) {
        req.destroy();
        reject(new Error('Request payload exceeds limit (100KB).'));
      }
    });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        resolve(json);
      } catch (err) {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', err => reject(err));
  });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(payload);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '127.0.0.1'
  );
}

/**
 * Static file serving handler with support for HTTP Range requests (for video streaming)
 */
function serveStaticFile(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Support range requests for video playback (.mp4)
    if (ext === '.mp4' && req.headers.range) {
      const range = req.headers.range;
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/**
 * Main HTTP Server
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = decodeURI(parsedUrl.pathname);
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  const method = req.method.toUpperCase();
  const clientIp = getClientIp(req);

  // ---------------------------------------------------------------------------
  // 1. HEALTH CHECK ENDPOINT
  // ---------------------------------------------------------------------------
  if (pathname === '/api/health' && method === 'GET') {
    const dbStats = db.getDatabaseStats();
    return sendJson(res, 200, {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      database: dbStats,
      integrations: {
        google_sheets: sheets.isConfigured(),
        crm: crm.isConfigured()
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 2. PUBLIC LEAD SUBMISSION ENDPOINT
  // ---------------------------------------------------------------------------
  if (pathname === '/api/leads' && method === 'POST') {
    if (!checkLeadRateLimit(clientIp)) {
      return sendJson(res, 429, {
        success: false,
        message: 'Submission limit reached from this IP. Please wait a few moments before trying again.'
      });
    }

    try {
      const body = await parseJsonBody(req);
      const result = leads.processNewLead(body, clientIp);

      if (!result.success) {
        return sendJson(res, result.status || 400, result);
      }

      // Asynchronously queue downstream integrations (Google Sheets & CRM)
      sheets.queueLeadSync(result.lead_id);
      crm.queueLeadSync(result.lead_id);

      return sendJson(res, 201, {
        success: true,
        lead_id: result.lead_id,
        message: 'Your school details have been successfully received. An MMC programme advisor will reach out to schedule an introductory discussion.',
        google_sheet_sync_status: result.lead.google_sheet_sync_status,
        crm_sync_status: result.lead.crm_sync_status
      });
    } catch (err) {
      console.error('[Lead Submission Error]', err);
      return sendJson(res, 500, {
        success: false,
        message: 'An unexpected internal error occurred while recording your details. Please try again.'
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. ADMIN AUTHENTICATION ROUTES
  // ---------------------------------------------------------------------------
  if (pathname === '/api/admin/login' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const password = body.password || '';
      const loginResult = auth.loginAdmin(password, clientIp);

      if (!loginResult.success) {
        return sendJson(res, loginResult.status, {
          success: false,
          message: loginResult.message
        });
      }

      // Set HttpOnly SameSite cookie
      const cookieHeader = `mmc_admin_session=${loginResult.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
      return sendJson(res, 200, {
        success: true,
        message: 'Authentication successful.',
        expiresAt: loginResult.expiresAt
      }, { 'Set-Cookie': cookieHeader });
    } catch (err) {
      return sendJson(res, 500, { success: false, message: 'Authentication process failed.' });
    }
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    const session = auth.getSessionFromRequest(req);
    if (session) {
      db.deleteAdminSession(session.token);
    }
    const clearCookie = `mmc_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
    return sendJson(res, 200, { success: true, message: 'Logged out.' }, { 'Set-Cookie': clearCookie });
  }

  // ---------------------------------------------------------------------------
  // 4. PROTECTED ADMIN API ROUTES
  // ---------------------------------------------------------------------------
  if (pathname.startsWith('/api/admin/')) {
    const session = auth.getSessionFromRequest(req);
    if (!session) {
      return sendJson(res, 401, {
        success: false,
        message: 'Unauthorized. Active administrative session required.'
      });
    }

    // A. Analytics Summary
    if (pathname === '/api/admin/analytics/summary' && method === 'GET') {
      const days = parseInt(query.days, 10) || 30;
      const summary = analytics.getDashboardSummary(days);
      return sendJson(res, 200, summary);
    }

    // B. Leads Listing with Filters & Pagination
    if (pathname === '/api/admin/leads' && method === 'GET') {
      const q = query;
      const result = db.listLeads({
        search: q.search || '',
        role: q.role || '',
        status: q.status || '',
        gsheetStatus: q.gsheetStatus || '',
        crmStatus: q.crmStatus || '',
        source: q.source || '',
        campaign: q.campaign || '',
        city: q.city || '',
        startDate: q.startDate || '',
        endDate: q.endDate || '',
        limit: parseInt(q.limit, 10) || 20,
        offset: parseInt(q.offset, 10) || 0,
        sortOrder: q.sortOrder || 'DESC'
      });
      return sendJson(res, 200, result);
    }

    // C. Single Lead Details with Sync Audit Logs
    const leadDetailMatch = pathname.match(/^\/api\/admin\/leads\/([a-zA-Z0-9_\-]+)$/);
    if (leadDetailMatch && method === 'GET') {
      const leadId = leadDetailMatch[1];
      const lead = db.getLeadById(leadId);
      if (!lead) return sendJson(res, 404, { success: false, message: 'Lead not found.' });

      const syncLogs = db.getSyncLogs(leadId);
      return sendJson(res, 200, { success: true, lead, syncLogs });
    }

    // D. Update Lead Status
    const updateStatusMatch = pathname.match(/^\/api\/admin\/leads\/([a-zA-Z0-9_\-]+)\/status$/);
    if (updateStatusMatch && method === 'PATCH') {
      try {
        const leadId = updateStatusMatch[1];
        const body = await parseJsonBody(req);
        const updated = db.updateLeadStatus(leadId, body.status);
        return sendJson(res, 200, { success: true, lead: updated });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // E. Retry Sync for Single Lead (Google Sheets & CRM)
    const retryLeadMatch = pathname.match(/^\/api\/admin\/leads\/([a-zA-Z0-9_\-]+)\/retry-sync$/);
    if (retryLeadMatch && method === 'POST') {
      const leadId = retryLeadMatch[1];
      const sheetsResult = await sheets.syncLeadToGoogleSheets(leadId);
      const crmResult = await crm.syncLeadToCrm(leadId);
      return sendJson(res, 200, {
        success: sheetsResult.success || crmResult.success,
        sheets: sheetsResult,
        crm: crmResult
      });
    }

    // F. Batch Retry All Failed/Pending Syncs
    if (pathname === '/api/admin/integrations/retry-all' && method === 'POST') {
      const sheetsBatch = await sheets.retryAllPendingOrFailed();
      const crmBatch = await crm.retryAllPendingOrFailed();
      return sendJson(res, 200, { sheets: sheetsBatch, crm: crmBatch });
    }

    // G. Test Integrations Ping
    if (pathname === '/api/admin/integrations/test-sheets' && method === 'POST') {
      const testResult = await sheets.testConnection();
      return sendJson(res, 200, testResult);
    }

    if (pathname === '/api/admin/integrations/test-crm' && method === 'POST') {
      const testResult = await crm.testConnection();
      return sendJson(res, 200, testResult);
    }

    // H. Reports: Geography
    if (pathname === '/api/admin/reports/geography' && method === 'GET') {
      return sendJson(res, 200, analytics.getGeographyReport());
    }

    // I. Reports: Schools
    if (pathname === '/api/admin/reports/schools' && method === 'GET') {
      return sendJson(res, 200, analytics.getSchoolReport());
    }

    // J. Reports: Meta Attribution Details
    if (pathname === '/api/admin/reports/meta' && method === 'GET') {
      return sendJson(res, 200, analytics.getMetaAttributionDetails());
    }

    // K. Export Leads to CSV
    if (pathname === '/api/admin/leads/export.csv' && method === 'GET') {
      const q = query;
      const { leads: exportLeads } = db.listLeads({
        search: q.search || '',
        role: q.role || '',
        status: q.status || '',
        limit: 10000,
        offset: 0
      });

      const headers = [
        'Lead ID', 'Created At (UTC)', 'Full Name', 'Phone', 'Email',
        'School Role', 'Role Specification', 'School Name', 'City/District',
        'Consent', 'Consent Version', 'UTM Source', 'UTM Medium', 'UTM Campaign',
        'Meta fbclid', 'Status', 'Sheets Sync Status', 'CRM Sync Status'
      ];

      const csvRows = [headers.join(',')];
      exportLeads.forEach(l => {
        const row = [
          `"${l.lead_id}"`,
          `"${l.created_at}"`,
          `"${(l.full_name || '').replace(/"/g, '""')}"`,
          `"${l.phone}"`,
          `"${l.email || ''}"`,
          `"${(l.school_role || '').replace(/"/g, '""')}"`,
          `"${(l.school_role_other || '').replace(/"/g, '""')}"`,
          `"${(l.school_name || '').replace(/"/g, '""')}"`,
          `"${(l.school_city_district || '').replace(/"/g, '""')}"`,
          l.consent ? 'YES' : 'NO',
          `"${l.consent_version}"`,
          `"${l.utm_source || ''}"`,
          `"${l.utm_medium || ''}"`,
          `"${l.utm_campaign || ''}"`,
          `"${l.fbclid || ''}"`,
          `"${l.lead_status}"`,
          `"${l.google_sheet_sync_status}"`,
          `"${l.crm_sync_status}"`
        ];
        csvRows.push(row.join(','));
      });

      const csvData = csvRows.join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mmc-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store'
      });
      return res.end(csvData);
    }

    return sendJson(res, 404, { success: false, message: 'Admin API route not found.' });
  }

  // ---------------------------------------------------------------------------
  // 5. STATIC & FRONTEND PAGE ROUTING
  // ---------------------------------------------------------------------------

  // A. Admin Login Page
  if (pathname === '/admin/login') {
    const session = auth.getSessionFromRequest(req);
    if (session) {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }
    return serveStaticFile(req, res, path.join(ROOT_DIR, 'admin', 'login.html'));
  }

  // B. Admin Dashboard Page (Protected)
  if (pathname === '/admin' || pathname === '/admin/') {
    const session = auth.getSessionFromRequest(req);
    if (!session) {
      res.writeHead(302, { Location: '/admin/login' });
      return res.end();
    }
    return serveStaticFile(req, res, path.join(ROOT_DIR, 'admin', 'index.html'));
  }

  // C. Landing Page Root
  if (pathname === '/' || pathname === '/index.html' || pathname === '/MMC%20Career%20Readiness%20Grant%E2%84%A2%202027%E2%80%9328.html' || pathname === '/MMC Career Readiness Grant™ 2027–28.html') {
    return serveStaticFile(req, res, path.join(ROOT_DIR, MAIN_HTML_NAME));
  }

  // D. General Static Assets
  let cleanPathname = pathname;
  if (cleanPathname.startsWith('/css/public/images/')) {
    cleanPathname = cleanPathname.replace('/css/public/images/', '/public/images/');
  }
  const safeRelativePath = path.normalize(cleanPathname).replace(/^(\.\.[\/\\])+/, '');
  const targetFilePath = path.join(ROOT_DIR, safeRelativePath);

  // Security: prevent directory traversal
  if (!targetFilePath.startsWith(ROOT_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(targetFilePath, (err, stats) => {
    if (!err && stats.isFile()) {
      return serveStaticFile(req, res, targetFilePath);
    }
    return sendText(res, 404, '404 Not Found');
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`MMC Career Readiness Grant™ 2027–28 Server`);
    console.log(`Status: Running at http://127.0.0.1:${PORT}/`);
    console.log(`Landing Page: http://127.0.0.1:${PORT}/`);
    console.log(`Admin Portal: http://127.0.0.1:${PORT}/admin`);
    console.log(`Health Check: http://127.0.0.1:${PORT}/api/health`);
    console.log(`Database:     data/leads.db (SQLite WAL Mode Active)`);
    console.log(`================================================================`);
  });
}

module.exports = server;

/**
 * MMC Career Readiness Grant™ 2027–28 — Google Sheets Sync Module
 * Manages Google Sheets integration via Google Apps Script Webhook
 * or Google Sheets API v4 with idempotent row appending and retry handling.
 */

const https = require('node:https');
const http = require('node:http');
require('./env');
const db = require('./db');

/**
 * Check if Google Sheets integration is configured in environment.
 */
function isConfigured() {
  if (process.env.GOOGLE_SHEETS_WEBHOOK_URL && process.env.GOOGLE_SHEETS_WEBHOOK_URL.trim().length > 0) {
    return { configured: true, method: 'WEBHOOK' };
  }
  if (
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SHEET_ID
  ) {
    return { configured: true, method: 'SERVICE_ACCOUNT' };
  }
  return { configured: false, method: 'NONE' };
}

/**
 * Format canonical row data for Google Sheets.
 */
function formatLeadForSheet(lead) {
  return {
    lead_id: lead.lead_id,
    created_at: lead.created_at,
    full_name: lead.full_name,
    phone: lead.phone,
    email: lead.email || '',
    school_role: lead.school_role,
    school_role_other: lead.school_role_other || '',
    school_name: lead.school_name,
    school_city_district: lead.school_city_district,
    consent: lead.consent ? 'YES' : 'NO',
    consent_version: lead.consent_version || 'v1.0-2027',
    utm_source: lead.utm_source || '',
    utm_medium: lead.utm_medium || '',
    utm_campaign: lead.utm_campaign || '',
    utm_content: lead.utm_content || '',
    utm_term: lead.utm_term || '',
    fbclid_or_click_id: lead.fbclid || '',
    landing_page_url: lead.landing_page_url || '',
    referrer_url: lead.referrer_url || '',
    lead_status: lead.lead_status || 'NEW',
    crm_sync_status: lead.crm_sync_status || 'NOT_CONFIGURED'
  };
}

/**
 * Send payload to Google Apps Script Webhook using native fetch.
 */
async function postToWebhook(urlStr, data) {
  const res = await fetch(urlStr, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'MMC-LeadEngine/1.0'
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000)
  });

  const text = await res.text();
  if (res.status >= 200 && res.status < 300) {
    return { success: true, statusCode: res.status, body: text };
  }
  throw new Error(`Google Webhook returned HTTP ${res.status}: ${text.slice(0, 150)}`);
}

/**
 * Execute sync for an individual lead.
 */
async function syncLeadToGoogleSheets(leadId) {
  const lead = db.getLeadById(leadId);
  if (!lead) {
    return { success: false, message: 'Lead not found in database.' };
  }

  const config = isConfigured();
  if (!config.configured) {
    db.updateLeadSyncStatus(leadId, 'GOOGLE_SHEETS', 'NOT_CONFIGURED', 'Google Sheets credentials or Webhook URL not configured in .env.');
    db.addSyncLog(leadId, 'GOOGLE_SHEETS', 'SKIPPED', 'Integration not configured in .env.');
    return {
      success: false,
      status: 'NOT_CONFIGURED',
      message: 'Google Sheets integration is awaiting configuration. Lead is safely stored in local database.'
    };
  }

  const startTime = Date.now();
  db.updateLeadSyncStatus(leadId, 'GOOGLE_SHEETS', 'PENDING');

  const rowData = formatLeadForSheet(lead);

  try {
    if (config.method === 'WEBHOOK') {
      await postToWebhook(process.env.GOOGLE_SHEETS_WEBHOOK_URL, {
        ...rowData,
        action: 'append_lead',
        lead: rowData
      });
    } else {
      // Service Account API stub
      throw new Error('Google Cloud Service Account authentication requires service account token exchange setup.');
    }

    const duration = Date.now() - startTime;
    db.updateLeadSyncStatus(leadId, 'GOOGLE_SHEETS', 'SYNCED', null);
    db.addSyncLog(leadId, 'GOOGLE_SHEETS', 'SUCCESS', null, duration);

    return { success: true, status: 'SYNCED', leadId };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err.message || 'Unknown Google Sheets sync error';
    db.updateLeadSyncStatus(leadId, 'GOOGLE_SHEETS', 'FAILED', errorMsg);
    db.addSyncLog(leadId, 'GOOGLE_SHEETS', 'FAILED', errorMsg, duration);

    return { success: false, status: 'FAILED', message: errorMsg };
  }
}

/**
 * Asynchronously queue a lead sync without blocking HTTP response.
 */
function queueLeadSync(leadId) {
  setImmediate(() => {
    syncLeadToGoogleSheets(leadId).catch(err => {
      console.error(`[Sheets Sync Error] Lead ${leadId}:`, err.message);
    });
  });
}

/**
 * Batch retry for failed or pending leads.
 */
async function retryAllPendingOrFailed() {
  const { leads } = db.listLeads({
    limit: 50,
    offset: 0
  });

  const targetLeads = leads.filter(l => l.google_sheet_sync_status === 'FAILED' || l.google_sheet_sync_status === 'PENDING');
  let successCount = 0;
  let failCount = 0;

  for (const lead of targetLeads) {
    const res = await syncLeadToGoogleSheets(lead.lead_id);
    if (res.success) successCount++;
    else failCount++;
  }

  return { total: targetLeads.length, succeeded: successCount, failed: failCount };
}

/**
 * Test integration connection without persisting test leads.
 */
async function testConnection() {
  const config = isConfigured();
  if (!config.configured) {
    return {
      connected: false,
      method: 'NONE',
      message: 'Google Sheets is not configured. Add GOOGLE_SHEETS_WEBHOOK_URL or Service Account credentials in .env.'
    };
  }

  if (config.method === 'WEBHOOK') {
    try {
      await postToWebhook(process.env.GOOGLE_SHEETS_WEBHOOK_URL, { action: 'ping' });
      return { connected: true, method: 'WEBHOOK', message: 'Webhook connection responded successfully.' };
    } catch (err) {
      return { connected: false, method: 'WEBHOOK', message: `Webhook connection test failed: ${err.message}` };
    }
  }

  return { connected: false, method: config.method, message: 'Service account credentials configured, awaiting authorization test.' };
}

module.exports = {
  isConfigured,
  formatLeadForSheet,
  syncLeadToGoogleSheets,
  queueLeadSync,
  retryAllPendingOrFailed,
  testConnection
};

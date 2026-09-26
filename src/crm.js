/**
 * MMC Career Readiness Grant™ 2027–28 — CRM Integration Adapter
 * Implements direct synchronization with LeadsZone.ai API
 * Supports automated lead creation, status updates, and retry queuing.
 */

require('./env');
const db = require('./db');

const DEFAULT_CRM_API_URL = 'https://app.leadszone.ai/api/integrate/a46e4428-cb4c-4a0c-98a5-5af15716d4e0/leads';

function isConfigured() {
  const provider = (process.env.CRM_PROVIDER || 'LeadsZone').trim();
  const apiUrl = (process.env.CRM_API_URL || DEFAULT_CRM_API_URL).trim();

  if (apiUrl && apiUrl.length > 0) {
    return { configured: true, provider, apiUrl };
  }
  return { configured: false, provider: 'None', apiUrl: null };
}

/**
 * Maps database lead to LeadsZone payload format
 */
function formatLeadForLeadsZone(lead) {
  const roleDisplay = lead.school_role === 'Other' && lead.school_role_other
    ? `Other (${lead.school_role_other})`
    : lead.school_role;

  const detailParts = [
    `School: ${lead.school_name}`,
    `Role: ${roleDisplay}`,
    `City: ${lead.school_city_district}`,
    `MMC ID: ${lead.lead_id}`
  ];

  if (lead.utm_source || lead.utm_campaign) {
    detailParts.push(`Source: ${lead.utm_source || 'direct'} / ${lead.utm_campaign || 'none'}`);
  }

  return {
    name: lead.full_name,
    mobile: lead.phone,
    email: lead.email || '',
    detail1: detailParts.join(' | ')
  };
}

/**
 * Synchronize a single lead to LeadsZone CRM
 */
async function syncLeadToCrm(leadId) {
  const lead = db.getLeadById(leadId);
  if (!lead) {
    return { success: false, message: 'Lead not found in database.' };
  }

  const config = isConfigured();
  if (!config.configured) {
    db.updateLeadSyncStatus(leadId, 'CRM', 'NOT_CONFIGURED', 'CRM_API_URL not configured in .env.');
    db.addSyncLog(leadId, 'CRM', 'SKIPPED', 'CRM integration not configured in .env.');
    return {
      success: false,
      status: 'NOT_CONFIGURED',
      message: 'CRM integration is awaiting configuration in .env.'
    };
  }

  const startTime = Date.now();
  db.updateLeadSyncStatus(leadId, 'CRM', 'PENDING');

  const payload = formatLeadForLeadsZone(lead);

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MMC-LeadEngine/1.0'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000) // 12s timeout
    });

    const duration = Date.now() - startTime;
    const responseText = await response.text();
    let responseData = null;
    try { responseData = JSON.parse(responseText); } catch {}

    if (response.status >= 200 && response.status < 300) {
      const crmRecordId = responseData && (responseData.lead_id || responseData.existing_lead_id)
        ? String(responseData.lead_id || responseData.existing_lead_id)
        : null;
      db.updateLeadSyncStatus(leadId, 'CRM', 'SYNCED', null, crmRecordId);
      db.addSyncLog(leadId, 'CRM', 'SUCCESS', `LeadsZone ID: ${crmRecordId || 'Created'}`, duration);

      return {
        success: true,
        status: 'SYNCED',
        leadId,
        crmRecordId,
        response: responseData || responseText
      };
    } else {
      const errorMsg = `LeadsZone returned HTTP ${response.status}: ${responseText.slice(0, 150)}`;
      db.updateLeadSyncStatus(leadId, 'CRM', 'FAILED', errorMsg);
      db.addSyncLog(leadId, 'CRM', 'FAILED', errorMsg, duration);

      return {
        success: false,
        status: 'FAILED',
        message: errorMsg
      };
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err.message || 'Unknown network error connecting to CRM';
    db.updateLeadSyncStatus(leadId, 'CRM', 'FAILED', errorMsg);
    db.addSyncLog(leadId, 'CRM', 'FAILED', errorMsg, duration);

    return {
      success: false,
      status: 'FAILED',
      message: errorMsg
    };
  }
}

/**
 * Asynchronously queue lead sync to CRM without blocking user response
 */
function queueLeadSync(leadId) {
  setImmediate(() => {
    syncLeadToCrm(leadId).catch(err => {
      console.error(`[CRM Sync Error] Lead ${leadId}:`, err.message);
    });
  });
}

/**
 * Batch retry for failed or pending CRM leads
 */
async function retryAllPendingOrFailed() {
  const result = db.listLeads({ limit: 1000, offset: 0 });
  const eligible = result.leads.filter(l => l.crm_sync_status === 'FAILED' || l.crm_sync_status === 'PENDING' || l.crm_sync_status === 'NOT_CONFIGURED');

  const summary = { total: eligible.length, synced: 0, failed: 0 };
  for (const lead of eligible) {
    const res = await syncLeadToCrm(lead.lead_id);
    if (res.success) summary.synced++;
    else summary.failed++;
  }

  return summary;
}

/**
 * Test connectivity to LeadsZone endpoint
 */
async function testConnection() {
  const config = isConfigured();
  if (!config.configured) {
    return { success: false, message: 'CRM endpoint URL not configured in .env' };
  }

  try {
    const res = await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'MMC Ping Test',
        mobile: '9999999999',
        email: 'ping@mymentorcircle.com',
        detail1: 'Connection Test from MMC Lead System'
      }),
      signal: AbortSignal.timeout(8000)
    });
    const text = await res.text();
    return {
      success: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      body: text.slice(0, 200)
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  isConfigured,
  formatLeadForLeadsZone,
  syncLeadToCrm,
  queueLeadSync,
  retryAllPendingOrFailed,
  testConnection
};

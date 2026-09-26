import { json } from '../_shared.js';

export async function onRequestGet(context) {
  const { env } = context;

  let totalLeads = 0;
  let d1Status = 'DISCONNECTED';

  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT COUNT(*) as total FROM leads').first();
      totalLeads = row ? row.total : 0;
      d1Status = 'CONNECTED';
    } catch (err) {
      d1Status = 'ERROR: ' + err.message;
    }
  }

  return json({
    status: 'OK',
    runtime: 'Cloudflare Pages Functions / Workers',
    timestamp: new Date().toISOString(),
    database: {
      type: 'Cloudflare D1 SQL Database',
      database_id: 'a63cfb65-eb51-4ade-86f7-0154c874fb17',
      binding: env.DB ? 'DB' : 'MISSING_BINDING',
      status: d1Status,
      total_leads: totalLeads
    },
    integrations: {
      google_sheets: {
        configured: Boolean(env.GOOGLE_SHEETS_WEBHOOK_URL && env.GOOGLE_SHEETS_WEBHOOK_URL.trim())
      },
      crm: {
        configured: Boolean(env.CRM_API_URL && env.CRM_API_URL.trim()),
        provider: env.CRM_PROVIDER || 'LeadsZone'
      }
    }
  });
}

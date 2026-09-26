import { json, verifyAdminSession, syncToGoogleSheets, syncToLeadsZone } from '../../../_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  if (!env.DB) {
    return json({ success: false, message: 'Cloudflare D1 database binding (DB) is missing.' }, 500);
  }

  try {
    const pendingLeadsResult = await env.DB.prepare(`
      SELECT * FROM leads 
      WHERE google_sheet_sync_status != 'SYNCED' OR crm_sync_status != 'SYNCED'
      LIMIT 100
    `).all();

    const pendingLeads = pendingLeadsResult.results || [];
    let succeeded = 0;
    let failed = 0;

    for (const lead of pendingLeads) {
      let leadOk = true;

      if (lead.google_sheet_sync_status !== 'SYNCED') {
        const sRes = await syncToGoogleSheets(lead, env);
        if (!sRes.success) leadOk = false;
      }

      if (lead.crm_sync_status !== 'SYNCED') {
        const cRes = await syncToLeadsZone(lead, env);
        if (!cRes.success) leadOk = false;
      }

      if (leadOk) succeeded++;
      else failed++;
    }

    return json({
      success: true,
      total: pendingLeads.length,
      succeeded,
      failed,
      message: `Processed ${pendingLeads.length} leads: ${succeeded} succeeded, ${failed} failed.`
    }, 200);
  } catch (err) {
    console.error('Batch retry error:', err);
    return json({ success: false, message: 'Failed to process batch sync retry.' }, 500);
  }
}

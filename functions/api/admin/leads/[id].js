import { json, verifyAdminSession } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const leadId = params.id;
  if (!leadId) {
    return json({ success: false, message: 'Lead ID is required.' }, 400);
  }

  try {
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE lead_id = ?').bind(leadId).first();
    if (!lead) {
      return json({ success: false, message: 'Lead not found.' }, 404);
    }

    const logsResult = await env.DB.prepare(
      'SELECT * FROM sync_logs WHERE lead_id = ? ORDER BY attempted_at DESC LIMIT 20'
    ).bind(leadId).all();

    return json({
      success: true,
      lead,
      syncLogs: logsResult.results || []
    }, 200);
  } catch (err) {
    console.error('Lead detail error:', err);
    return json({ success: false, message: 'Failed to retrieve lead details.' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const leadId = params.id;
  if (!leadId) {
    return json({ success: false, message: 'Lead ID is required.' }, 400);
  }

  try {
    if (!env || !env.DB) {
      return json({ success: false, message: 'Database binding not available.' }, 500);
    }

    // Delete associated sync logs and lead record
    await env.DB.prepare('DELETE FROM sync_logs WHERE lead_id = ?').bind(leadId).run();
    const result = await env.DB.prepare('DELETE FROM leads WHERE lead_id = ?').bind(leadId).run();

    return json({
      success: true,
      message: `Lead ${leadId} deleted successfully.`
    }, 200);
  } catch (err) {
    console.error('Delete lead error:', err);
    return json({ success: false, message: 'Failed to delete lead: ' + err.message }, 500);
  }
}

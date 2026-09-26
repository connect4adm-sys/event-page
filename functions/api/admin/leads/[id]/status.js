import { json, verifyAdminSession } from '../../../../_shared.js';

const VALID_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'ENROLLED'];

export async function onRequestPatch(context) {
  const { request, env, params } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const leadId = params.id;
  if (!leadId) {
    return json({ success: false, message: 'Lead ID is required.' }, 400);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid JSON request payload.' }, 400);
  }

  const newStatus = typeof body.status === 'string' ? body.status.toUpperCase().trim() : '';
  if (!VALID_STATUSES.includes(newStatus)) {
    return json({
      success: false,
      message: `Invalid lead status. Must be one of: ${VALID_STATUSES.join(', ')}`
    }, 400);
  }

  try {
    await env.DB.prepare(
      'UPDATE leads SET lead_status = ?, updated_at = datetime("now") WHERE lead_id = ?'
    ).bind(newStatus, leadId).run();

    const updated = await env.DB.prepare('SELECT * FROM leads WHERE lead_id = ?').bind(leadId).first();
    return json({ success: true, lead: updated }, 200);
  } catch (err) {
    console.error('Update lead status error:', err);
    return json({ success: false, message: 'Failed to update lead status.' }, 500);
  }
}

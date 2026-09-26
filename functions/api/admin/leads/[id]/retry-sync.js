import { json, verifyAdminSession, syncToGoogleSheets, syncToLeadsZone } from '../../../../_shared.js';

export async function onRequestPost(context) {
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

    const [sheetsResult, crmResult] = await Promise.all([
      syncToGoogleSheets(lead, env),
      syncToLeadsZone(lead, env)
    ]);

    return json({
      success: sheetsResult.success || crmResult.success,
      sheets: sheetsResult,
      crm: crmResult
    }, 200);
  } catch (err) {
    console.error('Retry sync error:', err);
    return json({ success: false, message: 'Failed to retry sync.' }, 500);
  }
}

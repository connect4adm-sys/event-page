import { json, verifyAdminSession, listLeadsD1 } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const url = new URL(request.url);
  const p = url.searchParams;

  try {
    const result = await listLeadsD1(env, {
      search: p.get('search') || '',
      role: p.get('role') || '',
      status: p.get('status') || '',
      gsheetStatus: p.get('gsheetStatus') || '',
      crmStatus: p.get('crmStatus') || '',
      source: p.get('source') || '',
      campaign: p.get('campaign') || '',
      city: p.get('city') || '',
      period: p.get('period') || '',
      startDate: p.get('startDate') || '',
      endDate: p.get('endDate') || '',
      limit: parseInt(p.get('limit'), 10) || 20,
      offset: parseInt(p.get('offset'), 10) || 0,
      sortOrder: p.get('sortOrder') || 'DESC'
    });

    return json(result, 200);
  } catch (err) {
    console.error('List leads error:', err);
    return json({ success: false, message: 'Failed to retrieve leads list.' }, 500);
  }
}

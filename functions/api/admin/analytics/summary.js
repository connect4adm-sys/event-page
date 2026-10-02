import { json, verifyAdminSession, getDashboardSummaryD1 } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '';
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  const days = parseInt(url.searchParams.get('days'), 10) || null;

  try {
    const summary = await getDashboardSummaryD1(env, { period, startDate, endDate, days });
    return json(summary, 200);
  } catch (err) {
    console.error('Analytics summary error:', err);
    return json({ success: false, message: 'Failed to retrieve analytics summary.' }, 500);
  }
}

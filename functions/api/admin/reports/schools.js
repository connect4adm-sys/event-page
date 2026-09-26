import { json, verifyAdminSession, getSchoolReportD1 } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  try {
    const report = await getSchoolReportD1(env);
    return json(report, 200);
  } catch (err) {
    console.error('School report error:', err);
    return json({ success: false, message: 'Failed to retrieve school report.' }, 500);
  }
}

import { json, verifyAdminSession, getMetaAttributionDetailsD1 } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  try {
    const report = await getMetaAttributionDetailsD1(env);
    return json(report, 200);
  } catch (err) {
    console.error('Meta attribution report error:', err);
    return json({ success: false, message: 'Failed to retrieve Meta attribution report.' }, 500);
  }
}

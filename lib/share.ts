import { RequestError } from './request-limits';
export function shareUrl(request: Request, token: string, bulk = false) {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '');
  return `${origin}/shared/${bulk ? 'bulk/' : ''}${token}`;
}
export function shareOptions(body: any, days: number | null = 30) {
  if (body.allowChat !== undefined && typeof body.allowChat !== 'boolean') throw new RequestError('Invalid chat permission');
  return { shareExpiresAt: days === null ? null : new Date(Date.now() + days * 86400000), shareAllowChat: body.allowChat === true };
}
export async function configuredShareOptions(body: any) {
  const { getCollection } = await import('./db');
  const { shareExpiryDays } = await import('./runtime-settings');
  const doc = await (await getCollection('global_settings')).findOne({ type: 'models' });
  // User-supplied expiry is deliberately ignored; only the admin policy applies.
  return shareOptions(body, shareExpiryDays(doc?.settings?.shareExpiryDays));
}
export function activeShareFilter() {
  return { $or: [{ shareExpiresAt: { $exists: false } }, { shareExpiresAt: null }, { shareExpiresAt: { $gt: new Date() } }] };
}

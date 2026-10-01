import { RequestError } from './request-limits';
export function shareUrl(request: Request, token: string, bulk = false) {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '');
  return `${origin}/shared/${bulk ? 'bulk/' : ''}${token}`;
}
export function shareOptions(body: any) {
  const days = body.expiresInDays ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 365 || (body.allowChat !== undefined && typeof body.allowChat !== 'boolean')) throw new RequestError('Invalid expiry or chat permission');
  return { shareExpiresAt: new Date(Date.now() + days * 86400000), shareAllowChat: body.allowChat === true };
}
export function activeShareFilter() {
  return { $or: [{ shareExpiresAt: { $exists: false } }, { shareExpiresAt: null }, { shareExpiresAt: { $gt: new Date() } }] };
}

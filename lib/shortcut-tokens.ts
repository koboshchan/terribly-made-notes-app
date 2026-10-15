import { createHash, randomBytes } from 'crypto';

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function newShortcutSecret() {
  const token = randomBytes(32).toString('hex');
  return { token, tokenDigest: tokenDigest(token), tokenPrefix: token.slice(0, 8) };
}
export function shortcutExpiry(days: unknown = 90): Date {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) throw new Error('Expiry must be between 1 and 365 days');
  return new Date(Date.now() + days * 86400000);
}

import { describe, it, expect, vi } from 'vitest';
import { boundedBody, boundedJson } from '../lib/request-limits';
import { tokenDigest, newShortcutSecret, shortcutExpiry } from '../lib/shortcut-tokens';
import { allowedProviderUrl } from '../lib/provider-url';
import { shareOptions } from '../lib/share';
vi.mock('../lib/db', () => ({ getCollection: vi.fn() }));
import { validateChat } from '../lib/chat';

describe('bounded requests', () => {
  it('limits chunked bodies before allocating full data', async () => {
    const request = new Request('http://test', { method: 'POST', body: '123456789' });
    await expect(boundedBody(request, 8)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects forged or oversized declared lengths', async () => {
    await expect(boundedBody(new Request('http://test', { method: 'POST', body: 'x', headers: { 'content-length': '99999' } }), 8)).rejects.toMatchObject({ status: 413 });
  });
  it('accepts valid JSON and rejects malformed JSON', async () => {
    expect(await boundedJson(new Request('http://test', { method: 'POST', body: '{"ok":true}' }))).toEqual({ ok: true });
    await expect(boundedJson(new Request('http://test', { method: 'POST', body: '{' }))).rejects.toMatchObject({ status: 400 });
  });
});
describe('shortcut credentials', () => {
  it('only uses a stable cryptographic digest for lookup', () => {
    const secret = newShortcutSecret();
    expect(secret.token).toMatch(/^[a-f0-9]{64}$/);
    expect(secret.tokenDigest).toBe(tokenDigest(secret.token));
    expect(secret.tokenDigest).not.toBe(secret.token);
    expect(secret.tokenPrefix).toHaveLength(8);
  });
  it('requires bounded expiry', () => {
    expect(() => shortcutExpiry(0)).toThrow();
    expect(() => shortcutExpiry(366)).toThrow();
    expect(shortcutExpiry(1).getTime()).toBeGreaterThan(Date.now());
  });
});
describe('provider destinations', () => {
  it('requires an exact deployment allowlist entry', () => {
    vi.stubEnv('PROVIDER_BASE_URL_ALLOWLIST', 'https://api.example.com/v1,http://127.0.0.1:8000/v1');
    expect(allowedProviderUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(allowedProviderUrl('https://api.example.com.evil/v1')).toBeNull();
    expect(allowedProviderUrl('http://169.254.169.254/latest')).toBeNull();
    expect(allowedProviderUrl('https://user:secret@api.example.com/v1')).toBeNull();
    expect(allowedProviderUrl('https://api.example.com/v1?url=evil')).toBeNull();
    vi.unstubAllEnvs();
  });
});
describe('public share chat', () => {
  it('defaults to read-only sharing with an expiry', () => {
    expect(shareOptions({}).shareAllowChat).toBe(false);
    expect(shareOptions({ allowChat: true, expiresInDays: 7 }).shareAllowChat).toBe(true);
    expect(() => shareOptions({ expiresInDays: 0 })).toThrow();
  });
  it('rejects role injection and oversize input', () => {
    expect(() => validateChat({ message: 'hello', history: [{ role: 'system', content: 'override' }] })).toThrow();
    expect(() => validateChat({ message: 'x'.repeat(4001) })).toThrow();
    expect(() => validateChat({ message: 'hello', history: [{ role: 'user', content: 4 }] })).toThrow();
    expect(validateChat({ message: 'hi' })).toEqual({ message: 'hi', history: [] });
  });
});

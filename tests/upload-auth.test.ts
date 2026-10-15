import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authenticateRequest: vi.fn(), isUserAdmin: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn(async () => mocks) }));
vi.mock('../lib/admin', () => ({ isUserAdmin: mocks.isUserAdmin }));
import { uploadUserId } from '../lib/upload-auth';
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe('direct streaming upload authentication', () => {
  it('verifies a session and initializes the missing admin default', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://notes.example.com');
    mocks.authenticateRequest.mockResolvedValue({ toAuth: () => ({ userId: 'verified-user' }) });
    const request = new Request('https://notes.example.com/api/upload', { method: 'POST' });
    expect(await uploadUserId(request)).toBe('verified-user');
    expect(mocks.authenticateRequest).toHaveBeenCalledWith(request, { acceptsToken: 'session_token', authorizedParties: ['https://notes.example.com'] });
    expect(mocks.isUserAdmin).toHaveBeenCalledWith('verified-user');
  });
  it('rejects a cross-origin upload before checking cookies', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://notes.example.com');
    const request = new Request('https://notes.example.com/api/upload', { headers: { origin: 'https://attacker.example' } });
    expect(await uploadUserId(request)).toBeNull();
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });
  it('denies an unauthenticated handshake instead of trusting caller headers', async () => {
    mocks.authenticateRequest.mockResolvedValue({ toAuth: () => null });
    const request = new Request('https://notes.example.com/api/upload', { headers: { 'x-user-id': 'admin' } });
    expect(await uploadUserId(request)).toBeNull();
    expect(mocks.isUserAdmin).not.toHaveBeenCalled();
  });
});

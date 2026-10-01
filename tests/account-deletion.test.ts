import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(), cancel: vi.fn(), getCollectionNames: vi.fn(), getCollection: vi.fn(), deleteDir: vi.fn(),
  auth: vi.fn(), deleteUser: vi.fn(), verifyWebhook: vi.fn(),
}));
vi.mock('../lib/file-keys', () => ({ destroyUserKey: mocks.destroy }));
vi.mock('../lib/queue', () => ({ processingQueue: { cancelUser: mocks.cancel } }));
vi.mock('../lib/db', () => ({ getCollection: mocks.getCollection, getCollectionNames: mocks.getCollectionNames }));
vi.mock('../lib/storage', () => ({ deleteDir: mocks.deleteDir, getUserDataDir: (id: string) => `/data/${id}` }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth, clerkClient: async () => ({ users: { deleteUser: mocks.deleteUser } }) }));
vi.mock('@clerk/nextjs/webhooks', () => ({ verifyWebhook: mocks.verifyWebhook }));
import { handleDeletedAccount } from '../lib/account-deletion';
import { DELETE } from '../app/api/user/route';
import { POST } from '../app/api/webhooks/clerk/route';

const removed = new Map<string, ReturnType<typeof vi.fn>>();
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); removed.clear();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://notes.example');
  vi.stubEnv('DATA_DIR', '/data');
  mocks.getCollectionNames.mockResolvedValue(['notes', 'future_materials', 'file_encryption_keys', 'file_encryption_nonces', 'processing_jobs']);
  mocks.destroy.mockResolvedValue(undefined); mocks.cancel.mockResolvedValue(undefined);
  mocks.deleteDir.mockReturnValue(undefined); mocks.auth.mockResolvedValue({ userId: 'user_test' });
  mocks.deleteUser.mockResolvedValue({});
  mocks.getCollection.mockImplementation(async (name: string) => {
    const deleteMany = removed.get(name) || vi.fn().mockResolvedValue({});
    removed.set(name, deleteMany); return { deleteMany };
  });
  mocks.verifyWebhook.mockResolvedValue({ type: 'user.deleted', data: { id: 'user_test' } });
});
function request(headers: Record<string, string> = { origin: 'https://notes.example' }) {
  return new Request('https://notes.example/api/user', { method: 'DELETE', headers });
}
function webhook() {
  return new NextRequest('https://notes.example/api/webhooks/clerk', { method: 'POST', body: '{"type":"user.deleted"}' });
}

describe('account deletion key ordering and cleanup', () => {
  it('destroys the key before cancellation and removes each owned collection', async () => {
    expect(await handleDeletedAccount('user_test')).toEqual({ complete: true, pending: [] });
    expect(mocks.destroy.mock.invocationCallOrder[0]).toBeLessThan(mocks.cancel.mock.invocationCallOrder[0]);
    for (const name of ['notes', 'user_classes', 'shared_note_sets', 'shortcut_tokens', 'user_settings', 'usage_limits', 'processing_jobs']) {
      expect(removed.get(name)).toHaveBeenCalledWith(name === 'processing_jobs' ? { userId: 'user_test' } : { $or: [{ userId: 'user_test' }, { ownerId: 'user_test' }, { accountId: 'user_test' }, { clerkUserId: 'user_test' }] });
    }
    expect(removed.has('file_encryption_keys')).toBe(false);
    expect(mocks.deleteDir).toHaveBeenCalledWith('/data/user_test');
  });
  it('hard-deletes discovered content collections idempotently without touching other accounts', async () => {
    const rows = [{ ownerId: 'user_test', text: 'private' }, { userId: 'other', text: 'keep' }];
    const erase = vi.fn(async (query: { $or: Record<string, string>[] }) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (query.$or.some(filter => Object.entries(filter).every(([key, value]) => (rows[i] as Record<string, unknown>)[key] === value))) rows.splice(i, 1);
      }
    });
    removed.set('future_materials', erase);
    expect((await handleDeletedAccount('user_test')).complete).toBe(true);
    expect((await handleDeletedAccount('user_test')).complete).toBe(true);
    expect(rows).toEqual([{ userId: 'other', text: 'keep' }]);
    expect(erase).toHaveBeenCalledTimes(2);
    expect(removed.has('file_encryption_keys')).toBe(false);
    expect(removed.has('file_encryption_nonces')).toBe(false);
    for (const name of ['transcripts', 'summaries', 'study_materials', 'chat_history', 'settings']) expect(removed.get(name)).toHaveBeenCalledTimes(2);
  });
  it('retries collection discovery failures rather than acknowledging incomplete erasure', async () => {
    mocks.getCollectionNames.mockRejectedValueOnce(new Error('unavailable'));
    expect((await handleDeletedAccount('user_test')).pending).toContain('collection discovery');
    expect((await handleDeletedAccount('user_test')).complete).toBe(true);
  });
  it('fails before cancellation and cleanup if the tombstone cannot persist', async () => {
    mocks.destroy.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(handleDeletedAccount('user_test')).rejects.toThrow();
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.deleteDir).not.toHaveBeenCalled();
  });
  it('does not unlink files or delete cancellation records while active work remains', async () => {
    mocks.cancel.mockRejectedValueOnce(new Error('still running'));
    expect(await handleDeletedAccount('user_test')).toEqual({ complete: false, pending: ['processing cancellation'] });
    expect(mocks.deleteDir).not.toHaveBeenCalled(); expect(removed.has('processing_jobs')).toBe(false);
    expect(removed.get('shortcut_tokens')).toHaveBeenCalled();
  });
  it('continues independent cleanup after a collection failure and can retry', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({});
    removed.set('notes', failing);
    expect((await handleDeletedAccount('user_test')).complete).toBe(false);
    expect(mocks.deleteDir).toHaveBeenCalled();
    expect((await handleDeletedAccount('user_test')).complete).toBe(true);
  });
  it('rejects traversal identifiers before destroying the key', async () => {
    await expect(handleDeletedAccount('../other')).rejects.toThrow();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
});

describe('authenticated DELETE account', () => {
  it('destroys the key before deleting the Clerk identity', async () => {
    expect((await DELETE(request())).status).toBe(200);
    expect(mocks.destroy.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteUser.mock.invocationCallOrder[0]);
  });
  it('rejects forged Origin before authentication', async () => {
    expect((await DELETE(request({ origin: 'https://evil.example' }))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it('rejects no-Origin cookie requests even with a bearer header', async () => {
    expect((await DELETE(request({ cookie: '__session=x', authorization: 'Bearer x' }))).status).toBe(403);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it('accepts a verified native bearer session without Origin or cookies', async () => {
    expect((await DELETE(request({ authorization: 'Bearer x' }))).status).toBe(200);
    expect(mocks.auth).toHaveBeenCalled();
  });
  it('rejects an unauthenticated request without key destruction', async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null });
    expect((await DELETE(request())).status).toBe(401);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it('does not delete the identity if key destruction fails', async () => {
    mocks.destroy.mockRejectedValueOnce(new Error('down'));
    expect((await DELETE(request())).status).toBe(503);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it('cleans local data and requests retry when Clerk deletion fails', async () => {
    mocks.deleteUser.mockRejectedValueOnce(new Error('down'));
    expect((await DELETE(request())).status).toBe(503);
    expect(mocks.deleteDir).toHaveBeenCalled();
  });
  it('reports incomplete cleanup as 202 after Clerk deletion', async () => {
    mocks.cancel.mockRejectedValueOnce(new Error('busy'));
    const response = await DELETE(request());
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ deleted: true, cleanupPending: true });
  });
});

describe('signed Clerk deletion webhook', () => {
  it('fails closed without a secret before reading the request', async () => {
    expect((await POST(webhook())).status).toBe(503);
    expect(mocks.verifyWebhook).not.toHaveBeenCalled(); expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it('rejects an invalid signature without deletion', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', 'whsec_test');
    mocks.verifyWebhook.mockRejectedValueOnce(new Error('bad signature'));
    expect((await POST(webhook())).status).toBe(400); expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it('passes the unconsumed raw request directly to the installed verifier', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', 'whsec_test'); const req = webhook();
    expect((await POST(req)).status).toBe(200);
    expect(mocks.verifyWebhook).toHaveBeenCalledWith(req, { signingSecret: 'whsec_test' });
    expect(req.bodyUsed).toBe(false);
  });
  it('acknowledges unrelated verified events without destructive changes', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', 'whsec_test');
    mocks.verifyWebhook.mockResolvedValueOnce({ type: 'user.created', data: { id: 'user_test' } });
    expect((await POST(webhook())).status).toBe(200); expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it('retries failed cleanup instead of acknowledging delivery', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', 'whsec_test'); mocks.cancel.mockRejectedValueOnce(new Error('busy'));
    expect((await POST(webhook())).status).toBe(503);
    expect((await POST(webhook())).status).toBe(200);
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid signed account identifiers', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', 'whsec_test');
    mocks.verifyWebhook.mockResolvedValueOnce({ type: 'user.deleted', data: { id: '../bad' } });
    expect((await POST(webhook())).status).toBe(400); expect(mocks.destroy).not.toHaveBeenCalled();
  });
});

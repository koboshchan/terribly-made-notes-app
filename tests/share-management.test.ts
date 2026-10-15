import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), findOne: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn(),
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('../lib/db', () => ({ getCollection: vi.fn(async () => mocks) }));
import { PATCH as patchNote, DELETE as deleteNote } from '../app/api/notes/[id]/share/route';
import { PATCH as patchBulk, DELETE as deleteBulk } from '../app/api/notes/share-bulk/route';
const id = 'a'.repeat(24);
const token = 'b'.repeat(48);
const context = () => ({ params: Promise.resolve({ id }) });
function request(method: string, body?: unknown) {
  return new NextRequest('https://notes.example.com/api/notes/' + id + '/share', {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'owner' });
  mocks.findOne.mockResolvedValue({ status: 'completed', shareToken: token, shareEnabled: true });
  mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
  mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });
});
describe('share link management', () => {
  it('updates expiry and permission without replacing an individual link', async () => {
    const response = await patchNote(request('PATCH', { expiresInDays: 7, allowChat: true }), context());
    expect(response.status).toBe(200);
    const update = mocks.updateOne.mock.calls[0][1];
    expect(update.$set.shareToken).toBe(token);
    expect(update.$set.shareAllowChat).toBe(true);
    expect(update.$set.shareExpiresAt).toBeInstanceOf(Date);
  });
  it('deletes all individual share fields but preserves the note', async () => {
    const response = await deleteNote(request('DELETE'), context());
    expect(response.status).toBe(200);
    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter.userId).toBe('owner');
    expect(Object.keys(update.$unset).sort()).toEqual(['shareAllowChat', 'shareEnabled', 'shareExpiresAt', 'shareToken', 'sharedAt'].sort());
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ success: true, shareUrl: null });
  });
  it('keeps the bulk link stable when updating expiry', async () => {
    const response = await patchBulk(request('PATCH', { token, expiresInDays: 10, allowChat: false }));
    expect(response.status).toBe(200);
    expect(mocks.updateOne).toHaveBeenCalledWith({ userId: 'owner', shareToken: token }, {
      $set: expect.objectContaining({ shareToken: token, shareEnabled: true, shareAllowChat: false }),
    });
  });
  it('deletes the owned bulk share record only', async () => {
    const response = await deleteBulk(request('DELETE', { token }));
    expect(response.status).toBe(200);
    expect(mocks.deleteOne).toHaveBeenCalledWith({ userId: 'owner', shareToken: token });
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
  it('denies anonymous deletion', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await deleteNote(request('DELETE'), context())).status).toBe(401);
    expect((await deleteBulk(request('DELETE', { token }))).status).toBe(401);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });
  it('does not delete another owner\'s note share', async () => {
    mocks.findOne.mockResolvedValue(null);
    expect((await deleteNote(request('DELETE'), context())).status).toBe(404);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
  it('does not delete a missing or differently owned bulk link', async () => {
    mocks.deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect((await deleteBulk(request('DELETE', { token }))).status).toBe(404);
  });
});

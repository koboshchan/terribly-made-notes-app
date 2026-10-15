import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { boundedJson } from '../lib/request-limits';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), findOne: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn(), insertOne: vi.fn(),
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('../lib/db', () => ({ getCollection: vi.fn(async () => mocks) }));
vi.mock('../lib/queue', () => ({ processingQueue: {} }));
vi.mock('../lib/storage', () => ({ saveFile: vi.fn(), getNoteDir: vi.fn() }));
import { POST as sharePost, PATCH as sharePatch } from '../app/api/notes/[id]/share/route';
import { POST as bulkPost, PATCH as bulkPatch, DELETE as bulkDelete } from '../app/api/notes/share-bulk/route';
import { PATCH as notePatch } from '../app/api/notes/[id]/route';

const malformed = [null, [], ['x'], 'x', 42, true];
const context = { params: Promise.resolve({ id: 'a'.repeat(24) }) };
function request(method: string, value: unknown) {
  return new NextRequest('https://notes.example/api/notes/' + 'a'.repeat(24), {
    method, body: JSON.stringify(value), headers: { 'content-type': 'application/json' },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'owner' });
  mocks.findOne.mockResolvedValue({ status: 'completed' });
});
describe('JSON object API boundaries', () => {
  it.each(malformed)('rejects a non-object JSON body %j', async value => {
    await expect(boundedJson(request('POST', value))).rejects.toMatchObject({ status: 400 });
  });
  for (const [name, method, handler] of [
    ['single create', 'POST', sharePost], ['single update', 'PATCH', sharePatch],
    ['bulk create', 'POST', bulkPost], ['bulk update', 'PATCH', bulkPatch],
    ['bulk revoke', 'DELETE', bulkDelete], ['note update', 'PATCH', notePatch],
  ] as const) {
    it.each(malformed)(name + ' returns 400 without mutations for %j', async value => {
      const response = await handler(request(method, value), context);
      expect(response.status).toBe(400);
      expect(mocks.updateOne).not.toHaveBeenCalled();
      expect(mocks.deleteOne).not.toHaveBeenCalled();
      expect(mocks.insertOne).not.toHaveBeenCalled();
    });
  }
});

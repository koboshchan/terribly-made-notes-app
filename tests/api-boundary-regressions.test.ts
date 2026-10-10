import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findOne: vi.fn(), insertOne: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('../lib/db', () => ({ getCollection: vi.fn(async () => mocks) }));
vi.mock('../lib/queue', () => ({ processingQueue: {} }));
import { GET as bulkDetail } from '../app/api/shared-bulk/[token]/notes/[noteId]/route';
import { GET as noteGet, DELETE as noteDelete } from '../app/api/notes/[id]/route';
import { POST as createClass } from '../app/api/user/classes/route';
const id = 'a'.repeat(24);
function request(method = 'GET', body?: unknown) {
  return new NextRequest('https://notes.example/api/notes/' + id, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'owner' }); });
describe('API input and ownership boundaries', () => {
  it('scopes bulk detail to the share owner even when a foreign ID appears in a legacy set', async () => {
    mocks.findOne.mockResolvedValueOnce({ noteIds: [], userId: 'owner' }).mockResolvedValueOnce(null);
    const response = await bulkDetail(request(), { params: Promise.resolve({ token: 'b'.repeat(48), noteId: id }) });
    expect(response.status).toBe(404);
    expect(mocks.findOne.mock.calls[1][0]).toEqual(expect.objectContaining({ userId: 'owner', status: 'completed' }));
  });
  it.each([noteGet, noteDelete])('rejects malformed note IDs as client errors before querying', async handler => {
    expect((await handler(request(), { params: Promise.resolve({ id: 'not-an-id' }) })).status).toBe(400);
    expect(mocks.findOne).not.toHaveBeenCalled();
  });
  it.each([{ name: 123 }, { name: 'x', description: {} }, { name: 'x'.repeat(101) }, { name: 'x', description: 'x'.repeat(1001) }])('rejects invalid class metadata %j', async body => {
    expect((await createClass(request('POST', body))).status).toBe(400);
    expect(mocks.insertOne).not.toHaveBeenCalled();
  });
  it('bounds class JSON before reading untrusted metadata', async () => {
    expect((await createClass(request('POST', { name: 'x', description: 'x'.repeat(9000) }))).status).toBe(413);
    expect(mocks.insertOne).not.toHaveBeenCalled();
  });
});

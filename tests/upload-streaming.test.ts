import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFile, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
vi.mock('../lib/queue', () => ({ processingQueue: { enqueue: vi.fn() } }));
vi.mock('../lib/db', () => ({ getCollection: vi.fn() }));
import { parseUpload, acceptUpload } from '../lib/upload';
import { getCollection } from '../lib/db';

function raw(body: BodyInit, signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/shortcuts', { method: 'PUT', headers: { 'content-type': 'audio/mpeg' }, body, signal, duplex: 'half' } as any);
}
async function tempUploads() { return (await readdir(tmpdir())).filter(name => name.startsWith('notes-upload-')); }

describe('disk-stream uploads', () => {
  it('streams raw chunks to disk and hashes incrementally without a Buffer result', async () => {
    let index = 0;
    const body = new ReadableStream({ pull(controller) {
      if (index++ === 8) controller.close();
      else controller.enqueue(new Uint8Array(65536).fill(7));
    } });
    const upload = await parseUpload(raw(body), true);
    try {
      expect(upload.size).toBe(8 * 65536);
      expect(upload).not.toHaveProperty('data');
      expect(upload.sha256).toBe(createHash('sha256').update(await readFile(upload.tempPath)).digest('hex'));
      expect(upload.filename).toBe('recording.mp3');
    } finally { await rm(upload.tempDir, { recursive: true }); }
  });
  it('streams multipart audio and preserves small metadata fields', async () => {
    const form = new FormData();
    form.append('file', new Blob(['abc']), 'test.mp3');
    form.append('language', 'other');
    form.append('className', 'Physics');
    form.append('generateQuiz', 'false');
    const upload = await parseUpload(new NextRequest('http://localhost/api/upload', { method: 'POST', body: form }));
    try {
      expect((await readFile(upload.tempPath)).toString()).toBe('abc');
      expect(upload.language).toBe('other');
      expect(upload.className).toBe('Physics');
      expect(upload.processingPreferences).toEqual({ flashcards: true, quiz: false });
    } finally { await rm(upload.tempDir, { recursive: true }); }
  });
  it('cleans temp files on malformed multipart and interrupted raw streams', async () => {
    const before = await tempUploads();
    const request = new NextRequest('http://localhost/api/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: '--x\r\ninvalid' });
    await expect(parseUpload(request)).rejects.toThrow('Malformed');
    const broken = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.error(new Error('disconnected')); } });
    await expect(parseUpload(raw(broken), true)).rejects.toThrow('interrupted');
    expect(await tempUploads()).toEqual(before);
  });
  it('cleans parsed files even when admission database fails', async () => {
    const upload = await parseUpload(raw('audio'), true);
    vi.mocked(getCollection).mockRejectedValueOnce(new Error('database down'));
    await expect(acceptUpload('user', upload)).rejects.toThrow('database down');
    await expect(readFile(upload.tempPath)).rejects.toThrow();
  });
  it('rejects duplicate audio parts without leaving disk files', async () => {
    const before = await tempUploads();
    const body = '--x\r\nContent-Disposition: form-data; name="file"; filename="one.mp3"\r\nContent-Type: audio/mpeg\r\n\r\none\r\n--x\r\nContent-Disposition: form-data; name="file"; filename="two.mp3"\r\nContent-Type: audio/mpeg\r\n\r\ntwo\r\n--x--\r\n';
    await expect(parseUpload(new NextRequest('http://localhost/api/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body }))).rejects.toThrow('Only one');
    expect(await tempUploads()).toEqual(before);
  });
});

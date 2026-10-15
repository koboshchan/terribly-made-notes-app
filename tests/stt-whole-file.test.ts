import { describe, it, expect, vi } from 'vitest';
vi.mock('../lib/runtime-settings', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/runtime-settings')>();
  return { ...actual, getRuntimeSettings: vi.fn(async () => actual.runtimeDefaults()) };
});
vi.mock('../lib/storage', () => ({ withDecryptedFile: async (file: string, callback: (plain: string) => Promise<unknown>) => callback(file), saveFile: vi.fn(), readFile: vi.fn(), fileExists: vi.fn(), encryptFile: vi.fn() }));
vi.mock('../lib/provider-url', () => ({ allowedProviderUrl: () => true }));
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, openAsBlob: vi.fn(async (_path: string, options: { type: string }) => new Blob(['audio'], options)) };
});
import { transcribeAudio } from '../lib/processing';

const settings = { baseUrl: 'https://provider.invalid/v1', apiKey: 'test', modelName: 'stt', task: 'transcribe' as const, temperature: 0 };
describe('whole-file STT default', () => {
  it('sends the original normalized mp3 with correct name and mime, without probing or chunking', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const file = (init.body as FormData).get('file') as File;
      expect(file.name).toBe('converted.mp3');
      expect(file.type).toBe('audio/mpeg');
      return new Response('full transcription');
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(transcribeAudio('/nonexistent/converted.mp3', settings)).resolves.toBe('full transcription');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('reports whole-file provider rejection explicitly instead of silently chunking', async () => {
    const fetchMock = vi.fn(async () => new Response('too large', { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(transcribeAudio('/nonexistent/converted.mp3', { ...settings, capabilities: { chunkingEnabled: false, maxBytes: 1024 } })).rejects.toThrow('Whole-file STT failed; no automatic chunking fallback. STT API error: 413');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});

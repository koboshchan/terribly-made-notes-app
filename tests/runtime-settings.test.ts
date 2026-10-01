import { beforeEach, describe, expect, it, vi } from 'vitest';
const { findOne } = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock('../lib/db', () => ({ getCollection: vi.fn(async () => ({ findOne })) }));
import { runtimeDefaults, validateRuntime, getRuntimeSettings, shareExpiryDays, validateCapabilities, validatePipeline, normalizedPipeline } from '../lib/runtime-settings';
import { configuredShareOptions } from '../lib/share';
beforeEach(() => { vi.unstubAllEnvs(); findOne.mockReset(); });
describe('admin runtime policy', () => {
  it('defaults audio length to ten hours and rejects obsolete per-file cap', () => {
    expect(runtimeDefaults().audioMaxSeconds).toBe(36000);
    expect(() => validateRuntime({ uploadMaxBytes: 1000000 })).toThrow();
  });
  it('uses env only as fallback and Mongo overrides it', async () => {
    vi.stubEnv('PUBLIC_CHAT_DAILY_REQUESTS', '321');
    expect(runtimeDefaults().chatOwnerPerDay).toBe(321);
    findOne.mockResolvedValue({ settings: { runtime: { chatOwnerPerDay: 12 } } });
    expect((await getRuntimeSettings()).chatOwnerPerDay).toBe(12);
    vi.unstubAllEnvs();
  });
  it('rejects out-of-range, fractional and unknown runtime values', () => {
    expect(() => validateRuntime({ providerTimeoutMs: 0 })).toThrow();
    expect(() => validateRuntime({ maxProcessingNotes: 1.5 })).toThrow();
    expect(() => validateRuntime({ chatOwnerPerDay: '10' })).toThrow();
    expect(() => validateRuntime({ PROVIDER_BASE_URL_ALLOWLIST: '*' })).toThrow();
  });
  it('supports bounded expiry or never only', () => {
    expect(shareExpiryDays(undefined)).toBe(30);
    expect(shareExpiryDays(null)).toBeNull();
    expect(shareExpiryDays(365)).toBe(365);
    expect(() => shareExpiryDays('never')).toThrow();
    expect(() => shareExpiryDays(0)).toThrow();
  });
  it('ignores user expiry and applies the stored admin policy', async () => {
    findOne.mockResolvedValue({ settings: { shareExpiryDays: null } });
    expect((await configuredShareOptions({ expiresInDays: 1, allowChat: true })).shareExpiresAt).toBeNull();
    findOne.mockResolvedValue({ settings: { shareExpiryDays: 2 } });
    const now = Date.now();
    const date = (await configuredShareOptions({ expiresInDays: null })).shareExpiresAt!;
    expect(date.getTime() - now).toBeGreaterThanOrEqual(172800000);
    expect(date.getTime() - now).toBeLessThan(172801000);
  });
  it('validates STT capability fields and opt-in chunking', () => {
    expect(validateCapabilities({ chunkingEnabled: false })).toEqual({ chunkingEnabled: false });
    expect(() => validateCapabilities({ chunkingEnabled: 'true' })).toThrow();
    expect(() => validateCapabilities({ format: 'exe' })).toThrow();
    expect(() => validateCapabilities({ channels: 3 })).toThrow();
    expect(() => validateCapabilities({ chunkSeconds: 10, overlapSeconds: 6 })).toThrow();
  });
  it('returns the actual concurrency defaults to the admin UI', () => {
    const defaults = { generation: { parallel: true } };
    expect(normalizedPipeline({}, defaults).generation.concurrency).toBe(2);
    vi.stubEnv('PIPELINE_GENERATION_CONCURRENCY', '4');
    expect(normalizedPipeline({}, defaults).generation.concurrency).toBe(4);
    expect(normalizedPipeline({ generation: { parallel: true, concurrency: 3 } }, defaults).generation.concurrency).toBe(3);
  });
  it('validates stage concurrency', () => {
    expect(() => validatePipeline({ generation: { parallel: true, concurrency: 10 } })).not.toThrow();
    expect(() => validatePipeline({ generation: { parallel: true, concurrency: 11 } })).toThrow();
    expect(() => validatePipeline({ generation: { parallel: 'yes' } })).toThrow();
  });
});

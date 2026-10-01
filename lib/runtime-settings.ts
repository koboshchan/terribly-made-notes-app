import { getCollection } from './db';
import { RequestError } from './request-limits';

// Mongo is authoritative after an administrator saves settings. Environment
// variables supply defaults only; infrastructure/secrets remain env-only.
export const runtimeSpecs = {
  chatTokenPerMinute: [1, 10000, 10, 'PUBLIC_CHAT_TOKEN_PER_MINUTE'],
  chatClientPerMinute: [1, 10000, 20, 'PUBLIC_CHAT_CLIENT_PER_MINUTE'],
  chatOwnerPerDay: [1, 1000000, 100, 'PUBLIC_CHAT_DAILY_REQUESTS'],
  audioMaxSeconds: [1, 86400, 36000, 'MAX_AUDIO_SECONDS'],
  maxProcessingNotes: [1, 1000, 5, 'MAX_PROCESSING_NOTES'],
  providerTimeoutMs: [1000, 3600000, 300000, 'PROVIDER_TIMEOUT_MS'],
  mediaTimeoutSeconds: [1, 3600, 600, 'MEDIA_TIMEOUT_SECONDS'],
  summaryMaxTokens: [256, 128000, 6000, 'LLM_SUMMARY_MAX_TOKENS'],
  contextChars: [4000, 2000000, 48000, 'LLM_CONTEXT_CHARS'],
} as const;
export type RuntimeSettings = { -readonly [K in keyof typeof runtimeSpecs]: number };
function envNumber(name: string, min: number, max: number, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
export function runtimeDefaults(): RuntimeSettings {
  return Object.fromEntries(Object.entries(runtimeSpecs).map(([key, [min, max, fallback, env]]) => [key, envNumber(env, min, max, fallback)])) as RuntimeSettings;
}
export function validateRuntime(value: unknown): Partial<RuntimeSettings> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Invalid runtime settings');
  const result: Partial<RuntimeSettings> = {};
  for (const [key, number] of Object.entries(value)) {
    if (!(key in runtimeSpecs)) throw new RequestError(`Unknown runtime setting: ${key}`);
    const [min, max] = runtimeSpecs[key as keyof RuntimeSettings];
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < min || number > max) throw new RequestError(`${key} must be an integer from ${min} to ${max}`);
    result[key as keyof RuntimeSettings] = number;
  }
  return result;
}
export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const doc = await (await getCollection('global_settings')).findOne({ type: 'models' });
  return { ...runtimeDefaults(), ...validateRuntime(doc?.settings?.runtime) };
}
export function shareExpiryDays(value: unknown): number | null {
  if (value === undefined) return 30;
  if (value === null) return null;
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > 365) throw new RequestError('shareExpiryDays must be 1 to 365, or null for never');
  return value;
}
export const capabilitySpecs = {
  maxBytes: [1024, 268435456, 20971520, 'STT_MAX_BYTES'],
  chunkSeconds: [2, 3600, 300, 'STT_CHUNK_SECONDS'],
  overlapSeconds: [0, 60, 2, 'STT_OVERLAP_SECONDS'],
  sampleRate: [8000, 192000, 16000, 'STT_SAMPLE_RATE'],
  channels: [1, 2, 1, 'STT_CHANNELS'],
} as const;
export type SttCapabilities = { -readonly [K in keyof typeof capabilitySpecs]: number } & { format: 'mp3' | 'wav'; chunkingEnabled: boolean };
export function capabilityDefaults(): SttCapabilities {
  return { ...Object.fromEntries(Object.entries(capabilitySpecs).map(([key, [min, max, fallback, env]]) => [key, envNumber(env, min, max, fallback)])), format: process.env.STT_FORMAT === 'wav' ? 'wav' : 'mp3', chunkingEnabled: false } as SttCapabilities;
}
export function validateCapabilities(value: any) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Invalid STT capabilities');
  for (const [key, number] of Object.entries(value)) {
    if (key === 'chunkingEnabled') { if (typeof number !== 'boolean') throw new RequestError('STT chunkingEnabled must be boolean'); continue; }
    if (key === 'format') { if (!['mp3', 'wav'].includes(number as string)) throw new RequestError('STT format must be mp3 or wav'); continue; }
    if (!(key in capabilitySpecs)) throw new RequestError(`Unknown STT capability: ${key}`);
    const [min, max] = capabilitySpecs[key as keyof typeof capabilitySpecs];
    if (!Number.isSafeInteger(number) || (number as number) < min || (number as number) > max) throw new RequestError(`STT ${key} must be an integer from ${min} to ${max}`);
  }
  const effective = { ...capabilityDefaults(), ...value };
  if (effective.overlapSeconds >= effective.chunkSeconds / 2) throw new RequestError('STT overlap must be less than half chunk duration');
  return value;
}
export function normalizedPipeline(value: any, defaults: any) {
  return Object.fromEntries(Object.keys(defaults).map(stage => {
    const config = { ...defaults[stage], ...(value?.[stage] || {}) };
    config.concurrency = config.concurrency ?? envNumber(`PIPELINE_${stage.toUpperCase()}_CONCURRENCY`, 1, 10, 2);
    return [stage, config];
  }));
}
export function validatePipeline(value: any) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Invalid pipeline settings');
  const stages = ['audioNormalization', 'transcription', 'summarization', 'generation'];
  for (const [key, stage] of Object.entries(value)) {
    if (!stages.includes(key) || !stage || typeof stage !== 'object' || Array.isArray(stage)) throw new RequestError('Invalid pipeline stage');
    const s = stage as any;
    if (typeof s.parallel !== 'boolean' || (s.concurrency !== undefined && (!Number.isInteger(s.concurrency) || s.concurrency < 1 || s.concurrency > 10))) throw new RequestError('Pipeline parallel must be boolean and concurrency 1 to 10');
    if (Object.keys(s).some(k => !['parallel', 'concurrency'].includes(k))) throw new RequestError('Unknown pipeline setting');
  }
}

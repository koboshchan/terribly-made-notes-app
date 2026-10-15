import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateModelSettings } from '../lib/model-settings';
import { normalizedPipeline } from '../lib/runtime-settings';

function settings() {
  const sttModel = { modelName: 'whisper', task: 'transcribe', temperature: 0 };
  const provider = { baseUrl: 'https://api.openai.com/v1', apiKey: 'test-only' };
  return {
    stt: { ...provider, english: { ...sttModel }, other: { ...sttModel } },
    llm: { ...provider, summarizationModel: 'summary', quizModel: 'quiz', chatModel: 'chat' },
    tts: { ...provider, modelName: 'tts', voice: 'voice', responseFormat: 'mp3', speed: 1, sampleRate: 24000 },
  };
}
afterEach(() => vi.unstubAllEnvs());
describe('saved provider settings', () => {
  it('accepts complete approved settings', () => expect(() => validateModelSettings(settings())).not.toThrow());
  it('supports legacy STT model settings', () => {
    const value: any = settings();
    value.stt = { baseUrl: value.stt.baseUrl, apiKey: value.stt.apiKey, ...value.stt.english };
    expect(() => validateModelSettings(value)).not.toThrow();
  });
  it('requires both language profiles', () => {
    const value: any = settings();
    delete value.stt.other;
    expect(() => validateModelSettings(value)).toThrow('Invalid STT model settings');
  });
  it('rejects an unapproved endpoint before it can break all jobs', () => {
    const value = settings(); value.llm.baseUrl = 'http://127.0.0.1/v1';
    expect(() => validateModelSettings(value)).toThrow('PROVIDER_BASE_URL_ALLOWLIST');
  });
  it('accepts an operator allowlisted custom provider', () => {
    vi.stubEnv('PROVIDER_BASE_URL_ALLOWLIST', 'https://qa.example/v1');
    const value = settings();
    value.stt.baseUrl = value.llm.baseUrl = value.tts.baseUrl = 'https://qa.example/v1/';
    expect(() => validateModelSettings(value)).not.toThrow();
  });
  it.each(['summarizationModel', 'quizModel', 'chatModel'])('rejects an empty %s', field => {
    const value: any = settings(); value.llm[field] = '';
    expect(() => validateModelSettings(value)).toThrow();
  });
  it.each([NaN, -1, 1.1, '0'])('rejects invalid STT temperature %s', temperature => {
    const value: any = settings(); value.stt.english.temperature = temperature;
    expect(() => validateModelSettings(value)).toThrow();
  });
  it.each([0, Infinity, '1', 5])('rejects invalid TTS speed %s', speed => {
    const value: any = settings(); value.tts.speed = speed;
    expect(() => validateModelSettings(value)).toThrow();
  });
  it('preserves sequential defaults when normalizing missing stage settings', () => {
    const defaults = { transcription: { parallel: false }, generation: { parallel: true } };
    expect(normalizedPipeline({}, defaults).transcription.concurrency).toBe(1);
    expect(normalizedPipeline({}, defaults).generation.concurrency).toBe(2);
    expect(normalizedPipeline({ transcription: { parallel: true } }, defaults).transcription.concurrency).toBe(2);
  });
});

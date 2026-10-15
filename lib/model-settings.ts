import { allowedProviderUrl } from './provider-url';
import { RequestError } from './request-limits';

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(`Invalid ${name} settings`);
  return value as Record<string, any>;
}

function text(value: unknown, name: string, max = 256): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new RequestError(`Invalid ${name}`);
}

function provider(value: unknown, name: string): Record<string, any> {
  const settings = record(value, name);
  if (!allowedProviderUrl(settings.baseUrl)) throw new RequestError(`${name} provider must be configured in PROVIDER_BASE_URL_ALLOWLIST`);
  text(settings.apiKey, `${name} API key`, 4096);
  return settings;
}

// Reject unusable provider settings before replacing a working configuration.
// Both the legacy single-model STT shape and language-specific shape remain supported.
export function validateModelSettings(value: unknown): void {
  const settings = record(value, 'model');
  const stt = provider(settings.stt, 'STT');
  const validateStt = (value: unknown) => {
    const model = record(value, 'STT model');
    text(model.modelName, 'STT model name');
    if (!['transcribe', 'translate'].includes(model.task)) throw new RequestError('Invalid STT task');
    if (typeof model.temperature !== 'number' || !Number.isFinite(model.temperature) || model.temperature < 0 || model.temperature > 1) throw new RequestError('STT temperature must be from 0 to 1');
  };
  if (stt.english !== undefined || stt.other !== undefined) {
    validateStt(stt.english);
    validateStt(stt.other);
  } else validateStt(stt);
  const llm = provider(settings.llm, 'LLM');
  for (const field of ['summarizationModel', 'quizModel', 'chatModel']) text(llm[field], `LLM ${field}`);
  const tts = provider(settings.tts, 'TTS');
  text(tts.modelName, 'TTS model name');
  text(tts.voice, 'TTS voice');
  if (!['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'].includes(tts.responseFormat)) throw new RequestError('Invalid TTS response format');
  if (typeof tts.speed !== 'number' || !Number.isFinite(tts.speed) || tts.speed < 0.25 || tts.speed > 4) throw new RequestError('TTS speed must be from 0.25 to 4');
  if (!Number.isSafeInteger(tts.sampleRate) || tts.sampleRate < 8000 || tts.sampleRate > 192000) throw new RequestError('Invalid TTS sample rate');
}

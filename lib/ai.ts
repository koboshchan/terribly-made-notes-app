import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LanguageModel } from 'ai';

export interface LLMSettings {
  baseUrl: string;
  apiKey: string;
  chatModel?: string;
  summarizationModel?: string;
  quizModel?: string;
}

export interface STTSettings {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  task: 'transcribe' | 'translate';
  temperature: number;
}

export interface TTSSettings {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  voice: string;
}

/**
 * Get a language model instance from AI SDK using OpenAI-compatible API
 */
export function getLanguageModel(settings: LLMSettings, modelName: string): LanguageModel {
  const client = createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: settings.baseUrl.replace(/\/+$/, ''),
    apiKey: settings.apiKey,
  });

  return client(modelName);
}

/**
 * Get chat model for chat completions
 */
export function getChatModel(settings: LLMSettings): LanguageModel {
  return getLanguageModel(settings, settings.chatModel!);
}

/**
 * Get summarization model
 */
export function getSummarizationModel(settings: LLMSettings): LanguageModel {
  return getLanguageModel(settings, settings.summarizationModel!);
}

/**
 * Get quiz model
 */
export function getQuizModel(settings: LLMSettings): LanguageModel {
  return getLanguageModel(settings, settings.quizModel!);
}

/**
 * Transcribe audio using OpenAI-compatible STT API
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  settings: STTSettings
): Promise<string> {
  const formData = new FormData();
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mp3' });
  formData.append('file', audioBlob, 'audio.mp3');
  formData.append('model', settings.modelName);
  formData.append('task', settings.task);
  formData.append('temperature', settings.temperature.toString());
  formData.append('response_format', 'text');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10 * 60 * 1000); // 10 minutes

  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`STT API error: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Speech-to-text request timed out after 10 minutes. Please try with a shorter audio file.');
    }
    throw error;
  }
}

/**
 * Generate speech using OpenAI-compatible TTS API
 */
export async function generateSpeech(
  text: string,
  settings: TTSSettings
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 2 * 60 * 1000); // 2 minutes

  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.modelName,
        input: text,
        voice: settings.voice,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
    }

    return await response.arrayBuffer();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Text-to-speech request timed out after 2 minutes.');
    }
    throw error;
  }
}

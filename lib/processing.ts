import { allowedProviderUrl } from './provider-url';
import { getRuntimeSettings, runtimeDefaults, capabilityDefaults, type RuntimeSettings } from './runtime-settings';
import { openAsBlob } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { saveFile, deleteFile, readFile, fileExists } from './storage';
// Deadlines include reading the provider response body, not only headers.
async function providerFetch(url: string, init: RequestInit, runtime: RuntimeSettings): Promise<Response> {
  const destination = url.replace(/\/(chat\/completions|audio\/transcriptions)$/, '');
  if (!allowedProviderUrl(destination)) throw new Error('Provider endpoint is not approved in deployment configuration');
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runtime.providerTimeoutMs);
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
      const body = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    } finally { clearTimeout(timer); }
  }
}

const execAsync = promisify(execFile);

// Select bounded relevant source sections, preserving labels for citations.
export function retrieveRelevantContext(sources: { id: string; content: string }[], query: string, maxChars = runtimeDefaults().contextChars): string {
  const terms = new Set(query.toLowerCase().match(/\w{3,}/g) || []);
  const sections = sources.flatMap(source => source.content.split(/\n(?=#{1,6} )|\n\n/).flatMap(section => {
    const pieces = section.match(/[\s\S]{1,4000}/g) || [];
    return pieces.map(content => ({ content: `[Source ${source.id}]\n${content}`, score: [...terms].filter(term => content.toLowerCase().includes(term)).length }));
  }));
  sections.sort((a, b) => b.score - a.score);
  let result = '';
  for (const section of sections) {
    if (result.length + section.content.length + 2 > maxChars) continue;
    result += section.content + '\n\n';
  }
  return result;
}

function boundedInput(content: string, runtime: RuntimeSettings): string {
  const max = runtime.contextChars;
  if (content.length > max) throw new Error(`Input exceeds configured LLM context budget (${max} characters); split recording or increase budget`);
  return content;
}

export interface ProcessingProgress {
  queueProgress: number;
  processProgress: number;
  status: string;
}

export interface AudioMetadata {
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  format?: string;
  recordedAt?: Date;
  title?: string;
  artist?: string;
  album?: string;
}

export async function extractAudioMetadata(filePath: string, runtime?: RuntimeSettings): Promise<AudioMetadata> {
  runtime ??= await getRuntimeSettings();
  try {
    const { stdout } = await execAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath], { timeout: runtime.mediaTimeoutSeconds * 1000, maxBuffer: 4 * 1024 * 1024 });
    const probeData = JSON.parse(stdout);

    const metadata: AudioMetadata = {};

    // Extract format information
    if (probeData.format) {
      const format = probeData.format;
      metadata.duration = format.duration ? parseFloat(format.duration) : undefined;
      metadata.bitrate = format.bit_rate ? parseInt(format.bit_rate) : undefined;
      metadata.format = format.format_name;

      // Extract recording date from tags
      if (format.tags) {
        const tags = format.tags;

        // Try different possible date fields
        const dateFields = ['date', 'creation_time', 'DATE', 'CREATION_TIME', 'recorded_date', 'RECORDED_DATE'];
        for (const field of dateFields) {
          if (tags[field]) {
            const dateStr = tags[field];
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
              metadata.recordedAt = parsedDate;
              break;
            }
          }
        }

        // Extract other metadata
        metadata.title = tags.title || tags.TITLE;
        metadata.artist = tags.artist || tags.ARTIST;
        metadata.album = tags.album || tags.ALBUM;
      }
    }

    // Extract stream information (audio properties)
    if (probeData.streams && probeData.streams.length > 0) {
      const audioStream = probeData.streams.find((stream: any) => stream.codec_type === 'audio') || probeData.streams[0];
      if (audioStream) {
        metadata.sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate) : undefined;
        metadata.channels = audioStream.channels ? parseInt(audioStream.channels) : undefined;
        if (!metadata.bitrate && audioStream.bit_rate) {
          metadata.bitrate = parseInt(audioStream.bit_rate);
        }
      }
    }

    // If no recorded date found in metadata, try file stats as fallback
    if (!metadata.recordedAt) {
      try {
        const fs = await import('fs');
        const stats = fs.statSync(filePath);
        // Use the earlier of creation time or modification time
        const fileDate = stats.birthtime < stats.mtime ? stats.birthtime : stats.mtime;
        metadata.recordedAt = fileDate;
      } catch (error) {
        console.warn('Could not get file stats for date fallback:', error);
      }
    }

    return metadata;
  } catch (error) {
    console.error('Failed to extract audio metadata:', error);
    // Return basic metadata object even if extraction fails
    return {};
  }
}

export async function convertAudioToMp3(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const runtime = await getRuntimeSettings();
  onProgress?.(0);
  await execAsync('ffmpeg', ['-y', '-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2', '-ar', '44100', outputPath], { timeout: runtime.mediaTimeoutSeconds * 1000, maxBuffer: 4 * 1024 * 1024 });
  onProgress?.(100);
}

type SttSettings = Parameters<typeof transcribeSingleAudio>[1] & {
  capabilities?: { chunkingEnabled?: boolean; maxBytes?: number; chunkSeconds?: number; overlapSeconds?: number; format?: 'mp3' | 'wav'; sampleRate?: number; channels?: number };
};

export async function transcribeAudio(audioPath: string, settings: SttSettings, assertActive: () => Promise<void> = async () => {}): Promise<string> {
  const runtime = await getRuntimeSettings();
  const configured = settings.capabilities || {};
  if (configured.chunkingEnabled !== true) {
    await assertActive();
    try {
      const text = await transcribeSingleAudio(audioPath, settings, runtime);
      await assertActive();
      return text;
    } catch (error) {
      throw new Error(`Whole-file STT failed; no automatic chunking fallback. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const profile = { ...capabilityDefaults(), ...configured };
  const maxBytes = profile.maxBytes ?? Number((capabilityDefaults() as Record<string, unknown>).maxBytes);
  const format = profile.format;
  const duration = (await extractAudioMetadata(audioPath, runtime)).duration;
  if (!duration || !Number.isFinite(duration)) throw new Error('Cannot determine audio duration');
  const seconds = Math.min(profile.chunkSeconds || 300, Math.floor(maxBytes / (format === 'wav' ? (profile.sampleRate || 16000) * (profile.channels || 1) * 2 : 16000)) - 1);
  const overlap = Math.min(profile.overlapSeconds ?? 2, seconds / 4);
  if (seconds <= 1) throw new Error('Invalid STT byte capability');
  const parts: string[] = [];
  for (let start = 0, index = 0; start < duration; start += seconds - overlap, index++) {
    await assertActive();
    const chunk = `${audioPath}.chunk-${index}.${format}`;
    const checkpoint = `${chunk}.txt`;
    if (fileExists(checkpoint)) { parts.push(readFile(checkpoint).toString('utf8')); continue; }
    try {
      await execAsync('ffmpeg', ['-y', '-ss', String(start), '-i', audioPath, '-t', String(seconds), '-vn', '-ac', String(profile.channels || 1), '-ar', String(profile.sampleRate || 16000), ...(format === 'mp3' ? ['-b:a', '128k'] : ['-c:a', 'pcm_s16le']), chunk], { timeout: runtime.mediaTimeoutSeconds * 1000, maxBuffer: 4 * 1024 * 1024 });
      const fs = await import('fs');
      if (fs.statSync(chunk).size > maxBytes) throw new Error('STT chunk exceeds configured provider size limit');
      const text = await transcribeSingleAudio(chunk, settings, runtime);
      await assertActive();
      saveFile(checkpoint, text);
      parts.push(text);
    } finally { deleteFile(chunk); }
  }
  // Remove exact word overlap without inventing or summarizing speech.
  let result = '';
  for (const part of parts) {
    const prior = result.trim().split(/\s+/);
    const next = part.trim().split(/\s+/);
    let overlapWords = 0;
    for (let size = 1; size <= Math.min(80, prior.length, next.length); size++) {
      if (prior.slice(-size).join(' ') === next.slice(0, size).join(' ')) overlapWords = size;
    }
    result += (result ? ' ' : '') + next.slice(overlapWords).join(' ');
  }
  return result;
}

async function transcribeSingleAudio(
  audioPath: string,
  settings: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    task: 'transcribe' | 'translate';
    temperature: number;
  },
  runtime: RuntimeSettings
): Promise<string> {
  try {
    const formData = new FormData();
    // Native disk-backed Blob keeps whole-file STT memory bounded too.
    const audioBlob = await openAsBlob(audioPath, { type: audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' });
    formData.append('file', audioBlob, path.basename(audioPath));
    formData.append('model', settings.modelName);
    formData.append('task', settings.task);
    formData.append('temperature', settings.temperature.toString());
    formData.append('response_format', 'text');

    try {
      const response = await providerFetch(`${settings.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: formData,
      }, runtime);

      if (!response.ok) {
        throw new Error(`STT API error: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      throw error;
    }
  } catch (error) {
    console.error('Transcription failed:', error);
    throw error;
  }
}

export async function summarizeText(
  text: string,
  settings: {
    baseUrl: string;
    apiKey: string;
    summarizationModel: string;
    quizModel: string;
  },
  userClasses: string[] = [],
  modelType: 'summarization' | 'quiz' = 'summarization'
): Promise<{
  title: string;
  description: string;
  content: string;
  noteClass?: string;
}> {
  const runtime = await getRuntimeSettings();
  try {
    let classificationInstruction = '';
    let classificationField = '';

    if (userClasses.length > 0) {
      classificationInstruction = `\n\nCLASSIFICATION REQUIREMENT:
- You must classify this content into one of these predefined categories: ${userClasses.join(', ')}
- Choose the most appropriate category based on the content
- If none fit perfectly, choose the closest match`;

      classificationField = ',\n  "noteClass": "The most appropriate category from the provided list"';
    }

    const prompt = `Analyze the following transcribed audio and create a structured summary.

CRITICAL INSTRUCTIONS:
- Return ONLY a valid JSON object
- Do NOT include any markdown code blocks, explanations, or other text
- Do NOT wrap the JSON in \`\`\`json code blocks
- Your entire response must be parseable JSON${classificationInstruction}

Required JSON structure:
{
  "title": "A concise, descriptive title for the content",
  "description": "A one-line summary description",
  "content": "A detailed markdown-formatted summary of the main points, organized with headers, bullet points, and proper formatting"${classificationField}
}

Transcribed text:
${boundedInput(text, runtime)}

Remember: Return ONLY the JSON object, nothing else.`;

    const response = await providerFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: modelType === 'quiz' ? settings.quizModel : settings.summarizationModel,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: runtime.summaryMaxTokens,
      }),
    }, runtime);


    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content received from LLM API');
    }

    try {
      // Try to extract JSON from content if it's wrapped in code blocks
      let jsonContent = content.trim();

      // Remove markdown code block wrapper if present
      if (jsonContent.startsWith('```json\n')) {
        jsonContent = jsonContent.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (jsonContent.startsWith('```\n')) {
        jsonContent = jsonContent.replace(/^```\n/, '').replace(/\n```$/, '');
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
      }

      const result = JSON.parse(jsonContent);

      // Validate the response structure
      if (![result.title, result.description, result.content].every(v => typeof v === 'string' && v.trim())) {
        throw new Error('Invalid response structure from LLM');
      }

      return result;
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      throw new Error('Failed to parse LLM response as JSON');
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI summarization exceeded the configured provider timeout. Please try again or use a shorter audio file.');
    }
    console.error('Summarization failed:', error);
    throw error;
  }
}

export async function saveMarkdownNote(filePath: string, content: string): Promise<void> {
  saveFile(filePath, content);
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizQuestion {
  question: string;
  wrongAnswers: string[];
  correctAnswer: string;
  explanation: string;
}

interface ParsedQuizQuestion {
  question?: string;
  wrongAnswers?: string[];
  correctAnswer?: string;
  explanation?: string;
  hint?: string;
}

export async function generateFlashcards(
  content: string,
  settings: {
    baseUrl: string;
    apiKey: string;
    quizModel: string;
  }
): Promise<Flashcard[]> {
  const runtime = await getRuntimeSettings();
  const prompt = `Based on the following note content, generate enough flashcards to cover all information in this note.

Return ONLY a valid JSON array (no markdown code blocks, no explanations):
[
  {"front": "Question or term", "back": "Answer or definition"}
]

Note content:
${boundedInput(content.toString(), runtime)}

Generate flashcards that test understanding of key concepts, definitions, and important facts.`;

  try {
    const response = await providerFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.quizModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: runtime.summaryMaxTokens,
      }),
    }, runtime);

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    let responseContent = data.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error('No content received');
    }

    responseContent = responseContent.replace(/```(?:json)?\n?|\n?```$/g, '').trim();

    const flashcards = JSON.parse(responseContent);
    if (!Array.isArray(flashcards) || !flashcards.length || flashcards.length > 100 || !flashcards.every(c => c && typeof c.front === 'string' && c.front.trim() && typeof c.back === 'string' && c.back.trim())) throw new Error('Invalid flashcard schema');
    return flashcards;
  } catch (error) {
    console.error('Failed to generate flashcards:', error);
    throw error;
  }
}

export async function generateQuiz(
  content: string,
  settings: {
    baseUrl: string;
    apiKey: string;
    quizModel: string;
  }
): Promise<QuizQuestion[]> {
  const runtime = await getRuntimeSettings();
  const prompt = `Based on the following note content, generate 5 to 10 quiz questions.

Return ONLY a valid JSON object with a 'questions' array (no markdown code blocks, no explanations):
{
  "questions": [
    {
      "question": "Question text",
      "wrongAnswers": ["Wrong answer 1", "Wrong answer 2", "Wrong answer 3"],
      "correctAnswer": "Correct answer",
      "explanation": "Brief explanation of why this is correct",
      "hint": "If the user is stuck, they can review this and get a hint."
    }
  ]
}

Note content:
${boundedInput(content.toString(), runtime)}

Generate questions that test understanding. Ensure wrong answers are plausible but incorrect.`;

  try {
    const response = await providerFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.quizModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: runtime.summaryMaxTokens,
        response_format: { type: 'json_object' },
      }),
    }, runtime);

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    let responseContent = data.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error('No content received');
    }

    // Try to extract JSON
    responseContent = responseContent.replace(/```(?:json)?\n?|\n?```$/g, '').trim();

    const parsed = JSON.parse(responseContent);
    const questions = parsed.questions;
    if (!Array.isArray(questions) || !questions.length || questions.length > 100 || !questions.every(q => q && typeof q.question === 'string' && q.question.trim() && typeof q.correctAnswer === 'string' && q.correctAnswer.trim() && typeof q.explanation === 'string' && Array.isArray(q.wrongAnswers) && q.wrongAnswers.length === 3 && q.wrongAnswers.every((a: unknown) => typeof a === 'string' && a.trim()))) throw new Error('Invalid quiz schema');
    
    return questions.map((q: ParsedQuizQuestion) => ({
      question: q.question || '',
      wrongAnswers: Array.isArray(q.wrongAnswers) ? q.wrongAnswers : [],
      correctAnswer: q.correctAnswer || '',
      explanation: q.explanation || '',
      hint: q.hint || ''
    }));
  } catch (error) {
    console.error('Failed to generate quiz:', error);
    throw error;
  }
}

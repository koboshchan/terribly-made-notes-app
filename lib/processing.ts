import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { saveFile, deleteFile, readFile, fileExists } from './storage';
import { generateObject, generateText } from 'ai';
import { getSummarizationModel, getQuizModel, transcribeAudio as aiTranscribeAudio, type LLMSettings, type STTSettings } from './ai';
import { z } from 'zod';

const execAsync = promisify(exec);

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

export async function extractAudioMetadata(filePath: string): Promise<AudioMetadata> {
  try {
    const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
    const { stdout } = await execAsync(command);
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
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .audioChannels(2)
      .audioFrequency(44100)
      .on('progress', (progress) => {
        if (onProgress) {
          onProgress(progress.percent || 0);
        }
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      })
      .save(outputPath);
  });
}

export async function transcribeAudio(
  audioPath: string,
  settings: STTSettings
): Promise<string> {
  try {
    const audioBuffer = readFile(audioPath);
    return await aiTranscribeAudio(audioBuffer, settings);
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
  try {
    let classificationInstruction = '';

    if (userClasses.length > 0) {
      classificationInstruction = `\n\nCLASSIFICATION REQUIREMENT:
- You must classify this content into one of these predefined categories: ${userClasses.join(', ')}
- Choose the most appropriate category based on the content
- If none fit perfectly, choose the closest match`;
    }

    const prompt = `Analyze the following transcribed audio and create a structured summary.${classificationInstruction}

Transcribed text:
${text}`;

    const schema = z.object({
      title: z.string().describe('A concise, descriptive title for the content'),
      description: z.string().describe('A one-line summary description'),
      content: z.string().describe('A detailed markdown-formatted summary of the main points, organized with headers, bullet points, and proper formatting'),
      noteClass: z.string().optional().describe('The most appropriate category from the provided list if classification was requested'),
    });

    const model = modelType === 'quiz' ? getQuizModel(settings) : getSummarizationModel(settings);

    const result = await generateObject({
      model,
      schema,
      prompt,
      temperature: 0.7,
      maxTokens: 50000,
    });

    // Validate the response structure
    if (!result.object.title || !result.object.description || !result.object.content) {
      throw new Error('Invalid response structure from LLM');
    }

    return result.object;
  } catch (error) {
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

export async function generateFlashcards(
  content: string,
  settings: {
    baseUrl: string;
    apiKey: string;
    quizModel: string;
  }
): Promise<Flashcard[]> {
  const prompt = `Based on the following note content, generate flashcards that cover all information in this note.

Note content:
${content.toString()}

Generate flashcards that test understanding of key concepts, definitions, and important facts.`;

  try {
    const schema = z.object({
      flashcards: z.array(z.object({
        front: z.string().describe('Question or term'),
        back: z.string().describe('Answer or definition'),
      })),
    });

    const model = getQuizModel(settings);

    const result = await generateObject({
      model,
      schema,
      prompt,
      temperature: 0.3,
      maxTokens: 4000,
    });

    return result.object.flashcards;
  } catch (error) {
    console.error('Failed to generate flashcards:', error);
    return [];
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
  const prompt = `Based on the following note content, generate 5 to 10 quiz questions.

Note content:
${content.toString()}

Generate questions that test understanding. Ensure wrong answers are plausible but incorrect.`;

  try {
    const schema = z.object({
      questions: z.array(z.object({
        question: z.string().describe('Question text'),
        wrongAnswers: z.array(z.string()).describe('Array of 3 plausible wrong answers'),
        correctAnswer: z.string().describe('The correct answer'),
        explanation: z.string().describe('Brief explanation of why this is correct'),
        hint: z.string().optional().describe('If the user is stuck, they can review this and get a hint'),
      })),
    });

    const model = getQuizModel(settings);

    const result = await generateObject({
      model,
      schema,
      prompt,
      temperature: 0.3,
      maxTokens: 4000,
    });

    return result.object.questions.map((q: any) => ({
      question: q.question,
      wrongAnswers: q.wrongAnswers,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      hint: q.hint || '',
    }));
  } catch (error) {
    console.error('Failed to generate quiz:', error);
    return [];
  }
}

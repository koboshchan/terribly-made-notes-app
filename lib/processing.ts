import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { saveFile, deleteFile, readFile, fileExists } from './storage';

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
  settings: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    task: 'transcribe' | 'translate';
    temperature: number;
  }
): Promise<string> {
  try {
    const audioBuffer = readFile(audioPath);

    const formData = new FormData();
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mp3' });
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('model', settings.modelName);
    formData.append('task', settings.task);
    formData.append('temperature', settings.temperature.toString());
    formData.append('response_format', 'text');

    // Set 10-minute timeout for STT
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
${text}

Remember: Return ONLY the JSON object, nothing else.`;

    // Set 5-minute timeout for LLM
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 5 * 60 * 1000); // 5 minutes

    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
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
        max_tokens: 50000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
      if (!result.title || !result.description || !result.content) {
        throw new Error('Invalid response structure from LLM');
      }

      return result;
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      throw new Error('Failed to parse LLM response as JSON');
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI summarization request timed out after 5 minutes. Please try again or use a shorter audio file.');
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

export async function generateFlashcards(
  content: string,
  settings: {
    baseUrl: string;
    apiKey: string;
    quizModel: string;
  }
): Promise<Flashcard[]> {
  const prompt = `Based on the following note content, generate flashcards thats enough to cover all information in this note.

Return ONLY a valid JSON array (no markdown code blocks, no explanations):
[
  {"front": "Question or term", "back": "Answer or definition"}
]

Note content:
${content.toString()}

Generate flashcards that test understanding of key concepts, definitions, and important facts.`;

  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.quizModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    let responseContent = data.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error('No content received');
    }

    // Try to extract JSON array
    const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      responseContent = jsonMatch[0];
    }

    responseContent = responseContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/```$/g, '').trim();

    const flashcards = JSON.parse(responseContent);
    return Array.isArray(flashcards) ? flashcards : [];
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
${content.toString()}

Generate questions that test understanding. Ensure wrong answers are plausible but incorrect.`;

  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.quizModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    let responseContent = data.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error('No content received');
    }

    // Try to extract JSON
    responseContent = responseContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/```$/g, '').trim();

    const parsed = JSON.parse(responseContent);
    const questions = parsed.questions || parsed.questions || [];
    
    return questions.map((q: any) => ({
      question: q.question || '',
      wrongAnswers: q.wrongAnswers || [],
      correctAnswer: q.correctAnswer || '',
      explanation: q.explanation || '',
      hint: q.hint || ''
    }));
  } catch (error) {
    console.error('Failed to generate quiz:', error);
    return [];
  }
}

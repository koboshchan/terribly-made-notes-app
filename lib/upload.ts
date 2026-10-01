import { execFile } from 'child_process';
import { promisify } from 'util';
import { ObjectId } from 'mongodb';
import path from 'path';
import { NextRequest } from 'next/server';
import { getCollection } from './db';
import { getNoteDir, saveFile, deleteDir } from './storage';
import { processingQueue } from './queue';
import { boundedBody, RequestError } from './request-limits';
import { reserveUsage } from './usage';

const probe = promisify(execFile);
const extensions = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm', '.mp4']);
export const MAX_UPLOAD_BYTES = Math.min(256 * 1024 * 1024, Math.max(1024, Number(process.env.MAX_UPLOAD_BYTES) || 64 * 1024 * 1024));

export async function parseUpload(request: NextRequest, shortcut = false) {
  const bytes = await boundedBody(request, MAX_UPLOAD_BYTES + 65536);
  const contentType = request.headers.get('content-type') || '';
  let data: Buffer;
  let filename: string;
  let language: unknown = request.headers.get('language')?.toLowerCase() || 'english';
  let className: string | undefined;
  let processingPreferences: { flashcards: boolean; quiz: boolean } | undefined;
  if (contentType.startsWith('multipart/form-data')) {
    const form = await new Request('http://upload.invalid', { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) }).formData();
    const entry = form.get(shortcut ? 'recording' : 'file');
    if (!entry || typeof entry === 'string') throw new RequestError('Audio file required');
    filename = path.basename(entry.name).slice(0, 255);
    data = Buffer.from(await entry.arrayBuffer());
    language = form.get('language') || language;
    const manualClass = form.get('className');
    if (manualClass !== null) {
      if (typeof manualClass !== 'string' || manualClass.length > 100 || !manualClass.trim()) throw new RequestError('Invalid className');
      className = manualClass.trim();
    }
    if (form.has('generateFlashcards') || form.has('generateQuiz')) {
      for (const field of ['generateFlashcards', 'generateQuiz']) {
        const value = form.get(field);
        if (value !== null && value !== 'true' && value !== 'false') throw new RequestError('Study preference must be true or false');
      }
      processingPreferences = { flashcards: form.get('generateFlashcards') !== 'false', quiz: form.get('generateQuiz') !== 'false' };
    }
  } else if (shortcut) {
    const mimeExtensions: Record<string, string> = { 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/ogg': '.ogg', 'audio/webm': '.webm' };
    const ext = mimeExtensions[contentType.split(';')[0].trim().toLowerCase()];
    if (!ext) throw new RequestError('Unsupported audio Content-Type');
    filename = `recording${ext}`;
    data = Buffer.from(bytes);
  } else throw new RequestError('Multipart audio file required');
  if (!extensions.has(path.extname(filename).toLowerCase())) throw new RequestError('Unsupported audio extension');
  if (!data.length || data.length > MAX_UPLOAD_BYTES) throw new RequestError('Audio file empty or too large', 413);
  if (language !== 'english' && language !== 'other') throw new RequestError('Invalid language');
  return { data, filename, language: language as 'english' | 'other', className, processingPreferences };
}

export async function acceptUpload(userId: string, upload: Awaited<ReturnType<typeof parseUpload>>, source?: string, idempotencyKey?: string | null) {
  const notes = await getCollection('notes');
  if (idempotencyKey && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new RequestError('Invalid idempotency key');
  if (idempotencyKey) {
    await notes.createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
    const existing = await notes.findOne({ userId, idempotencyKey });
    if (existing) return { noteId: existing._id.toString(), filename: upload.filename };
  }
  await reserveUsage(`upload-count:${userId}`, 100, 86400000);
  await reserveUsage(`upload-bytes:${userId}`, Number(process.env.MAX_DAILY_UPLOAD_BYTES) || 2 * 1024 ** 3, 86400000, upload.data.length);
  if (await notes.countDocuments({ userId, status: 'processing' }) >= 5) throw new RequestError('Too many processing notes', 429);
  const storage = await notes.aggregate([{ $match: { userId } }, { $group: { _id: null, bytes: { $sum: '$fileSize' } } }]).next();
  if ((storage?.bytes || 0) + upload.data.length > (Number(process.env.MAX_USER_STORAGE_BYTES) || 10 * 1024 ** 3)) throw new RequestError('Note storage limit reached', 429);
  const noteId = new ObjectId();
  const noteDir = getNoteDir(userId, noteId.toString());
  // Never interpolate a client filename into a path or subprocess.
  const originalPath = path.join(noteDir, 'original.audio');
  try {
    saveFile(originalPath, upload.data);
    const { stdout } = await probe('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', originalPath], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const info = JSON.parse(stdout);
    const stream = info.streams?.find((s: any) => s.codec_type === 'audio');
    const duration = Number(info.format?.duration);
    if (!stream || info.streams?.some((s: any) => s.codec_type !== 'audio' && s.disposition?.attached_pic !== 1) || !Number.isFinite(duration) || duration <= 0 || duration > (Number(process.env.MAX_AUDIO_SECONDS) || 4 * 3600)) throw new RequestError('Invalid audio or duration limit exceeded');
    await notes.insertOne({ _id: noteId, userId, title: `Processing: ${upload.filename}`, description: 'Processing audio file...', content: '', status: 'processing', originalFileName: upload.filename, fileSize: upload.data.length, language: upload.language, duration, bitrate: Number(info.format?.bit_rate) || undefined, sampleRate: Number(stream.sample_rate) || undefined, channels: stream.channels, format: info.format?.format_name, recordedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ...(source ? { source } : {}), ...(upload.className ? { noteClass: upload.className, classificationSource: 'manual' } : {}), ...(upload.processingPreferences ? { processingPreferences: upload.processingPreferences } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) });
    await processingQueue.enqueue({ id: `${userId}_${noteId}`, userId, noteId: noteId.toString(), originalPath, mp3Path: path.join(noteDir, 'converted.mp3'), markdownPath: path.join(noteDir, 'output.md'), language: upload.language });
    return { noteId: noteId.toString(), filename: upload.filename };
  } catch (error: any) {
    deleteDir(noteDir);
    await notes.deleteOne({ _id: noteId, userId });
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await notes.findOne({ userId, idempotencyKey });
      if (existing) return { noteId: existing._id.toString(), filename: upload.filename };
    }
    if (error instanceof RequestError) throw error;
    throw new RequestError('Audio validation or upload failed', 400);
  }
}

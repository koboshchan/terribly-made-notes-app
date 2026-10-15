import { execFile } from 'child_process';
import { mediaEnvironment } from './media-environment';
import { promisify } from 'util';
import { ObjectId } from 'mongodb';
import path from 'path';
import { NextRequest } from 'next/server';
import { getCollection } from './db';
import { getNoteDir, deleteDir, ensureUserKey, assertUserKeyActive, encryptFile } from './storage';
import busboy from 'busboy';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { processingQueue } from './queue';
import { RequestError } from './request-limits';
import { randomUUID, createHash } from 'crypto';
import { getRuntimeSettings, type RuntimeSettings } from './runtime-settings';

const probe = promisify(execFile);
const extensions = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm', '.mp4']);
export async function parseUpload(request: NextRequest, shortcut = false, _runtime?: RuntimeSettings) {
  if (!request.body) throw new RequestError('Audio file required');
  const tempDir = await mkdtemp(path.join(tmpdir(), 'notes-upload-'));
  const tempPath = path.join(tempDir, 'audio');
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const input = Readable.fromWeb(request.body as any);
  let size = 0;
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
  let filename = '';
  let language = request.headers.get('language')?.toLowerCase() || 'english';
  const fields = new Map<string, string>();
  let className: string | undefined;
  let processingPreferences: { flashcards: boolean; quiz: boolean } | undefined;
  let fileWrite: Promise<void> | undefined;
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      // Limits apply to metadata only. File bytes have no application cap.
      const parser = busboy({ headers: { 'content-type': contentType }, limits: { files: 1, fields: 10, parts: 11, fieldSize: 1024, fieldNameSize: 100 } });
      let invalid: RequestError | undefined;
      const fail = (message: string) => { invalid ??= new RequestError(message); controller.abort(); };
      parser.on('filesLimit', () => fail('Only one audio file is allowed'));
      parser.on('fieldsLimit', () => fail('Too many upload fields'));
      parser.on('partsLimit', () => fail('Too many upload parts'));
      parser.on('field', (name, value, info) => {
        if (info.valueTruncated || info.nameTruncated || fields.has(name)) { fail('Invalid or duplicate upload field'); return; }
        fields.set(name, value);
      });
      parser.on('file', (name, file, info) => {
        if (name !== (shortcut ? 'recording' : 'file') || !info.filename) { file.resume(); fail('Audio file required'); return; }
        filename = path.basename(info.filename).slice(0, 255);
        if (!extensions.has(path.extname(filename).toLowerCase())) { file.resume(); fail('Unsupported audio extension'); return; }
        fileWrite = pipeline(file, meter, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
        // Attach a rejection handler immediately; await the settled pipeline below.
        void fileWrite.catch(() => controller.abort());
      });
      try { await pipeline(input, parser, { signal: controller.signal }); }
      catch (error) { throw invalid || error; }
      if (!fileWrite) throw new RequestError('Audio file required');
      await fileWrite;
      if (invalid) throw invalid;
      language = fields.get('language') || language;
      if (fields.has('className')) {
        const value = fields.get('className')!;
        if (value.length > 100 || !value.trim()) throw new RequestError('Invalid className');
        className = value.trim();
      }
      if (fields.has('generateFlashcards') || fields.has('generateQuiz')) {
        for (const field of ['generateFlashcards', 'generateQuiz']) {
          const value = fields.get(field);
          if (value !== undefined && value !== 'true' && value !== 'false') throw new RequestError('Study preference must be true or false');
        }
        processingPreferences = { flashcards: fields.get('generateFlashcards') !== 'false', quiz: fields.get('generateQuiz') !== 'false' };
      }
    } else if (shortcut) {
      const mimeExtensions: Record<string, string> = { 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/ogg': '.ogg', 'audio/webm': '.webm' };
      const ext = mimeExtensions[contentType.split(';')[0].trim().toLowerCase()];
      if (!ext) throw new RequestError('Unsupported audio Content-Type');
      filename = `recording${ext}`;
      await pipeline(input, meter, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
    } else throw new RequestError('Multipart audio file required');
    if (!size) throw new RequestError('Audio file empty');
    if (language !== 'english' && language !== 'other') throw new RequestError('Invalid language');
    return { tempPath, tempDir, size, sha256: hash.digest('hex'), filename, language: language as 'english' | 'other', className, processingPreferences };
  } catch (error) {
    controller.abort();
    input.destroy();
    await fileWrite?.catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
    if (error instanceof RequestError) throw error;
    throw new RequestError('Malformed or interrupted audio upload');
  } finally { request.signal.removeEventListener('abort', abort); }
}

export async function acceptUpload(userId: string, upload: Awaited<ReturnType<typeof parseUpload>>, source?: string, idempotencyKey?: string | null, runtime?: RuntimeSettings) {
  try { return await acceptUploadLocked(userId, upload, source, idempotencyKey, runtime); }
  finally { await rm(upload.tempDir, { recursive: true, force: true }); }
}

let indexesEnsured: Promise<void> | null = null;
async function ensureUploadIndexes() {
  if (!indexesEnsured) {
    indexesEnsured = (async () => {
      try {
        const [locks, notes] = await Promise.all([getCollection('upload_admission'), getCollection('notes')]);
        await Promise.all([
          locks.createIndex({ key: 1 }, { unique: true }),
          notes.createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } })
        ]);
      } catch (err) {
        indexesEnsured = null;
        console.error('Failed ensuring upload indexes:', err);
      }
    })();
  }
  await indexesEnsured;
}

async function acceptUploadLocked(userId: string, upload: Awaited<ReturnType<typeof parseUpload>>, source?: string, idempotencyKey?: string | null, runtime?: RuntimeSettings) {
  await ensureUserKey(userId);
  runtime ??= await getRuntimeSettings();
  await ensureUploadIndexes();
  // Serialize concurrent-processing admission across replicas for the same user.
  const locks = await getCollection('upload_admission');
  const key = createHash('sha256').update(userId).digest('hex');
  const owner = randomUUID();
  try {
    await locks.updateOne({ key }, { $setOnInsert: { owner: null, leaseUntil: new Date(0) } }, { upsert: true });
  } catch (error: any) { if (error?.code !== 11000) throw error; }
  let claim = await locks.updateOne({ key, leaseUntil: { $lte: new Date() } }, { $set: { owner, leaseUntil: new Date(Date.now() + 90000) } });
  if (!claim.modifiedCount) {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 500));
      claim = await locks.updateOne({ key, leaseUntil: { $lte: new Date() } }, { $set: { owner, leaseUntil: new Date(Date.now() + 90000) } });
      if (claim.modifiedCount) break;
    }
  }
  if (!claim.modifiedCount) throw new RequestError('Another upload is being admitted. Retry shortly.', 409);
  const heartbeat = setInterval(() => { void locks.updateOne({ key, owner }, { $set: { leaseUntil: new Date(Date.now() + 90000) } }).catch(console.error); }, 15000);
  try { return await admitUpload(userId, upload, runtime, source, idempotencyKey); }
  finally {
    clearInterval(heartbeat);
    await locks.updateOne({ key, owner }, { $set: { owner: null, leaseUntil: new Date(0) } });
  }
}

async function admitUpload(userId: string, upload: Awaited<ReturnType<typeof parseUpload>>, runtime: RuntimeSettings, source?: string, idempotencyKey?: string | null) {
  const notes = await getCollection('notes');
  if (idempotencyKey && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new RequestError('Invalid idempotency key');
  if (idempotencyKey) {
    const existing = await notes.findOne({ userId, idempotencyKey });
    if (existing) return { noteId: existing._id.toString(), filename: upload.filename };
  }
  if (await notes.countDocuments({ userId, status: 'processing' }) >= runtime.maxProcessingNotes) throw new RequestError('Too many processing notes', 429);
  const noteId = new ObjectId();
  const noteDir = getNoteDir(userId, noteId.toString());
  // Never interpolate a client filename into a path or subprocess.
  const originalPath = path.join(noteDir, 'original.audio');
  try {
    const { stdout } = await probe('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', upload.tempPath], { env: mediaEnvironment(), timeout: runtime.mediaTimeoutSeconds * 1000, maxBuffer: 1024 * 1024 });
    const info = JSON.parse(stdout);
    const stream = info.streams?.find((s: any) => s.codec_type === 'audio');
    const duration = Number(info.format?.duration);
    if (!stream || info.streams?.some((s: any) => s.codec_type !== 'audio' && s.disposition?.attached_pic !== 1) || !Number.isFinite(duration) || duration <= 0 || duration > runtime.audioMaxSeconds) throw new RequestError('Invalid audio or duration limit exceeded');
    await encryptFile(upload.tempPath, originalPath);
    await assertUserKeyActive(userId);
    await notes.insertOne({ _id: noteId, userId, title: `Processing: ${upload.filename}`, description: 'Processing audio file...', content: '', status: 'processing', originalFileName: upload.filename, fileSize: upload.size, sha256: upload.sha256, language: upload.language, duration, bitrate: Number(info.format?.bit_rate) || undefined, sampleRate: Number(stream.sample_rate) || undefined, channels: stream.channels, format: info.format?.format_name, recordedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ...(source ? { source } : {}), ...(upload.className ? { noteClass: upload.className, classificationSource: 'manual' } : {}), ...(upload.processingPreferences ? { processingPreferences: upload.processingPreferences } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) });
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

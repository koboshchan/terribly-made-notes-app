import fs, { createReadStream, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdtemp, chmod, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getUserKey, assertUserKeyActive, reserveFileNonce } from './file-keys';
import { encryptToFile, decryptedStream, inspectEncrypted, sourceLength } from './file-crypto';
export { ensureUserKey, assertUserKeyActive } from './file-keys';
function root() { return path.resolve(process.env.DATA_DIR || './data'); }
function segment(value: string) { if (!/^[A-Za-z0-9_-]+$/.test(value) || value === '.' || value === '..') throw new Error('Invalid storage identifier'); return value; }
export function getUserDataDir(userId: string) { return path.join(root(), segment(userId)); }
export function getNoteDir(userId: string, noteId: string) { return path.join(getUserDataDir(userId), segment(noteId)); }
function identity(file: string) {
  const resolved = path.resolve(file), relative = path.relative(root(), resolved), parts = relative.split(path.sep);
  if (relative.startsWith('..') || path.isAbsolute(relative) || parts.length < 3) throw new Error('Invalid storage path');
  segment(parts[0]); segment(parts[1]);
  return { userId: parts[0], binding: parts.join('/'), resolved };
}
async function noSymlinks(file: string) {
  const resolved = path.resolve(file); let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink storage forbidden'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
}
export function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
async function writeEncrypted(file: string, source: AsyncIterable<Buffer>, length: number) {
  const id = identity(file); await noSymlinks(id.resolved);
  const key = await getUserKey(id.userId); const temporary = `${id.resolved}.${randomUUID()}.tmp`;
  try {
    ensureDir(path.dirname(id.resolved));
    await encryptToFile(source, temporary, key, id.binding, length, undefined, await reserveFileNonce(id.userId));
    await assertUserKeyActive(id.userId);
    fs.renameSync(temporary, id.resolved);
    // Recheck after rename to remove ciphertext finalized concurrently with a tombstone.
    try { await assertUserKeyActive(id.userId); } catch (error) { deleteFile(id.resolved); throw error; }
  } finally { key.fill(0); deleteFile(temporary); }
}
export async function encryptFile(sourcePlain: string, destination: string) {
  await writeEncrypted(destination, createReadStream(sourcePlain), await sourceLength(sourcePlain));
}
export async function saveFile(file: string, value: Buffer | string) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  await writeEncrypted(file, Readable.from([data]), data.length);
}
export async function openFileStream(file: string, start?: number, end?: number) {
  const id = identity(file); await noSymlinks(id.resolved); const key = await getUserKey(id.userId);
  try {
    const info = await inspectEncrypted(id.resolved, key, id.binding);
    const stream = decryptedStream(id.resolved, key, id.binding, start, end, () => assertUserKeyActive(id.userId));
    stream.once('close', () => key.fill(0)); stream.once('end', () => key.fill(0)); stream.once('error', () => key.fill(0));
    return { stream, length: info.length };
  } catch (error) { key.fill(0); throw error; }
}
export async function readFile(file: string): Promise<Buffer> {
  const { stream } = await openFileStream(file); const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
}
export async function withDecryptedFile<T>(file: string, callback: (plain: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'notes-decrypt-')); await chmod(dir, 0o700);
  const plain = path.join(dir, path.basename(file));
  try { const { stream } = await openFileStream(file); await pipeline(stream, createWriteStream(plain, { flags: 'wx', mode: 0o600 })); return await callback(plain); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
export function deleteFile(file: string) { if (fs.existsSync(file)) fs.unlinkSync(file); }
export function deleteDir(dir: string) { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); }
export function fileExists(file: string) { return fs.existsSync(file); }
export function getFileExtension(filename: string) { return path.extname(filename).toLowerCase(); }

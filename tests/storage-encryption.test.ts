import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile as readDisk, writeFile, rm, symlink, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  nonces: new Set<string>(),
  findOne: vi.fn(), updateOne: vi.fn(), insertOne: vi.fn(), getCollection: vi.fn(),
}));
vi.mock('../lib/db', () => ({ getCollection: db.getCollection }));
import { ensureUserKey, getUserKey, destroyUserKey, reserveFileNonce } from '../lib/file-keys';
import { saveFile, readFile, openFileStream, encryptFile, getNoteDir, withDecryptedFile } from '../lib/storage';

let directory: string;
let file: string;
async function consume(stream: Readable) {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
}
beforeEach(async () => {
  vi.clearAllMocks(); db.rows.clear(); db.nonces.clear();
  directory = await mkdtemp(path.join(tmpdir(), 'notes-storage-test-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('FILE_ENCRYPTION_MASTER_KEY', randomBytes(32).toString('base64'));
  db.findOne.mockImplementation(async (query: { _id: string }) => db.rows.get(query._id) ?? null);
  db.updateOne.mockImplementation(async (query: { _id: string }, change: { $setOnInsert?: Record<string, unknown>; $set?: Record<string, unknown>; $unset?: Record<string, unknown> }) => {
    const row = db.rows.get(query._id) ?? { _id: query._id, ...change.$setOnInsert };
    Object.assign(row, change.$set);
    for (const field of Object.keys(change.$unset ?? {})) delete row[field];
    db.rows.set(query._id, row);
    return { acknowledged: true };
  });
  db.insertOne.mockImplementation(async (row: { _id: string }) => {
    if (db.nonces.has(row._id)) throw Object.assign(new Error('duplicate nonce'), { code: 11000 });
    db.nonces.add(row._id);
    return { acknowledged: true, insertedId: row._id };
  });
  db.getCollection.mockImplementation(async (name: string) => {
    if (name === 'file_encryption_keys') return { findOne: db.findOne, updateOne: db.updateOne };
    if (name === 'file_encryption_nonces') return { insertOne: db.insertOne };
    throw new Error(`Unexpected collection ${name}`);
  });
  file = path.join(getNoteDir('user_storage', 'note_storage'), 'audio.mp3');
});
afterEach(async () => {
  for (const userId of db.rows.keys()) await destroyUserKey(userId);
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('real encrypted storage with a mocked key database', () => {
  it.each([Buffer.alloc(0), Buffer.from('private lecture recording'), randomBytes(256 * 1024 + 7)])('saves encrypted disk bytes and reads the original buffer (%#. test)', async plain => {
    await ensureUserKey('user_storage');
    await saveFile(file, plain);
    const ciphertext = await readDisk(file);
    expect(ciphertext.subarray(0, 8).toString()).toBe('NOTEGCM1');
    expect(ciphertext).not.toEqual(plain);
    if (plain.length) expect(ciphertext.includes(plain)).toBe(false);
    expect(await readFile(file)).toEqual(plain);
    expect(db.insertOne).toHaveBeenCalledTimes(1);
    expect(await readdir(path.dirname(file))).toEqual(['audio.mp3']);
  });
  it('supports UTF-8 strings and inclusive stream ranges over chunk boundaries', async () => {
    await ensureUserKey('user_storage');
    const plain = Buffer.from('日本語 private notes '.repeat(10000));
    await saveFile(file, plain.toString());
    const result = await openFileStream(file, 65530, 65545);
    expect(result.length).toBe(plain.length);
    expect(await consume(result.stream)).toEqual(plain.subarray(65530, 65546));
    const full = await openFileStream(file);
    expect(await consume(full.stream)).toEqual(plain);
  });
  it('encrypts an actual plaintext source file and leaves that source unchanged', async () => {
    await ensureUserKey('user_storage');
    const source = path.join(directory, 'source.tmp');
    const plain = randomBytes(200000);
    await writeFile(source, plain);
    await encryptFile(source, file);
    expect(await readFile(file)).toEqual(plain);
    expect(await readDisk(source)).toEqual(plain);
    expect((await readDisk(file)).includes(plain)).toBe(false);
  });
  it('materializes a temporary decrypted file only during the callback', async () => {
    await ensureUserKey('user_storage'); await saveFile(file, 'secret');
    let temporary = '';
    expect(await withDecryptedFile(file, async plain => {
      temporary = plain;
      expect(await readDisk(plain, 'utf8')).toBe('secret');
      return 'result';
    })).toBe('result');
    await expect(readDisk(temporary)).rejects.toThrow();
  });
  it('fails closed for missing keys without saving plaintext or silently creating a key', async () => {
    await expect(saveFile(file, 'secret')).rejects.toThrow(/key unavailable/);
    await expect(openFileStream(file)).rejects.toThrow(/key unavailable/);
    await expect(readDisk(file)).rejects.toThrow();
    expect(db.updateOne).not.toHaveBeenCalled();
  });
  it('fails closed with no master key even when the account key is cached', async () => {
    await ensureUserKey('user_storage'); await saveFile(file, 'secret');
    vi.stubEnv('FILE_ENCRYPTION_MASTER_KEY', '');
    await expect(readFile(file)).rejects.toThrow(/master key unavailable/);
    await expect(saveFile(file, 'replacement')).rejects.toThrow(/master key unavailable/);
  });
  it('refuses old ciphertext and new writes after key destruction and cannot recreate the key', async () => {
    await ensureUserKey('user_storage'); await saveFile(file, 'secret');
    const original = await readDisk(file);
    await destroyUserKey('user_storage');
    expect(db.rows.get('user_storage')).toMatchObject({ destroyed: true });
    expect(db.rows.get('user_storage')).not.toHaveProperty('wrapped');
    await expect(readFile(file)).rejects.toThrow(/destroyed/);
    await expect(saveFile(file, 'replacement')).rejects.toThrow(/destroyed/);
    await expect(ensureUserKey('user_storage')).rejects.toThrow(/destroyed/);
    expect(await readDisk(file)).toEqual(original);
  });
  it('checks the database on cache hits and rejects another replica tombstoning the key', async () => {
    await ensureUserKey('user_storage'); await saveFile(file, 'secret');
    await getUserKey('user_storage');
    const reads = db.findOne.mock.calls.length;
    await getUserKey('user_storage');
    expect(db.findOne.mock.calls.length).toBeGreaterThan(reads);
    db.rows.set('user_storage', { _id: 'user_storage', destroyed: true });
    await expect(readFile(file)).rejects.toThrow(/destroyed/);
  });
  it('checks revocation after opening a stream but before releasing plaintext', async () => {
    await ensureUserKey('user_storage'); await saveFile(file, randomBytes(100000));
    const opened = await openFileStream(file);
    db.rows.set('user_storage', { _id: 'user_storage', destroyed: true });
    await expect(consume(opened.stream)).rejects.toThrow(/destroyed/);
  });
  it('reserves independent file nonce prefixes in a separate unique-id collection', async () => {
    await ensureUserKey('user_storage');
    const a = await reserveFileNonce('user_storage');
    const b = await reserveFileNonce('user_storage');
    expect(a.length).toBe(8); expect(b.length).toBe(8); expect(a).not.toEqual(b);
    expect(db.nonces.size).toBe(2);
    expect(db.insertOne.mock.calls[0][0]).toEqual({ _id: `user_storage:${a.toString('hex')}` });
    expect(db.getCollection).toHaveBeenCalledWith('file_encryption_nonces');
  });
  it('retries duplicate nonce reservations and propagates other database failures', async () => {
    await ensureUserKey('user_storage');
    db.insertOne.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
    expect((await reserveFileNonce('user_storage')).length).toBe(8);
    expect(db.insertOne).toHaveBeenCalledTimes(2);
    db.insertOne.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(reserveFileNonce('user_storage')).rejects.toThrow('database unavailable');
  });
  it('rejects ciphertext moved to a different note path', async () => {
    await ensureUserKey('user_storage'); await saveFile(file, 'secret');
    const moved = path.join(path.dirname(file), 'moved.mp3');
    await rename(file, moved);
    await expect(readFile(moved)).rejects.toThrow();
  });
  it('rejects symlink files for both reads and writes without touching the target', async () => {
    await ensureUserKey('user_storage'); await saveFile(file, 'secret');
    const link = path.join(path.dirname(file), 'link.mp3');
    await symlink(file, link);
    const original = await readDisk(file);
    await expect(readFile(link)).rejects.toThrow(/Symlink/);
    await expect(saveFile(link, 'replacement')).rejects.toThrow(/Symlink/);
    expect(await readDisk(file)).toEqual(original);
  });
  it('rejects a symlink ancestor and storage traversal', async () => {
    await ensureUserKey('user_storage');
    const outside = path.join(directory, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(directory, 'user_storage'));
    await expect(saveFile(file, 'secret')).rejects.toThrow(/Symlink/);
    await expect(openFileStream(file)).rejects.toThrow(/Symlink/);
    await expect(saveFile(path.join(directory, '..', 'escape.mp3'), 'secret')).rejects.toThrow(/Invalid storage/);
    expect(await readdir(outside)).toEqual([]);
  });
});

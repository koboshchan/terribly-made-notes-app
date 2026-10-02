import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

const { rows, nonces, findOne, updateOne, insertOne } = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const nonces = new Set<string>();
  return { rows, nonces, findOne: vi.fn(), updateOne: vi.fn(), insertOne: vi.fn() };
});
vi.mock('../lib/db', () => ({ getCollection: vi.fn(async (name: string) => name === 'file_encryption_nonces' ? { insertOne } : { findOne, updateOne }) }));
import { encryptToFile, decryptFrames, inspectEncrypted } from '../lib/file-crypto';
import { ensureUserKey, getUserKey, destroyUserKey, assertUserKeyActive } from '../lib/file-keys';
import { migrateFileEncryption } from '../scripts/migrate-file-encryption';

let directory: string;
const CHUNK = 65536;
const HEADER = 48;
const RECORD = 25;
const key = randomBytes(32);
const binding = 'user_test/note_test/audio.mp3';
async function decoded(file: string, secret: Buffer = key, name = binding, start = 0, end?: number) {
  const pieces: Buffer[] = [];
  for await (const piece of decryptFrames(file, secret, name, start, end)) pieces.push(piece);
  return Buffer.concat(pieces);
}
async function encrypted(data: Buffer, name = 'encrypted.bin') {
  const file = path.join(directory, name);
  // Deliberately fragmented input exercises chunk accumulation and split boundaries.
  async function* source() {
    for (let i = 0; i < data.length; i += 17003) yield data.subarray(i, i + 17003);
  }
  await encryptToFile(source(), file, key, binding, data.length, CHUNK);
  return file;
}
async function corrupt(file: string, transform: (data: Buffer) => Buffer) {
  await writeFile(file, transform(await readFile(file)));
}
async function storageFile(name = 'audio.mp3', contents = Buffer.from('legacy audio')) {
  const file = path.join(directory, 'user_test', 'note_test', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  return file;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'notes-crypto-test-'));
  rows.clear(); nonces.clear();
  insertOne.mockReset().mockImplementation(async (row: { _id: string }) => {
    if (nonces.has(row._id)) throw Object.assign(new Error('duplicate nonce'), { code: 11000 });
    nonces.add(row._id);
    return { acknowledged: true, insertedId: row._id };
  });
  findOne.mockReset().mockImplementation(async (query: { _id: string }) => rows.get(query._id) ?? null);
  updateOne.mockReset().mockImplementation(async (query: { _id: string }, change: { $setOnInsert?: Record<string, unknown>; $set?: Record<string, unknown>; $unset?: Record<string, unknown> }) => {
    const existing = rows.get(query._id);
    const row = existing ?? { _id: query._id, ...change.$setOnInsert };
    Object.assign(row, change.$set);
    for (const field of Object.keys(change.$unset ?? {})) delete row[field];
    rows.set(query._id, row);
    return { acknowledged: true };
  });
  vi.stubEnv('FILE_ENCRYPTION_MASTER_KEY', randomBytes(32).toString('base64'));
});
afterEach(async () => {
  // Clear module-level cached key material, not only the mocked database.
  for (const userId of rows.keys()) await destroyUserKey(userId);
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('authenticated chunked storage', () => {
  it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 2, CHUNK * 2 + 1])('roundtrips %i bytes including terminal frames', async size => {
    const plain = randomBytes(size);
    const file = await encrypted(plain);
    expect((await inspectEncrypted(file, key, binding)).length).toBe(size);
    expect(await decoded(file)).toEqual(plain);
    expect((await readFile(file)).subarray(0, 8).toString()).toBe('NOTEGCM1');
  });
  it('reads inclusive ranges crossing chunk boundaries', async () => {
    const plain = randomBytes(CHUNK * 3 + 5);
    const file = await encrypted(plain);
    for (const [start, end] of [[0, 0], [CHUNK - 4, CHUNK + 7], [CHUNK * 2, plain.length - 1], [plain.length - 1, plain.length - 1]]) {
      expect(await decoded(file, key, binding, start, end)).toEqual(plain.subarray(start, end + 1));
    }
  });
  it('rejects invalid plaintext ranges', async () => {
    const file = await encrypted(Buffer.from('abc'));
    for (const [start, end] of [[-1, 0], [2, 1], [0, 3], [0.5, 1], [0, NaN]]) {
      await expect(decoded(file, key, binding, start, end)).rejects.toThrow();
    }
  });
  it('binds ciphertext to its user and full relative path', async () => {
    const file = await encrypted(Buffer.from('secret'));
    await expect(decoded(file, key, 'other/note/audio.mp3')).rejects.toThrow();
    await expect(decoded(file, randomBytes(32))).rejects.toThrow();
  });
  it.each([0, 8, 12, 20, 28, 32, HEADER, HEADER + 9, HEADER + 12])('rejects tampering at byte %i', async position => {
    const file = await encrypted(randomBytes(CHUNK + 3));
    await corrupt(file, bytes => { bytes[position] ^= 1; return bytes; });
    await expect(decoded(file)).rejects.toThrow();
  });
  it.each([0, 7, 31, 47, HEADER, HEADER + RECORD, HEADER + CHUNK + RECORD])('rejects truncation to %i bytes', async size => {
    const file = await encrypted(randomBytes(CHUNK * 2));
    await corrupt(file, bytes => bytes.subarray(0, size));
    await expect(decoded(file)).rejects.toThrow();
  });
  it('rejects appended bytes', async () => {
    const file = await encrypted(Buffer.from('secret'));
    await corrupt(file, bytes => Buffer.concat([bytes, Buffer.from([0])]));
    await expect(decoded(file)).rejects.toThrow();
  });
  it('rejects reordered equal-size frames', async () => {
    const file = await encrypted(randomBytes(CHUNK * 2));
    await corrupt(file, bytes => Buffer.concat([bytes.subarray(0, HEADER), bytes.subarray(HEADER + CHUNK + RECORD, HEADER + 2 * (CHUNK + RECORD)), bytes.subarray(HEADER, HEADER + CHUNK + RECORD), bytes.subarray(HEADER + 2 * (CHUNK + RECORD))]));
    await expect(decoded(file)).rejects.toThrow();
  });
  it('authenticates the terminal frame even for an early byte range', async () => {
    const file = await encrypted(randomBytes(CHUNK * 2));
    await corrupt(file, bytes => { bytes[bytes.length - 1] ^= 1; return bytes; });
    await expect(decoded(file, key, binding, 0, 0)).rejects.toThrow();
  });
  it('fails closed for legacy plaintext and missing headers', async () => {
    const file = await storageFile('plain.txt', Buffer.alloc(100, 65));
    await expect(decoded(file)).rejects.toThrow(/migration/);
  });
  it('detects source length changes and refuses replacing existing destinations', async () => {
    const destination = path.join(directory, 'partial');
    await expect(encryptToFile(Readable.from([Buffer.from('abc')]), destination, key, binding, 2, CHUNK)).rejects.toThrow(/size changed/);
    await expect(encryptToFile(Readable.from([]), destination, key, binding, 0, CHUNK)).rejects.toThrow();
  });
  it('invokes the live revocation check before any plaintext is yielded', async () => {
    const file = await encrypted(Buffer.from('secret'));
    const check = vi.fn(async () => { throw new Error('destroyed'); });
    const generator = decryptFrames(file, key, binding, 0, undefined, check);
    await expect(generator.next()).rejects.toThrow('destroyed');
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe('account encryption keys', () => {
  it('requires a canonical 32-byte master key before creating or reading keys', async () => {
    for (const master of ['', 'not-base64', randomBytes(16).toString('base64'), `${randomBytes(32).toString('base64')}\n`]) {
      vi.stubEnv('FILE_ENCRYPTION_MASTER_KEY', master);
      await expect(ensureUserKey('new_user')).rejects.toThrow();
      await expect(getUserKey('new_user')).rejects.toThrow();
    }
    expect(updateOne).not.toHaveBeenCalled();
  });
  it('creates distinct wrapped per-account keys and preserves an existing key', async () => {
    await ensureUserKey('user_a');
    await ensureUserKey('user_b');
    const first = await getUserKey('user_a');
    expect(first.length).toBe(32);
    expect(await getUserKey('user_b')).not.toEqual(first);
    expect(rows.get('user_a')!.wrapped).not.toBe(first.toString('base64'));
    await ensureUserKey('user_a');
    expect(await getUserKey('user_a')).toEqual(first);
    first.fill(0);
  });
  it('destroys wrapped material and refuses cached keys or recreation', async () => {
    await ensureUserKey('user_a');
    const callerCopy = await getUserKey('user_a');
    callerCopy.fill(0);
    expect((await getUserKey('user_a')).some(value => value !== 0)).toBe(true);
    await destroyUserKey('user_a');
    expect(rows.get('user_a')).toMatchObject({ destroyed: true });
    expect(rows.get('user_a')).not.toHaveProperty('wrapped');
    expect(rows.get('user_a')).not.toHaveProperty('iv');
    expect(rows.get('user_a')).not.toHaveProperty('tag');
    await expect(getUserKey('user_a')).rejects.toThrow(/destroyed/);
    await expect(ensureUserKey('user_a')).rejects.toThrow(/destroyed/);
    await expect(assertUserKeyActive('user_a')).rejects.toThrow(/destroyed/);
  });
  it('observes another replica deleting a key despite a local cache hit', async () => {
    await ensureUserKey('user_a');
    await getUserKey('user_a');
    rows.set('user_a', { destroyed: true });
    await expect(getUserKey('user_a')).rejects.toThrow(/destroyed/);
  });
  it('creates a permanent tombstone even if the account never had a key', async () => {
    await destroyUserKey('never_created');
    await expect(ensureUserKey('never_created')).rejects.toThrow(/destroyed/);
    expect(rows.get('never_created')).not.toHaveProperty('wrapped');
  });
  it('rejects tampered wrapped keys after cache expiry', async () => {
    await ensureUserKey('user_a');
    await getUserKey('user_a');
    rows.get('user_a')!.tag = randomBytes(16).toString('base64');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);
    try { await expect(getUserKey('user_a')).rejects.toThrow(); }
    finally { clock.mockRestore(); }
  });
  it('authenticates the account identity when unwrapping keys', async () => {
    await ensureUserKey('user_a');
    await ensureUserKey('user_b');
    Object.assign(rows.get('user_b')!, rows.get('user_a'));
    await expect(getUserKey('user_b')).rejects.toThrow();
  });
});

describe('offline encryption migration', () => {
  it('requires explicit offline confirmation before accessing storage or keys', async () => {
    await expect(migrateFileEncryption({ offlineConfirmed: false, dataDir: directory })).rejects.toThrow(/offline-confirmed/);
    expect(updateOne).not.toHaveBeenCalled();
  });
  it('migrates legacy files atomically and verifies existing ciphertext on reruns', async () => {
    const plain = randomBytes(CHUNK + 3);
    const file = await storageFile('audio.mp3', plain);
    expect(await migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).toEqual({ migrated: 1, skipped: 0 });
    const secret = await getUserKey('user_test');
    expect(await decoded(file, secret)).toEqual(plain);
    const before = await readFile(file);
    expect(await migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).toEqual({ migrated: 0, skipped: 1 });
    expect(await readFile(file)).toEqual(before);
    secret.fill(0);
  });
  it('resumes after an interrupted temporary without promoting partial ciphertext', async () => {
    const file = await storageFile();
    await writeFile(`${file}.encryption-migration.tmp`, Buffer.from('interrupted ciphertext'));
    await migrateFileEncryption({ offlineConfirmed: true, dataDir: directory });
    const secret = await getUserKey('user_test');
    expect(await decoded(file, secret)).toEqual(Buffer.from('legacy audio'));
    await expect(readFile(`${file}.encryption-migration.tmp`)).rejects.toThrow();
    secret.fill(0);
  });
  it('never overwrites corrupt encrypted originals, including valid headers with bad frames', async () => {
    const file = await storageFile();
    await migrateFileEncryption({ offlineConfirmed: true, dataDir: directory });
    await corrupt(file, bytes => { bytes[HEADER + 9] ^= 1; return bytes; });
    const before = await readFile(file);
    await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).rejects.toThrow();
    expect(await readFile(file)).toEqual(before);
  });
  it('refuses tombstoned account migration without changing plaintext', async () => {
    const file = await storageFile();
    await destroyUserKey('user_test');
    await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).rejects.toThrow(/destroyed/);
    expect(await readFile(file)).toEqual(Buffer.from('legacy audio'));
  });
  it('preflights all nested symlinks before changing any earlier files', async () => {
    const file = await storageFile();
    await symlink(file, path.join(path.dirname(file), 'z_link'));
    await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).rejects.toThrow(/Symlink/);
    expect(await readFile(file)).toEqual(Buffer.from('legacy audio'));
    expect(updateOne).not.toHaveBeenCalled();
  });
  it('rejects symlink roots and symlink ancestors', async () => {
    await storageFile();
    const parent = await mkdtemp(path.join(tmpdir(), 'notes-crypto-link-'));
    try {
      const linked = path.join(parent, 'linked');
      await symlink(directory, linked);
      for (const root of [linked, path.join(linked, 'user_test')]) {
        await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: root })).rejects.toThrow(/Symlink/);
      }
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it('rejects root traversal, invalid identifiers, and orphan temporary files', async () => {
    await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: `${directory}/../data` })).rejects.toThrow(/traversal/);
    const orphan = await storageFile('audio.mp3.encryption-migration.tmp');
    await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).rejects.toThrow(/Orphan/);
    await rm(orphan);
    await mkdir(path.join(directory, 'bad.user'));
    await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).rejects.toThrow(/identifier/);
  });
  it('leaves a magic-prefixed but truncated file untouched', async () => {
    const file = await storageFile('audio.mp3', Buffer.from('NOTEGCM1'));
    await expect(migrateFileEncryption({ offlineConfirmed: true, dataDir: directory })).rejects.toThrow(/Truncated/);
    expect(await readFile(file)).toEqual(Buffer.from('NOTEGCM1'));
  });
  it('supports deeply nested file bindings using slash separators', async () => {
    const file = path.join(directory, 'user_test', 'note_test', 'nested', 'audio.mp3');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from('nested data'));
    await migrateFileEncryption({ offlineConfirmed: true, dataDir: directory });
    const secret = await getUserKey('user_test');
    expect(await decoded(file, secret, 'user_test/note_test/nested/audio.mp3')).toEqual(Buffer.from('nested data'));
    secret.fill(0);
  });
  it('registers existing authenticated ciphertext prefixes before migrating plaintext', async () => {
    const file = await storageFile();
    await migrateFileEncryption({ offlineConfirmed: true, dataDir: directory });
    const encrypted = await readFile(file);
    const prefix = encrypted.subarray(20, 28).toString('hex');
    nonces.clear();
    await storageFile('second.mp3', Buffer.from('second source'));
    insertOne.mockClear();
    await migrateFileEncryption({ offlineConfirmed: true, dataDir: directory });
    expect(insertOne.mock.calls[0][0]._id).toBe(`user_test:${prefix}`);
    expect(nonces.has(`user_test:${prefix}`)).toBe(true);
  });
  it('encrypts actual disk streams without loading the source into memory', async () => {
    const source = await storageFile();
    const destination = path.join(directory, 'from-stream');
    await encryptToFile(createReadStream(source), destination, key, binding, 12, CHUNK);
    expect(await decoded(destination)).toEqual(Buffer.from('legacy audio'));
  });
});

/*
 * OFFLINE ONLY. Stop every web instance, worker and other DATA_DIR writer first.
 * Back up DATA_DIR, MongoDB and FILE_ENCRYPTION_MASTER_KEY together beforehand.
 * Load the same environment as the application (tsx does not load .env itself).
 * Run from the repository root, for example:
 *   npx tsx --env-file=.env.local scripts/migrate-file-encryption.ts --offline-confirmed
 * Never start the application until this completes successfully. Plaintext files
 * deliberately remain unreadable by the application until migrated. No online
 * migration is supported. The confirmation flag is an operator assertion, not a lock.
 * Each file is encrypted to a private sibling, authenticated fully, fsynced, then
 * atomically renamed. Reruns authenticate every existing encrypted frame before
 * skipping it. Interrupted siblings are discarded only when their original exists;
 * the original remains authoritative until rename. Directory fsync requires POSIX.
 * Keep backups secure: a backup of wrapped keys can undo cryptographic deletion.
 */
import { createReadStream } from 'node:fs';
import { lstat, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encryptToFile, inspectEncrypted, decryptFrames } from '../lib/file-crypto';
import { ensureUserKey, getUserKey, assertUserKeyActive, reserveFileNonce, registerExistingFileNonce } from '../lib/file-keys';

const MAGIC = Buffer.from('NOTEGCM1');
const TEMP_SUFFIX = '.encryption-migration.tmp';
const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

async function assertSafePath(file: string) {
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden: ${current}`);
  }
}
async function syncDirectory(directory: string) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function fileIdentity(root: string, file: string) {
  const relative = path.relative(root, file);
  const parts = relative.split(path.sep);
  if (path.isAbsolute(relative) || parts.includes('..') || parts.length < 3 || !IDENTIFIER.test(parts[0]) || !IDENTIFIER.test(parts[1])) {
    throw new Error(`Invalid storage path: ${file}`);
  }
  return { userId: parts[0], binding: parts.join('/') };
}
async function hasMagic(file: string) {
  const handle = await open(file, 'r');
  try {
    const prefix = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    return bytesRead === MAGIC.length && prefix.equals(MAGIC);
  } finally { await handle.close(); }
}
async function verify(file: string, key: Buffer, binding: string, userId: string) {
  await inspectEncrypted(file, key, binding);
  for await (const frame of decryptFrames(file, key, binding, 0, undefined, () => assertUserKeyActive(userId))) {
    frame.fill(0);
  }
}

export async function migrateFileEncryption(options: { offlineConfirmed: boolean; dataDir?: string }) {
  if (!options.offlineConfirmed) throw new Error('Stop all writers and pass --offline-confirmed before migration');
  const configured = options.dataDir ?? process.env.DATA_DIR ?? './data';
  if (configured.split(/[\\/]/).includes('..')) throw new Error('DATA_DIR path traversal forbidden');
  const root = path.resolve(configured);
  await assertSafePath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error('DATA_DIR must be a directory');
  const files: string[] = [];
  const temporaries: string[] = [];
  async function walk(directory: string) {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const entry = await lstat(file);
      if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden: ${file}`);
      if (entry.isDirectory()) {
        const parts = path.relative(root, file).split(path.sep);
        if (parts.length <= 2 && !IDENTIFIER.test(name)) throw new Error(`Invalid storage identifier: ${name}`);
        await walk(file);
      } else if (entry.isFile()) {
        fileIdentity(root, file);
        (name.endsWith(TEMP_SUFFIX) ? temporaries : files).push(file);
      } else throw new Error(`Non-regular storage entry: ${file}`);
    }
  }
  // Preflight the entire tree before changing files or creating any account keys.
  await walk(root);
  for (const temporary of temporaries) {
    const original = temporary.slice(0, -TEMP_SUFFIX.length);
    if (!files.includes(original)) throw new Error(`Orphan migration temporary requires manual recovery: ${temporary}`);
  }
  // Reserve all authenticated existing prefixes before allocating any new nonce.
  for (const file of files) {
    if (!(await hasMagic(file))) continue;
    const { userId, binding } = fileIdentity(root, file);
    await ensureUserKey(userId);
    const key = await getUserKey(userId);
    try {
      await verify(file, key, binding, userId);
      const info = await inspectEncrypted(file, key, binding);
      await registerExistingFileNonce(userId, info.header.subarray(20, 28));
    } finally { key.fill(0); }
  }
  let migrated = 0, skipped = 0;
  for (const file of files) {
    await assertSafePath(file);
    const { userId, binding } = fileIdentity(root, file);
    // Insert-only ensure rejects permanent account tombstones, never recreates them.
    await ensureUserKey(userId);
    const key = await getUserKey(userId);
    const temporary = `${file}${TEMP_SUFFIX}`;
    try {
      if (await hasMagic(file)) {
        // Header-only inspection is not sufficient: authenticate every frame.
        await verify(file, key, binding, userId);
        skipped++;
      } else {
        if (temporaries.includes(temporary)) {
          await assertSafePath(temporary);
          await rm(temporary);
          await syncDirectory(path.dirname(file));
        }
        const source = await lstat(file);
        await encryptToFile(createReadStream(file), temporary, key, binding, source.size, undefined, await reserveFileNonce(userId));
        await verify(temporary, key, binding, userId);
        await assertSafePath(file);
        const unchanged = await lstat(file);
        if (unchanged.dev !== source.dev || unchanged.ino !== source.ino || unchanged.size !== source.size || unchanged.mtimeMs !== source.mtimeMs || unchanged.ctimeMs !== source.ctimeMs) {
          throw new Error(`Source changed while offline: ${file}`);
        }
        await assertUserKeyActive(userId);
        await rename(temporary, file);
        await syncDirectory(path.dirname(file));
        migrated++;
      }
      // A valid original ciphertext supersedes any interrupted sibling as well.
      if (temporaries.includes(temporary)) {
        await rm(temporary, { force: true });
        await syncDirectory(path.dirname(file));
      }
    } finally {
      key.fill(0);
      // Only remove this attempt's sibling. An existing corrupt original is untouched.
      if (!temporaries.includes(temporary)) await rm(temporary, { force: true });
    }
  }
  return { migrated, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--offline-confirmed') {
    console.error('Usage: npx tsx scripts/migrate-file-encryption.ts --offline-confirmed');
    process.exitCode = 1;
  } else {
    migrateFileEncryption({ offlineConfirmed: true }).then(result => {
      console.log(`Migration complete: ${result.migrated} encrypted, ${result.skipped} verified existing files.`);
      process.exit(0);
    }, error => {
      console.error('Migration stopped; keep all writers offline until resolved.', error);
      process.exit(1);
    });
  }
}

import { createHash } from 'node:crypto';
import path from 'node:path';
import { getCollection } from './db';
import { destroyUserKey } from './file-keys';
import { processingQueue } from './queue';
import { deleteDir, getUserDataDir } from './storage';

// Never remove file_encryption_keys: its destroyed row prevents key resurrection.
const USER_COLLECTIONS = [
  'notes',
  'user_classes',
  'shared_note_sets',
  'shortcut_tokens',
  'user_settings', // Legacy installations may still have per-user settings.
  'usage_limits', // Older rows with userId; current anonymous buckets expire via TTL.
] as const;

function validateUserId(userId: string): void {
  // Verified Clerk IDs are single safe path segments, never caller-provided paths.
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(userId)) throw new Error('Invalid account identifier');
}

export async function destroyAccountKey(userId: string): Promise<void> {
  validateUserId(userId);
  // This persistent tombstone must complete before Clerk deletion or data cleanup.
  await destroyUserKey(userId);
}

export interface AccountCleanupResult {
  complete: boolean;
  pending: string[];
}

// Idempotent and best effort. The webhook returns a retryable failure if any step
// is pending, so a partial cleanup is not acknowledged as successfully delivered.
export async function cleanupAccountData(userId: string): Promise<AccountCleanupResult> {
  validateUserId(userId);
  const pending: string[] = [];
  async function attempt(step: string, work: () => Promise<unknown> | void): Promise<boolean> {
    try {
      await work();
      return true;
    } catch {
      pending.push(step);
      // Do not log payloads, credentials, file keys, or upstream error bodies.
      console.error(`Account deletion cleanup pending (${step})`);
      return false;
    }
  }

  // Never unlink active workers' files or erase their cancellation records until
  // they have stopped. Other revocation steps still run if cancellation fails.
  const stopped = await attempt('processing cancellation', () => processingQueue.cancelUser(userId));
  await Promise.all(USER_COLLECTIONS.map(name => attempt(name, async () => {
    await (await getCollection(name)).deleteMany({ userId });
  })));
  await attempt('upload admission', async () => {
    const key = createHash('sha256').update(userId).digest('hex');
    await (await getCollection('upload_admission')).deleteMany({ $or: [{ userId }, { key }] });
  });

  if (stopped) {
    await attempt('processing jobs', async () => {
      await (await getCollection('processing_jobs')).deleteMany({ userId });
    });
    await attempt('stored files', () => {
      const directory = path.resolve(getUserDataDir(userId));
      const root = path.resolve(process.env.DATA_DIR || './data');
      if (path.dirname(directory) !== root) throw new Error('Invalid account data directory');
      deleteDir(directory);
    });
  }
  return { complete: pending.length === 0, pending };
}

export async function handleDeletedAccount(userId: string): Promise<AccountCleanupResult> {
  await destroyAccountKey(userId);
  return cleanupAccountData(userId);
}

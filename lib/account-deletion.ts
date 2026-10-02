import { createHash } from 'node:crypto';
import path from 'node:path';
import { getCollection, getCollectionNames } from './db';
import { destroyUserKey } from './file-keys';
import { processingQueue } from './queue';
import { deleteDir, getUserDataDir } from './storage';

const USER_COLLECTIONS = ['notes', 'transcripts', 'summaries', 'study_materials', 'flashcards', 'quizzes', 'chat_history', 'chats', 'conversations', 'messages', 'settings', 'user_classes', 'shared_note_sets', 'shortcut_tokens', 'user_settings', 'usage_limits'];
const PROTECTED = new Set(['file_encryption_keys', 'file_encryption_nonces', 'processing_jobs', 'upload_admission']);
function validateUserId(userId: string) {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(userId)) throw new Error('Invalid account identifier');
}
export async function destroyAccountKey(userId: string): Promise<void> {
  validateUserId(userId);
  await destroyUserKey(userId);
}
export interface AccountCleanupResult { complete: boolean; pending: string[] }
export async function cleanupAccountData(userId: string): Promise<AccountCleanupResult> {
  validateUserId(userId);
  const pending: string[] = [];
  async function attempt(step: string, work: () => Promise<unknown> | void) {
    try { await work(); return true; }
    catch { pending.push(step); console.error(`Account deletion cleanup pending (${step})`); return false; }
  }
  // Keep cancellation records and worker paths until active leases have ended.
  const stopped = await attempt('processing cancellation', () => processingQueue.cancelUser(userId));
  const names = new Set(USER_COLLECTIONS);
  await attempt('collection discovery', async () => {
    for (const name of await getCollectionNames()) names.add(name);
  });
  // Discover future/legacy collections too. Ownership does not mean membership
  // in another user's shared conversation. Preserve only content-free safety rows.
  await Promise.all([...names].filter(name => !name.startsWith('system.') && !PROTECTED.has(name)).map(name => attempt(name, async () => {
    await (await getCollection(name)).deleteMany({ $or: [{ userId }, { ownerId: userId }, { accountId: userId }, { clerkUserId: userId }] });
  })));
  await attempt('legacy owner usage', async () => {
    const bucket = Math.floor(Date.now() / 86400000);
    const keys = [bucket - 1, bucket, bucket + 1].map(window => createHash('sha256').update(`public-chat-owner:${userId}:${window}`).digest('hex'));
    await (await getCollection('usage_limits')).deleteMany({ key: { $in: keys } });
  });
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
      if (path.dirname(directory) !== path.resolve(process.env.DATA_DIR || './data')) throw new Error('Invalid account data directory');
      deleteDir(directory);
    });
  }
  return { complete: pending.length === 0, pending };
}
export async function handleDeletedAccount(userId: string): Promise<AccountCleanupResult> {
  await destroyAccountKey(userId);
  return cleanupAccountData(userId);
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getCollection } from './db';

const cache = new Map<string, { key: Buffer; expires: number }>();
const TTL = 5000;
function masterKey(): Buffer {
  const value = process.env.FILE_ENCRYPTION_MASTER_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('File encryption master key unavailable');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('Invalid file encryption master key');
  return key;
}
function clear(userId: string) { cache.get(userId)?.key.fill(0); cache.delete(userId); }
export async function assertUserKeyActive(userId: string): Promise<void> {
  const collection = await getCollection('file_encryption_keys');
  const row = await collection.findOne({ _id: userId as any }, { projection: { destroyed: 1, wrapped: 1 } });
  if (!row || row.destroyed || !row.wrapped) { clear(userId); throw new Error('File key unavailable or destroyed'); }
}
export async function ensureUserKey(userId: string): Promise<void> {
  const master = masterKey();
  const key = randomBytes(32), iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', master, iv);
    cipher.setAAD(Buffer.from(userId));
    const wrapped = Buffer.concat([cipher.update(key), cipher.final()]);
    const collection = await getCollection('file_encryption_keys');
    // A destroyed row is permanent and this insert-only operation cannot resurrect it.
    await collection.updateOne({ _id: userId as any }, { $setOnInsert: { wrapped: wrapped.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), destroyed: false, createdAt: new Date() } }, { upsert: true });
    await assertUserKeyActive(userId);
  } finally { master.fill(0); key.fill(0); }
}
export async function getUserKey(userId: string): Promise<Buffer> {
  const master = masterKey();
  try {
    const collection = await getCollection('file_encryption_keys');
    // Always check Mongo, including cache hits, so another replica's deletion is effective.
    const row = await collection.findOne({ _id: userId as any });
    if (!row || row.destroyed || !row.wrapped) { clear(userId); throw new Error('File key unavailable or destroyed'); }
    const hit = cache.get(userId);
    if (hit && hit.expires > Date.now()) return Buffer.from(hit.key);
    clear(userId);
    const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    const key = Buffer.concat([decipher.update(Buffer.from(row.wrapped, 'base64')), decipher.final()]);
    if (key.length !== 32) { key.fill(0); throw new Error('Invalid file key'); }
    cache.set(userId, { key, expires: Date.now() + TTL });
    const timer = setTimeout(() => { if (cache.get(userId)?.key === key) clear(userId); }, TTL); timer.unref();
    return Buffer.from(key);
  } finally { master.fill(0); }
}
export async function reserveFileNonce(userId: string): Promise<Buffer> {
  await assertUserKeyActive(userId);
  const collection = await getCollection('file_encryption_nonces');
  for (;;) {
    const prefix = randomBytes(8);
    try { await collection.insertOne({ _id: `${userId}:${prefix.toString('hex')}` as any }); return prefix; }
    catch (error: any) { if (error?.code !== 11000) throw error; }
  }
}
export async function registerExistingFileNonce(userId: string, prefix: Buffer): Promise<void> {
  if (prefix.length !== 8) throw new Error('Invalid file nonce prefix');
  await assertUserKeyActive(userId);
  try {
    await (await getCollection('file_encryption_nonces')).insertOne({ _id: `${userId}:${prefix.toString('hex')}` as any });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }
}
export async function destroyUserKey(userId: string): Promise<void> {
  clear(userId);
  const collection = await getCollection('file_encryption_keys');
  await collection.updateOne({ _id: userId as any }, { $set: { destroyed: true, destroyedAt: new Date() }, $unset: { wrapped: '', iv: '', tag: '' } }, { upsert: true });
  clear(userId);
}

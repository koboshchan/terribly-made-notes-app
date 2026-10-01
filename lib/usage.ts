import { createHash } from 'crypto';
import { getCollection } from './db';
import { RequestError } from './request-limits';

// A single Mongo document per fixed window makes reservations atomic across workers.
// Charges are attempts, not refunded requests. Limits fail closed if Mongo is down.
export async function reserveUsage(key: string, limit: number, windowMs: number, amount = 1): Promise<void> {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const id = createHash('sha256').update(`${key}:${bucket}`).digest('hex');
  const collection = await getCollection('usage_limits');
  await collection.createIndex({ key: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  try {
    await collection.updateOne({ key: id }, { $setOnInsert: { used: 0, expiresAt: new Date((bucket + 2) * windowMs) } }, { upsert: true });
  } catch (error: any) { if (error?.code !== 11000) throw error; }
  const result = await collection.updateOne({ key: id, used: { $lte: limit - amount } }, { $inc: { used: amount } });
  if (!result.modifiedCount) throw new RequestError('Usage limit reached. Try again later.', 429);
}

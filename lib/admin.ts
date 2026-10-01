import { getCollection } from './db';

// Owner identity comes from deployment configuration, never registration order.
// Existing database roles must be explicitly re-approved before this rollout.
export async function isUserAdmin(userId: string): Promise<boolean> {
  const ownerId = process.env.ADMIN_USER_ID?.trim();
  if (!ownerId || ownerId !== userId) return false;
  try {
    const users = await getCollection('users');
    await users.createIndex({ userId: 1 }, { unique: true });
    await users.updateOne({ userId }, {
      $set: { isAdmin: true },
      $setOnInsert: { registeredAt: new Date() },
    }, { upsert: true });
    return true;
  } catch (error) {
    console.error('Error checking configured owner:', error);
    return false;
  }
}

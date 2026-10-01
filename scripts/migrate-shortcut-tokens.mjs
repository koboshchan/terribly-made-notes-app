import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';

// Run before deploying digest-only authentication. Requires a database backup.
// Existing shortcut secrets keep working until the new 90-day expiry.
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/notesapp');
try {
  await client.connect();
  const tokens = client.db('notesapp').collection('shortcut_tokens');
  await tokens.updateMany({}, { $unset: { dailyUploadLimit: '', dailyByteLimit: '' } });
  let migrated = 0;
  for await (const record of tokens.find({ token: { $type: 'string' } })) {
    const tokenDigest = createHash('sha256').update(record.token).digest('hex');
    await tokens.updateOne({ _id: record._id, token: record.token }, {
      $set: { tokenDigest, tokenPrefix: record.token.slice(0, 8), scopes: ['upload'], expiresAt: record.expiresAt || new Date(Date.now() + 90 * 86400000) },
      $unset: { token: '', dailyUploadLimit: '', dailyByteLimit: '' },
    });
    migrated++;
  }
  console.log(`Migrated ${migrated} shortcut tokens. Bearer secrets were not printed.`);
} finally { await client.close(); }

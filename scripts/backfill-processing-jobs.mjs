import { MongoClient, ObjectId } from 'mongodb';
import path from 'node:path';
import fs from 'node:fs';

// Run once against a backup before starting the new worker. Legacy processing
// jobs restart at normalization, because no reliable old stage was persisted.
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/notesapp');
try {
  await client.connect();
  const db = client.db('notesapp');
  const jobs = db.collection('processing_jobs');
  await jobs.createIndex({ id: 1 }, { unique: true });
  let queued = 0;
  for await (const note of db.collection('notes').find({ status: 'processing' })) {
    const noteId = String(note._id);
    const dir = path.resolve(process.env.DATA_DIR || './data', note.userId, noteId);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const original = files.find(name => /^original\.[a-z0-9]+$/i.test(name));
    if (!original) {
      await db.collection('notes').updateOne({ _id: new ObjectId(noteId) }, { $set: { status: 'error', error: 'Original audio missing after legacy job recovery. Upload the recording again.', updatedAt: new Date() } });
      continue;
    }
    await jobs.updateOne({ id: `${note.userId}_${noteId}` }, { $setOnInsert: { id: `${note.userId}_${noteId}`, userId: note.userId, noteId, originalPath: path.join(dir, original), mp3Path: path.join(dir, 'converted.mp3'), markdownPath: path.join(dir, 'output.md'), language: note.language || 'english', status: 'queued', currentStage: 'audioNormalization', stageStatus: 'waiting', progress: 0, addedAt: Date.now(), leaseUntil: new Date(0) } }, { upsert: true });
    queued++;
  }
  console.log(`Checked ${queued} recoverable legacy jobs.`);
} finally { await client.close(); }

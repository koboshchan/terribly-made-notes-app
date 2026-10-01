import { MongoClient, Db } from 'mongodb';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/notesapp';
let connection: Promise<{ client: MongoClient; db: Db }> | undefined;

export async function connectToDatabase() {
  if (!connection) {
    connection = (async () => {
      const client = new MongoClient(MONGODB_URI);
      try {
        await client.connect();
        const db = client.db('notesapp');
        await Promise.all([
          db.collection('notes').createIndex({ userId: 1, createdAt: -1, _id: -1 }),
          db.collection('notes').createIndex({ userId: 1, updatedAt: -1 }),
          db.collection('notes').createIndex({ userId: 1, recordedAt: -1, _id: -1 }),
          db.collection('notes').createIndex({ shareToken: 1 }, { sparse: true }),
          db.collection('shared_note_sets').createIndex({ shareToken: 1 }, { unique: true }),
          db.collection('shared_note_sets').createIndex({ userId: 1, createdAt: -1 }),
        ]);
        return { client, db };
      } catch (error) {
        await client.close().catch(() => {});
        connection = undefined;
        throw error;
      }
    })();
  }
  return connection;
}
export async function getCollection(name: string) {
  return (await connectToDatabase()).db.collection(name);
}

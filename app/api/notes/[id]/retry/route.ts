import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import path from 'path';
import { getCollection } from '@/lib/db';
import { getNoteDir, getFileExtension, fileExists, assertUserKeyActive } from '@/lib/storage';
import { processingQueue } from '@/lib/queue';
const extensions = new Set(['.audio', '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm', '.mp4']);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const { userId } = await auth();
    if (!/^[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await assertUserKeyActive(userId);
    const notesCollection = await getCollection('notes');
    const note = await notesCollection.findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    if (note.status !== 'error') {
      return NextResponse.json({ error: 'Note is not in error state' }, { status: 400 });
    }

    if (!note.originalFileName) {
      return NextResponse.json({ error: 'Original filename not recorded. Cannot retry.' }, { status: 400 });
    }

    // Set up file paths
    const noteDir = getNoteDir(userId, id);
    const fileExtension = getFileExtension(note.originalFileName);
    if (!extensions.has(fileExtension.toLowerCase())) return NextResponse.json({ error: 'Unsafe legacy audio filename' }, { status: 400 });
    const legacyPath = path.join(noteDir, `original${fileExtension}`);
    const safePath = path.join(noteDir, 'original.audio');
    const originalPath = fileExists(safePath) ? safePath : legacyPath;
    const mp3Path = path.join(noteDir, 'converted.mp3');
    const markdownPath = path.join(noteDir, 'output.md');

    // Check if the original file still exists
    if (!fileExists(originalPath)) {
      return NextResponse.json({ error: 'Original audio file not found on disk. Cannot retry.' }, { status: 400 });
    }

    // A single persisted job claim prevents duplicate retries and retains completed stages.
    const queueId = `${userId}_${id}`;
    const jobs = await getCollection('processing_jobs');
    const priorJob = await jobs.findOne({ id: queueId });
    const claimed = await notesCollection.updateOne({ _id: new ObjectId(id), userId, status: 'error' }, { $set: { status: 'processing', error: null, updatedAt: new Date() } });
    if (!claimed.modifiedCount) return NextResponse.json({ error: 'Retry already claimed' }, { status: 409 });
    try {
      if (priorJob) {
        if (!await processingQueue.retry(queueId)) throw new Error('Persisted retry already claimed');
      } else {
        await processingQueue.enqueue({ id: queueId, userId, noteId: id, originalPath, mp3Path, markdownPath, language: note.language || 'english' });
      }
    } catch (error) {
      await notesCollection.updateOne({ _id: new ObjectId(id), userId, status: 'processing' }, { $set: { status: 'error', error: 'Retry could not be queued', updatedAt: new Date() } });
      throw error;
    }

    return NextResponse.json({
      message: 'Note queued for reprocessing',
    });

  } catch (error) {
    console.error('Retry route error:', error);
    return NextResponse.json(
      { error: 'Failed to queue note for retry' },
      { status: 500 }
    );
  }
}

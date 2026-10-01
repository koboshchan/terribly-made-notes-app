import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';
import { processingQueue } from '@/lib/queue';
import { deleteDir, getNoteDir, saveFile } from '@/lib/storage';
import { boundedJson, RequestError } from '@/lib/request-limits';
import path from 'path';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const notesCollection = await getCollection('notes');
    const note = await notesCollection.findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    return NextResponse.json({
      _id: note._id.toString(),
      title: note.title,
      description: note.description,
      content: note.content,
      flashcards: note.flashcards || [],
      quizQuestions: note.quizQuestions || [],
      createdAt: note.createdAt,
      status: note.status,
      originalFileName: note.originalFileName,
      class: note.noteClass || null,
      error: note.error || null,
    });
  } catch (error) {
    console.error('Failed to fetch note:', error);
    return NextResponse.json(
      { error: 'Failed to fetch note' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const notesCollection = await getCollection('notes');
    const owned = await notesCollection.findOne({ _id: new ObjectId(id), userId });
    if (!owned) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    await processingQueue.cancel(`${userId}_${id}`);
    const result = await notesCollection.deleteOne({
      _id: new ObjectId(id),
      userId,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    // Delete associated files
    const noteDir = getNoteDir(userId, id);
    deleteDir(noteDir);

    return NextResponse.json({ message: 'Note deleted successfully' });
  } catch (error) {
    console.error('Failed to delete note:', error);
    return NextResponse.json(
      { error: 'Failed to delete note' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await boundedJson(request, 2 * 1024 * 1024);
    if (!/^[a-f0-9]{24}$/.test(id)) throw new RequestError('Invalid note ID');
    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const [field, max] of [['title', 255], ['content', 1048576]] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > max) throw new RequestError(`Invalid ${field}`);
        updates[field] = body[field];
      }
    }
    if (body.class !== undefined) {
      if (body.class !== null && (typeof body.class !== 'string' || body.class.length > 100)) throw new RequestError('Invalid class');
      updates.noteClass = body.class;
      updates.classificationSource = 'manual';
    }
    if (body.processingPreferences !== undefined) {
      const prefs = body.processingPreferences;
      if (!prefs || typeof prefs.flashcards !== 'boolean' || typeof prefs.quiz !== 'boolean') throw new RequestError('Invalid study preferences');
      updates.processingPreferences = { flashcards: prefs.flashcards, quiz: prefs.quiz };
    }
    if (Object.keys(updates).length === 1) throw new RequestError('No update fields provided');
    const notesCollection = await getCollection('notes');
    const owned = await notesCollection.findOne({ _id: new ObjectId(id), userId });
    if (!owned) throw new RequestError('Note not found', 404);
    if (owned.status === 'processing' && (body.content !== undefined || body.title !== undefined)) throw new RequestError('Wait until processing finishes before editing', 409);
    const result = await notesCollection.updateOne(
      { _id: new ObjectId(id), userId },
      { $set: updates }
    );
    if (updates.content !== undefined) saveFile(path.join(getNoteDir(userId, id), 'output.md'), updates.content);

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Note updated successfully' });
  } catch (error) {
    console.error('Failed to update note:', error);
    return NextResponse.json(
      { error: error instanceof RequestError ? error.message : 'Failed to update note' },
      { status: error instanceof RequestError ? error.status : 500 }
    );
  }
}

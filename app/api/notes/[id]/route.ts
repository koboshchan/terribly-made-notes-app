import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';
import { processingQueue } from '@/lib/queue';
import { deleteDir, getNoteDir } from '@/lib/storage';

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

    const body = await request.json();
    const { class: noteClass } = body; // Rename 'class' to 'noteClass' to avoid conflicts

    if (typeof noteClass === 'undefined') {
      return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
    }

    const notesCollection = await getCollection('notes');
    const result = await notesCollection.updateOne(
      {
        _id: new ObjectId(id),
        userId,
      },
      {
        $set: { noteClass: noteClass, classificationSource: 'manual' },
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Note updated successfully' });
  } catch (error) {
    console.error('Failed to update note:', error);
    return NextResponse.json(
      { error: 'Failed to update note' },
      { status: 500 }
    );
  }
}

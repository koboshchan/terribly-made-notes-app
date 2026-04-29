import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';

type SharedSet = {
  noteIds: ObjectId[];
};

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; noteId: string }> }
) {
  const { token, noteId } = await context.params;

  try {
    if (!ObjectId.isValid(noteId)) {
      return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
    }

    const noteObjectId = new ObjectId(noteId);
    const sharedNoteSetsCollection = await getCollection('shared_note_sets');
    const sharedSet = await sharedNoteSetsCollection.findOne({
      shareToken: token,
      shareEnabled: true,
      noteIds: noteObjectId,
    }) as SharedSet | null;

    if (!sharedSet) {
      return NextResponse.json({ error: 'Shared note not found' }, { status: 404 });
    }

    const notesCollection = await getCollection('notes');
    const note = await notesCollection.findOne({
      _id: noteObjectId,
      status: 'completed',
    });

    if (!note) {
      return NextResponse.json({ error: 'Shared note not found' }, { status: 404 });
    }

    return NextResponse.json({
      _id: String(note._id),
      title: note.title,
      description: note.description,
      content: note.content,
      createdAt: note.createdAt,
    });
  } catch (error) {
    console.error('Failed to fetch shared bulk note:', error);
    return NextResponse.json({ error: 'Failed to fetch shared bulk note' }, { status: 500 });
  }
}
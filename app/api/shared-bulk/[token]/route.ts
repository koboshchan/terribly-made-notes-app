import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';

type SharedSet = {
  noteIds: ObjectId[];
  shareEnabled?: boolean;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;

  try {
    const sharedNoteSetsCollection = await getCollection('shared_note_sets');
    const sharedSet = await sharedNoteSetsCollection.findOne({
      shareToken: token,
      shareEnabled: true,
    }) as SharedSet | null;

    if (!sharedSet || !Array.isArray(sharedSet.noteIds) || sharedSet.noteIds.length === 0) {
      return NextResponse.json({ error: 'Shared note set not found' }, { status: 404 });
    }

    const notesCollection = await getCollection('notes');
    const notes = await notesCollection
      .find({
        _id: { $in: sharedSet.noteIds },
        status: 'completed',
      })
      .project({ title: 1, description: 1, createdAt: 1 })
      .toArray();

    const noteMap = new Map(notes.map((note) => [String(note._id), note]));
    const orderedNotes = sharedSet.noteIds
      .map((id) => noteMap.get(String(id)))
      .filter(Boolean)
      .map((note: any) => ({
        _id: String(note._id),
        title: note.title,
        description: note.description,
        createdAt: note.createdAt,
      }));

    return NextResponse.json({ notes: orderedNotes });
  } catch (error) {
    console.error('Failed to fetch shared bulk notes:', error);
    return NextResponse.json({ error: 'Failed to fetch shared bulk notes' }, { status: 500 });
  }
}
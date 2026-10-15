import { NextRequest, NextResponse } from 'next/server';
import { getCollection } from '@/lib/db';
import { activeShareFilter } from '@/lib/share';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;

  try {
    const notesCollection = await getCollection('notes');
    const note = await notesCollection.findOne({
      shareToken: token,
      shareEnabled: true,
      ...activeShareFilter(),
      status: 'completed',
    });

    if (!note) {
      return NextResponse.json({ error: 'Shared note not found' }, { status: 404 });
    }

    return NextResponse.json({
      title: note.title,
      description: note.description,
      content: note.content,
      createdAt: note.createdAt,
      shareAllowChat: note.shareAllowChat === true,
    });
  } catch (error) {
    console.error('Failed to fetch shared note:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shared note' },
      { status: 500 }
    );
  }
}

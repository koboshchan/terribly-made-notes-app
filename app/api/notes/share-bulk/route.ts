import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getCollection } from '@/lib/db';

function buildBulkShareUrl(request: NextRequest, token: string) {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/shared/bulk/${token}`;
  }
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const origin = forwardedHost
    ? `${forwardedProto.split(',')[0].trim()}://${forwardedHost.split(',')[0].trim()}`
    : new URL(request.url).origin;
  return `${origin}/shared/bulk/${token}`;
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { noteIds } = await request.json();
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      return NextResponse.json({ error: 'At least one note ID is required' }, { status: 400 });
    }

    const uniqueIds = [...new Set(noteIds)].filter((id) => ObjectId.isValid(id));
    if (uniqueIds.length === 0) {
      return NextResponse.json({ error: 'No valid note IDs were provided' }, { status: 400 });
    }

    const noteObjectIds = uniqueIds.map((id) => new ObjectId(id));
    const notesCollection = await getCollection('notes');
    const completedNotes = await notesCollection
      .find({
        _id: { $in: noteObjectIds },
        userId,
        status: 'completed',
      })
      .project({ _id: 1 })
      .toArray();

    if (completedNotes.length === 0) {
      return NextResponse.json({ error: 'No completed notes found for sharing' }, { status: 400 });
    }

    const shareToken = crypto.randomBytes(24).toString('hex');
    const selectedIds = completedNotes.map((note) => note._id);

    const sharedNoteSetsCollection = await getCollection('shared_note_sets');
    await sharedNoteSetsCollection.insertOne({
      userId,
      shareToken,
      noteIds: selectedIds,
      shareEnabled: true,
      createdAt: new Date(),
      sharedAt: new Date(),
    });

    return NextResponse.json({
      shareUrl: buildBulkShareUrl(request, shareToken),
      noteCount: selectedIds.length,
    });
  } catch (error) {
    console.error('Failed to create bulk share link:', error);
    return NextResponse.json({ error: 'Failed to create bulk share link' }, { status: 500 });
  }
}
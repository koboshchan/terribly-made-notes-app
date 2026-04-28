import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getCollection } from '@/lib/db';

function buildShareUrl(request: NextRequest, token: string) {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/shared/${token}`;
  }
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const origin = forwardedHost
    ? `${forwardedProto.split(',')[0].trim()}://${forwardedHost.split(',')[0].trim()}`
    : new URL(request.url).origin;
  return `${origin}/shared/${token}`;
}

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

    if (!note.shareToken || note.shareEnabled !== true) {
      return NextResponse.json({ shareUrl: null });
    }

    return NextResponse.json({
      shareUrl: buildShareUrl(request, note.shareToken),
    });
  } catch (error) {
    console.error('Failed to fetch share link:', error);
    return NextResponse.json(
      { error: 'Failed to fetch share link' },
      { status: 500 }
    );
  }
}

export async function POST(
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

    if (note.status !== 'completed') {
      return NextResponse.json(
        { error: 'Only completed notes can be shared' },
        { status: 400 }
      );
    }

    if (note.shareToken && note.shareEnabled === true) {
      return NextResponse.json({
        shareUrl: buildShareUrl(request, note.shareToken),
      });
    }

    const shareToken = crypto.randomBytes(24).toString('hex');
    await notesCollection.updateOne(
      { _id: new ObjectId(id), userId },
      {
        $set: {
          shareToken,
          shareEnabled: true,
          sharedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      shareUrl: buildShareUrl(request, shareToken),
    });
  } catch (error) {
    console.error('Failed to create share link:', error);
    return NextResponse.json(
      { error: 'Failed to create share link' },
      { status: 500 }
    );
  }
}

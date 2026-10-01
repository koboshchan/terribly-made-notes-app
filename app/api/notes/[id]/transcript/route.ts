import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getNoteDir, fileExists, readFile, saveFile } from '@/lib/storage';
import path from 'path';
import { getCollection } from '@/lib/db';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
    const note = await (await getCollection('notes')).findOne({ _id: new ObjectId(id), userId });
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    // Authorization and canonical ID validation precede all disk operations.
    const directory = path.resolve(getNoteDir(userId, id));
    const transcriptPath = path.resolve(directory, 'output.txt');
    if (path.dirname(transcriptPath) !== directory) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    if (!fileExists(transcriptPath)) saveFile(transcriptPath, note.content || '');
    const transcript = readFile(transcriptPath).toString('utf8');
    return new NextResponse(transcript, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="transcript-${id}.txt"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Failed to fetch transcript:', error);
    return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 });
  }
}

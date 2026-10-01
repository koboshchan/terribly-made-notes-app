import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getNoteDir, fileExists, readFile, saveFile } from '@/lib/storage';
import path from 'path';
import { getCollection } from '@/lib/db';
import { boundedJson, RequestError } from '@/lib/request-limits';

type Context = { params: Promise<{ id: string }> };
async function transcriptAccess(context: Context) {
  const { userId } = await auth();
  if (!userId) throw new RequestError('Unauthorized', 401);
  const { id } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(id)) throw new RequestError('Invalid note ID');
  const notes = await getCollection('notes');
  const filter = { _id: new ObjectId(id), userId };
  const note = await notes.findOne(filter);
  if (!note) throw new RequestError('Note not found', 404);
  const directory = path.resolve(getNoteDir(userId, id));
  const transcriptPath = path.resolve(directory, 'output.txt');
  if (path.dirname(transcriptPath) !== directory) throw new RequestError('Invalid path');
  return { id, note, notes, filter, transcriptPath };
}
function failure(error: unknown) {
  console.error('Transcript request failed:', error);
  return NextResponse.json({ error: error instanceof RequestError ? error.message : 'Transcript request failed' }, { status: error instanceof RequestError ? error.status : 500 });
}
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id, note, transcriptPath } = await transcriptAccess(context);
    if (!fileExists(transcriptPath)) throw new RequestError('Original transcript is unavailable. The AI summary is not a transcript.', 404);
    const transcript = readFile(transcriptPath).toString('utf8');
    return new NextResponse(transcript, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="transcript-${id}.txt"`, 'Cache-Control': 'private, no-store', 'Last-Modified': new Date(note.transcriptUpdatedAt || note.updatedAt || note.createdAt).toUTCString() } });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { note, notes, filter, transcriptPath } = await transcriptAccess(context);
    if (note.status === 'processing') throw new RequestError('Wait until processing finishes before correcting the transcript', 409);
    const { transcript } = await boundedJson(request, 2 * 1024 * 1024);
    if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 1024 * 1024) throw new RequestError('Transcript must be 1 to 1048576 characters');
    saveFile(transcriptPath, transcript);
    await notes.updateOne(filter, { $set: { transcriptUpdatedAt: new Date(), updatedAt: new Date() } });
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}

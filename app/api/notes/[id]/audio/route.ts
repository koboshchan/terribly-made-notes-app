import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { Readable } from 'node:stream';
import path from 'node:path';
import { getCollection } from '@/lib/db';
import { getNoteDir, openFileStream } from '@/lib/storage';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
    if (!await (await getCollection('notes')).findOne({ _id: new ObjectId(id), userId })) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const file = path.join(getNoteDir(userId, id), 'converted.mp3');
    let opened = await openFileStream(file);
    let start = 0, end = opened.length - 1, status = 200;
    const range = request.headers.get('range');
    if (range) {
      opened.stream.destroy();
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]) || !opened.length) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${opened.length}` } });
      if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${opened.length}` } }); start = Math.max(0, opened.length - suffix); }
      else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= opened.length) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${opened.length}` } });
      opened = await openFileStream(file, start, end); status = 206;
    }
    const headers: Record<string, string> = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Content-Length': String(Math.max(0, end - start + 1)), 'Content-Disposition': 'inline' };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${opened.length}`;
    return new NextResponse(Readable.toWeb(opened.stream) as ReadableStream<Uint8Array>, { status, headers });
  } catch { return NextResponse.json({ error: 'Audio unavailable' }, { status: 404 }); }
}

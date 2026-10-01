import { NextRequest, NextResponse } from 'next/server';
import { getCollection } from '@/lib/db';
import { parseUpload, acceptUpload } from '@/lib/upload';
import { RequestError } from '@/lib/request-limits';

export async function PUT(request: NextRequest) {
  try {
    const header = request.headers.get('authorization');
    if (!header?.startsWith('Bearer ')) return NextResponse.json({ error: 'Bearer token required' }, { status: 401 });
    const tokens = await getCollection('shortcut_tokens');
    const token = await tokens.findOne({ token: header.slice(7).trim(), isActive: true });
    if (!token) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    await tokens.updateOne({ _id: token._id }, { $set: { lastUsed: new Date() } });
    const result = await acceptUpload(token.userId, await parseUpload(request, true), 'Apple Shortcut', request.headers.get('idempotency-key'));
    return NextResponse.json({ ...result, success: true, message: 'Recording queued for processing' });
  } catch (error) {
    console.error('Shortcut upload error:', error);
    return NextResponse.json({ error: error instanceof RequestError ? error.message : 'Upload failed' }, { status: error instanceof RequestError ? error.status : 500 });
  }
}

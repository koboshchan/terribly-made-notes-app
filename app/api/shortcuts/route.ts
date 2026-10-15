import { NextRequest, NextResponse } from 'next/server';
import { getCollection } from '@/lib/db';
import { parseUpload, acceptUpload } from '@/lib/upload';
import { RequestError } from '@/lib/request-limits';
import { tokenDigest } from '@/lib/shortcut-tokens';

import { getRuntimeSettings } from '@/lib/runtime-settings';

export async function PUT(request: NextRequest) {
  try {
    const header = request.headers.get('authorization');
    if (!header?.startsWith('Bearer ')) return NextResponse.json({ error: 'Bearer token required' }, { status: 401 });
    const tokens = await getCollection('shortcut_tokens');
    const secret = header.slice(7).trim();
    if (!/^[a-f0-9]{64}$/.test(secret)) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    const token = await tokens.findOne({ tokenDigest: tokenDigest(secret), isActive: true, scopes: 'upload', expiresAt: { $gt: new Date() } });
    if (!token) return NextResponse.json({ error: 'Token invalid, expired, or missing upload scope' }, { status: 401 });
    const runtime = await getRuntimeSettings();
    const upload = await parseUpload(request, true, runtime);
    const result = await acceptUpload(token.userId, upload, 'Apple Shortcut', request.headers.get('idempotency-key'), runtime);
    await tokens.updateOne({ _id: token._id }, { $set: { lastUsed: new Date() } });
    return NextResponse.json({ ...result, success: true, message: 'Recording queued for processing' });
  } catch (error) {
    console.error('Shortcut upload error:', error);
    return NextResponse.json({ error: error instanceof RequestError ? error.message : 'Upload failed' }, { status: error instanceof RequestError ? error.status : 500 });
  }
}

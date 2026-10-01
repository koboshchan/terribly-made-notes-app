import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { parseUpload, acceptUpload } from '@/lib/upload';
import { RequestError } from '@/lib/request-limits';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const result = await acceptUpload(userId, await parseUpload(request), undefined, request.headers.get('idempotency-key'));
    return NextResponse.json({ ...result, message: 'File uploaded successfully and queued for processing' });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: error instanceof RequestError ? error.message : 'Failed to upload file' }, { status: error instanceof RequestError ? error.status : 500 });
  }
}

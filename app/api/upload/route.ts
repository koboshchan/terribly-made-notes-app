import { NextRequest, NextResponse } from 'next/server';
import { uploadUserId } from '@/lib/upload-auth';
import { parseUpload, acceptUpload } from '@/lib/upload';
import { RequestError } from '@/lib/request-limits';
import { getRuntimeSettings } from '@/lib/runtime-settings';

export async function POST(request: NextRequest) {
  try {
    const userId = await uploadUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const runtime = await getRuntimeSettings();
    const result = await acceptUpload(userId, await parseUpload(request, false, runtime), undefined, request.headers.get('idempotency-key'), runtime);
    return NextResponse.json({ ...result, message: 'File uploaded successfully and queued for processing' });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: error instanceof RequestError ? error.message : 'Failed to upload file' }, { status: error instanceof RequestError ? error.status : 500 });
  }
}

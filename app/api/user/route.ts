import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { cleanupAccountData, destroyAccountKey } from '@/lib/account-deletion';

export const runtime = 'nodejs';

function allowedDeletionOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  if (origin !== null) return origin === expected;
  // Native session bearer calls have no Origin. A browser cookie request must
  // provide the exact same Origin, even if it also happens to contain a bearer.
  return !request.headers.has('cookie') && /^Bearer\s+\S+$/i.test(request.headers.get('authorization') || '');
}

export async function DELETE(request: Request) {
  try {
    if (!allowedDeletionOrigin(request)) {
      return NextResponse.json({ error: 'Account deletion requires a same-origin request' }, { status: 403 });
    }
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // If this fails, do not delete the Clerk user or acknowledge account deletion.
    await destroyAccountKey(userId);
    let identityDeleted = false;
    try {
      await (await clerkClient()).users.deleteUser(userId);
      identityDeleted = true;
    } catch (error) {
      // A repeated deletion may race a signed user.deleted delivery.
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) {
        identityDeleted = true;
      } else {
        console.error('Account identity deletion pending');
      }
    }

    // Even when Clerk is unavailable, the requested key destruction is permanent
    // and local cleanup proceeds. A failed identity deletion remains retryable.
    const cleanup = await cleanupAccountData(userId);
    if (!identityDeleted) {
      return NextResponse.json({ error: 'File key destroyed. Account identity deletion is pending; retry deletion.', cleanupPending: !cleanup.complete }, { status: 503 });
    }
    return NextResponse.json({ deleted: true, cleanupPending: !cleanup.complete }, { status: cleanup.complete ? 200 : 202, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('Account deletion could not complete');
    return NextResponse.json({ error: 'Account deletion could not complete; retry deletion' }, { status: 503 });
  }
}

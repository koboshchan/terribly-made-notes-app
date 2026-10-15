import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { NextRequest, NextResponse } from 'next/server';
import { handleDeletedAccount } from '@/lib/account-deletion';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    // Never accept an unsigned event, including in development.
    return NextResponse.json({ error: 'Webhook verification is not configured' }, { status: 503 });
  }

  let event;
  try {
    // Clerk verifies the original raw body and signed Svix timestamp/headers.
    // Do not call request.json() or reserialize before signature verification.
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }
  if (event.type !== 'user.deleted') return NextResponse.json({ received: true });
  const userId = event.data.id;
  if (!userId || !/^[A-Za-z0-9_-]{1,256}$/.test(userId)) {
    return NextResponse.json({ error: 'Invalid deleted account identifier' }, { status: 400 });
  }

  try {
    const cleanup = await handleDeletedAccount(userId);
    if (!cleanup.complete) {
      // Request a retry, including after an earlier attempt destroyed the key.
      return NextResponse.json({ error: 'Account cleanup pending' }, { status: 503 });
    }
    return NextResponse.json({ received: true });
  } catch {
    console.error('Deleted account webhook cleanup pending');
    return NextResponse.json({ error: 'Account cleanup pending' }, { status: 503 });
  }
}

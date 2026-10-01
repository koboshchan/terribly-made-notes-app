import { clerkClient } from '@clerk/nextjs/server';
import { isUserAdmin } from './admin';

// Upload routes bypass Next proxy/middleware so it cannot clone entire large
// bodies into memory. Authenticate headers/cookies directly, never trust IDs
// supplied by the caller. authenticateRequest only accepts session tokens here.
export async function uploadUserId(request: Request): Promise<string | null> {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  const expectedOrigin = origin ? new URL(origin).origin : new URL(request.url).origin;
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && requestOrigin !== expectedOrigin) return null;
  const state = await (await clerkClient()).authenticateRequest(request, {
    acceptsToken: 'session_token',
    ...(origin ? { authorizedParties: [new URL(origin).origin] } : {}),
  });
  const userId = state.toAuth()?.userId || null;
  if (userId) await isUserAdmin(userId);
  return userId;
}

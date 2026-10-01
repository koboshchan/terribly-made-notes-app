import { clerkMiddleware } from '@clerk/nextjs/server'
import { isUserAdmin } from './lib/admin'

export default clerkMiddleware(async (auth) => {
  const { userId } = await auth();
  // Upload APIs authenticate directly to avoid cloning large bodies in proxy.
  if (userId) await isUserAdmin(userId);
})

export const config = {
  matcher: [
    '/((?!api/(?:upload|shortcuts)(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/trpc/:path*',
  ],
}

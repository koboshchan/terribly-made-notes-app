import { clerkMiddleware } from '@clerk/nextjs/server'
import { isUserAdmin } from './lib/admin'

export default clerkMiddleware(async (auth) => {
  const { userId } = await auth();
  // Initialize the default on the first signed-in request, including native
  // API clients. Admin routes still perform their own live authorization check.
  if (userId) await isUserAdmin(userId);
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/api/:path*',
    '/trpc/:path*',
  ],
}
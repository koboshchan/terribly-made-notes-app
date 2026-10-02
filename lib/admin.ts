import { clerkClient } from '@clerk/nextjs/server';

// Clerk private metadata is the live source of truth, matching cal's admin check.
// Never trust registration order, session claims, or cached Mongo admin flags.
export async function isUserAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    // Match cal: initialize only a missing key, preserving all other metadata
    // and never overwriting an admin value already set manually in Clerk.
    if (user.privateMetadata?.admin === undefined) {
      await client.users.updateUserMetadata(userId, {
        privateMetadata: { ...user.privateMetadata, admin: false },
      });
      return false;
    }
    return user.privateMetadata.admin === true;
  } catch (error) {
    console.error('Error checking Clerk admin metadata:', error);
    return false;
  }
}

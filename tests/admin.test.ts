import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUser, updateUserMetadata, client } = vi.hoisted(() => {
  const getUser = vi.fn();
  const updateUserMetadata = vi.fn();
  return { getUser, updateUserMetadata, client: vi.fn(async () => ({ users: { getUser, updateUserMetadata } })) };
});
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: client }));
import { isUserAdmin } from '../lib/admin';

beforeEach(() => {
  vi.clearAllMocks();
  client.mockResolvedValue({ users: { getUser, updateUserMetadata } });
  updateUserMetadata.mockResolvedValue({});
});

describe('Clerk private admin metadata', () => {
  it('grants only a boolean true and uses the requested Clerk identity', async () => {
    getUser.mockResolvedValue({ privateMetadata: { admin: true } });
    expect(await isUserAdmin('user_owner')).toBe(true);
    expect(getUser).toHaveBeenCalledWith('user_owner');
  });

  it.each([undefined, {}, { admin: false }, { admin: 'true' }, { admin: 1 }])(
    'denies missing or non-boolean admin metadata %j', async (privateMetadata) => {
      getUser.mockResolvedValue({ privateMetadata, publicMetadata: { admin: true } });
      expect(await isUserAdmin('user_other')).toBe(false);
    },
  );

  it('initializes a missing admin to false while preserving unrelated metadata', async () => {
    getUser.mockResolvedValue({ privateMetadata: { theme: 'dark' } });
    expect(await isUserAdmin('user_new')).toBe(false);
    expect(updateUserMetadata).toHaveBeenCalledWith('user_new', {
      privateMetadata: { theme: 'dark', admin: false },
    });
  });

  it.each([false, true, 'true', null])('never resets an existing admin value %j', async (admin) => {
    getUser.mockResolvedValue({ privateMetadata: { admin } });
    expect(await isUserAdmin('user_existing')).toBe(admin === true);
    expect(updateUserMetadata).not.toHaveBeenCalled();
  });

  it('denies access if default initialization fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUser.mockResolvedValue({ privateMetadata: {} });
    updateUserMetadata.mockRejectedValueOnce(new Error('Unavailable'));
    expect(await isUserAdmin('user_new')).toBe(false);
    log.mockRestore();
  });

  it('reads metadata again so revocation is not cached', async () => {
    getUser.mockResolvedValueOnce({ privateMetadata: { admin: true } })
      .mockResolvedValueOnce({ privateMetadata: { admin: false } });
    expect(await isUserAdmin('user_owner')).toBe(true);
    expect(await isUserAdmin('user_owner')).toBe(false);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('denies an empty identity without calling Clerk', async () => {
    expect(await isUserAdmin('')).toBe(false);
    expect(client).not.toHaveBeenCalled();
  });

  it('fails closed when Clerk is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUser.mockRejectedValueOnce(new Error('Unavailable'));
    expect(await isUserAdmin('user_owner')).toBe(false);
    client.mockRejectedValueOnce(new Error('Unavailable'));
    expect(await isUserAdmin('user_owner')).toBe(false);
    log.mockRestore();
  });
});

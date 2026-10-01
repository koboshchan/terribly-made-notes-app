import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUser, client } = vi.hoisted(() => {
  const getUser = vi.fn();
  return { getUser, client: vi.fn(async () => ({ users: { getUser } })) };
});
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: client }));
import { isUserAdmin } from '../lib/admin';

beforeEach(() => {
  vi.clearAllMocks();
  client.mockResolvedValue({ users: { getUser } });
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

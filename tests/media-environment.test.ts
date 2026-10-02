import { describe, expect, it } from 'vitest';
import { mediaEnvironment } from '../lib/media-environment';

describe('media parser environment', () => {
  it('keeps lookup and locale settings without deployment secrets', () => {
    const env = mediaEnvironment({ PATH: '/usr/bin', LANG: 'C.UTF-8', TMPDIR: '/tmp', FILE_ENCRYPTION_MASTER_KEY: 'secret', CLERK_SECRET_KEY: 'secret', MONGODB_URI: 'secret', PROVIDER_API_KEY: 'secret' });
    expect(env).toEqual({ NODE_ENV: 'production', PATH: '/usr/bin', LANG: 'C.UTF-8', TMPDIR: '/tmp' });
    expect(env).not.toHaveProperty('FILE_ENCRYPTION_MASTER_KEY');
  });
  it('returns a separate map so parser options cannot mutate the parent environment', () => {
    const original = { PATH: '/usr/bin' };
    const env = mediaEnvironment(original);
    env.PATH = '/elsewhere';
    expect(original.PATH).toBe('/usr/bin');
  });
});

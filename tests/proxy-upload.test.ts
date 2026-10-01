import { describe, expect, it } from 'vitest';
import { unstable_doesMiddlewareMatch as matches } from 'next/experimental/testing/server';
import { config } from '../proxy';
describe('streaming upload proxy exclusions', () => {
  it('does not clone upload or shortcut request bodies', () => {
    expect(matches({ config, url: '/api/upload' })).toBe(false);
    expect(matches({ config, url: '/api/shortcuts' })).toBe(false);
  });
  it('keeps auth middleware on other API routes and pages', () => {
    expect(matches({ config, url: '/api/admin/models' })).toBe(true);
    expect(matches({ config, url: '/api/notes' })).toBe(true);
    expect(matches({ config, url: '/note/example' })).toBe(true);
  });
});

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

// Missing assets can render the authenticated root layout's not-found page.
describe('favicon not-found authentication', () => {
  it('runs Clerk on favicon requests that can fall through to the root layout', () => {
    expect(matches({ config, url: '/favicon.ico' })).toBe(true);
    expect(matches({ config, url: '/favicon.ico?cache=1' })).toBe(true);
  });
  it('still excludes generated static files and image optimization', () => {
    expect(matches({ config, url: '/_next/static/chunks/example.js' })).toBe(false);
    expect(matches({ config, url: '/_next/image?url=%2Fposter.png&w=640&q=75' })).toBe(false);
  });
});

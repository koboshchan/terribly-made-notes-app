import { describe, it, expect, beforeAll } from 'vitest';
import { renderMarkdown, setupMarkdownRenderer, sanitizeHtml } from '../lib/markdown';

beforeAll(async () => { await setupMarkdownRenderer(); });

describe('renderMarkdown sanitization', () => {
  it('strips script tags', () => {
    expect(renderMarkdown('hi <script>alert(1)</script>')).not.toMatch(/<script/i);
  });
  it('strips event handlers', () => {
    const out = renderMarkdown('<img src="x" onerror="alert(1)"><div onclick="x()">a</div><svg onload=alert(1)>');
    expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i);
    expect(out).toContain('src="x"');
  });
  it('removes javascript: and data: links', () => {
    const out = renderMarkdown('[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](data:text/html,<script>x</script>) <a href=" vbscript:x">d</a> <img src="javascript:x">');
    expect(out).not.toMatch(/javascript:|vbscript:|data:text/i);
  });
  it('removes iframes, forms, styles', () => {
    const out = renderMarkdown('<iframe src="https://evil"></iframe><form action="x"><input></form><style>*{}</style>');
    expect(out).not.toMatch(/<iframe|<form|<input|<style/i);
  });
  it('keeps safe links with rel noopener', () => {
    const out = renderMarkdown('[ok](https://example.com) [rel](/note/1)');
    expect(out).toContain('href="https://example.com"');
    expect(out).toMatch(/rel="noopener noreferrer nofollow"/);
    expect(out).toContain('href="/note/1"');
  });
  it('preserves KaTeX output', () => {
    const out = renderMarkdown('Energy $E=mc^2$ and $$\\frac{1}{2}mv^2$$');
    expect(out).toContain('class="katex');
    expect(out).toMatch(/style="[^"]*height/);
  });
  it('sanitizeHtml is idempotent on safe html', () => {
    expect(sanitizeHtml('<p><strong>x</strong></p>')).toBe('<p><strong>x</strong></p>');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) => readFileSync(join(__dirname, '..', 'app', f), 'utf8');

describe('frontend regression guards (source level)', () => {
  const upload = src('new/page.tsx');
  it('upload polling handles persisted error status and shows provider error', () => {
    expect(upload).toContain("status === 'error'");
    expect(upload).toContain('progress.error');
  });
  it('upload polling is cancelled on unmount/reset and guarded after awaits', () => {
    expect(upload).toContain('unmounted.current = true');
    expect(upload).toContain('pollGeneration');
    expect(upload).toMatch(/resetUpload = \(\) => \{\s*stopPolling\(\)/);
    expect(upload).not.toMatch(/setTimeout\(\(\) => pollProgress/);
  });
  it('upload accepts audio with empty MIME via extension and guards bad JSON', () => {
    expect(upload).toContain('m4a');
    expect(upload).toContain('unexpected server response');
    expect(upload).toContain('setUploadError(msg)');
    expect(upload).toContain('slice(0, 300)');
  });
  it('upload surfaces server error text and never hangs on bad responses', () => {
    expect(upload).toContain("typeof result.error === 'string'");
    expect(upload).toContain('unexpected server response');
    expect(upload).not.toContain("alert('Upload failed");
  });
  it('quiz locks answers and tolerates missing wrongAnswers', () => {
    const quiz = src('note/[id]/quiz/page.tsx');
    expect(quiz).toContain('if (selectedAnswer !== null) return;');
    expect(quiz).not.toContain('...q.wrongAnswers.map');
  });
  it('flashcard flip is keyboard accessible', () => {
    const fc = src('note/[id]/flashcards/page.tsx');
    expect(fc).toContain('role="button"');
    expect(fc).toContain('onKeyDown');
  });
  it('chat inputs ignore IME composition Enter and avoid onKeyPress', () => {
    for (const f of ['note/[id]/chat/page.tsx', 'chat-multi/page.tsx']) {
      const s = src(f);
      expect(s).toContain('isComposing');
      expect(s).not.toContain('onKeyPress');
    }
  });
  it('note chat preview uses matchMedia not window.innerWidth at render', () => {
    const s = src('note/[id]/chat/page.tsx');
    expect(s).toContain('matchMedia');
    expect(s).not.toContain('window.innerWidth');
  });
  it('settings guards non-array responses', () => {
    const s = src('settings/page.tsx');
    expect(s).toContain('setClasses(Array.isArray(data)');
    expect(s).toContain('setShortcutTokens(Array.isArray(data)');
  });
  it('effects do not poll without a dependency guard', () => {
    // the only unconditional intervals are status-gated in note/[id]/page.tsx
    const note = src('note/[id]/page.tsx');
    expect(note).toMatch(/note\.status === 'processing' \|\| note\.status === 'queued'/);
  });
  it('shared bulk Download All shows a visible error when a fetch fails', () => {
    const bulk = src('shared/bulk/[token]/page.tsx');
    expect(bulk).toContain('setDownloadError(');
    expect(bulk).toMatch(/role="alert">\{downloadError\}/);
  });
  it('download filenames keep non-Latin letters instead of collapsing to underscores', () => {
    const files = ['note/[id]/page.tsx', 'note/[id]/quiz/page.tsx', 'note/[id]/flashcards/page.tsx', 'shared/[token]/page.tsx', 'shared/bulk/[token]/page.tsx', 'shared/bulk/[token]/note/[noteId]/page.tsx'];
    for (const f of files) {
      const text = src(f);
      expect(text, f).toContain('[^\\p{L}\\p{N}]');
      expect(text, f).not.toContain('[^a-z0-9]');
    }
    expect('测试 笔记!'.replace(/[^\p{L}\p{N}]/gu, '_')).toBe('测试_笔记_');
  });
});

describe('keyboard and label accessibility guards (source level)', () => {
  it('upload drop zone is keyboard operable without double-firing the picker', () => {
    const upload = src('new/page.tsx');
    expect(upload).toContain('role="button"');
    expect(upload).toContain('tabIndex={0}');
    expect(upload).toContain("e.key === 'Enter' || e.key === ' '");
    expect(upload).toContain('e.target !== e.currentTarget');
    expect(upload).toContain('e.stopPropagation()');
    expect(upload).toContain('htmlFor="upload-language"');
    expect(upload).toContain('id="upload-language"');
  });
  it.each(['settings/page.tsx', 'admin/models/page.tsx'])('%s form labels are associated with controls', (f) => {
    const s = src(f);
    expect(s).not.toMatch(/<label className="form-label">/);
    const fors = [...s.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]);
    for (const id of new Set(fors)) expect(s).toContain('id="' + id + '"');
  });
});

describe('shared bulk chat IME guard', () => {
  it('does not send on Enter while composing', () => {
    expect(src('shared/bulk/[token]/chat/page.tsx')).toContain("e.key === 'Enter' && !e.nativeEvent.isComposing");
  });
});


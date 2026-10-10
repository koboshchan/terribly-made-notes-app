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
});

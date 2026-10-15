// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }));
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/app/components/ShareControls', () => ({ BulkShareManager: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('settings token dialog runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      const json = (b: unknown) => ({ ok: true, json: async () => b });
      if (String(url).includes('shortcut-tokens') && init?.method === 'POST') return json({ token: 'tok_secret_123' });
      return json([]);
    }));
  });
  it('renders settings and opens a focus-trapped dialog that closes on Escape and restores focus', async () => {
    const { default: Page } = await import('@/app/settings/page');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(React.createElement(Page)); });
    await flush();
    const nameInput = el.querySelector('#settings-field-3') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(nameInput, 'My shortcut'); nameInput.dispatchEvent(new Event('input', { bubbles: true })); });
    const create = Array.from(el.querySelectorAll('button')).find((b) => /create token/i.test(b.textContent || ''))!;
    create.focus();
    await act(async () => { create.click(); });
    await flush();
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg).toBeTruthy();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)?.textContent).toMatch(/Token created/);
    expect(dlg.contains(document.activeElement)).toBe(true);
    const btns = dlg.querySelectorAll('button');
    (btns[btns.length - 1] as HTMLElement).focus();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(btns[0]);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await new Promise((r) => setTimeout(r, 5));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector("#settings-field-3"));
    await act(async () => { root.unmount(); });
  });
});

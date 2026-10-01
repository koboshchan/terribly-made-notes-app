// Device-local persistence for study/chat progress (localStorage, per note).
// Safe to call during SSR; silently no-ops when storage is unavailable.

const PREFIX = 'notes:progress:v1:';

export function loadProgress<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveProgress<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // quota exceeded or storage disabled
  }
}

export function clearProgress(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Keep stored chats bounded so localStorage never fills up. */
export function trimChat<T>(messages: T[], max = 60): T[] {
  return messages.length > max ? messages.slice(messages.length - max) : messages;
}

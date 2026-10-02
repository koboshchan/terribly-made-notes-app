// Device-local persistence for study/chat progress (localStorage).
// Keys are namespaced by Clerk userId so one account never sees another's
// progress on a shared browser. Safe during SSR; no-ops when storage is unavailable.

const PREFIX = 'notes:progress:v2:';
const MAX_RAW_CHARS = 200_000;

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = window.localStorage;
    return s ?? null;
  } catch {
    return null; // access can throw (privacy mode, sandboxed iframes)
  }
}

function fullKey(userId: string | null | undefined, key: string): string | null {
  if (!userId) return null; // never persist without a known user
  return `${PREFIX}${encodeURIComponent(userId)}:${key}`;
}

let purged = false;

export function loadProgress<T>(userId: string | null | undefined, key: string): T | null {
  if (!purged) {
    purged = true;
    purgeLegacyProgress();
  }
  const s = storage();
  const k = fullKey(userId, key);
  if (!s || !k) return null;
  try {
    const raw = s.getItem(k);
    if (!raw) return null;
    if (raw.length > MAX_RAW_CHARS) {
      s.removeItem(k);
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveProgress<T>(userId: string | null | undefined, key: string, value: T): void {
  const s = storage();
  const k = fullKey(userId, key);
  if (!s || !k) return;
  try {
    const raw = JSON.stringify(value);
    if (raw.length > MAX_RAW_CHARS) return;
    s.setItem(k, raw);
  } catch {
    // quota exceeded or storage disabled
  }
}

export function clearProgress(userId: string | null | undefined, key: string): void {
  const s = storage();
  const k = fullKey(userId, key);
  if (!s || !k) return;
  try {
    s.removeItem(k);
  } catch {
    // ignore
  }
}

/** Remove legacy un-namespaced (v1) entries that could leak across accounts. */
export function purgeLegacyProgress(): void {
  const s = storage();
  if (!s) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith('notes:progress:v1:')) stale.push(k);
    }
    stale.forEach((k) => s.removeItem(k));
  } catch {
    // ignore
  }
}

/** Keep stored chats bounded so localStorage never fills up. */
export function trimChat<T>(messages: T[], max = 60): T[] {
  return messages.length > max ? messages.slice(messages.length - max) : messages;
}

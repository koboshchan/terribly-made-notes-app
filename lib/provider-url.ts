// Exact provider base URLs are trusted deployment configuration. Internal endpoints
// are only reachable if the operator explicitly adds them to this allowlist.
export function allowedProviderUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const normalize = (raw: string) => {
      const url = new URL(raw);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid provider URL');
      return url.href.replace(/\/+$/, '');
    };
    const candidate = normalize(value);
    const allowlist = (process.env.PROVIDER_BASE_URL_ALLOWLIST || '').split(',').map(v => v.trim()).filter(Boolean).map(normalize);
    return allowlist.includes(candidate) ? candidate : null;
  } catch { return null; }
}

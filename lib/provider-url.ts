const DEFAULT_ALLOWED_PROVIDERS = [
  'https://api.openai.com/v1',
  'https://generativelanguage.googleapis.com/v1beta/openai',
  'https://api.groq.com/openai/v1',
  'https://api.anthropic.com/v1',
];

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
    const envValue = process.env.PROVIDER_BASE_URL_ALLOWLIST;
    const rawList = typeof envValue === 'string' && envValue.trim().length > 0
      ? envValue.split(',').map(v => v.trim()).filter(Boolean)
      : DEFAULT_ALLOWED_PROVIDERS;
    const allowlist = rawList.map(normalize);
    return allowlist.includes(candidate) ? candidate : null;
  } catch { return null; }
}

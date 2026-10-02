type ProcessEnv = Record<string, string | undefined>;

// Media parsers receive only process lookup and locale/temporary-directory settings.
// Never inherit wrapping keys, Clerk secrets, database credentials or provider tokens.
export function mediaEnvironment(source: ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'PATHEXT']) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  return env;
}

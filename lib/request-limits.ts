export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new RequestError('Request too large', 413);
  if (!request.body) throw new RequestError('Request body required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RequestError('Request too large', 413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

export async function boundedJson(request: Request, limit = 65536): Promise<any> {
  try { return JSON.parse(new TextDecoder().decode(await boundedBody(request, limit))); }
  catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('Invalid JSON');
  }
}

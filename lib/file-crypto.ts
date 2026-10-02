import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
const MAGIC = Buffer.from('NOTEGCM1');
const HEADER = 48, RECORD = 25;
export const DEFAULT_CHUNK_SIZE = 256 * 1024;
function nonce(prefix: Buffer, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) throw new Error('File nonce exhausted');
  const result = Buffer.alloc(12); prefix.copy(result); result.writeUInt32BE(index, 8); return result;
}
function seal(key: Buffer, iv: Buffer, aad: Buffer, data: Buffer) {
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
  return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}
function unseal(key: Buffer, iv: Buffer, aad: Buffer, data: Buffer) {
  if (data.length < 16) throw new Error('Truncated encrypted file');
  const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad); cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]);
}
async function exact(handle: Awaited<ReturnType<typeof open>>, length: number, position: number) {
  const buffer = Buffer.alloc(length); let offset = 0;
  while (offset < length) { const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset); if (!bytesRead) throw new Error('Truncated encrypted file'); offset += bytesRead; }
  return buffer;
}
export async function encryptToFile(source: AsyncIterable<Buffer>, destination: string, key: Buffer, binding: string, length: number, chunkSize = DEFAULT_CHUNK_SIZE, uniquePrefix: Buffer = randomBytes(8)) {
  if (!Number.isSafeInteger(length) || length < 0 || chunkSize < 65536 || chunkSize > 1048576 || !Number.isInteger(chunkSize) || Math.floor(length / chunkSize) + 1 > 0xffffffff) throw new Error('Unsupported file size');
  const handle = await open(destination, 'wx', 0o600);
  const header = Buffer.alloc(32); MAGIC.copy(header); header.writeUInt32BE(chunkSize, 8); header.writeBigUInt64BE(BigInt(length), 12);
  if (uniquePrefix.length !== 8) { await handle.close(); throw new Error('Invalid file nonce prefix'); }
  uniquePrefix.copy(header, 20);
  const prefix = header.subarray(20, 28), bind = Buffer.from(binding);
  const write = async (buffer: Buffer) => { let offset = 0; while (offset < buffer.length) { const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset); if (!bytesWritten) throw new Error('Encrypted write failed'); offset += bytesWritten; } };
  let index = 1, total = 0, pending = Buffer.alloc(0);
  const frame = async (data: Buffer, final: boolean) => {
    const record = Buffer.alloc(9); record.writeUInt32BE(index, 0); record.writeUInt32BE(data.length, 4); record[8] = final ? 1 : 0;
    await write(Buffer.concat([record, seal(key, nonce(prefix, index++), Buffer.concat([header, bind, record]), data)]));
  };
  try {
    await write(Buffer.concat([header, seal(key, nonce(prefix, 0), Buffer.concat([header, bind]), Buffer.alloc(0))]));
    for await (const piece of source) {
      total += piece.length; if (total > length) throw new Error('Source size changed');
      let cursor = 0;
      if (pending.length) { const count = Math.min(chunkSize - pending.length, piece.length); pending = Buffer.concat([pending, piece.subarray(0, count)]); cursor += count; if (pending.length === chunkSize) { await frame(pending, false); pending = Buffer.alloc(0); } }
      while (piece.length - cursor >= chunkSize) { await frame(piece.subarray(cursor, cursor + chunkSize), false); cursor += chunkSize; }
      if (cursor < piece.length) pending = Buffer.from(piece.subarray(cursor));
    }
    if (total !== length) throw new Error('Source size changed');
    await frame(pending, true); await handle.sync();
  } finally { await handle.close(); }
}
export async function inspectEncrypted(file: string, key: Buffer, binding: string) {
  const handle = await open(file, 'r');
  try {
    const all = await exact(handle, HEADER, 0), header = all.subarray(0, 32);
    if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Plaintext storage requires offline migration');
    unseal(key, nonce(header.subarray(20, 28), 0), Buffer.concat([header, Buffer.from(binding)]), all.subarray(32));
    const chunkSize = header.readUInt32BE(8), bigint = header.readBigUInt64BE(12);
    if (chunkSize < 65536 || chunkSize > 1048576 || bigint > BigInt(Number.MAX_SAFE_INTEGER) || header.readUInt32BE(28) !== 0) throw new Error('Corrupt file header');
    const length = Number(bigint), full = Math.floor(length / chunkSize);
    if (full + 1 > 0xffffffff) throw new Error('File nonce exhausted');
    const expected = HEADER + full * (chunkSize + RECORD) + (length % chunkSize) + RECORD;
    if (!Number.isSafeInteger(expected) || (await handle.stat()).size !== expected) throw new Error('Truncated or extended encrypted file');
    return { header: Buffer.from(header), chunkSize, length, full };
  } finally { await handle.close(); }
}
export async function* decryptFrames(file: string, key: Buffer, binding: string, start = 0, end?: number, check?: () => Promise<void>) {
  const info = await inspectEncrypted(file, key, binding); end ??= info.length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || (info.length ? end < start || end >= info.length : start !== 0 || end !== -1)) throw new Error('Invalid plaintext range');
  const handle = await open(file, 'r');
  const frame = async (number: number) => {
    await check?.();
    const size = number === info.full ? info.length % info.chunkSize : info.chunkSize;
    const record = await exact(handle, size + RECORD, HEADER + number * (info.chunkSize + RECORD));
    const meta = record.subarray(0, 9);
    if (meta.readUInt32BE(0) !== number + 1 || meta.readUInt32BE(4) !== size || meta[8] !== (number === info.full ? 1 : 0)) throw new Error('Corrupt encrypted frame');
    return unseal(key, nonce(info.header.subarray(20, 28), number + 1), Buffer.concat([info.header, Buffer.from(binding), meta]), record.subarray(9));
  };
  try {
    // Always authenticate terminal frame, even when only an earlier range is requested.
    await frame(info.full);
    if (!info.length) return;
    for (let i = Math.floor(start / info.chunkSize); i <= Math.floor(end / info.chunkSize); i++) {
      const data = await frame(i); yield data.subarray(Math.max(0, start - i * info.chunkSize), Math.min(data.length, end - i * info.chunkSize + 1));
    }
  } finally { await handle.close(); }
}
export function decryptedStream(file: string, key: Buffer, binding: string, start?: number, end?: number, check?: () => Promise<void>) { return Readable.from(decryptFrames(file, key, binding, start, end, check)); }
export async function sourceLength(file: string) { return (await stat(file)).size; }

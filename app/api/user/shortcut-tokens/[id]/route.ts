import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';
import { boundedJson, RequestError } from '@/lib/request-limits';
import { newShortcutSecret, shortcutExpiry } from '@/lib/shortcut-tokens';

type Context = { params: Promise<{ id: string }> };
async function ownerFilter(context: Context) {
  const { userId } = await auth();
  if (!userId) throw new RequestError('Unauthorized', 401);
  const { id } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(id)) throw new RequestError('Invalid token ID');
  return { _id: new ObjectId(id), userId };
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Token update failed' }, { status: error instanceof RequestError ? error.status : 400 });
}
export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const filter = await ownerFilter(context);
    const result = await (await getCollection('shortcut_tokens')).deleteOne(filter);
    if (!result.deletedCount) throw new RequestError('Token not found', 404);
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const filter = await ownerFilter(context);
    const { isActive } = await boundedJson(request, 8192);
    if (typeof isActive !== 'boolean') throw new RequestError('isActive must be a boolean');
    const result = await (await getCollection('shortcut_tokens')).updateOne(filter, { $set: { isActive, updatedAt: new Date() } });
    if (!result.matchedCount) throw new RequestError('Token not found', 404);
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const filter = await ownerFilter(context);
    const { expiresInDays = 90 } = await boundedJson(request, 8192);
    const expiresAt = shortcutExpiry(expiresInDays);
    const { token, ...secretFields } = newShortcutSecret();
    const result = await (await getCollection('shortcut_tokens')).findOneAndUpdate(filter, { $set: { ...secretFields, expiresAt, scopes: ['upload'], dailyUploadLimit: 20, dailyByteLimit: 512 * 1024 * 1024, isActive: true, updatedAt: new Date() }, $unset: { token: '' } }, { returnDocument: 'after', projection: { tokenDigest: 0, token: 0 } });
    if (!result) throw new RequestError('Token not found', 404);
    return NextResponse.json({ ...result, token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

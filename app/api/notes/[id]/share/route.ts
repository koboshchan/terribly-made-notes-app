import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'crypto';
import { getCollection } from '@/lib/db';
import { boundedJson, RequestError } from '@/lib/request-limits';

import { shareUrl, shareOptions } from '@/lib/share';

type Context = { params: Promise<{ id: string }> };
async function owned(context: Context) {
  const { userId } = await auth();
  if (!userId) throw new RequestError('Unauthorized', 401);
  const { id } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(id)) throw new RequestError('Invalid note ID');
  const collection = await getCollection('notes');
  const filter = { _id: new ObjectId(id), userId };
  const note = await collection.findOne(filter);
  if (!note) throw new RequestError('Note not found', 404);
  return { collection, filter, note };
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Sharing failed' }, { status: error instanceof RequestError ? error.status : 500 });
}
function details(request: Request, note: any) {
  const enabled = note.shareEnabled === true && (!note.shareExpiresAt || new Date(note.shareExpiresAt) > new Date());
  return { shareUrl: enabled && note.shareToken ? shareUrl(request, note.shareToken) : null, shareEnabled: enabled, shareExpiresAt: note.shareExpiresAt || null, shareAllowChat: note.shareAllowChat === true };
}
export async function GET(request: NextRequest, context: Context) {
  try { return NextResponse.json(details(request, (await owned(context)).note)); }
  catch (error) { return failure(error); }
}
async function update(request: NextRequest, context: Context, rotate: boolean) {
  try {
    const { collection, filter, note } = await owned(context);
    if (note.status !== 'completed') throw new RequestError('Only completed notes can be shared');
    const body = await boundedJson(request, 8192);
    const options = shareOptions(body);
    const shareToken = rotate || body.rotate === true || !note.shareToken || !note.shareEnabled ? randomBytes(24).toString('hex') : note.shareToken;
    await collection.updateOne(filter, { $set: { shareToken, shareEnabled: true, sharedAt: new Date(), ...options } });
    return NextResponse.json(details(request, { shareToken, shareEnabled: true, ...options }));
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) { return update(request, context, false); }
export async function PATCH(request: NextRequest, context: Context) { return update(request, context, false); }
export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { collection, filter } = await owned(context);
    await collection.updateOne(filter, { $set: { shareEnabled: false, shareAllowChat: false }, $unset: { shareToken: '' } });
    return NextResponse.json({ success: true, shareUrl: null });
  } catch (error) { return failure(error); }
}

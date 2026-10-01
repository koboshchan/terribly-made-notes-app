import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'crypto';
import { getCollection } from '@/lib/db';
import { boundedJson, RequestError } from '@/lib/request-limits';
import { shareUrl, shareOptions } from '@/lib/share';

async function owner() {
  const { userId } = await auth();
  if (!userId) throw new RequestError('Unauthorized', 401);
  return userId;
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Sharing failed' }, { status: error instanceof RequestError ? error.status : 500 });
}
export async function GET(request: NextRequest) {
  try {
    const userId = await owner();
    const shares = await (await getCollection('shared_note_sets')).find({ userId }).sort({ createdAt: -1 }).limit(100).toArray();
    return NextResponse.json({ shares: shares.map(s => ({ token: s.shareToken, shareUrl: shareUrl(request, s.shareToken, true), noteIds: s.noteIds.map(String), expiresAt: s.shareExpiresAt, allowChat: s.shareAllowChat === true, shareEnabled: s.shareEnabled })) });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const userId = await owner();
    const body = await boundedJson(request, 16384);
    if (!Array.isArray(body.noteIds) || !body.noteIds.length || body.noteIds.length > 100 || body.noteIds.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id))) throw new RequestError('Select 1 to 100 valid notes');
    const ids = [...new Set(body.noteIds as string[])].map(id => new ObjectId(id));
    const notes = await (await getCollection('notes')).find({ _id: { $in: ids }, userId, status: 'completed' }).project({ _id: 1 }).toArray();
    if (notes.length !== ids.length) throw new RequestError('All selected notes must be completed and owned by you');
    const sets = await getCollection('shared_note_sets');
    if (await sets.countDocuments({ userId }) >= 100) throw new RequestError('Maximum 100 shared sets', 429);
    const shareToken = randomBytes(24).toString('hex');
    const options = shareOptions(body);
    await sets.insertOne({ userId, shareToken, noteIds: ids, shareEnabled: true, ...options, createdAt: new Date(), sharedAt: new Date() });
    return NextResponse.json({ shareUrl: shareUrl(request, shareToken, true), token: shareToken, noteCount: ids.length, expiresAt: options.shareExpiresAt, allowChat: options.shareAllowChat });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest) {
  try {
    const userId = await owner();
    const body = await boundedJson(request, 8192);
    if (typeof body.token !== 'string' || !/^[a-f0-9]{48}$/.test(body.token)) throw new RequestError('Invalid share token');
    const shareToken = body.rotate === true ? randomBytes(24).toString('hex') : body.token;
    const options = shareOptions(body);
    const result = await (await getCollection('shared_note_sets')).updateOne({ userId, shareToken: body.token }, { $set: { shareToken, shareEnabled: true, ...options } });
    if (!result.matchedCount) throw new RequestError('Shared set not found', 404);
    return NextResponse.json({ shareUrl: shareUrl(request, shareToken, true), token: shareToken, expiresAt: options.shareExpiresAt, allowChat: options.shareAllowChat });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const userId = await owner();
    const { token } = await boundedJson(request, 8192);
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw new RequestError('Invalid share token');
    const result = await (await getCollection('shared_note_sets')).deleteOne({ userId, shareToken: token });
    if (!result.deletedCount) throw new RequestError('Shared set not found', 404);
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}

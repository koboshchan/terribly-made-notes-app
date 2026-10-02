import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';
import { newShortcutSecret, shortcutExpiry } from '@/lib/shortcut-tokens';
import { boundedJson, RequestError } from '@/lib/request-limits';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const collection = await getCollection('shortcut_tokens');
  const tokens = await collection.find({ userId }, { projection: { token: 0, tokenDigest: 0 } }).sort({ createdAt: -1 }).toArray();
  return NextResponse.json(tokens);
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { name, description, expiresInDays = 90 } = await boundedJson(request, 8192);
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || (description !== undefined && (typeof description !== 'string' || description.length > 1000))) throw new RequestError('Invalid token name or description');
    const expiresAt = shortcutExpiry(expiresInDays);
    const collection = await getCollection('shortcut_tokens');
    await collection.createIndex({ tokenDigest: 1 }, { unique: true, sparse: true });
    await collection.createIndex({ userId: 1, name: 1 }, { unique: true });
    if (await collection.countDocuments({ userId }) >= 20) throw new RequestError('Maximum 20 shortcut tokens', 429);
    const { token, ...secretFields } = newShortcutSecret();
    const record = { _id: new ObjectId(), userId, name: name.trim(), description: description?.trim() || '', ...secretFields, scopes: ['upload'], expiresAt, createdAt: new Date(), lastUsed: null, isActive: true };
    await collection.insertOne(record);
    const { tokenDigest: _digest, ...safeRecord } = record;
    // The bearer secret is shown only here. It cannot be recovered from storage.
    return NextResponse.json({ ...safeRecord, token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.code === 11000 ? 'Token name already exists' : error instanceof Error ? error.message : 'Token creation failed' }, { status: error instanceof RequestError ? error.status : 400 });
  }
}

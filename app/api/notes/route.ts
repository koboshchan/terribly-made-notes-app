import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getCollection } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const p = new URL(request.url).searchParams;
    const search = (p.get('search') || '').slice(0, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const limit = Math.min(100, Math.max(1, Number(p.get('limit')) || 50));
    const page = Math.max(0, Math.min(10000, Math.floor(Number(p.get('page')) || 0)));
    const sortField = p.get('sortBy') === 'recorded' ? 'recordedAt' : 'createdAt';
    const direction = p.get('sortOrder') === 'asc' ? 1 : -1;
    const query: any = { userId };
    if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
    if (p.has('updatedSince')) {
      const date = new Date(p.get('updatedSince')!);
      if (!Number.isFinite(date.getTime())) return NextResponse.json({ error: 'Invalid updatedSince' }, { status: 400 });
      query.updatedAt = { $gt: date };
    }
    const notes = await (await getCollection('notes')).find(query).project({ userId: 0, content: 0, flashcards: 0, quizQuestions: 0, shareToken: 0, idempotencyKey: 0, processingPreferences: 0 }).sort({ [sortField]: direction, _id: direction }).skip(page * limit).limit(limit + 1).toArray();
    const hasMore = notes.length > limit;
    return NextResponse.json(notes.slice(0, limit).map(n => ({ ...n, class: n.noteClass || null })), { headers: { 'X-Has-More': String(hasMore), 'X-Page': String(page), 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Failed to fetch notes:', error);
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';
import { generateText } from 'ai';
import { getChatModel } from '@/lib/ai';

type SharedSet = {
  noteIds: ObjectId[];
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;

  try {
    const { message, history, noteId } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const sharedNoteSetsCollection = await getCollection('shared_note_sets');
    const sharedSet = await sharedNoteSetsCollection.findOne({
      shareToken: token,
      shareEnabled: true,
    }) as SharedSet | null;

    if (!sharedSet || !Array.isArray(sharedSet.noteIds) || sharedSet.noteIds.length === 0) {
      return NextResponse.json({ error: 'Shared note set not found' }, { status: 404 });
    }

    let targetNoteIds: ObjectId[] = sharedSet.noteIds;

    if (noteId) {
      if (!ObjectId.isValid(noteId)) {
        return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
      }

      const singleId = new ObjectId(noteId);
      const isInSharedSet = sharedSet.noteIds.some((id) => String(id) === String(singleId));
      if (!isInSharedSet) {
        return NextResponse.json({ error: 'Note is not in this shared set' }, { status: 404 });
      }
      targetNoteIds = [singleId];
    }

    const notesCollection = await getCollection('notes');
    const notes = await notesCollection
      .find({
        _id: { $in: targetNoteIds },
        status: 'completed',
      })
      .project({ title: 1, description: 1, content: 1 })
      .toArray();

    if (notes.length === 0) {
      return NextResponse.json({ error: 'No note content available for chat' }, { status: 404 });
    }

    const orderedNoteMap = new Map(notes.map((note) => [String(note._id), note]));
    const orderedNotes = targetNoteIds
      .map((id) => orderedNoteMap.get(String(id)))
      .filter(Boolean) as any[];

    let combinedNoteContent = '';
    orderedNotes.forEach((note, index) => {
      combinedNoteContent += `### Note ${index + 1}: ${note.title}\n`;
      combinedNoteContent += `Description: ${note.description}\n`;
      combinedNoteContent += `Content:\n${note.content}\n\n`;
    });

    const globalSettingsCollection = await getCollection('global_settings');
    const globalSettings = await globalSettingsCollection.findOne({ type: 'models' });

    if (!globalSettings || !globalSettings.settings) {
      return NextResponse.json({ error: 'Global API settings not configured' }, { status: 500 });
    }

    const llmSettings = globalSettings.settings.llm;
    const systemPrompt = `You are a helpful assistant answering questions about the following note content.\n\n${combinedNoteContent}\nProvide clear, concise, and helpful answers based on the note content above. If the answer is not in the provided note content, acknowledge that and provide general knowledge if helpful.`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history && Array.isArray(history)) {
      messages.push(
        ...history.slice(-10).map((msg: any) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }))
      );
    }

    messages.push({ role: 'user', content: message });

    const model = getChatModel({
      baseUrl: llmSettings.baseUrl,
      apiKey: llmSettings.apiKey,
      chatModel: llmSettings.chatModel,
      summarizationModel: llmSettings.summarizationModel,
      quizModel: llmSettings.quizModel,
    });

    const result = await generateText({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0.7,
      maxTokens: 2000,
    });

    return NextResponse.json({ message: result.text });
  } catch (error) {
    console.error('Failed to process shared bulk chat:', error);
    return NextResponse.json({ error: 'Failed to process shared bulk chat' }, { status: 500 });
  }
}
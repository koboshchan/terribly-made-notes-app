import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';

export async function POST(
  request: NextRequest,
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, history, noteIds } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
      return NextResponse.json({ error: 'At least one note ID is required' }, { status: 400 });
    }

    const notesCollection = await getCollection('notes');
    const fetchedNotes = await notesCollection.find({
      _id: { $in: noteIds.map((id: string) => new ObjectId(id)) },
      userId,
    }).toArray();

    if (fetchedNotes.length === 0) {
      return NextResponse.json({ error: 'No notes found for the given IDs' }, { status: 404 });
    }

    let combinedNoteContent = "";
    fetchedNotes.forEach((note, index) => {
      combinedNoteContent += `### Note ${index + 1}: ${note.title}\n`;
      combinedNoteContent += `Description: ${note.description}\n`;
      combinedNoteContent += `Content:\n${note.content}\n\n`;
    });

    // Get global admin settings
    const globalSettingsCollection = await getCollection('global_settings');
    const globalSettings = await globalSettingsCollection.findOne({ type: 'models' });

    if (!globalSettings || !globalSettings.settings) {
      return NextResponse.json({ error: 'Global API settings not configured' }, { status: 500 });
    }

    const settings = globalSettings.settings;
    const llmSettings = settings.llm;

    // Build messages with combined note context
    const systemPrompt = `You are a helpful assistant answering questions about the following note content. Multiple notes are provided, each clearly separated with a title and content. Combine information from these notes as needed to answer the user's questions.\n\n${combinedNoteContent}\nProvide clear, concise, and helpful answers based on the note content above. If the answer is not in the provided note content, acknowledge that and provide general knowledge if helpful.`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add chat history if provided
    if (history && Array.isArray(history)) {
      messages.push(...history.slice(-10).map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })));
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    const response = await fetch(`${llmSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmSettings.apiKey}`,
      },
      body: JSON.stringify({
        model: llmSettings.chatModel,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Chat API error:', response.status, errorText);
      return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
    }

    const data = await response.json();
    const assistantMessage = data.choices[0]?.message?.content;

    return NextResponse.json({
      message: assistantMessage,
    });
  } catch (error) {
    console.error('Failed to process multi-note chat:', error);
    return NextResponse.json(
      { error: 'Failed to process multi-note chat' },
      { status: 500 }
    );
  }
}

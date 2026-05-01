import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/db';
import { generateText } from 'ai';
import { getChatModel } from '@/lib/ai';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, history } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const notesCollection = await getCollection('notes');
    const note = await notesCollection.findOne({
      _id: new ObjectId(id),
      userId,
    });

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    // Get global admin settings
    const globalSettingsCollection = await getCollection('global_settings');
    const globalSettings = await globalSettingsCollection.findOne({ type: 'models' });

    if (!globalSettings || !globalSettings.settings) {
      return NextResponse.json({ error: 'Global API settings not configured' }, { status: 500 });
    }

    const settings = globalSettings.settings;
    const llmSettings = settings.llm;

    // Build messages with note context
    const systemPrompt = `You are a helpful assistant answering questions about the following note content:

${note.content}

Provide clear, concise, and helpful answers based on the note content above. If the answer is not in the note content, acknowledge that and provide general knowledge if helpful.`;

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

    const model = getChatModel({
      baseUrl: llmSettings.baseUrl,
      apiKey: llmSettings.apiKey,
      chatModel: llmSettings.chatModel,
      summarizationModel: llmSettings.summarizationModel,
      quizModel: llmSettings.quizModel,
    });

    const result = await generateText({
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: 0.7,
      maxTokens: 2000,
    });

    return NextResponse.json({
      message: result.text,
    });
  } catch (error) {
    console.error('Failed to process chat:', error);
    return NextResponse.json(
      { error: 'Failed to process chat' },
      { status: 500 }
    );
  }
}

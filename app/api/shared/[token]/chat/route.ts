import { NextRequest, NextResponse } from 'next/server';
import { getCollection } from '@/lib/db';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;

  try {
    const { message, history } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const notesCollection = await getCollection('notes');
    const note = await notesCollection.findOne({
      shareToken: token,
      shareEnabled: true,
      status: 'completed',
    });

    if (!note) {
      return NextResponse.json({ error: 'Shared note not found' }, { status: 404 });
    }

    const globalSettingsCollection = await getCollection('global_settings');
    const globalSettings = await globalSettingsCollection.findOne({ type: 'models' });

    if (!globalSettings || !globalSettings.settings) {
      return NextResponse.json({ error: 'Global API settings not configured' }, { status: 500 });
    }

    const settings = globalSettings.settings;
    const llmSettings = settings.llm;

    const systemPrompt = `You are a helpful assistant answering questions about the following note content:

${note.content}

Provide clear, concise, and helpful answers based on the note content above. If the answer is not in the note content, acknowledge that and provide general knowledge if helpful.`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    if (history && Array.isArray(history)) {
      messages.push(...history.slice(-10).map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })));
    }

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
      console.error('Shared chat API error:', response.status, errorText);
      return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
    }

    const data = await response.json();
    const assistantMessage = data.choices[0]?.message?.content;

    return NextResponse.json({
      message: assistantMessage,
    });
  } catch (error) {
    console.error('Failed to process shared chat:', error);
    return NextResponse.json(
      { error: 'Failed to process shared chat' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isUserAdmin } from '@/lib/admin';
import { allowedProviderUrl } from '@/lib/provider-url';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!await isUserAdmin(userId)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const { baseUrl, apiKey, type } = await request.json();
    const approvedUrl = allowedProviderUrl(baseUrl);
    if (!approvedUrl || typeof apiKey !== 'string' || apiKey.length > 4096) {
      return NextResponse.json({ error: 'Provider must be configured in PROVIDER_BASE_URL_ALLOWLIST' }, { status: 400 });
    }

    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: 'Base URL and API key are required' },
        { status: 400 }
      );
    }

    try {
      const response = await fetch(`${approvedUrl}/models`, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      let models = data.data?.map((model: any) => model.id) || [];

      // Filter models based on type for better UX
      if (type === 'stt') {
        // Filter for speech-to-text models (whisper, etc.)
        models = models.filter((model: string) =>
          model.toLowerCase().includes('whisper') ||
          model.toLowerCase().includes('speech') ||
          model.toLowerCase().includes('audio') ||
          model.toLowerCase().includes('stt')
        );
      } else if (type === 'tts') {
        // Filter for text-to-speech models
        models = models.filter((model: string) =>
          model.toLowerCase().includes('tts') ||
          model.toLowerCase().includes('voice') ||
          model.toLowerCase().includes('speech') ||
          model.toLowerCase().includes('audio') ||
          model.toLowerCase().includes('eleven')
        );
      } else if (type === 'llm') {
        // Filter out audio/speech models for LLM
        models = models.filter((model: string) =>
          !model.toLowerCase().includes('whisper') &&
          !model.toLowerCase().includes('tts') &&
          !model.toLowerCase().includes('dall-e') &&
          !model.toLowerCase().includes('embedding')
        );
      }

      // If no filtered models found, return all models as fallback
      if (models.length === 0) {
        models = data.data?.map((model: any) => model.id) || [];
      }

      return NextResponse.json({ models });
    } catch (apiError) {
      console.error('Failed to fetch models from API:', apiError);
      return NextResponse.json(
        { error: 'Failed to fetch models from the provided API' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Failed to fetch models:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}

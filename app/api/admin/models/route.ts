import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getCollection } from '@/lib/db';
import { isUserAdmin } from '@/lib/admin';
import { processingQueue, PipelineSettings, defaultPipelineSettings } from '@/lib/queue';
import { boundedJson, RequestError } from '@/lib/request-limits';
import { runtimeDefaults, validateRuntime, shareExpiryDays, capabilityDefaults, validateCapabilities, validatePipeline, normalizedPipeline } from '@/lib/runtime-settings';

interface GlobalModelSettings {
  stt: {
    baseUrl: string;
    apiKey: string;
    english: {
      modelName: string;
      task: 'transcribe' | 'translate';
      temperature: number;
    };
    other: {
      modelName: string;
      task: 'transcribe' | 'translate';
      temperature: number;
    };
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    summarizationModel: string;
    quizModel: string;
    chatModel: string;
  };
  tts: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    voice: string;
    responseFormat: string;
    speed: number;
    sampleRate: number;
  };
  pipeline: PipelineSettings;
}

const defaultGlobalSettings: GlobalModelSettings = {
  stt: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    english: {
      modelName: 'whisper-1',
      task: 'transcribe',
      temperature: 0.0,
    },
    other: {
      modelName: 'whisper-1',
      task: 'transcribe',
      temperature: 0.0,
    },
  },
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    summarizationModel: 'gpt-3.5-turbo',
    quizModel: 'gpt-3.5-turbo',
    chatModel: 'gpt-3.5-turbo',
  },
  tts: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    modelName: 'tts-1',
    voice: 'alloy',
    responseFormat: 'mp3',
    speed: 1.0,
    sampleRate: 22050,
  },
  pipeline: defaultPipelineSettings,
};

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isUserAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const globalSettingsCollection = await getCollection('global_settings');
    const settingsDoc = await globalSettingsCollection.findOne({ type: 'models' });

    let settings = settingsDoc?.settings || defaultGlobalSettings;

    // Handle backward compatibility for old STT structure
    if (settings.stt && !settings.stt.english && !settings.stt.other) {
      settings = {
        ...settings,
        stt: {
          baseUrl: settings.stt.baseUrl,
          apiKey: settings.stt.apiKey,
          english: {
            modelName: settings.stt.modelName || 'whisper-1',
            task: settings.stt.task || 'transcribe',
            temperature: settings.stt.temperature || 0.0,
          },
          other: {
            modelName: settings.stt.modelName || 'whisper-1',
            task: settings.stt.task || 'transcribe',
            temperature: settings.stt.temperature || 0.0,
          },
        },
      };
    }

    if (!settings.pipeline) {
      settings.pipeline = defaultGlobalSettings.pipeline;
    } else {
      settings.pipeline = {
        ...defaultGlobalSettings.pipeline,
        ...settings.pipeline,
      };
    }

    settings = {
      ...settings,
      runtime: { ...runtimeDefaults(), ...validateRuntime(settings.runtime) },
      pipeline: normalizedPipeline(settings.pipeline, defaultPipelineSettings),
      shareExpiryDays: shareExpiryDays(settings.shareExpiryDays),
      stt: { ...settings.stt, capabilities: { ...capabilityDefaults(), ...validateCapabilities(settings.stt?.capabilities) } },
    };
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to fetch global model settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch global model settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isUserAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const settings = await boundedJson(request, 131072);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new RequestError('Invalid global settings');
    settings.runtime = { ...runtimeDefaults(), ...validateRuntime(settings.runtime) };
    settings.shareExpiryDays = shareExpiryDays(settings.shareExpiryDays);
    validatePipeline(settings.pipeline);
    settings.pipeline = normalizedPipeline(settings.pipeline, defaultPipelineSettings);
    if (!settings.stt || !settings.llm || !settings.tts) throw new RequestError('Missing model settings');
    settings.stt.capabilities = { ...capabilityDefaults(), ...validateCapabilities(settings.stt.capabilities) };
    const globalSettingsCollection = await getCollection('global_settings');

    const existingSettings = await globalSettingsCollection.findOne({ type: 'models' });

    if (existingSettings) {
      await globalSettingsCollection.updateOne(
        { type: 'models' },
        {
          $set: {
            settings,
            updatedAt: new Date(),
            updatedBy: userId
          }
        }
      );
    } else {
      await globalSettingsCollection.insertOne({
        type: 'models',
        settings,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
      });
    }

    if (settings.pipeline) {
      processingQueue.updatePipelineSettings(settings.pipeline);
    }

    return NextResponse.json({ message: 'Global model settings saved successfully' });
  } catch (error) {
    console.error('Failed to save global model settings:', error);
    return NextResponse.json(
      { error: error instanceof RequestError ? error.message : 'Failed to save global model settings' },
      { status: error instanceof RequestError ? error.status : 500 }
    );
  }
}

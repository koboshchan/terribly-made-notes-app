'use client';

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

// Mirrors lib/runtime-settings.ts (server-only; imports db). Keep in sync.
const RUNTIME_FIELDS = [
  { key: 'chatTokenPerMinute', label: 'Public chat requests per share link per minute', min: 1, max: 10000, def: 10 },
  { key: 'chatClientPerMinute', label: 'Public chat requests per client per minute', min: 1, max: 10000, def: 20 },
  { key: 'chatOwnerPerDay', label: 'Public chat requests per note owner per day', min: 1, max: 1000000, def: 100 },
  { key: 'audioMaxSeconds', label: 'Maximum audio length (seconds, 36000 = 10 hours)', min: 1, max: 86400, def: 36000 },
  { key: 'maxProcessingNotes', label: 'Maximum notes processing at once per user', min: 1, max: 1000, def: 5 },
  { key: 'providerTimeoutMs', label: 'AI provider request timeout (ms)', min: 1000, max: 3600000, def: 300000 },
  { key: 'mediaTimeoutSeconds', label: 'FFmpeg/media processing timeout (seconds)', min: 1, max: 3600, def: 600 },
  { key: 'summaryMaxTokens', label: 'Summary max output tokens', min: 256, max: 128000, def: 6000 },
  { key: 'contextChars', label: 'Chat context size (characters)', min: 4000, max: 2000000, def: 48000 },
] as const;
type RuntimeSettings = { [K in typeof RUNTIME_FIELDS[number]['key']]: number };
const runtimeDefaults = () => Object.fromEntries(RUNTIME_FIELDS.map(f => [f.key, f.def])) as RuntimeSettings;
const CAPABILITY_FIELDS = [
  { key: 'maxBytes', label: 'Max bytes per chunk', min: 1024, max: 268435456, def: 20971520 },
  { key: 'chunkSeconds', label: 'Chunk length (seconds)', min: 2, max: 3600, def: 300 },
  { key: 'overlapSeconds', label: 'Chunk overlap (seconds)', min: 0, max: 60, def: 2 },
  { key: 'sampleRate', label: 'Chunk sample rate (Hz)', min: 8000, max: 192000, def: 16000 },
  { key: 'channels', label: 'Chunk channels', min: 1, max: 2, def: 1 },
] as const;
interface SttCapabilities { chunkingEnabled: boolean; maxBytes: number; chunkSeconds: number; overlapSeconds: number; format: 'mp3' | 'wav'; sampleRate: number; channels: number }
const capabilityDefaults = (): SttCapabilities => ({ chunkingEnabled: false, format: 'mp3', ...Object.fromEntries(CAPABILITY_FIELDS.map(f => [f.key, f.def])) } as SttCapabilities);
type PipelineStage = { parallel: boolean; concurrency?: number };

interface ModelSettings {
  stt: {
    baseUrl: string;
    apiKey: string;
    capabilities: SttCapabilities;
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
  pipeline: {
    audioNormalization: PipelineStage;
    transcription: PipelineStage;
    summarization: PipelineStage;
    generation: PipelineStage;
  };
  shareExpiryDays: number | null;
  runtime: RuntimeSettings;
}

export default function AdminModelsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [settings, setSettings] = useState<ModelSettings>({
    stt: {
      capabilities: capabilityDefaults(),
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
    pipeline: {
      audioNormalization: { parallel: true },
      transcription: { parallel: false },
      summarization: { parallel: true },
      generation: { parallel: true },
    },
    shareExpiryDays: 30,
    runtime: runtimeDefaults(),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [models, setModels] = useState<{[key: string]: string[]}>({});

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/');
      return;
    }

    if (isLoaded && isSignedIn) {
      fetchSettings();
    }
  }, [isLoaded, isSignedIn]);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/admin/models');
      if (response.status === 403) {
        // Not an admin
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      if (response.ok) {
        const data = await response.json();

        // Handle backward compatibility for old STT structure
        if (data.stt && !data.stt.english && !data.stt.other) {
          // Convert old structure to new structure
          data.stt = {
            baseUrl: data.stt.baseUrl,
            apiKey: data.stt.apiKey,
            english: {
              modelName: data.stt.modelName || 'whisper-1',
              task: data.stt.task || 'transcribe',
              temperature: data.stt.temperature || 0.0,
            },
            other: {
              modelName: data.stt.modelName || 'whisper-1',
              task: data.stt.task || 'transcribe',
              temperature: data.stt.temperature || 0.0,
            },
          };
        }

        // Ensure pipeline settings defaults
        if (!data.pipeline) {
          data.pipeline = {
            audioNormalization: { parallel: true },
            transcription: { parallel: false },
            summarization: { parallel: true },
            generation: { parallel: true },
          };
        } else {
          data.pipeline = {
            audioNormalization: { ...data.pipeline.audioNormalization, parallel: data.pipeline.audioNormalization?.parallel ?? true },
            transcription: { ...data.pipeline.transcription, parallel: data.pipeline.transcription?.parallel ?? false },
            summarization: { ...data.pipeline.summarization, parallel: data.pipeline.summarization?.parallel ?? true },
            generation: { ...data.pipeline.generation, parallel: data.pipeline.generation?.parallel ?? true },
          };
        }

        data.runtime = { ...runtimeDefaults(), ...(data.runtime || {}) };
        if (data.stt) data.stt.capabilities = { ...capabilityDefaults(), ...(data.stt.capabilities || {}) };
        if (data.shareExpiryDays === undefined) {
          data.shareExpiryDays = 30;
        }

        setSettings(data);
        await preloadModels(data);
        setIsAdmin(true);
      }
    } catch (error) {
      console.error('Failed to fetch admin settings:', error);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async (baseUrl: string, apiKey: string, type: 'stt' | 'llm' | 'tts') => {
    if (!baseUrl || !apiKey) return;

    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ baseUrl, apiKey, type }),
      });

      if (response.ok) {
        const data = await response.json();
        setModels(prev => ({ ...prev, [type]: data.models }));
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  };

  const preloadModels = async (loadedSettings: ModelSettings) => {
    await Promise.all([
      fetchModels(loadedSettings.stt.baseUrl, loadedSettings.stt.apiKey, 'stt'),
      fetchModels(loadedSettings.llm.baseUrl, loadedSettings.llm.apiKey, 'llm'),
      fetchModels(loadedSettings.tts.baseUrl, loadedSettings.tts.apiKey, 'tts'),
    ]);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        showNotification('API settings saved successfully!');
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      showNotification('Failed to save settings. Please try again.', true);
    } finally {
      setSaving(false);
    }
  };

  const showNotification = (message: string, isError = false) => {
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      document.body.removeChild(notification);
    }, 3000);
  };

  const updateSettings = (section: Exclude<keyof ModelSettings, 'shareExpiryDays' | 'runtime'>, field: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  const updateRuntime = (key: keyof RuntimeSettings, value: number) =>
    setSettings(prev => ({ ...prev, runtime: { ...prev.runtime, [key]: value } }));
  const updateCapability = (patch: Partial<SttCapabilities>) =>
    setSettings(prev => ({ ...prev, stt: { ...prev.stt, capabilities: { ...capabilityDefaults(), ...prev.stt.capabilities, ...patch } } }));
  const updateConcurrency = (stage: keyof ModelSettings['pipeline'], value: number) =>
    setSettings(prev => ({
      ...prev,
      pipeline: {
        ...prev.pipeline,
        [stage]: {
          ...prev.pipeline[stage],
          concurrency: value,
          parallel: value === -1 || value > 1,
        },
      },
    }));
  const numberField = (id: string, label: string, min: number, max: number, value: number, onChange: (n: number) => void) => (
    <div className="form-group" key={id}>
      <label className="form-label" htmlFor={id}>{label}</label>
      <input id={id} type="number" className="form-input" min={min} max={max} step={1} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.trunc(n)); }} />
      <small style={{ color: '#94a3b8' }}>Allowed {min.toLocaleString()} to {max.toLocaleString()}</small>
    </div>
  );

  // Helper function to safely get nested STT settings
  const getSafeSTTSettings = () => ({
    english: settings.stt.english || { modelName: 'whisper-1', task: 'transcribe', temperature: 0.0 },
    other: settings.stt.other || { modelName: 'whisper-1', task: 'transcribe', temperature: 0.0 }
  });

  const renderPipelineStepCard = (
    key: keyof ModelSettings['pipeline'],
    stepNumber: number,
    title: string,
    icon: string,
    description: string,
    behaviorNote: string
  ) => {
    const stage = settings.pipeline?.[key];
    const concurrency = stage?.concurrency ?? (stage?.parallel === false ? 1 : 2);
    const isInfinite = concurrency === -1;
    const isSequential = concurrency === 1;

    let badgeText = `⚡ Parallel (${concurrency} at once)`;
    let badgeBg = '#dbeafe';
    let badgeColor = '#1d4ed8';
    let badgeBorder = '#93c5fd';

    if (isInfinite) {
      badgeText = '⚡ Infinite (All at once)';
      badgeBg = '#dcfce7';
      badgeColor = '#15803d';
      badgeBorder = '#86efac';
    } else if (isSequential) {
      badgeText = '⏳ Sequential (1 at a time queue)';
      badgeBg = '#fef3c7';
      badgeColor = '#92400e';
      badgeBorder = '#fde68a';
    }

    return (
      <div
        key={key}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 340px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.25rem' }}>{icon}</span>
            <span style={{ fontWeight: '600', fontSize: '1.05rem', color: '#1e293b' }}>
              Step {stepNumber}: {title}
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                padding: '2px 10px',
                borderRadius: '9999px',
                backgroundColor: badgeBg,
                color: badgeColor,
                border: `1px solid ${badgeBorder}`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {badgeText}
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 4px 0', paddingLeft: '32px' }}>
            {description}
          </p>
          <p style={{ fontSize: '0.785rem', color: '#94a3b8', margin: 0, paddingLeft: '32px' }}>
            {behaviorNote}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>
            <span>Max concurrent:</span>
            <input
              type="number"
              min={-1}
              max={10}
              step={1}
              className="form-input"
              style={{ width: '80px', textAlign: 'center', fontWeight: 'bold' }}
              value={concurrency}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value));
                if (Number.isFinite(n)) updateConcurrency(key, n);
              }}
            />
          </label>
          <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
            1 to 10, or -1 for infinite
          </small>
        </div>
      </div>
    );
  };

  if (!isLoaded || loading) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="container">
        <div className="card">
          <h2>Access Denied</h2>
          <p>You don't have admin permissions to access this page.</p>
          <p>Only the first registered user has admin access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button onClick={() => router.back()} className="btn btn-secondary">
          ← Back
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '10px' }}>⚙️ Admin & Pipeline Settings</h2>
        <p style={{ marginBottom: '30px', color: '#6b7280' }}>
          Configure note processing pipeline concurrency and AI API endpoints for all users. Only administrators can modify these settings.
        </p>

        {/* Pipeline & Parallel Processing Settings */}
        <section style={{ marginBottom: '45px', borderBottom: '2px solid #f1f5f9', paddingBottom: '35px' }}>
          <div style={{ marginBottom: '12px' }}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a' }}>
              <span>⚡</span> Note Processing Pipeline & Concurrency
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.925rem', marginTop: '4px' }}>
              Control concurrency for each stage of the processing pipeline. Enter 1 for sequential queue, a positive number for max concurrent notes, or -1 for infinite (all at once).
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '20px' }}>
            {renderPipelineStepCard(
              'audioNormalization',
              1,
              'Audio Normalization (FFmpeg)',
              '🎵',
              'Converts uploaded audio files into standardized MP3 (128 kbps, 44.1 kHz).',
              'Set -1 to convert all notes simultaneously, 1 to process one by one, or 2 to 10.'
            )}

            {renderPipelineStepCard(
              'transcription',
              2,
              'Speech-to-Text Transcription (STT)',
              '🎙️',
              'Transcribes normalized MP3 audio into verbatim text via the configured STT model.',
              'Set -1 to transcribe all notes simultaneously, 1 for sequential queue (recommended for API rate limits), or 2 to 10.'
            )}

            {renderPipelineStepCard(
              'summarization',
              3,
              'AI Summarization & Classification',
              '📝',
              'Generates structured Markdown study notes and assigns subject classes using LLM.',
              'Set -1 to summarize all notes simultaneously, 1 to process one by one, or 2 to 10.'
            )}

            {renderPipelineStepCard(
              'generation',
              4,
              'Study Materials Generation (Flashcards & Quiz)',
              '🎴',
              'Generates question/answer flashcards and interactive multiple-choice quiz questions.',
              'Set -1 to generate all study materials simultaneously, 1 for sequential generation, or 2 to 10.'
            )}
          </div>
        </section>

        {/* Runtime limits */}
        <section style={{ marginBottom: '45px', borderBottom: '2px solid #f1f5f9', paddingBottom: '35px' }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '8px' }}>Runtime Limits</h3>
          <p style={{ color: '#64748b', fontSize: '0.925rem', marginBottom: '20px' }}>
            Saved values override environment defaults. There is no per-file upload size cap or upload/storage quota.
          </p>
          {RUNTIME_FIELDS.map(f => numberField(`runtime-${f.key}`, f.label, f.min, f.max, settings.runtime?.[f.key] ?? f.def, n => updateRuntime(f.key, n)))}

          <h4 style={{ fontSize: '1.15rem', fontWeight: 600, margin: '24px 0 8px' }}>STT Chunking</h4>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '12px' }}>
            Off by default: the whole normalized MP3 (128 kbps, 44.1 kHz stereo) is sent in one request. Your STT provider may impose its own file size limit; enable chunking if it rejects long recordings.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <input type="checkbox" checked={settings.stt.capabilities?.chunkingEnabled ?? false}
              onChange={(e) => updateCapability({ chunkingEnabled: e.target.checked })} />
            Split audio into chunks before transcription
          </label>
          {settings.stt.capabilities?.chunkingEnabled && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="stt-chunk-format">Chunk format</label>
                <select id="stt-chunk-format" className="form-input" value={settings.stt.capabilities.format}
                  onChange={(e) => updateCapability({ format: e.target.value as 'mp3' | 'wav' })}>
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV</option>
                </select>
              </div>
              {CAPABILITY_FIELDS.map(f => numberField(`stt-${f.key}`, f.label, f.min, f.max, settings.stt.capabilities?.[f.key] ?? f.def, n => updateCapability({ [f.key]: n })))}
              <small style={{ color: '#94a3b8' }}>Overlap must be less than half the chunk length.</small>
            </>
          )}
        </section>

        {/* STT Settings */}
        <section style={{ marginBottom: '40px' }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '20px' }}>
            Speech-to-Text (STT) API
          </h3>

          <div className="form-group">
            <label className="form-label">Base URL</label>
            <input
              type="url"
              className="form-input"
              value={settings.stt.baseUrl}
              onChange={(e) => updateSettings('stt', 'baseUrl', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              value={settings.stt.apiKey}
              onChange={(e) => updateSettings('stt', 'apiKey', e.target.value)}
            />
          </div>

          {/* English Model Settings */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
            <h4 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '16px', color: '#374151' }}>
              English Model
            </h4>

            <div className="form-group">
              <label className="form-label">Model Name</label>
              {models.stt ? (
              <select
                className="form-select"
                value={settings.stt.english?.modelName || ''}
                onChange={(e) => updateSettings('stt', 'english', { ...getSafeSTTSettings().english, modelName: e.target.value })}
              >
                {models.stt.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="form-input"
                value={settings.stt.english?.modelName || ''}
                onChange={(e) => updateSettings('stt', 'english', { ...getSafeSTTSettings().english, modelName: e.target.value })}
              />
            )}
            </div>

            <div className="form-group">
              <label className="form-label">Task</label>
              <select
                className="form-select"
                value={settings.stt.english?.task || 'transcribe'}
                onChange={(e) => updateSettings('stt', 'english', { ...getSafeSTTSettings().english, task: e.target.value as 'transcribe' | 'translate' })}
              >
                <option value="transcribe">Transcribe</option>
                <option value="translate">Translate</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Temperature (0.0 - 1.0)</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                className="form-input"
                value={settings.stt.english?.temperature || 0.0}
                onChange={(e) => updateSettings('stt', 'english', { ...getSafeSTTSettings().english, temperature: parseFloat(e.target.value) })}
              />
            </div>
          </div>

          {/* Other Language Model Settings */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '16px', color: '#374151' }}>
              Other Language Model
            </h4>

            <div className="form-group">
              <label className="form-label">Model Name</label>
              {models.stt ? (
              <select
                className="form-select"
                value={settings.stt.other?.modelName || ''}
                onChange={(e) => updateSettings('stt', 'other', { ...getSafeSTTSettings().other, modelName: e.target.value })}
              >
                {models.stt.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="form-input"
                value={settings.stt.other?.modelName || ''}
                onChange={(e) => updateSettings('stt', 'other', { ...getSafeSTTSettings().other, modelName: e.target.value })}
              />
            )}
            </div>

            <div className="form-group">
              <label className="form-label">Task</label>
              <select
                className="form-select"
                value={settings.stt.other?.task || 'transcribe'}
                onChange={(e) => updateSettings('stt', 'other', { ...getSafeSTTSettings().other, task: e.target.value as 'transcribe' | 'translate' })}
              >
                <option value="transcribe">Transcribe</option>
                <option value="translate">Translate</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Temperature (0.0 - 1.0)</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                className="form-input"
                value={settings.stt.other?.temperature || 0.0}
                onChange={(e) => updateSettings('stt', 'other', { ...getSafeSTTSettings().other, temperature: parseFloat(e.target.value) })}
              />
            </div>
          </div>
        </section>

        {/* LLM Settings */}
        <section style={{ marginBottom: '40px' }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '20px' }}>
            Large Language Model (LLM) API
          </h3>

          <div className="form-group">
            <label className="form-label">Base URL</label>
            <input
              type="url"
              className="form-input"
              value={settings.llm.baseUrl}
              onChange={(e) => updateSettings('llm', 'baseUrl', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              value={settings.llm.apiKey}
              onChange={(e) => updateSettings('llm', 'apiKey', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Summarization Model</label>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
              Used for generating note summaries from transcriptions
            </p>
            {models.llm ? (
              <select
                className="form-select"
                value={settings.llm.summarizationModel}
                onChange={(e) => updateSettings('llm', 'summarizationModel', e.target.value)}
              >
                {models.llm.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="form-input"
                value={settings.llm.summarizationModel}
                onChange={(e) => updateSettings('llm', 'summarizationModel', e.target.value)}
              />
            )}
          </div>

            <div className="form-group">
            <label className="form-label">Quiz & Flashcard Model</label>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
              Used for generating flashcards and quiz questions
            </p>
            {models.llm ? (
              <select
                className="form-select"
                value={settings.llm.quizModel}
                onChange={(e) => updateSettings('llm', 'quizModel', e.target.value)}
              >
                {models.llm.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="form-input"
                value={settings.llm.quizModel}
                onChange={(e) => updateSettings('llm', 'quizModel', e.target.value)}
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Chat Model</label>
            <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
              Used for conversational AI chat about the note
            </p>
            {models.llm ? (
              <select
                className="form-select"
                value={settings.llm.chatModel}
                onChange={(e) => updateSettings('llm', 'chatModel', e.target.value)}
              >
                {models.llm.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="form-input"
                value={settings.llm.chatModel}
                onChange={(e) => updateSettings('llm', 'chatModel', e.target.value)}
              />
            )}
          </div>
        </section>

        {/* TTS Settings */}
        <section style={{ marginBottom: '40px' }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '20px' }}>
            Text-to-Speech (TTS) API
          </h3>

          <div className="form-group">
            <label className="form-label">Base URL</label>
            <input
              type="url"
              className="form-input"
              value={settings.tts.baseUrl}
              onChange={(e) => updateSettings('tts', 'baseUrl', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              value={settings.tts.apiKey}
              onChange={(e) => updateSettings('tts', 'apiKey', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Model Name</label>
            {models.tts ? (
              <select
                className="form-select"
                value={settings.tts.modelName}
                onChange={(e) => updateSettings('tts', 'modelName', e.target.value)}
              >
                {models.tts.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="form-input"
                value={settings.tts.modelName}
                onChange={(e) => updateSettings('tts', 'modelName', e.target.value)}
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Voice</label>
            <input
              type="text"
              className="form-input"
              value={settings.tts.voice}
              onChange={(e) => updateSettings('tts', 'voice', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Response Format</label>
            <input
              type="text"
              className="form-input"
              value={settings.tts.responseFormat}
              onChange={(e) => updateSettings('tts', 'responseFormat', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Speed (0.5 - 2.0)</label>
            <input
              type="number"
              min="0.5"
              max="2.0"
              step="0.1"
              className="form-input"
              value={settings.tts.speed}
              onChange={(e) => updateSettings('tts', 'speed', parseFloat(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Sample Rate (8000 - 48000)</label>
            <input
              type="number"
              min="8000"
              max="48000"
              step="1000"
              className="form-input"
              value={settings.tts.sampleRate}
              onChange={(e) => updateSettings('tts', 'sampleRate', parseInt(e.target.value))}
            />
          </div>
        </section>

        <section style={{ marginBottom: '40px' }}>
          <h3 style={{ marginBottom: '8px' }}>Share Links</h3>
          <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '16px' }}>
            Expiry applies when a share is created or updated. Existing shares keep their current expiry.
          </p>
          <div className="form-group">
            <label className="form-label" htmlFor="share-expiry-never">
              <input
                id="share-expiry-never"
                type="checkbox"
                checked={settings.shareExpiryDays === null}
                onChange={(e) => setSettings(prev => ({ ...prev, shareExpiryDays: e.target.checked ? null : 30 }))}
                style={{ marginRight: '8px' }}
              />
              Never expire
            </label>
          </div>
          {settings.shareExpiryDays !== null && (
            <div className="form-group">
              <label className="form-label" htmlFor="share-expiry-days">Expire after (days, 1-365)</label>
              <input
                id="share-expiry-days"
                type="number"
                min="1"
                max="365"
                step="1"
                className="form-input"
                value={settings.shareExpiryDays}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  const days = Number.isNaN(n) ? 1 : Math.min(365, Math.max(1, n));
                  setSettings(prev => ({ ...prev, shareExpiryDays: days }));
                }}
              />
            </div>
          )}
        </section>

        <div style={{ textAlign: 'center' }}>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="btn btn-primary"
            style={{ minWidth: '140px' }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

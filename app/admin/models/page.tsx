'use client';

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

interface ModelSettings {
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
}

export default function AdminModelsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [settings, setSettings] = useState<ModelSettings>({
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

  const updateSettings = (section: keyof ModelSettings, field: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  // Helper function to safely get nested STT settings
  const getSafeSTTSettings = () => ({
    english: settings.stt.english || { modelName: 'whisper-1', task: 'transcribe', temperature: 0.0 },
    other: settings.stt.other || { modelName: 'whisper-1', task: 'transcribe', temperature: 0.0 }
  });

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
        <h2 style={{ marginBottom: '10px' }}>⚙️ API Settings</h2>
        <p style={{ marginBottom: '30px', color: '#6b7280' }}>
          Configure the AI API endpoints that will be used for all users. Only administrators can modify these settings.
        </p>

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

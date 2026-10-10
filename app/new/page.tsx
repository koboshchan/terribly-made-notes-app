'use client';

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";

export default function NewNote() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<'english' | 'other'>('english');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [queueProgress, setQueueProgress] = useState(0);
  const [processProgress, setProcessProgress] = useState(0);
  const [currentStatus, setCurrentStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorNoteId, setErrorNoteId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userClasses, setUserClasses] = useState<Array<{_id: string, name: string}>>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [generateFlashcards, setGenerateFlashcards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);
  // Stable per selected file so retries of the same attempt are deduplicated server-side
  const idempotencyKey = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);
  const pollGeneration = useRef(0);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    fetch('/api/user/classes')
      .then(res => (res.ok ? res.json() : []))
      .then(data => { if (Array.isArray(data)) setUserClasses(data); })
      .catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/');
    }
  }, [isLoaded, isSignedIn, router]);

  const handleFileSelect = (selectedFile: File) => {
    // Check if file is audio
    if (!selectedFile.type.startsWith('audio/') && !/\.(mp3|m4a|wav|aac|ogg|opus|flac|webm|mp4)$/i.test(selectedFile.name)) {
      alert('Please select an audio file.');
      return;
    }

    setFile(selectedFile);
    idempotencyKey.current = crypto.randomUUID();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const uploadFile = async () => {
    if (!file) return;

    setUploading(true);
    setUploadError('');
    setErrorNoteId(null);
    setUploadProgress(0);
    setQueueProgress(0);
    setProcessProgress(0);
    setCurrentStatus('Preparing upload...');

    return new Promise<void>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language', language);
      if (selectedClass) formData.append('className', selectedClass);
      formData.append('generateFlashcards', String(generateFlashcards));
      formData.append('generateQuiz', String(generateQuiz));
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percentComplete);
          setCurrentStatus(`Uploading: ${percentComplete}%`);
        }
      });

      xhr.addEventListener('load', () => {
        let result: { noteId?: unknown; error?: unknown } = {};
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed && typeof parsed === 'object') result = parsed;
        } catch {}
        // Text only: never render raw server bodies, cap length
        const serverError = typeof result.error === 'string' ? result.error.trim().slice(0, 300) : '';
        const fail = (fallback: string) => {
          const msg = serverError || fallback;
          setUploadError(msg);
          setCurrentStatus(msg);
          setUploading(false);
          showNotification(msg, true);
          reject(new Error(msg));
        };
        if (xhr.status >= 200 && xhr.status < 300) {
          if (typeof result.noteId !== 'string' || !result.noteId) {
            fail('Upload failed: unexpected server response.');
            return;
          }
          setCurrentStatus('Upload complete! Processing...');
          pollProgress(result.noteId);
          resolve();
        } else {
          fail(`Upload failed (HTTP ${xhr.status}). Please try again.`);
        }
      });

      xhr.addEventListener('error', () => {
        console.error('Upload failed');
        const msg = 'Upload failed: network error. Please try again.';
        setUploadError(msg);
        setCurrentStatus(msg);
        setUploading(false);
        showNotification(msg, true);
        reject(new Error(msg));
      });

      xhr.addEventListener('timeout', () => {
        const msg = 'Upload timed out. Please try again.';
        setUploadError(msg);
        setCurrentStatus(msg);
        setUploading(false);
        showNotification(msg, true);
        reject(new Error(msg));
      });

      xhr.addEventListener('abort', () => {
        setUploading(false);
        reject(new Error('Upload cancelled'));
      });

      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('Idempotency-Key', idempotencyKey.current);
      xhr.send(formData);
    });
  };

  const stopPolling = () => {
    pollGeneration.current += 1;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const pollProgress = async (noteId: string) => {
    // Each poll chain owns a generation; reset/unmount/new chain invalidates older ones
    const generation = ++pollGeneration.current;
    const tick = async () => {
      if (unmounted.current || generation !== pollGeneration.current) return;
      const schedule = (ms: number) => {
        if (unmounted.current || generation !== pollGeneration.current) return;
        pollTimer.current = setTimeout(tick, ms);
      };
      try {
        const response = await fetch(`/api/notes/${noteId}/progress`);
        if (unmounted.current || generation !== pollGeneration.current) return;
        if (!response.ok) {
          schedule(2000);
          return;
        }
        const progress = await response.json();
        if (unmounted.current || generation !== pollGeneration.current) return;

        const status: string = typeof progress.status === 'string' ? progress.status : '';
        const failed = status === 'error' || status.includes('Error:');
        const providerError: string = typeof progress.error === 'string' ? progress.error : '';

        setQueueProgress(progress.queueProgress ?? 0);
        setProcessProgress(progress.processProgress ?? 0);

        if (status === 'completed') {
          setCurrentStatus(status);
          setUploading(false);
          showNotification('Note created successfully!', false);
          router.push(`/note/${noteId}`);
        } else if (failed) {
          const detail = providerError || (status !== 'error' ? status : '') || 'Processing failed';
          setCurrentStatus(detail);
          setUploading(false);
          setErrorNoteId(noteId);
          showNotification(`Processing failed: ${detail}`, true);
        } else {
          setCurrentStatus(progress.message || status);
          schedule(1000);
        }
      } catch (error) {
        if (unmounted.current || generation !== pollGeneration.current) return;
        console.error('Failed to get progress:', error);
        schedule(2000);
      }
    };
    await tick();
  };

  const showNotification = (message: string, isError: boolean) => {
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 5000);
  };

  const resetUpload = () => {
    stopPolling();
    setUploadError('');
    idempotencyKey.current = null;
    setFile(null);
    setLanguage('english');
    setUploading(false);
    setErrorNoteId(null);
    setUploadProgress(0);
    setQueueProgress(0);
    setProcessProgress(0);
    setCurrentStatus('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRetry = async () => {
    if (!errorNoteId) return;
    setRetrying(true);
    setUploading(true);
    setErrorNoteId(null);
    setCurrentStatus('Retrying processing...');
    try {
      const response = await fetch(`/api/notes/${errorNoteId}/retry`, {
        method: 'POST',
      });
      if (response.ok) {
        pollProgress(errorNoteId);
      } else {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to retry');
      }
    } catch (err: any) {
      console.error(err);
      showNotification(err.message || 'Retry failed', true);
      setErrorNoteId(errorNoteId);
      setUploading(false);
      setCurrentStatus(err.message || 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  if (!isLoaded || !isSignedIn) {
    return <div className="container">Loading...</div>;
  }

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginBottom: '20px' }}>Create New Note</h2>

        {!file && !uploading && (
          <div
            className={`upload-area ${isDragOver ? 'dragover' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <p style={{ fontSize: '18px', marginBottom: '10px' }}>
              Drop an audio file here or click to select
            </p>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              Supported formats: MP3, WAV, M4A, OGG, FLAC
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3, .wav, .m4a, .aac, audio/*"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {file && !uploading && (
          <div style={{ textAlign: 'center' }}>
            {errorNoteId && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '20px',
                textAlign: 'center'
              }}>
                <strong style={{ color: '#ef4444' }}>⚠️ Processing Failed: {currentStatus}</strong>
              </div>
            )}

            {uploadError && (
              <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', padding: '12px', marginBottom: '20px', color: '#b91c1c', overflowWrap: 'anywhere' }}>
                {uploadError}
              </div>
            )}

            <p style={{ marginBottom: '20px' }}>
              Selected file: <strong>{file.name}</strong>
            </p>

            <div style={{ marginBottom: '20px' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '8px' }}>
                Audio Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'english' | 'other')}
                className="form-select"
                style={{ maxWidth: '200px', margin: '0 auto' }}
              >
                <option value="english">English</option>
                <option value="other">Other Language</option>
              </select>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Select the primary language of the audio
              </p>
            </div>

            {userClasses.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label className="form-label" htmlFor="upload-class" style={{ display: 'block', marginBottom: '8px' }}>
                  Class
                </label>
                <select
                  id="upload-class"
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className="form-select"
                  style={{ maxWidth: '200px', margin: '0 auto' }}
                >
                  <option value="">No class</option>
                  {userClasses.map(c => (
                    <option key={c._id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <fieldset style={{ marginBottom: '20px', border: 'none', padding: 0, display: 'flex', gap: '16px', justifyContent: 'center' }}>
              <legend className="form-label" style={{ marginBottom: '8px', width: '100%' }}>Study materials</legend>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="checkbox" checked={generateFlashcards} onChange={(e) => setGenerateFlashcards(e.target.checked)} />
                Flashcards
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="checkbox" checked={generateQuiz} onChange={(e) => setGenerateQuiz(e.target.checked)} />
                Quiz
              </label>
            </fieldset>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {errorNoteId ? (
                <button onClick={handleRetry} className="btn btn-success" disabled={retrying}>
                  {retrying ? 'Retrying...' : 'Retry Processing'}
                </button>
              ) : (
                <button onClick={() => { uploadFile().catch(() => {}); }} className="btn btn-primary">
                  Upload & Process
                </button>
              )}
              <button onClick={resetUpload} className="btn btn-secondary" disabled={retrying}>
                Choose Different File
              </button>
            </div>
          </div>
        )}

        {uploading && (
          <div>
            {uploadProgress < 100 && (
              <div style={{
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '20px',
                textAlign: 'center'
              }}>
                <strong>⚠️ Don't leave this page while uploading!</strong>
              </div>
            )}

            {uploadProgress < 100 && (
              <div className="progress-container">
                <div className="progress-label">Upload Progress</div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${uploadProgress}%`,
                      backgroundColor: uploadProgress < 100 ? '#3b82f6' : '#10b981'
                    }}
                  />
                </div>
                <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '14px', color: '#6b7280' }}>
                  {uploadProgress}% of {file ? (file.size / 1024 / 1024).toFixed(2) : 0} MB
                </div>
              </div>
            )}

            {(uploadProgress >= 100 || queueProgress > 0 || processProgress > 0) && (
              <div className="progress-container">
                <div className="progress-label">Queue Position</div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${queueProgress}%` }}
                  />
                </div>
              </div>
            )}

            {(uploadProgress >= 100 || queueProgress >= 100) && (
              <div className="progress-container">
                <div className="progress-label">Processing Progress</div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${processProgress}%`,
                      backgroundColor: processProgress >= 100 ? '#10b981' : '#3b82f6'
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <p style={{ color: '#6b7280' }}>{currentStatus}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

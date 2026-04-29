'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { renderMarkdown, setupMarkdownRenderer } from '@/lib/markdown';

interface SharedNote {
  title: string;
  description: string;
  content: string;
  createdAt: string;
}

export default function SharedNotePage() {
  const params = useParams();
  const router = useRouter();
  const [note, setNote] = useState<SharedNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    setupMarkdownRenderer();

    fetchSharedNote();
  }, []);

  const fetchSharedNote = async () => {
    try {
      const token = params.token as string;
      const response = await fetch(`/api/shared/${token}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('This shared note does not exist or is no longer available.');
        } else {
          setError('Failed to load shared note.');
        }
        return;
      }

      const data = await response.json();
      setNote(data);
    } catch (fetchError) {
      console.error('Failed to fetch shared note:', fetchError);
      setError('Failed to load shared note.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading shared note...</p>
        </div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="container">
        <div className="card">
          <h1 className="shared-title-error">Shared Note</h1>
          <p className="shared-error-text">{error || 'Shared note not found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="shared-toolbar">
        <button
          onClick={() => router.push(`/shared/${params.token}/chat`)}
          className="btn btn-secondary"
        >
          💬 Open Chat
        </button>
      </div>

      <div className="card">
        <header className="shared-header">
          <h1 className="shared-note-title">
            {note.title}
          </h1>
          <p className="shared-note-description">
            {note.description}
          </p>
          <p className="shared-note-date">
            Created on {formatDate(note.createdAt)}
          </p>
        </header>

        <div
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
        />
      </div>
    </div>
  );
}

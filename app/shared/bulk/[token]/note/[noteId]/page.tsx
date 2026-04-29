'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

interface SharedNote {
  _id: string;
  title: string;
  description: string;
  content: string;
  createdAt: string;
}

export default function SharedBulkNotePage() {
  const { token, noteId } = useParams<{ token: string; noteId: string }>();
  const [note, setNote] = useState<SharedNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marked.use(markedKatex({ throwOnError: false, output: 'html' }));

    const fetchNote = async () => {
      try {
        const response = await fetch(`/api/shared-bulk/${token}/notes/${noteId}`);
        if (!response.ok) {
          throw new Error('Shared note not found');
        }
        const data = await response.json();
        setNote(data);
      } catch (err) {
        setError('Shared note not found or unavailable.');
      } finally {
        setLoading(false);
      }
    };

    if (token && noteId) {
      fetchNote();
    }
  }, [token, noteId]);

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
          <h2 className="shared-title-error">Shared note unavailable</h2>
          <p className="shared-error-text">{error || 'This shared note could not be loaded.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="shared-toolbar">
        <Link href={`/shared/bulk/${token}`} className="btn btn-secondary">
          Back to List
        </Link>
        <Link href={`/shared/bulk/${token}/chat?noteId=${noteId}`} className="btn btn-primary">
          Chat This Note
        </Link>
        <Link href={`/shared/bulk/${token}/chat`} className="btn btn-secondary">
          Chat All Notes
        </Link>
      </div>

      <div className="card">
        <div className="shared-header">
          <h1 className="shared-note-title">{note.title}</h1>
          <p className="shared-note-description">{note.description}</p>
          <p className="shared-note-date">Created on {formatDate(note.createdAt)}</p>
        </div>
        <div
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: marked(note.content) }}
        />
      </div>
    </div>
  );
}
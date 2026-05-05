'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { renderMarkdown, setupMarkdownRenderer } from '@/lib/markdown';

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
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    setupMarkdownRenderer();

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

  const sanitizeFileName = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shared-note';
  };

  const buildMarkdown = (sharedNote: SharedNote) => {
    return `# ${sharedNote.title}\n\n${sharedNote.description}\n\n---\n\n${sharedNote.content}`;
  };

  const copyNote = async (sharedNote: SharedNote) => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(buildMarkdown(sharedNote));
    } catch (copyError) {
      console.error('Failed to copy note:', copyError);
    } finally {
      setCopying(false);
    }
  };

  const downloadMarkdown = (sharedNote: SharedNote) => {
    const markdown = buildMarkdown(sharedNote);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeFileName(sharedNote.title)}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
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
        <button
          onClick={() => copyNote(note)}
          className="btn btn-secondary"
          disabled={copying}
        >
          {copying ? 'Copying...' : 'Copy Note'}
        </button>
        <button
          onClick={() => downloadMarkdown(note)}
          className="btn btn-primary"
        >
          Download as .md
        </button>
      </div>

      <div className="card">
        <div className="shared-header">
          <h1 className="shared-note-title">{note.title}</h1>
          <p className="shared-note-description">{note.description}</p>
          <p className="shared-note-date">Created on {formatDate(note.createdAt)}</p>
        </div>
        <div
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
        />
      </div>
    </div>
  );
}
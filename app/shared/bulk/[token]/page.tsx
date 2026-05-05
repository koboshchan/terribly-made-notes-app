'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface SharedNoteSummary {
  _id: string;
  title: string;
  description: string;
  createdAt: string;
}

interface SharedNoteContent extends SharedNoteSummary {
  content: string;
}

export default function SharedBulkPage() {
  const { token } = useParams<{ token: string }>();
  const [notes, setNotes] = useState<SharedNoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    const fetchSharedSet = async () => {
      try {
        const response = await fetch(`/api/shared-bulk/${token}`);
        if (!response.ok) {
          throw new Error('Shared set not found');
        }

        const data = await response.json();
        setNotes(data.notes || []);
      } catch (err) {
        setError('Shared set not found or unavailable.');
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      fetchSharedSet();
    }
  }, [token]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const sanitizeFileName = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shared-notes';
  };

  const downloadAllNotes = async () => {
    if (!token || notes.length === 0) {
      return;
    }

    setDownloadingAll(true);
    try {
      const detailResponses = await Promise.all(
        notes.map((note) =>
          fetch(`/api/shared-bulk/${token}/notes/${note._id}`).then(async (response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch note ${note._id}`);
            }
            return response.json() as Promise<SharedNoteContent>;
          })
        )
      );

      const sections = detailResponses.map((note, index) => {
        const createdDate = new Date(note.createdAt).toLocaleString();
        return [
          `# ${index + 1}. ${note.title}`,
          '',
          `${note.description}`,
          '',
          `Created: ${createdDate}`,
          '',
          '---',
          '',
          note.content,
        ].join('\n');
      });

      const fullMarkdown = sections.join('\n\n\n');
      const blob = new Blob([fullMarkdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${sanitizeFileName(String(token))}-all-notes.md`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      console.error('Failed to download all shared notes:', downloadError);
    } finally {
      setDownloadingAll(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading shared notes...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="card">
          <h2 className="shared-title-error">Shared set unavailable</h2>
          <p className="shared-error-text">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="shared-toolbar">
        <Link href={`/shared/bulk/${token}/chat`} className="btn btn-primary">
          Chat With All Notes
        </Link>
        <button
          onClick={downloadAllNotes}
          className="btn btn-secondary"
          disabled={downloadingAll || notes.length === 0}
        >
          {downloadingAll ? 'Preparing download...' : 'Download All (.md)'}
        </button>
      </div>

      <div className="card">
        <h1 className="shared-bulk-title">Shared Notes</h1>
        {notes.length === 0 ? (
          <p className="shared-error-text">No notes are available in this shared set.</p>
        ) : (
          <div className="note-list">
            {notes.map((note) => (
              <div key={note._id} className="note-item">
                <div className="note-content">
                  <h3 className="note-title">{note.title}</h3>
                  <p className="note-description">{note.description}</p>
                  <p className="note-date">{formatDate(note.createdAt)}</p>
                </div>
                <div className="note-actions">
                  <Link href={`/shared/bulk/${token}/note/${note._id}`} className="btn btn-primary">
                    Open
                  </Link>
                  <Link href={`/shared/bulk/${token}/chat?noteId=${note._id}`} className="btn btn-secondary">
                    Chat This Note
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
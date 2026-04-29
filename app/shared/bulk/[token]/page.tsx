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

export default function SharedBulkPage() {
  const { token } = useParams<{ token: string }>();
  const [notes, setNotes] = useState<SharedNoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
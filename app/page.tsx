'use client';

import { SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Note {
  _id: string;
  title: string;
  description: string;
  createdAt: string;
  recordedAt?: string;
  status: 'processing' | 'completed';
  noteClass?: string;
}

interface Progress {
  queueProgress: number;
  processProgress: number;
  status: string;
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [filteredNotes, setFilteredNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{[key: string]: Progress}>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'uploaded' | 'recorded'>('uploaded');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [userClasses, setUserClasses] = useState<Array<{_id: string, name: string}>>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [bulkShareLink, setBulkShareLink] = useState<string>('');
  const [bulkShareLoading, setBulkShareLoading] = useState(false);
  const pendingRefresh = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchNotes();
    fetchUserClasses();
  }, []);

  const fetchUserClasses = async () => {
    try {
      const response = await fetch('/api/user/classes');
      if (response.ok) {
        const data = await response.json();
        setUserClasses(data);
      }
    } catch (error) {
      console.error('Failed to fetch user classes:', error);
    }
  };

  useEffect(() => {
    // Poll progress for processing notes
    const processingNotes = notes.filter(note => note.status === 'processing');
    if (processingNotes.length > 0) {
      const interval = setInterval(() => {
        processingNotes.forEach(note => {
          fetchProgress(note._id);
        });
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [notes]);

  const fetchNotes = async () => {
    try {
      const params = new URLSearchParams({
        sortBy,
        sortOrder,
        search: searchTerm,
      });
      const response = await fetch(`/api/notes?${params}`);
      if (response.ok) {
        const data = await response.json();
        setNotes(data);
        setFilteredNotes(data);
      }
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort notes when search term or sort options change
  useEffect(() => {
    let filtered = [...notes];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(note =>
        note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        note.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply class filter
    if (classFilter !== 'all') {
      if (classFilter === 'unclassified') {
        filtered = filtered.filter(note => !note.noteClass);
      } else {
        filtered = filtered.filter(note => note.noteClass === classFilter);
      }
    }

    // Apply sorting
    filtered.sort((a, b) => {
      const dateA = sortBy === 'uploaded' ? new Date(a.createdAt) : new Date(a.recordedAt || a.createdAt);
      const dateB = sortBy === 'uploaded' ? new Date(b.createdAt) : new Date(b.recordedAt || b.createdAt);

      if (sortOrder === 'desc') {
        return dateB.getTime() - dateA.getTime();
      } else {
        return dateA.getTime() - dateB.getTime();
      }
    });

    setFilteredNotes(filtered);
  }, [notes, searchTerm, sortBy, sortOrder, classFilter]);

  const fetchProgress = async (noteId: string) => {
    try {
      const response = await fetch(`/api/notes/${noteId}/progress`);
      if (response.ok) {
        const progressData = await response.json();
        setProgress(prev => ({
          ...prev,
          [noteId]: progressData
        }));

        // If completed, refresh notes list after 1 second so the "completed" progress bar is visible
        if (progressData.status === 'completed' && !pendingRefresh.current.has(noteId)) {
          pendingRefresh.current.add(noteId);
          setTimeout(() => {
            pendingRefresh.current.delete(noteId);
            fetchNotes();
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Failed to fetch progress:', error);
    }
  };

  const deleteNote = async (id: string) => {
    if (!confirm('Are you sure you want to delete this note?')) {
      return;
    }

    try {
      const response = await fetch(`/api/notes/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setNotes(notes.filter(note => note._id !== id));
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleNoteSelection = (noteId: string) => {
    setSelectedNoteIds(prevSelected =>
      prevSelected.includes(noteId)
        ? prevSelected.filter(id => id !== noteId)
        : [...prevSelected, noteId]
    );
  };

  const selectedShareableIds = selectedNoteIds.filter((id) => {
    const note = notes.find((n) => n._id === id);
    return note?.status === 'completed';
  });

  const createBulkShareLink = async () => {
    if (selectedShareableIds.length === 0 || bulkShareLoading) return;

    setBulkShareLoading(true);
    try {
      const response = await fetch('/api/notes/share-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ noteIds: selectedShareableIds }),
      });

      if (!response.ok) {
        throw new Error('Failed to create bulk share link');
      }

      const data = await response.json();
      setBulkShareLink(data.shareUrl);

      try {
        await navigator.clipboard.writeText(data.shareUrl);
        alert('Bulk share link copied to clipboard!');
      } catch (clipboardError) {
        console.warn('Clipboard not available:', clipboardError);
        alert(`Bulk share link created: ${data.shareUrl}`);
      }
    } catch (error) {
      console.error('Failed to create bulk share link:', error);
      alert('Failed to create bulk share link. Please try again.');
    } finally {
      setBulkShareLoading(false);
    }
  };

  return (
    <div className="container">
      <SignedOut>
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>Welcome to terribly made notes app</h2>
          <p style={{ margin: '20px 0', color: '#64748b' }}>
            Sign in to start creating AI-powered notes from your audio recordings.
          </p>
        </div>
      </SignedOut>

      <SignedIn>
        <div style={{
          marginBottom: '30px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <Link href="/new" className="btn btn-primary">
            + New Note
          </Link>
          <Link href="/settings" className="btn btn-secondary">
            ⚙️ Settings
          </Link>
          <button
            onClick={() => {
              setIsSelectionMode(!isSelectionMode);
              setSelectedNoteIds([]); // Clear selection when toggling off
            }}
            className="btn btn-secondary"
          >
            {isSelectionMode ? 'Cancel Selection' : 'Select Notes'}
          </button>
          {isSelectionMode && (
            <>
              <button
                onClick={() => {
                  if (selectedNoteIds.length === filteredNotes.length) {
                    setSelectedNoteIds([]); // Deselect all if all are selected
                  } else {
                    setSelectedNoteIds(filteredNotes.map(note => note._id)); // Select all
                  }
                }}
                className="btn btn-secondary"
                style={{ marginLeft: '8px' }}
              >
                {selectedNoteIds.length === filteredNotes.length && filteredNotes.length > 0 ? 'Deselect All' : 'Select All'}
              </button>
              <Link
                href={`/chat-multi?noteIds=${selectedNoteIds.join(',')}`}
                className={`btn btn-primary ${selectedNoteIds.length === 0 ? 'btn-disabled' : ''}`}
                style={{ marginLeft: '8px' }}
                aria-disabled={selectedNoteIds.length === 0}
                tabIndex={selectedNoteIds.length === 0 ? -1 : undefined}
              >
                Chat with Selected ({selectedNoteIds.length})
              </Link>
              <button
                onClick={createBulkShareLink}
                className="btn btn-secondary"
                disabled={selectedShareableIds.length === 0 || bulkShareLoading}
              >
                {bulkShareLoading ? 'Creating link...' : `Share Selected (${selectedShareableIds.length})`}
              </button>
            </>
          )}
        </div>

        {isSelectionMode && bulkShareLink && (
          <div className="card bulk-share-link-card">
            <p className="bulk-share-link-title">Bulk share link</p>
            <input
              type="text"
              readOnly
              value={bulkShareLink}
              className="form-input"
              aria-label="Bulk share link"
            />
          </div>
        )}

        <div className="card">
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '20px',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <h2 style={{ margin: 0, minWidth: 'fit-content' }}>Your Notes</h2>
            <div style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              flex: 1,
              minWidth: '280px'
            }}>
              <input
                type="text"
                placeholder="Search notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input"
                style={{ width: '200px', margin: 0, minWidth: '150px', maxWidth: '200px', flex: '1 1 150px' }}
              />
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="form-select"
                style={{ width: 'auto', margin: 0 }}
              >
                <option value="all">All Classes</option>
                <option value="unclassified">Unclassified</option>
                {userClasses.map((noteClass) => (
                  <option key={noteClass._id} value={noteClass.name}>
                    {noteClass.name}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'uploaded' | 'recorded')}
                className="form-select"
                style={{ width: 'auto', margin: 0 }}
              >
                <option value="uploaded">Sort by Upload Time</option>
                <option value="recorded">Sort by Recorded Time</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="btn btn-secondary"
                style={{ padding: '8px 12px', fontSize: '12px' }}
              >
                {sortOrder === 'desc' ? '↓' : '↑'}
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <p>Loading notes...</p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <p style={{ color: '#64748b' }}>
                {notes.length === 0 ? 'No notes yet. Create your first note by uploading an audio file!' : 'No notes match your search.'}
              </p>
            </div>
          ) : (
            <div className="note-list">
              {filteredNotes.map((note) => {
                const noteProgress = progress[note._id];

                return (
                  <div key={note._id} className="note-item" style={{ display: 'flex', alignItems: 'center' }}>
                    {isSelectionMode && (
                      <input
                        type="checkbox"
                        checked={selectedNoteIds.includes(note._id)}
                        onChange={() => handleNoteSelection(note._id)}
                        style={{ marginRight: '15px', transform: 'scale(1.4)' }}
                      />
                    )}
                    <div className="note-content" style={{ flexGrow: 1 }}>
                      <h3 className="note-title">
                        {note.status === 'completed' ? (
                          <Link href={`/note/${note._id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                            {note.title}
                          </Link>
                        ) : (
                          note.title
                        )}
                      </h3>

                      {note.status === 'processing' && noteProgress ? (
                        <div style={{ margin: '12px 0' }}>
                          {noteProgress.queueProgress < 100 && (
                            <div style={{ marginBottom: '8px' }}>
                              <div className="progress-label">Queue Position</div>
                              <div className="progress-bar">
                                <div
                                  className="progress-fill"
                                  style={{ width: `${noteProgress.queueProgress}%` }}
                                />
                              </div>
                            </div>
                          )}
                          <div style={{ marginBottom: '8px' }}>
                            <div className="progress-label">Processing Progress</div>
                            <div className="progress-bar">
                              <div
                                className="progress-fill"
                                style={{ width: `${noteProgress.processProgress}%` }}
                              />
                            </div>
                          </div>
                          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                            {noteProgress.status}
                          </p>
                        </div>
                      ) : (
                        <p className="note-description">
                          {note.status === 'processing' ? 'Initializing...' : note.description}
                        </p>
                      )}

                      <div className="note-date">
                        {note.noteClass && (
                          <p style={{ fontSize: '11px', color: '#3b82f6', fontWeight: '500', marginBottom: '2px' }}>
                            📁 {note.noteClass}
                          </p>
                        )}
                        <p>Uploaded: {formatDate(note.createdAt)}</p>
                        {note.recordedAt && (
                          <p style={{ fontSize: '11px', color: '#9ca3af' }}>
                            Recorded: {formatDate(note.recordedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="note-actions">
                      {note.status === 'completed' && (
                        <Link href={`/note/${note._id}`} className="btn btn-primary" style={{ fontSize: '12px', padding: '8px 12px' }}>
                          View
                        </Link>
                      )}
                      <button
                        onClick={() => deleteNote(note._id)}
                        className="btn btn-danger"
                        style={{ fontSize: '12px', padding: '8px 12px' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SignedIn>
    </div>
  );
}

'use client';

import { useAuth } from "@clerk/nextjs";
import { useRouter, useParams } from "next/navigation";
import { useState, useEffect } from "react";

interface Flashcard {
  front: string;
  back: string;
}

export default function FlashcardsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const params = useParams();
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');

  useEffect(() => {
    const initPage = async () => {
      if (isLoaded && !isSignedIn) {
        router.push('/');
        return;
      }

      if (isLoaded && isSignedIn) {
        await fetchNote();
      }
    };

    initPage();
  }, [isLoaded, isSignedIn]);

  const fetchNote = async () => {
    try {
      const { id } = params;
      const response = await fetch(`/api/notes/${id}`);
      if (response.ok) {
        const data = await response.json();
        setNoteTitle(data.title || 'Note');
        const cards = data.flashcards || [];
        setFlashcards(cards);
        if (cards.length > 0) {
          setCurrentIndex(0);
        }
      } else if (response.status === 404) {
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to fetch note:', error);
    } finally {
      setLoading(false);
    }
  };

  const nextCard = () => {
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setFlipped(false);
    }
  };

  const prevCard = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setFlipped(false);
    }
  };

  const downloadFlashcards = () => {
    const content = JSON.stringify(flashcards, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${noteTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_flashcards.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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

  return (
    <div className="container">
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => router.back()} className="btn btn-secondary">
          ← Back
        </button>
        <button 
          onClick={() => router.push(`/note/${params.id}`)}
          className="btn btn-secondary"
        >
          📄 Note
        </button>
        <button 
          onClick={() => router.push(`/note/${params.id}/chat`)}
          className="btn btn-secondary"
        >
          💬 Chat
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={downloadFlashcards} className="btn btn-primary" disabled={flashcards.length === 0}>
          ↓ Save Cards
        </button>
      </div>

      <div className="card">
        <header style={{ marginBottom: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '5px' }}>
            🎴 Flashcards
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>
            {noteTitle} • {flashcards.length} cards
          </p>
        </header>

        {flashcards.length > 0 ? (
          <>
            <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Card {currentIndex + 1} of {flashcards.length}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={prevCard} disabled={currentIndex === 0} className="btn btn-secondary">
                  ← Previous
                </button>
                <button onClick={nextCard} disabled={currentIndex >= flashcards.length - 1} className="btn btn-secondary">
                  Next →
                </button>
              </div>
            </div>
            <div 
              onClick={() => setFlipped(!flipped)}
              style={{ 
                minHeight: '200px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '40px',
                backgroundColor: flipped ? '#dbeafe' : '#f8fafc',
                border: '2px solid #3b82f6',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '18px',
                lineHeight: '1.6',
                transition: 'all 0.2s'
              }}
            >
              <div>
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '10px' }}>
                  {flipped ? 'Answer' : 'Question'}
                </div>
                {flipped ? flashcards[currentIndex]?.back : flashcards[currentIndex]?.front}
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '15px' }}>
                  Click to flip
                </div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8fafc' }}>
            <p style={{ color: '#6b7280' }}>
              No flashcards available for this note.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

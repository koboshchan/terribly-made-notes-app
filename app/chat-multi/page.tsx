'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useMemo, Suspense } from 'react';
import { renderMarkdown, setupMarkdownRenderer } from '@/lib/markdown';

interface Note {
  _id: string;
  title: string;
  description: string;
  content: string; // Ensure content is always present
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function MultiNoteChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const noteIds = useMemo(() => {
    const noteIdsParam = searchParams.get('noteIds');
    return noteIdsParam ? noteIdsParam.split(',') : [];
  }, [searchParams]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setupMarkdownRenderer();

    if (noteIds.length > 0) {
      fetchNotesContent(noteIds);
    } else {
      setError('No notes selected for chat.');
      setLoading(false);
    }
  }, [noteIds]);

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchNotesContent = async (ids: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const fetchedNotes: Note[] = [];
      for (const id of ids) {
        const response = await fetch(`/api/notes/${id}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch note ${id}`);
        }
        const data = await response.json();
        if (!data.content) {
            console.warn(`Note ${id} has no content.`);
            continue; // Skip notes without content
        }
        fetchedNotes.push(data);
      }
      setNotes(fetchedNotes);
      setChatMessages([{
        role: 'assistant',
        content: `Hi! I'm here to help you with questions about your selected notes. What would you like to know?`
      }]);
    } catch (err: any) {
      console.error('Error fetching notes for chat:', err);
      setError(err.message || 'Failed to load notes.');
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatLoading(true);

    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const response = await fetch(`/api/chat-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: chatMessages,
          noteIds: notes.map(note => note._id),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setChatMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      } else {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.'
        }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.'
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const clearChat = () => {
    setChatMessages([{
      role: 'assistant',
      content: `Hi! I'm here to help you with questions about your selected notes. What would you like to know?`
    }]);
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading notes for chat...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="container" style={{ color: 'red' }}>Error: {error}</div>;
  }

  if (notes.length === 0) {
    return (
      <div className="container">
        <div className="card">
          <p>No valid notes found to chat about. Please go back and select some notes with content.</p>
          <button onClick={() => router.push('/')} className="btn btn-primary" style={{ marginTop: '15px' }}>
            Go back to notes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button onClick={() => router.back()} className="btn btn-secondary">
          ← Back to Notes
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={clearChat} className="btn btn-secondary">
          Clear Chat
        </button>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '15px' }}>
          Chat about Selected Notes
        </h2>

        {/* Notes in Context Display */}
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f0f4f8', borderRadius: '8px' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Notes in Context:</h3>
          <ul style={{ listStyleType: 'disc', paddingLeft: '20px' }}>
            {notes.map(note => (
              <li key={note._id} style={{ marginBottom: '5px' }}>
                <strong>{note.title}</strong>: {note.description.substring(0, 100)}...
              </li>
            ))}
          </ul>
        </div>

        {/* Chat Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '15px',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          marginBottom: '15px',
          minHeight: '400px' // Ensure chat area has a minimum height
        }}>
          {chatMessages.map((msg, index) => (
            <div
              key={index}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: msg.role === 'user' ? '80%' : '100%',
                padding: msg.role === 'user' ? '12px 16px' : '0',
                borderRadius: '12px',
                backgroundColor: msg.role === 'user' ? '#3b82f6' : 'transparent',
                color: msg.role === 'user' ? 'white' : '#1e293b',
                border: msg.role === 'assistant' ? 'none' : 'none',
                boxShadow: msg.role === 'user' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {msg.role === 'user' ? (
                <div style={{ padding: '12px 16px' }}>
                  {msg.content}
                </div>
              ) : (
                <div
                  className="markdown-content"
                  style={{
                    padding: '16px',
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              )}
            </div>
          ))}
          {chatLoading && (
            <div style={{
              alignSelf: 'flex-start',
              padding: '12px 16px',
              borderRadius: '12px',
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              color: '#6b7280',
              fontStyle: 'italic'
            }}>
              Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
            placeholder="Ask a question about these notes..."
            className="form-input"
            style={{ flex: 1 }}
            disabled={chatLoading}
          />
          <button
            onClick={sendChatMessage}
            className="btn btn-primary"
            disabled={!chatInput.trim() || chatLoading}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MultiNoteChat() {
  return (
    <Suspense fallback={<div>Loading chat...</div>}>
      <MultiNoteChatContent />
    </Suspense>
  );
}

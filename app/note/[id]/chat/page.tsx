'use client';

import { useAuth } from "@clerk/nextjs";
import { useRouter, useParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { renderMarkdown, setupMarkdownRenderer } from '@/lib/markdown';

interface Note {
  _id: string;
  title: string;
  description: string;
  content: string;
  createdAt: string;
  status: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function NoteChatPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const params = useParams();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setupMarkdownRenderer();

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

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchNote = async () => {
    try {
      const { id } = await params;
      const response = await fetch(`/api/notes/${id}`);
      if (response.ok) {
        const data = await response.json();
        setNote(data);
        // Initialize chat with welcome message
        setChatMessages([{
          role: 'assistant',
          content: `Hi! I'm here to help you with questions about "${data.title}". What would you like to know?`
        }]);
      } else {
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to fetch note:', error);
      router.push('/');
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
      const { id } = await params;
      const response = await fetch(`/api/notes/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: chatMessages
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
      content: `Hi! I'm here to help you with questions about "${note?.title}". What would you like to know?`
    }]);
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

  if (!isSignedIn || !note) {
    return null;
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button onClick={() => router.back()} className="btn btn-secondary">
          ← Back to Note
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={clearChat} className="btn btn-secondary">
          Clear Chat
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showNotePreview() ? '1fr 1fr' : '1fr', gap: '20px' }}>
        {/* Note Content Preview */}
        {showNotePreview() && (
          <div className="card">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '15px' }}>
              Note Reference
            </h2>
            <div 
              className="markdown-content"
              style={{ maxHeight: '70vh', overflowY: 'auto' }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
            />
          </div>
        )}

        {/* Chat Panel */}
        <div className="card" style={{ 
          display: 'flex',
          flexDirection: 'column',
          height: showNotePreview() ? '70vh' : '80vh'
        }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '15px' }}>
            Chat about "{note.title}"
          </h2>

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
            marginBottom: '15px'
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
              placeholder="Ask a question about this note..."
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
    </div>
  );

  function showNotePreview() {
    return typeof window !== 'undefined' && window.innerWidth > 1024;
  }
}

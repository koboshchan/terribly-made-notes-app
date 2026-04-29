'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function SharedBulkChatContent() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const noteId = searchParams.get('noteId') || undefined;
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    marked.use(markedKatex({ throwOnError: false, output: 'html' }));

    setChatMessages([
      {
        role: 'assistant',
        content: noteId
          ? 'Hi! Ask anything about this shared note.'
          : 'Hi! Ask anything about these shared notes. I can use all notes as context.',
      },
    ]);
    setLoading(false);
  }, [noteId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatLoading(true);
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    try {
      const response = await fetch(`/api/shared-bulk/${token}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: chatMessages,
          noteId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send chat message');
      }

      const data = await response.json();
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.message }]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const clearChat = () => {
    setChatMessages([
      {
        role: 'assistant',
        content: noteId
          ? 'Hi! Ask anything about this shared note.'
          : 'Hi! Ask anything about these shared notes. I can use all notes as context.',
      },
    ]);
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading chat...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="card">
          <p className="shared-error-text">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="shared-chat-toolbar">
        <Link href={`/shared/bulk/${token}`} className="btn btn-secondary">
          Back to Notes
        </Link>
        {noteId && (
          <Link href={`/shared/bulk/${token}/chat`} className="btn btn-secondary">
            Switch to Chat All
          </Link>
        )}
        <div className="shared-flex-spacer" />
        <button onClick={clearChat} className="btn btn-secondary">
          Clear Chat
        </button>
      </div>

      <div className="card shared-chat-card">
        <h2 className="shared-chat-title">{noteId ? 'Chat This Note' : 'Chat All Notes'}</h2>

        <div className="shared-chat-messages">
          {chatMessages.map((msg, index) => (
            <div
              key={index}
              className={msg.role === 'user' ? 'shared-chat-message-user' : 'shared-chat-message-assistant'}
            >
              {msg.role === 'user' ? (
                <div className="shared-chat-user-bubble">{msg.content}</div>
              ) : (
                <div
                  className="markdown-content shared-chat-assistant-bubble"
                  dangerouslySetInnerHTML={{ __html: marked(msg.content) }}
                />
              )}
            </div>
          ))}

          {chatLoading && <div className="shared-chat-thinking">Thinking...</div>}
          <div ref={messagesEndRef} />
        </div>

        <div className="shared-chat-input-row">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                sendChatMessage();
              }
            }}
            placeholder={noteId ? 'Ask about this note...' : 'Ask about all notes...'}
            className="form-input"
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

export default function SharedBulkChatPage() {
  return (
    <Suspense fallback={<div className="container"><div className="card"><p>Loading chat...</p></div></div>}>
      <SharedBulkChatContent />
    </Suspense>
  );
}
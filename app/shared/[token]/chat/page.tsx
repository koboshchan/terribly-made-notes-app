'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

interface SharedNote {
  title: string;
  content: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function SharedNoteChatPage() {
  const params = useParams();
  const router = useRouter();
  const [note, setNote] = useState<SharedNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadMhchem = async () => {
      try {
        // @ts-ignore - mhchem extension doesn't have TypeScript declarations but works
        await import('katex/contrib/mhchem');
      } catch (e) {
        console.warn('Could not load mhchem extension:', e);
      }
    };
    loadMhchem();

    marked.use(markedKatex({
      throwOnError: false,
      output: 'html'
    }));

    fetchSharedNote();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const fetchSharedNote = async () => {
    try {
      const token = params.token as string;
      const response = await fetch(`/api/shared/${token}`);

      if (!response.ok) {
        router.push(`/shared/${token}`);
        return;
      }

      const data = await response.json();
      setNote(data);
      setChatMessages([{
        role: 'assistant',
        content: `Hi! I'm here to help you with questions about \"${data.title}\". What would you like to know?`
      }]);
    } catch (error) {
      console.error('Failed to fetch shared note:', error);
      router.push(`/shared/${params.token}`);
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const token = params.token as string;
    const userMessage = chatInput.trim();
    const nextHistory = [...chatMessages, { role: 'user' as const, content: userMessage }];

    setChatInput('');
    setChatLoading(true);
    setChatMessages(nextHistory);

    try {
      const response = await fetch(`/api/shared/${token}/chat`, {
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
      console.error('Shared chat error:', error);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.'
      }]);
    } finally {
      setChatLoading(false);
    }
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

  if (!note) {
    return null;
  }

  return (
    <div className="container">
      <div className="shared-chat-toolbar">
        <button onClick={() => router.push(`/shared/${params.token}`)} className="btn btn-secondary">
          ← Back to Shared Note
        </button>
      </div>

      <div className="card shared-chat-card">
        <h2 className="shared-chat-title">
          Chat about "{note.title}"
        </h2>

        <div className="shared-chat-messages">
          {chatMessages.map((msg, index) => (
            <div
              key={index}
              className={msg.role === 'user' ? 'shared-chat-message-user' : 'shared-chat-message-assistant'}
            >
              {msg.role === 'user' ? (
                <div className="shared-chat-user-bubble">
                  {msg.content}
                </div>
              ) : (
                <div
                  className="markdown-content shared-chat-assistant-bubble"
                  dangerouslySetInnerHTML={{ __html: marked(msg.content) }}
                />
              )}
            </div>
          ))}

          {chatLoading && (
            <div className="shared-chat-thinking">
              Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="shared-chat-input-row">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
            placeholder="Ask a question about this note..."
            className="form-input"
            aria-label="Chat input"
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

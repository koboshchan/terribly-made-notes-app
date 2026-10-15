'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ShareSettingsBody {
  allowChat?: boolean;
}

export function formatExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return 'Never expires';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'Never expires';
  if (date.getTime() < Date.now()) return `Expired ${date.toLocaleDateString()}`;
  return `Expires ${date.toLocaleDateString()}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareWarning() {
  return (
    <p className="share-warning" role="note">
      Anyone with this link can read these notes without signing in. Delete the share link to stop access. Your notes are not deleted.
    </p>
  );
}

/** AI chat permission inputs, shared by single and bulk share UIs. */
export function ShareOptions({
  idPrefix,
  allowChat,
  onAllowChatChange,
  disabled,
}: {
  idPrefix: string;
  allowChat: boolean;
  onAllowChatChange: (allow: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="share-options">
      <label htmlFor={`${idPrefix}-chat`} className="share-option share-checkbox">
        <input
          id={`${idPrefix}-chat`}
          type="checkbox"
          checked={allowChat}
          disabled={disabled}
          onChange={(e) => onAllowChatChange(e.target.checked)}
        />
        <span>
          Let link viewers use AI chat
          <small>Off by default. Chat runs on your account&apos;s AI usage.</small>
        </span>
      </label>
    </div>
  );
}

/** Body sent to the API. Expiry is set by the admin's global policy, never by the user. */
export function buildShareBody(allowChat: boolean): ShareSettingsBody {
  return { allowChat };
}

interface ShareState {
  shareUrl: string | null;
  shareEnabled: boolean;
  shareExpiresAt: string | null;
  shareAllowChat: boolean;
}

/** Owner share-management panel for a single note. */
export function NoteShareManager({ noteId, canShare }: { noteId: string; canShare: boolean }) {
  const [state, setState] = useState<ShareState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [allowChat, setAllowChat] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${noteId}/share`);
      if (!res.ok) return;
      const data = await res.json();
      setState({
        shareUrl: data.shareUrl ?? null,
        shareEnabled: Boolean(data.shareEnabled ?? data.shareUrl),
        shareExpiresAt: data.shareExpiresAt ?? null,
        shareAllowChat: Boolean(data.shareAllowChat),
      });
      setAllowChat(Boolean(data.shareAllowChat));
    } catch (e) {
      console.error('Failed to load share settings:', e);
    }
  }, [noteId]);

  useEffect(() => { load(); }, [load]);

  const active = Boolean(state?.shareEnabled && state.shareUrl);

  const send = async (method: 'POST' | 'PATCH' | 'DELETE', body?: ShareSettingsBody, message?: string) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const res = await fetch(`/api/notes/${noteId}/share`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request failed');
      await load();
      if (method === 'POST' && data.shareUrl && (await copyText(data.shareUrl))) {
        setStatus('Link created and copied.');
        return;
      }
      if (message) setStatus(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const createLink = () => send('POST', buildShareBody(allowChat));
  const saveSettings = () => send('PATCH', buildShareBody(allowChat), 'Share settings saved.');
  const deleteLink = () => {
    if (!confirm('Delete this share link? Anyone using it will lose access. Your notes are not deleted.')) return;
    send('DELETE', undefined, 'Share link deleted.');
  };
  const onAllowChatChange = (allow: boolean) => {
    if (allow && !confirm('Anyone with the link will be able to chat with AI about this note, using your account. Allow?')) return;
    setAllowChat(allow);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-secondary"
        disabled={!canShare && !active}
        aria-expanded={open}
        aria-controls="note-share-panel"
      >
        <span aria-hidden="true">🔗 </span>{active ? 'Sharing' : 'Share'}
      </button>
      {open && (
        <section id="note-share-panel" className="card share-panel" aria-label="Share settings">
          <div className="share-panel-head">
            <h2 className="share-panel-title">Public link</h2>
            <span className={`share-badge ${active ? 'is-on' : ''}`}>
              {active ? formatExpiry(state?.shareExpiresAt) : 'Not shared'}
            </span>
          </div>
          <ShareWarning />
          {active && state?.shareUrl && (
            <div className="share-url-row">
              <input
                value={state.shareUrl}
                readOnly
                className="form-input"
                aria-label="Public share link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="btn btn-secondary" onClick={async () => setStatus((await copyText(state.shareUrl!)) ? 'Copied.' : 'Copy failed.')}>
                Copy
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => window.open(state.shareUrl!, '_blank', 'noopener,noreferrer')}>
                Open
              </button>
            </div>
          )}
          <ShareOptions
            idPrefix="note-share"
            allowChat={allowChat}
            onAllowChatChange={onAllowChatChange}
            disabled={busy}
          />
          <div className="share-actions">
            {active ? (
              <>
                <button type="button" className="btn btn-primary" onClick={saveSettings} disabled={busy}>Save settings</button>
                <button type="button" className="btn btn-danger" onClick={deleteLink} disabled={busy}>Delete share link</button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={createLink} disabled={busy || !canShare}>
                {busy ? 'Creating…' : 'Create link'}
              </button>
            )}
          </div>
          <p className="share-status" role="status" aria-live="polite">
            {error ? <span className="share-error">{error}</span> : status}
          </p>
        </section>
      )}
    </>
  );
}

interface BulkShare {
  token: string;
  shareUrl: string;
  noteIds: string[];
  expiresAt: string | null;
  allowChat: boolean;
}

/** Owner list of bulk share links with per-link and "delete all" controls. */
export function BulkShareManager() {
  const [shares, setShares] = useState<BulkShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notes/share-bulk');
      if (res.ok) {
        const data = await res.json();
        setShares(Array.isArray(data.shares) ? data.shares : []);
      }
    } catch (e) {
      console.error('Failed to load bulk shares:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async (method: 'PATCH' | 'DELETE', token: string, extra: ShareSettingsBody, message: string) => {
    setBusyToken(token);
    setStatus('');
    try {
      const res = await fetch('/api/notes/share-bulk', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...extra }),
      });
      if (!res.ok) throw new Error();
      setStatus(message);
      await load();
    } catch {
      setStatus('That didn’t work. Try again.');
    } finally {
      setBusyToken(null);
    }
  };

  const deleteAll = async () => {
    if (!confirm(`Delete all ${shares.length} share links? Your notes are not deleted.`)) return;
    for (const s of shares) {
      await send('DELETE', s.token, {}, 'All share links deleted.');
    }
  };

  return (
    <section className="card share-panel" aria-labelledby="bulk-shares-title">
      <div className="share-panel-head">
        <h2 id="bulk-shares-title" className="share-panel-title">Shared note collections</h2>
        {shares.length > 1 && (
          <button type="button" className="btn btn-danger" onClick={deleteAll} disabled={busyToken !== null}>
            Delete all share links
          </button>
        )}
      </div>
      <ShareWarning />
      {loading ? (
        <p className="share-muted">Loading…</p>
      ) : shares.length === 0 ? (
        <p className="share-muted">No multi-note links. Create one by selecting notes on the home page.</p>
      ) : (
        <ul className="share-list">
          {shares.map((s) => (
            <BulkShareRow key={s.token} share={s} busy={busyToken === s.token} onSend={send} />
          ))}
        </ul>
      )}
      <p className="share-status" role="status" aria-live="polite">{status}</p>
    </section>
  );
}

function BulkShareRow({
  share,
  busy,
  onSend,
}: {
  share: BulkShare;
  busy: boolean;
  onSend: (method: 'PATCH' | 'DELETE', token: string, extra: ShareSettingsBody, message: string) => void;
}) {
  const [allowChat, setAllowChat] = useState(share.allowChat);
  const id = `bulk-${share.token.slice(0, 8)}`;

  return (
    <li className="share-list-item">
      <div className="share-panel-head">
        <strong>{share.noteIds.length} note{share.noteIds.length === 1 ? '' : 's'}</strong>
        <span className="share-badge is-on">{formatExpiry(share.expiresAt)}{share.allowChat ? ' · AI chat on' : ''}</span>
      </div>
      <div className="share-url-row">
        <input value={share.shareUrl} readOnly className="form-input" aria-label={`Share link for ${share.noteIds.length} notes`} />
        <button type="button" className="btn btn-secondary" onClick={() => copyText(share.shareUrl)}>Copy</button>
      </div>
      <ShareOptions
        idPrefix={id}
        allowChat={allowChat}
        onAllowChatChange={(allow) => {
          if (allow && !confirm('Anyone with the link will be able to chat with AI about these notes, using your account. Allow?')) return;
          setAllowChat(allow);
        }}
        disabled={busy}
      />
      <div className="share-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSend('PATCH', share.token, buildShareBody(allowChat), 'Settings saved.')}>Save</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => confirm('Delete this share link? Your notes are not deleted.') && onSend('DELETE', share.token, {}, 'Share link deleted.')}>Delete share link</button>
      </div>
    </li>
  );
}

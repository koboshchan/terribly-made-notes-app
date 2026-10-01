'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ShareSettingsBody {
  expiresInDays?: number;
  allowChat?: boolean;
  rotate?: boolean;
}

const EXPIRY_OPTIONS: { label: string; value: number }[] = [
  { label: '1 day', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '365 days (max)', value: 365 },
];

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
      Anyone with this link can read these notes without signing in. Revoke the link to stop access.
    </p>
  );
}

/** Expiry + AI chat permission inputs, shared by single and bulk share UIs. */
export function ShareOptions({
  idPrefix,
  expiresInDays,
  allowChat,
  onExpiresChange,
  onAllowChatChange,
  disabled,
}: {
  idPrefix: string;
  expiresInDays: number;
  allowChat: boolean;
  onExpiresChange: (days: number) => void;
  onAllowChatChange: (allow: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="share-options">
      <label htmlFor={`${idPrefix}-expiry`} className="share-option">
        <span>Link expires after</span>
        <select
          id={`${idPrefix}-expiry`}
          className="form-select share-select"
          value={expiresInDays}
          disabled={disabled}
          onChange={(e) => onExpiresChange(Number(e.target.value))}
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
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

/** Body sent to the API. Server requires expiresInDays in 1-365; always send a JSON body. */
export function buildShareBody(expiresInDays: number, allowChat: boolean, rotate?: boolean): ShareSettingsBody {
  const days = Number.isFinite(expiresInDays) ? Math.min(365, Math.max(1, Math.round(expiresInDays))) : 30;
  const body: ShareSettingsBody = { expiresInDays: days, allowChat };
  if (rotate) body.rotate = true;
  return body;
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
  const [expiresInDays, setExpiresInDays] = useState(30);
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

  const createLink = () => send('POST', buildShareBody(expiresInDays, allowChat));
  const saveSettings = () => send('PATCH', buildShareBody(expiresInDays, allowChat), 'Share settings saved.');
  const rotate = () => {
    if (!confirm('Create a new link? The current link will stop working.')) return;
    send('PATCH', buildShareBody(expiresInDays, allowChat, true), 'New link created. The old link no longer works.');
  };
  const revoke = () => {
    if (!confirm('Revoke this link? Anyone using it will lose access.')) return;
    send('DELETE', undefined, 'Link revoked.');
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
            expiresInDays={expiresInDays}
            allowChat={allowChat}
            onExpiresChange={setExpiresInDays}
            onAllowChatChange={onAllowChatChange}
            disabled={busy}
          />
          <div className="share-actions">
            {active ? (
              <>
                <button type="button" className="btn btn-primary" onClick={saveSettings} disabled={busy}>Save settings</button>
                <button type="button" className="btn btn-secondary" onClick={rotate} disabled={busy}>New link</button>
                <button type="button" className="btn btn-danger" onClick={revoke} disabled={busy}>Revoke</button>
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

/** Owner list of bulk share links with per-link and "revoke all" controls. */
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

  const revokeAll = async () => {
    if (!confirm(`Revoke all ${shares.length} shared links?`)) return;
    for (const s of shares) {
      await send('DELETE', s.token, {}, 'All links revoked.');
    }
  };

  return (
    <section className="card share-panel" aria-labelledby="bulk-shares-title">
      <div className="share-panel-head">
        <h2 id="bulk-shares-title" className="share-panel-title">Shared note collections</h2>
        {shares.length > 1 && (
          <button type="button" className="btn btn-danger" onClick={revokeAll} disabled={busyToken !== null}>
            Revoke all
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
  const [expiresInDays, setExpiresInDays] = useState(30);
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
        expiresInDays={expiresInDays}
        allowChat={allowChat}
        onExpiresChange={setExpiresInDays}
        onAllowChatChange={(allow) => {
          if (allow && !confirm('Anyone with the link will be able to chat with AI about these notes, using your account. Allow?')) return;
          setAllowChat(allow);
        }}
        disabled={busy}
      />
      <div className="share-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSend('PATCH', share.token, buildShareBody(expiresInDays, allowChat), 'Settings saved.')}>Save</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => confirm('Create a new link? The current one will stop working.') && onSend('PATCH', share.token, buildShareBody(expiresInDays, allowChat, true), 'New link created.')}>New link</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => confirm('Revoke this link?') && onSend('DELETE', share.token, {}, 'Link revoked.')}>Revoke</button>
      </div>
    </li>
  );
}

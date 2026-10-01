'use client';

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { BulkShareManager } from "@/app/components/ShareControls";

interface UserClass {
  _id: string;
  name: string;
  description: string;
}

interface ShortcutToken {
  _id: string;
  name: string;
  description: string;
  token: string;
  createdAt: string;
  lastUsed: string | null;
  isActive: boolean;
}

export default function UserSettings() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [classes, setClasses] = useState<UserClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [newClassName, setNewClassName] = useState('');
  const [newClassDescription, setNewClassDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Shortcuts state
  const [shortcutTokens, setShortcutTokens] = useState<ShortcutToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenDescription, setNewTokenDescription] = useState('');
  const [creatingToken, setCreatingToken] = useState(false);
  const [showTokenValue, setShowTokenValue] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/');
    } else if (isLoaded && isSignedIn) {
      fetchClasses();
      fetchShortcutTokens();
    }
  }, [isLoaded, isSignedIn, router]);

  const fetchClasses = async () => {
    try {
      const response = await fetch('/api/user/classes');
      if (response.ok) {
        const data = await response.json();
        setClasses(data);
      }
    } catch (error) {
      console.error('Failed to fetch classes:', error);
    } finally {
      setLoading(false);
    }
  };

  const addClass = async () => {
    if (!newClassName.trim()) return;

    setSaving(true);
    try {
      const response = await fetch('/api/user/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newClassName.trim(),
          description: newClassDescription.trim(),
        }),
      });

      if (response.ok) {
        setNewClassName('');
        setNewClassDescription('');
        fetchClasses();
      } else {
        alert('Failed to add class');
      }
    } catch (error) {
      console.error('Failed to add class:', error);
      alert('Failed to add class');
    } finally {
      setSaving(false);
    }
  };

  const removeClass = async (classId: string) => {
    if (!confirm('Are you sure you want to remove this class? This will not affect existing notes.')) {
      return;
    }

    try {
      const response = await fetch(`/api/user/classes/${classId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchClasses();
      } else {
        alert('Failed to remove class');
      }
    } catch (error) {
      console.error('Failed to remove class:', error);
      alert('Failed to remove class');
    }
  };

  // Shortcut token management functions
  const fetchShortcutTokens = async () => {
    try {
      const response = await fetch('/api/user/shortcut-tokens');
      if (response.ok) {
        const data = await response.json();
        setShortcutTokens(data);
      }
    } catch (error) {
      console.error('Failed to fetch shortcut tokens:', error);
    } finally {
      setTokensLoading(false);
    }
  };

  const createShortcutToken = async () => {
    if (!newTokenName.trim()) return;

    setCreatingToken(true);
    try {
      const response = await fetch('/api/user/shortcut-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newTokenName.trim(),
          description: newTokenDescription.trim(),
        }),
      });

      if (response.ok) {
        const newToken = await response.json();
        setNewTokenName('');
        setNewTokenDescription('');
        setShowTokenValue(newToken.token);
        fetchShortcutTokens();
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Failed to create token');
      }
    } catch (error) {
      console.error('Failed to create shortcut token:', error);
      alert('Failed to create token');
    } finally {
      setCreatingToken(false);
    }
  };

  const toggleTokenStatus = async (tokenId: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/user/shortcut-tokens/${tokenId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (response.ok) {
        fetchShortcutTokens();
      } else {
        alert('Failed to update token');
      }
    } catch (error) {
      console.error('Failed to update token:', error);
      alert('Failed to update token');
    }
  };

  const deleteShortcutToken = async (tokenId: string, tokenName: string) => {
    if (!confirm(`Are you sure you want to delete the token "${tokenName}"? This action cannot be undone and will break any shortcuts using this token.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/user/shortcut-tokens/${tokenId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchShortcutTokens();
      } else {
        alert('Failed to delete token');
      }
    } catch (error) {
      console.error('Failed to delete token:', error);
      alert('Failed to delete token');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Token copied to clipboard!');
    }).catch(() => {
      alert('Failed to copy token. Please copy it manually.');
    });
  };

  if (!isLoaded || loading || tokensLoading) {
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
      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => router.back()} className="btn btn-secondary">
          ← Back
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '20px' }}>User Settings</h2>

        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '15px' }}>Note Classes</h3>
          <p style={{ color: '#64748b', marginBottom: '20px', fontSize: '14px' }}>
            Define categories for your notes. The AI will automatically classify new notes into these categories.
          </p>

          {/* Add new class form */}
          <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
            <h4 style={{ marginBottom: '15px', fontSize: '16px' }}>Add New Class</h4>
            <div className="form-group">
              <label className="form-label">Class Name</label>
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="e.g., Meetings, Lectures, Ideas"
                className="form-input"
                maxLength={50}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description (Optional)</label>
              <input
                type="text"
                value={newClassDescription}
                onChange={(e) => setNewClassDescription(e.target.value)}
                placeholder="Brief description of what this class contains"
                className="form-input"
                maxLength={200}
              />
            </div>
            <button
              onClick={addClass}
              disabled={!newClassName.trim() || saving}
              className="btn btn-primary"
            >
              {saving ? 'Adding...' : 'Add Class'}
            </button>
          </div>

          {/* Existing classes list */}
          <div>
            <h4 style={{ marginBottom: '15px', fontSize: '16px' }}>Your Classes</h4>
            {classes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <p style={{ color: '#64748b' }}>
                  No classes defined yet. Add your first class above to start organizing your notes.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {classes.map((noteClass) => (
                <div key={noteClass._id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  backgroundColor: 'white'
                }} className="mobile-class-item">
                    <div>
                      <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                        {noteClass.name}
                      </div>
                      {noteClass.description && (
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {noteClass.description}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeClass(noteClass._id)}
                      className="btn btn-danger"
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Shortcuts Integration Section */}
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '15px' }}>Apple Shortcuts Integration</h3>
          <p style={{ color: '#64748b', marginBottom: '20px', fontSize: '14px' }}>
            Create tokens for Apple Shortcuts to upload voice recordings directly to your notes.
            Each token can be used in a shortcut that makes a PUT request to{' '}
            <code style={{ backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
              https://notes.kobosh.com/api/shortcuts
            </code>
          </p>

          {/* Token creation form */}
          <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
            <h4 style={{ marginBottom: '15px', fontSize: '16px' }}>Create New Shortcut Token</h4>
            <div className="form-group">
              <label className="form-label">Token Name</label>
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="e.g., iPhone Shortcut, iPad Voice Notes"
                className="form-input"
                maxLength={50}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description (Optional)</label>
              <input
                type="text"
                value={newTokenDescription}
                onChange={(e) => setNewTokenDescription(e.target.value)}
                placeholder="Brief description of where this token will be used"
                className="form-input"
                maxLength={200}
              />
            </div>
            <button
              onClick={createShortcutToken}
              disabled={!newTokenName.trim() || creatingToken}
              className="btn btn-primary"
            >
              {creatingToken ? 'Creating...' : 'Create Token'}
            </button>
          </div>

          {/* Token display modal */}
          {showTokenValue && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}>
              <div style={{
                backgroundColor: 'white',
                padding: '30px',
                borderRadius: '12px',
                maxWidth: '500px',
                width: '90%',
                maxHeight: '90vh',
                overflow: 'auto'
              }}>
                <h4 style={{ marginBottom: '15px', color: '#059669' }}>✅ Token Created Successfully!</h4>
                <p style={{ marginBottom: '15px', fontSize: '14px', color: '#64748b' }}>
                  Save this token safely. For security reasons, you won't be able to view it again.
                </p>
                <div style={{
                  backgroundColor: '#f8fafc',
                  padding: '15px',
                  borderRadius: '6px',
                  marginBottom: '20px',
                  border: '1px solid #e2e8f0'
                }}>
                  <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '5px' }}>Your Token:</p>
                  <code style={{
                    fontSize: '12px',
                    wordBreak: 'break-all',
                    backgroundColor: '#fff',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                    display: 'block'
                  }}>
                    {showTokenValue}
                  </code>
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => copyToClipboard(showTokenValue)}
                    className="btn btn-secondary"
                  >
                    Copy Token
                  </button>
                  <button
                    onClick={() => setShowTokenValue(null)}
                    className="btn btn-primary"
                  >
                    I've Saved It
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Existing tokens list */}
          <div>
            <h4 style={{ marginBottom: '15px', fontSize: '16px' }}>Your Shortcut Tokens</h4>
            {shortcutTokens.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <p style={{ color: '#64748b' }}>
                  No shortcut tokens created yet. Create your first token above to start using Apple Shortcuts.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {shortcutTokens.map((token) => (
                  <div key={token._id} style={{
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    backgroundColor: 'white'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontWeight: '500',
                          marginBottom: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          {token.name}
                          <span style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: token.isActive ? '#dcfce7' : '#fef2f2',
                            color: token.isActive ? '#166534' : '#dc2626'
                          }}>
                            {token.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        {token.description && (
                          <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                            {token.description}
                          </div>
                        )}
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Created: {new Date(token.createdAt).toLocaleDateString()}
                          {token.lastUsed && (
                            <span> • Last used: {new Date(token.lastUsed).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                        <button
                          onClick={() => toggleTokenStatus(token._id, token.isActive)}
                          className="btn"
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            backgroundColor: token.isActive ? '#fef2f2' : '#dcfce7',
                            color: token.isActive ? '#dc2626' : '#166534',
                            border: `1px solid ${token.isActive ? '#fecaca' : '#bbf7d0'}`
                          }}
                        >
                          {token.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => deleteShortcutToken(token._id, token.name)}
                          className="btn btn-danger"
                          style={{ fontSize: '11px', padding: '4px 8px' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Setup instructions */}
                    <details style={{ marginTop: '12px' }}>
                      <summary style={{
                        cursor: 'pointer',
                        fontSize: '12px',
                        color: '#3b82f6',
                        userSelect: 'none'
                      }}>
                        📱 Show Setup Instructions
                      </summary>
                      <div style={{
                        marginTop: '12px',
                        padding: '12px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '6px',
                        fontSize: '12px',
                        lineHeight: '1.5'
                      }}>
                        <p style={{ marginBottom: '8px', fontWeight: '500' }}>Simple Setup:</p>
                        <ol style={{ paddingLeft: '16px', margin: 0 }}>
                          <li>
                            <a
                              href="https://notes.kobosh.com/Upload%20to%20notes.shortcut"
                              download="Upload to notes.shortcut"
                              style={{ color: '#3b82f6', textDecoration: 'underline' }}
                            >
                              Download the "Upload to Notes" shortcut
                            </a>
                          </li>
                          <li>Replace the text "replace this with your token" with: <code style={{
                            backgroundColor: '#fff',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid #e2e8f0',
                            fontSize: '11px'
                          }}>{token.token}</code></li>
                          <li>Done! Your shortcut is ready to use.</li>
                        </ol>
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
      <div id="shared-links" style={{ marginTop: '20px' }}>
        <BulkShareManager />
      </div>
    </div>
  );
}

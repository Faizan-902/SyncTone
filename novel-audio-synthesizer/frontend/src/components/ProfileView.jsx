import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import { isWebAuthnSupported } from '../utils/webauthn';
import { IconUser, IconShield, IconBook, IconClock } from './icons';

export default function ProfileView({ onOpenAuth }) {
  const { user, role, isAuthenticated, logout, registerWithPasskey } = useAuth();
  const [passkeys, setPasskeys] = useState([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [passkeyMsg, setPasskeyMsg] = useState(null);
  const [addingPasskey, setAddingPasskey] = useState(false);

  const loadPasskeys = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoadingPasskeys(true);
    try {
      const res = await api.auth.passkey.list();
      setPasskeys(Array.isArray(res?.passkeys) ? res.passkeys : []);
    } catch (_) {
      setPasskeys([]);
    } finally {
      setLoadingPasskeys(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadPasskeys();
  }, [loadPasskeys]);

  const handleAddPasskey = async () => {
    setPasskeyMsg(null);
    setAddingPasskey(true);
    try {
      const res = await registerWithPasskey({});
      if (res?.success) {
        setPasskeyMsg({ type: 'ok', text: 'Passkey added! You can now sign in with one tap.' });
        await loadPasskeys();
      } else {
        setPasskeyMsg({ type: 'err', text: res?.error || 'Could not add passkey.' });
      }
    } finally {
      setAddingPasskey(false);
    }
  };

  const handleDeletePasskey = async (credId) => {
    setPasskeyMsg(null);
    try {
      await api.auth.passkey.remove(credId);
      setPasskeys((prev) => prev.filter((pk) => pk.credential_id !== credId));
      setPasskeyMsg({ type: 'ok', text: 'Passkey removed.' });
    } catch (err) {
      setPasskeyMsg({ type: 'err', text: err?.message || 'Failed to remove passkey.' });
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--bg-elevated)] border theme-border flex items-center justify-center text-[var(--accent-text)]">
          <IconUser className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold theme-heading font-serif mb-2">Member Profile</h2>
        <p className="text-sm theme-muted mb-6 max-w-md mx-auto">
          Sign in to your account to track reading progress, manage passkeys, and access personalized audio settings.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => onOpenAuth?.('login')}
            className="px-6 py-2.5 rounded-full bg-[var(--cta-primary-bg)] text-[var(--cta-primary-text)] text-xs font-bold hover:bg-[var(--cta-primary-hover)] transition-all duration-200 shadow-md hover:scale-[1.03] active:scale-[0.96] cursor-pointer"
          >
            Sign In
          </button>
          <button
            onClick={() => onOpenAuth?.('register')}
            className="px-6 py-2.5 rounded-full border theme-border theme-surface theme-heading text-xs font-medium hover:bg-[var(--bg-hover)] transition-all duration-200 shadow-sm hover:scale-[1.03] active:scale-[0.96] cursor-pointer"
          >
            Create Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Profile Header */}
      <div className="p-6 rounded-2xl theme-surface border theme-border shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.username || 'User avatar'}
                className="w-14 h-14 rounded-2xl object-cover border theme-border"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center justify-center text-[var(--accent-text)] font-bold text-xl">
                {user?.username?.charAt(0)?.toUpperCase() || 'U'}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold theme-heading font-serif">{user?.username || 'Reader'}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold tracking-wider bg-[var(--border-subtle)] text-[var(--accent-text)] border theme-border">
                  {role || 'Reader'}
                </span>
              </div>
              <p className="text-xs theme-muted font-mono mt-0.5">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="px-5 py-2 rounded-full border theme-border text-xs theme-muted hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all duration-200 hover:scale-[1.03] active:scale-[0.96] cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Account Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl theme-surface border theme-border">
          <div className="flex items-center gap-2 theme-muted text-xs mb-1">
            <IconShield className="w-4 h-4 text-[var(--accent-text)]" />
            <span>Account Role</span>
          </div>
          <p className="text-base font-bold theme-heading capitalize">{role || 'Reader'}</p>
          <p className="text-[11px] theme-muted mt-0.5">
            {role === 'admin'
              ? 'Full studio & system administration'
              : role === 'writer'
              ? 'Publish novels & upload manuscripts'
              : 'Listen to synchronized dramatic audio'}
          </p>
        </div>

        <div className="p-4 rounded-xl theme-surface border theme-border">
          <div className="flex items-center gap-2 theme-muted text-xs mb-1">
            <IconClock className="w-4 h-4 text-[var(--accent-text)]" />
            <span>Member Status</span>
          </div>
          <p className="text-base font-bold theme-heading text-status-success">Active</p>
          <p className="text-[11px] theme-muted mt-0.5">Session authenticated via secure cookie</p>
        </div>

        <div className="p-4 rounded-xl theme-surface border theme-border">
          <div className="flex items-center gap-2 theme-muted text-xs mb-1">
            <IconBook className="w-4 h-4 text-[var(--accent-text)]" />
            <span>Library</span>
          </div>
          <p className="text-base font-bold theme-heading">Synchronized</p>
          <p className="text-[11px] theme-muted mt-0.5">Bookmarks and audio timeline saved</p>
        </div>
      </div>

      {/* Security & Passkeys Management */}
      <div className="p-6 rounded-2xl theme-surface border theme-border shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-sm font-bold theme-heading flex items-center gap-2">
              <IconShield className="w-4 h-4 text-[var(--accent-text)]" />
              <span>Security & Passkeys</span>
            </h2>
            <p className="text-xs theme-muted mt-0.5">
              Sign in effortlessly with Touch ID, Face ID, Windows Hello, or a hardware security key.
            </p>
          </div>
          {isWebAuthnSupported() && (
            <button
              type="button"
              onClick={handleAddPasskey}
              disabled={addingPasskey}
              className="px-4 py-2 rounded-full bg-[var(--cta-primary-bg)] text-[var(--cta-primary-text)] text-xs font-bold hover:bg-[var(--cta-primary-hover)] transition cursor-pointer disabled:opacity-50 shrink-0"
            >
              {addingPasskey ? 'Follow Browser Prompt...' : '+ Add Passkey'}
            </button>
          )}
        </div>

        {passkeyMsg && (
          <div
            className={`p-3 rounded-xl text-xs font-medium border ${
              passkeyMsg.type === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-[var(--danger)]/10 border-[var(--danger)]/30 text-[var(--danger)]'
            }`}
          >
            {passkeyMsg.text}
          </div>
        )}

        {loadingPasskeys ? (
          <p className="text-xs theme-muted font-mono">Loading passkeys...</p>
        ) : passkeys.length === 0 ? (
          <p className="text-xs theme-muted">
            No passkeys registered on this account yet. Click &ldquo;+ Add Passkey&rdquo; above for passwordless sign-in.
          </p>
        ) : (
          <div className="space-y-2">
            {passkeys.map((pk) => (
              <div
                key={pk.credential_id}
                className="flex items-center justify-between p-3 rounded-xl theme-card border border-[var(--border-subtle)]"
              >
                <div>
                  <p className="text-xs font-bold theme-heading">{pk.friendly_name || 'Device Passkey'}</p>
                  <p className="text-[11px] theme-muted font-mono">
                    {pk.backed_up ? 'Synced Passkey' : pk.device_type || 'Device Key'} • Added{' '}
                    {new Date(pk.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeletePasskey(pk.credential_id)}
                  className="px-3 py-1 rounded-full text-[11px] border border-[var(--border-strong)] theme-muted hover:text-[var(--danger)] hover:border-[var(--danger)]/50 transition cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

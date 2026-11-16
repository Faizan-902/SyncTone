import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, ApiError } from '../services/api';
import { createPasskeyCredential, getPasskeyCredential } from '../utils/webauthn';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [providers, setProviders] = useState({
    loaded: false,
    emailPassword: true,
    passkey: true,
    google: true,
    github: false,
    googleMode: 'unconfigured',
    githubMode: 'unconfigured',
    neonAuthUrl: null,
  });
  const providersPromiseRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProviders = useCallback(async () => {
    if (providers.loaded) return providers;
    if (providersPromiseRef.current) return providersPromiseRef.current;
    providersPromiseRef.current = (async () => {
      try {
        if (typeof api.auth.providers === 'function') {
          const info = await api.auth.providers();
          if (info && typeof info === 'object') {
            const next = { ...info, loaded: true };
            setProviders(next);
            return next;
          }
        }
      } catch (_) {}
      return providers;
    })();
    try {
      return await providersPromiseRef.current;
    } finally {
      providersPromiseRef.current = null;
    }
  }, [providers]);

  // Restore session via GET /api/auth/me on mount + complete any pending Neon OAuth callback
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      // Handle OAuth callback query params only when present in URL
      if (typeof window !== 'undefined' && window.location?.search) {
        const params = new URLSearchParams(window.location.search);
        const authErr = params.get('auth_error');
        const authSuccess = params.get('auth');
        const isNeonCallback =
          params.has('neon_auth_session_verifier') || params.get('neon_auth_callback') === '1';

        if (authErr && isMounted) {
          setError(
            authErr.includes('not_configured')
              ? 'This OAuth provider is not configured on the server yet. Please use Email or Passkey sign-in.'
              : `Sign-in did not complete (${authErr.replace(/_/g, ' ')}).`
          );
          params.delete('auth_error');
          const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', cleanUrl);
        }

        if (isNeonCallback) {
          try {
            const providerInfo = await loadProviders();
            if (providerInfo?.neonAuthUrl) {
              const { createAuthClient } = await import('@neon/auth');
              const neonClient = createAuthClient(providerInfo.neonAuthUrl);
              const tokRes = await neonClient.token();
              const jwtToken = tokRes?.data?.token;
              if (jwtToken) {
                const bridgeRes = await api.auth.oauthNeonSession(jwtToken, 'google');
                if (isMounted && bridgeRes?.user) {
                  setUser(bridgeRes.user);
                }
              }
            }
          } catch (cbErr) {
            if (isMounted) {
              setError(cbErr?.message || 'Google sign-in session could not be verified.');
            }
          } finally {
            params.delete('neon_auth_session_verifier');
            params.delete('neon_auth_callback');
            const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
            window.history.replaceState({}, '', cleanUrl);
          }
        } else if (authSuccess) {
          params.delete('auth');
          params.delete('provider');
          const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', cleanUrl);
        }
      }

      try {
        const data = await api.auth.me();
        if (isMounted && data?.user) {
          setUser(data.user);
        }
      } catch (_) {
        // 401 Unauthorized simply means unauthenticated guest
        if (isMounted) {
          setUser((prev) => prev || null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initAuth();
    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const data = await api.auth.login(email, password);
      if (data?.user) {
        setUser(data.user);
        return { success: true, user: data.user };
      }
      throw new Error('Login succeeded but user profile was missing');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err.message || 'Login failed';
      setError(msg);
      return { success: false, error: msg };
    }
  }, []);

  const register = useCallback(
    async (username, email, password, role = 'reader') => {
      setError(null);
      try {
        const data = await api.auth.register(username, email, password, role);
        // Backend immediately issues httpOnly cookie + token+user
        if (data?.user && data?.token) {
          setUser(data.user);
          return { success: true, user: data.user };
        }
        const loginRes = await login(email, password);
        if (!loginRes.success) {
          return { success: true, user: data.user, note: 'Registered successfully. Please log in.' };
        }
        return { success: true, user: loginRes.user };
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : err.message || 'Registration failed';
        setError(msg);
        return { success: false, error: msg };
      }
    },
    [login]
  );

  const loginWithPasskey = useCallback(async (email = '') => {
    setError(null);
    try {
      const { challengeId, options } = await api.auth.passkey.loginOptions(
        email ? { email: email.trim().toLowerCase() } : {}
      );
      const credential = await getPasskeyCredential(options);
      const verifiedRes = await api.auth.passkey.loginVerify({ challengeId, credential });
      if (verifiedRes?.user) {
        setUser(verifiedRes.user);
        return { success: true, user: verifiedRes.user };
      }
      throw new Error('Passkey verification returned no user session.');
    } catch (err) {
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Passkey prompt was cancelled or timed out.'
          : err instanceof ApiError
            ? err.message
            : err.message || 'Passkey sign-in failed.';
      setError(msg);
      return { success: false, error: msg };
    }
  }, []);

  const registerWithPasskey = useCallback(
    async ({ email = '', username = '', role = 'reader', friendlyName = '' } = {}) => {
      setError(null);
      try {
        const defaultFriendly =
          friendlyName ||
          (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')
            ? 'Mac Touch ID'
            : typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent || '')
              ? 'Face ID / Touch ID'
              : 'Device Passkey');

        const { challengeId, options } = await api.auth.passkey.registerOptions({
          email: email ? email.trim().toLowerCase() : undefined,
          username: username ? username.trim() : undefined,
          role,
          friendlyName: defaultFriendly,
        });
        const credential = await createPasskeyCredential(options);
        const verifiedRes = await api.auth.passkey.registerVerify({
          challengeId,
          credential,
          friendlyName: defaultFriendly,
        });
        if (verifiedRes?.user) {
          setUser(verifiedRes.user);
          return { success: true, user: verifiedRes.user };
        }
        throw new Error('Passkey registration did not return a user session.');
      } catch (err) {
        const msg =
          err?.name === 'NotAllowedError'
            ? 'Passkey creation was cancelled or timed out.'
            : err instanceof ApiError
              ? err.message
              : err.message || 'Passkey registration failed.';
        setError(msg);
        return { success: false, error: msg };
      }
    },
    []
  );

  const loginWithOAuth = useCallback(
    async (provider) => {
      setError(null);
      const prov = String(provider || '').toLowerCase();
      const activeProviders = await loadProviders();

      if (prov === 'google' && activeProviders?.googleMode === 'neon_auth' && activeProviders?.neonAuthUrl) {
        try {
          const { createAuthClient } = await import('@neon/auth');
          const neonClient = createAuthClient(activeProviders.neonAuthUrl);
          const callbackURL = `${window.location.origin}/?neon_auth_callback=1`;
          const res = await neonClient.signIn.social({
            provider: 'google',
            callbackURL,
          });
          if (res?.data?.url) {
            window.location.assign(res.data.url);
            return { success: true };
          }
          if (res?.error) {
            throw new Error(res.error.message || 'Google sign-in could not start.');
          }
        } catch (err) {
          const msg = err?.message || 'Google sign-in could not start.';
          setError(msg);
          return { success: false, error: msg };
        }
      }

      if (
        (prov === 'google' && activeProviders?.googleMode === 'oauth') ||
        (prov === 'github' && activeProviders?.githubMode === 'oauth')
      ) {
        const apiBase = (
          (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
          '/api'
        ).replace(/\/$/, '');
        window.location.assign(`${apiBase}/auth/oauth/${prov}/start`);
        return { success: true };
      }

      const label = prov === 'github' ? 'GitHub' : 'Google';
      const msg = `${label} OAuth credentials are not configured yet on this deployment. Sign in with Passkey or Email/Password below.`;
      setError(msg);
      return { success: false, error: msg };
    },
    [loadProviders]
  );

  const logout = useCallback(async () => {
    setError(null);
    try {
      await api.auth.logout();
    } catch (err) {
      console.warn('[Auth] Logout warning:', err.message);
    } finally {
      setUser(null);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const role = user?.role || null;
  const isAuthenticated = !!user;
  const isWriterOrAdmin = role === 'writer' || role === 'admin';
  const isAdmin = role === 'admin';

  const value = useMemo(
    () => ({
      user,
      role,
      providers,
      isAuthenticated,
      isWriterOrAdmin,
      isAdmin,
      isLoading,
      error,
      login,
      register,
      loginWithPasskey,
      registerWithPasskey,
      loginWithOAuth,
      logout,
      clearError,
    }),
    [
      user,
      role,
      providers,
      isAuthenticated,
      isWriterOrAdmin,
      isAdmin,
      isLoading,
      error,
      login,
      register,
      loginWithPasskey,
      registerWithPasskey,
      loginWithOAuth,
      logout,
      clearError,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthContext;

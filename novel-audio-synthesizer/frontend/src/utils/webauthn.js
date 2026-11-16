/**
 * Browser WebAuthn Passkey helpers (base64url <-> ArrayBuffer & credential ceremony wrappers)
 */

export function isWebAuthnSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials && navigator.credentials.create && navigator.credentials.get)
  );
}

export function base64UrlToUint8Array(base64url) {
  const padded = String(base64url || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(base64url || '').length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function arrayBufferToBase64Url(buffer) {
  if (!buffer) return '';
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function prepareCreationOptions(options) {
  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToUint8Array(options.user.id),
    },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((cred) => ({
          ...cred,
          id: base64UrlToUint8Array(cred.id),
        }))
      : [],
  };
}

export function prepareRequestOptions(options) {
  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map((cred) => ({
          ...cred,
          id: base64UrlToUint8Array(cred.id),
        }))
      : undefined,
  };
}

export function serializeRegistrationCredential(cred) {
  return {
    id: cred.id,
    rawId: arrayBufferToBase64Url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: arrayBufferToBase64Url(cred.response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(cred.response.attestationObject),
      transports:
        typeof cred.response.getTransports === 'function' ? cred.response.getTransports() : undefined,
    },
  };
}

export function serializeAuthenticationCredential(cred) {
  return {
    id: cred.id,
    rawId: arrayBufferToBase64Url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: arrayBufferToBase64Url(cred.response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(cred.response.authenticatorData),
      signature: arrayBufferToBase64Url(cred.response.signature),
      userHandle: cred.response.userHandle ? arrayBufferToBase64Url(cred.response.userHandle) : null,
    },
  };
}

export async function createPasskeyCredential(options) {
  if (!isWebAuthnSupported()) {
    throw new Error('Passkeys are not supported in this browser.');
  }
  const publicKey = prepareCreationOptions(options);
  const credential = await navigator.credentials.create({ publicKey });
  if (!credential) {
    throw new Error('Passkey creation was cancelled.');
  }
  return serializeRegistrationCredential(credential);
}

export async function getPasskeyCredential(options) {
  if (!isWebAuthnSupported()) {
    throw new Error('Passkeys are not supported in this browser.');
  }
  const publicKey = prepareRequestOptions(options);
  const credential = await navigator.credentials.get({ publicKey });
  if (!credential) {
    throw new Error('Passkey sign-in was cancelled.');
  }
  return serializeAuthenticationCredential(credential);
}

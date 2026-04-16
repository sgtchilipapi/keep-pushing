'use client';

const PENDING_AUTH_PROVIDER_STORAGE_KEY = 'keep-pushing:pending-auth-provider';

export type PhantomAuthProvider = 'google' | 'apple' | 'injected';

export function isPhantomAuthProvider(value: unknown): value is PhantomAuthProvider {
  return value === 'google' || value === 'apple' || value === 'injected';
}

export function readPendingAuthProvider(): PhantomAuthProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.sessionStorage.getItem(PENDING_AUTH_PROVIDER_STORAGE_KEY);
  return isPhantomAuthProvider(stored) ? stored : null;
}

export function writePendingAuthProvider(provider: PhantomAuthProvider): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(PENDING_AUTH_PROVIDER_STORAGE_KEY, provider);
}

export function clearPendingAuthProvider(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(PENDING_AUTH_PROVIDER_STORAGE_KEY);
}

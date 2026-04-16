'use client';

import type {
  PhantomConnectDebugEvent,
  PhantomConnectDebugLevel,
} from './phantomConnectDebug';

const CLIENT_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_PHANTOM_CONNECT_DEBUG_ENABLED !== '0';
const DEBUG_ENDPOINT = '/api/debug/phantom-connect';

type ClientDebugInput = Omit<
  PhantomConnectDebugEvent,
  'source' | 'href' | 'origin' | 'userAgent' | 'referrer' | 'level'
> & {
  level?: PhantomConnectDebugLevel;
};

export function isPhantomConnectClientDebugEnabled(): boolean {
  return CLIENT_DEBUG_ENABLED;
}

function buildPayload(input: ClientDebugInput): PhantomConnectDebugEvent {
  return {
    source: 'client',
    level: input.level ?? 'info',
    area: input.area,
    stage: input.stage,
    message: input.message,
    details: input.details ?? null,
    href: typeof window === 'undefined' ? null : window.location.href,
    origin: typeof window === 'undefined' ? null : window.location.origin,
    userAgent:
      typeof navigator === 'undefined' ? null : navigator.userAgent,
    referrer: typeof document === 'undefined' ? null : document.referrer,
    createdAt: new Date().toISOString(),
  };
}

export function logPhantomConnectClientEvent(input: ClientDebugInput): void {
  if (!CLIENT_DEBUG_ENABLED || typeof window === 'undefined') {
    return;
  }

  const payload = buildPayload(input);
  const serialized = JSON.stringify(payload);

  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([serialized], { type: 'application/json' });
      navigator.sendBeacon(DEBUG_ENDPOINT, blob);
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: serialized,
    keepalive: true,
  }).catch(() => undefined);
}

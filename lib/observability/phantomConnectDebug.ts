import { mkdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type PhantomConnectDebugLevel = 'info' | 'warn' | 'error';

export interface PhantomConnectDebugEvent {
  eventId?: string;
  source: 'client' | 'server';
  area: 'sdk' | 'auth' | 'session' | 'ui' | 'network';
  stage: string;
  level: PhantomConnectDebugLevel;
  message: string;
  details?: Record<string, unknown> | null;
  href?: string | null;
  origin?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
  createdAt?: string;
}

export interface PhantomConnectStoredDebugEvent extends PhantomConnectDebugEvent {
  eventId: string;
  createdAt: string;
  receivedAt: string;
}

const DEFAULT_LOG_FILE_NAME = 'phantom-connect.ndjson';

export function isPhantomConnectDebugEnabled(): boolean {
  return process.env.PHANTOM_CONNECT_DEBUG_ENABLED === '1';
}

export function getPhantomConnectDebugLogDir(): string {
  if (process.env.PHANTOM_CONNECT_DEBUG_LOG_DIR?.trim()) {
    return process.env.PHANTOM_CONNECT_DEBUG_LOG_DIR.trim();
  }

  if (process.env.VERCEL === '1' || process.env.VERCEL === 'true') {
    return '/tmp/keep-pushing-debug';
  }

  return path.join(process.cwd(), 'debug', 'logs');
}

export function getPhantomConnectDebugLogFilePath(): string {
  return path.join(getPhantomConnectDebugLogDir(), DEFAULT_LOG_FILE_NAME);
}

function clampObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }

    if (typeof value === 'string') {
      output[key] = value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
      continue;
    }

    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      output[key] = value;
      continue;
    }

    try {
      const serialized = JSON.stringify(value);
      output[key] =
        serialized.length > 4_000 ? `${serialized.slice(0, 4_000)}…` : serialized;
    } catch {
      output[key] = '[unserializable]';
    }
  }

  return output;
}

export function normalizePhantomConnectDebugEvent(
  input: PhantomConnectDebugEvent,
): PhantomConnectStoredDebugEvent {
  const now = new Date().toISOString();
  return {
    ...input,
    eventId: input.eventId ?? randomUUID(),
    createdAt: input.createdAt ?? now,
    receivedAt: now,
    details: clampObject(input.details ?? null),
    href: input.href ?? null,
    origin: input.origin ?? null,
    userAgent: input.userAgent ?? null,
    referrer: input.referrer ?? null,
  };
}

export async function appendPhantomConnectDebugEvent(
  event: PhantomConnectDebugEvent,
): Promise<PhantomConnectStoredDebugEvent> {
  const normalized = normalizePhantomConnectDebugEvent(event);
  const logDir = getPhantomConnectDebugLogDir();
  const logPath = getPhantomConnectDebugLogFilePath();

  await mkdir(logDir, { recursive: true });
  await appendFile(logPath, `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

export async function readRecentPhantomConnectDebugEvents(
  limit: number,
): Promise<PhantomConnectStoredDebugEvent[]> {
  const logPath = getPhantomConnectDebugLogFilePath();
  let content: string;

  try {
    content = await readFile(logPath, 'utf8');
  } catch {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(limit, 500));
  return content
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-safeLimit)
    .map((line) => {
      try {
        return JSON.parse(line) as PhantomConnectStoredDebugEvent;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is PhantomConnectStoredDebugEvent => entry !== null);
}

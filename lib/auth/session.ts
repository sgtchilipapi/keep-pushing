import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { authPool } from './db';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './constants';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const STATELESS_SESSION_PREFIX = 'kps1';

function getSessionSigningSecret(): string {
  return (
    process.env.AUTH_SESSION_SIGNING_SECRET ??
    process.env.AUTH_NONCE_SIGNING_SECRET ??
    process.env.DATABASE_URL ??
    'keep-pushing-session-fallback'
  );
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signSessionPayload(payloadBase64: string): string {
  return createHmac('sha256', getSessionSigningSecret())
    .update(payloadBase64)
    .digest('base64url');
}

function createStatelessSessionToken(payload: {
  sessionId: string;
  userId: string;
  walletAddress: string;
  expiresAtIso: string;
}): string {
  const payloadBase64 = base64urlEncode(JSON.stringify({ ...payload, v: 1 }));
  const signature = signSessionPayload(payloadBase64);
  return `${STATELESS_SESSION_PREFIX}.${payloadBase64}.${signature}`;
}

function parseStatelessSessionToken(token: string): ActiveSession | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== STATELESS_SESSION_PREFIX) {
    return null;
  }

  const [, payloadBase64, signature] = parts;
  const expectedSignature = signSessionPayload(payloadBase64);
  const validSignature = timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8'),
  );
  if (!validSignature) {
    return null;
  }

  let parsed: {
    sessionId?: string;
    userId?: string;
    walletAddress?: string;
    expiresAtIso?: string;
  };
  try {
    parsed = JSON.parse(base64urlDecode(payloadBase64)) as {
      sessionId?: string;
      userId?: string;
      walletAddress?: string;
      expiresAtIso?: string;
    };
  } catch {
    return null;
  }

  if (
    !parsed.sessionId ||
    !parsed.userId ||
    !parsed.walletAddress ||
    !parsed.expiresAtIso
  ) {
    return null;
  }

  const expiresAt = new Date(parsed.expiresAtIso);
  if (expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    id: parsed.sessionId,
    userId: parsed.userId,
    walletAddress: parsed.walletAddress,
    expiresAt,
    revokedAt: null,
  };
}

export function buildSessionCookie(token: string, expiresAt: Date): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=${expiresAt.toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function parseSessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  const parts = cookieHeader.split(';').map((part) => part.trim());
  const session = parts.find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!session) {
    return null;
  }
  const token = session.slice(`${SESSION_COOKIE_NAME}=`.length).trim();
  return token.length > 0 ? token : null;
}

export async function createSession(input: {
  userId: string;
  walletAddress: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const id = randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
  try {
    await authPool.query(
      `UPDATE "Session"
         SET "revokedAt" = $3,
             "updatedAt" = $3
       WHERE "userId" = $1
         AND "walletAddress" = $2
         AND "revokedAt" IS NULL`,
      [input.userId, input.walletAddress, issuedAt],
    );

    await authPool.query(
      `INSERT INTO "Session"
        (id, "userId", "walletAddress", "tokenHash", "issuedAt", "expiresAt", "lastSeenAt", "ipAddress", "userAgent", "updatedAt")
       VALUES
        ($1, $2, $3, $4, $5, $6, $5, $7, $8, $5)`,
      [id, input.userId, input.walletAddress, tokenHash, issuedAt, expiresAt, input.ipAddress, input.userAgent],
    );

    return {
      sessionId: id,
      token,
      expiresAt,
    };
  } catch (error) {
    console.warn('[auth/session] falling back to stateless session token', {
      userId: input.userId,
      walletAddress: input.walletAddress,
      error,
    });
    const statelessToken = createStatelessSessionToken({
      sessionId: id,
      userId: input.userId,
      walletAddress: input.walletAddress,
      expiresAtIso: expiresAt.toISOString(),
    });

    return {
      sessionId: id,
      token: statelessToken,
      expiresAt,
    };
  }
}

export async function revokeSessionByToken(token: string): Promise<void> {
  if (parseStatelessSessionToken(token)) {
    return;
  }
  const now = new Date();
  await authPool.query(
    `UPDATE "Session"
       SET "revokedAt" = $2,
           "updatedAt" = $2
     WHERE "tokenHash" = $1
       AND "revokedAt" IS NULL`,
    [sha256(token), now],
  );
}

export interface ActiveSession {
  id: string;
  userId: string;
  walletAddress: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export async function getActiveSessionByToken(token: string): Promise<ActiveSession | null> {
  const stateless = parseStatelessSessionToken(token);
  if (stateless) {
    return stateless;
  }
  const now = new Date();
  const result = await authPool.query<{
    id: string;
    userId: string;
    walletAddress: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }>(
    `UPDATE "Session"
       SET "lastSeenAt" = $2,
           "updatedAt" = $2
     WHERE "tokenHash" = $1
       AND "revokedAt" IS NULL
       AND "expiresAt" > $2
     RETURNING id, "userId", "walletAddress", "expiresAt", "revokedAt"`,
    [sha256(token), now],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    walletAddress: row.walletAddress,
    expiresAt: new Date(row.expiresAt),
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
  };
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { authPool } from './db';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './constants';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
}

export async function revokeSessionByToken(token: string): Promise<void> {
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

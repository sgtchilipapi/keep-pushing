import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { authPool } from './db';
import { AUTH_NONCE_TTL_MS } from './constants';
import { buildWalletAuthMessage, randomNonce } from './walletVerify';

function normalizeWallet(value: string): string {
  return value.trim();
}

const STATELESS_NONCE_PREFIX = 'kpn1';

function base64urlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getAuthSigningSecret(): string {
  return (
    process.env.AUTH_NONCE_SIGNING_SECRET ??
    process.env.AUTH_SESSION_SIGNING_SECRET ??
    process.env.DATABASE_URL ??
    'keep-pushing-auth-fallback'
  );
}

function signStatelessPayload(payloadBase64: string): string {
  return createHmac('sha256', getAuthSigningSecret())
    .update(payloadBase64)
    .digest('base64url');
}

function buildStatelessNonceId(payload: {
  walletAddress: string;
  message: string;
  expiresAtIso: string;
}): string {
  const payloadBase64 = base64urlEncode(
    JSON.stringify({
      walletAddress: payload.walletAddress,
      messageSha256: createHash('sha256').update(payload.message).digest('hex'),
      expiresAtIso: payload.expiresAtIso,
      v: 1,
    }),
  );
  const signature = signStatelessPayload(payloadBase64);
  return `${STATELESS_NONCE_PREFIX}.${payloadBase64}.${signature}`;
}

function verifyStatelessNonceId(input: {
  nonceId: string;
  walletAddress: string;
  message: string;
}): { id: string; message: string } | null {
  const parts = input.nonceId.split('.');
  if (parts.length !== 3 || parts[0] !== STATELESS_NONCE_PREFIX) {
    return null;
  }

  const [, payloadBase64, signature] = parts;
  const expectedSignature = signStatelessPayload(payloadBase64);
  const validSignature = timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8'),
  );

  if (!validSignature) {
    return null;
  }

  let parsed: {
    walletAddress?: string;
    messageSha256?: string;
    expiresAtIso?: string;
  };
  try {
    parsed = JSON.parse(base64urlDecode(payloadBase64)) as {
      walletAddress?: string;
      messageSha256?: string;
      expiresAtIso?: string;
    };
  } catch {
    return null;
  }

  if (
    parsed.walletAddress !== normalizeWallet(input.walletAddress) ||
    parsed.messageSha256 !== createHash('sha256').update(input.message).digest('hex') ||
    !parsed.expiresAtIso
  ) {
    return null;
  }

  if (new Date(parsed.expiresAtIso).getTime() <= Date.now()) {
    return null;
  }

  return { id: input.nonceId, message: input.message };
}

export async function issueAuthNonce(input: { walletAddress: string; origin: string }) {
  const walletAddress = normalizeWallet(input.walletAddress);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + AUTH_NONCE_TTL_MS);
  const nonce = randomNonce();
  const message = buildWalletAuthMessage({
    origin: input.origin,
    walletAddress,
    nonce,
    issuedAtIso: issuedAt.toISOString(),
    expiresAtIso: expiresAt.toISOString(),
  });
  const id = randomUUID();

  try {
    await authPool.query(
      `INSERT INTO "AuthNonce" (id, "walletAddress", nonce, message, "expiresAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, walletAddress, nonce, message, expiresAt, issuedAt],
    );
  } catch (error) {
    console.warn('[auth/nonce] falling back to stateless nonce token', {
      walletAddress,
      error,
    });
    return {
      nonceId: buildStatelessNonceId({
        walletAddress,
        message,
        expiresAtIso: expiresAt.toISOString(),
      }),
      nonce,
      expiresAt: expiresAt.toISOString(),
      messageToSign: message,
    };
  }

  return {
    nonceId: id,
    nonce,
    expiresAt: expiresAt.toISOString(),
    messageToSign: message,
  };
}

export async function consumeAuthNonce(input: {
  nonceId: string;
  walletAddress: string;
  message: string;
}) {
  const stateless = verifyStatelessNonceId(input);
  if (stateless) {
    return stateless;
  }

  const now = new Date();
  const result = await authPool.query<{
    id: string;
    message: string;
  }>(
    `UPDATE "AuthNonce"
       SET "consumedAt" = $4,
           "updatedAt" = $4
     WHERE id = $1
       AND "walletAddress" = $2
       AND message = $3
       AND "consumedAt" IS NULL
       AND "expiresAt" > $4
     RETURNING id, message`,
    [input.nonceId, normalizeWallet(input.walletAddress), input.message, now],
  );

  return result.rows[0] ?? null;
}

export function hashIp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return createHash('sha256').update(value).digest('hex');
}

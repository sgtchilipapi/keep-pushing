import { createHash, randomUUID } from 'node:crypto';

import { authPool } from './db';
import { AUTH_NONCE_TTL_MS } from './constants';
import { buildWalletAuthMessage, randomNonce } from './walletVerify';

function normalizeWallet(value: string): string {
  return value.trim();
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

  await authPool.query(
    `INSERT INTO "AuthNonce" (id, "walletAddress", nonce, message, "expiresAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, walletAddress, nonce, message, expiresAt, issuedAt],
  );

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

import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';

import { authPool } from '../../../../../lib/auth/db';
import { consumeAuthNonce } from '../../../../../lib/auth/nonce';
import { buildSessionCookie, createSession } from '../../../../../lib/auth/session';
import { verifySolanaMessageSignature } from '../../../../../lib/auth/walletVerify';

interface VerifyBody {
  nonceId?: string;
  walletAddress?: string;
  signatureBase64?: string;
  signedMessage?: string;
}

export async function POST(request: Request) {
  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_INVALID_JSON' } }, { status: 400 });
  }

  if (!body.nonceId || !body.walletAddress || !body.signatureBase64 || !body.signedMessage) {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_REQUIRED_FIELDS' } }, { status: 400 });
  }

  try {
    void new PublicKey(body.walletAddress);
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_WALLET_INVALID' } }, { status: 400 });
  }

  const nonce = await consumeAuthNonce({
    nonceId: body.nonceId,
    walletAddress: body.walletAddress,
    message: body.signedMessage,
  });

  if (nonce === null) {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_NONCE_INVALID_OR_REPLAYED' } }, { status: 409 });
  }

  const signatureValid = verifySolanaMessageSignature({
    walletAddress: body.walletAddress,
    message: body.signedMessage,
    signatureBase64: body.signatureBase64,
  });

  if (!signatureValid) {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_SIGNATURE_INVALID' } }, { status: 401 });
  }

  const now = new Date();
  const userResult = await authPool.query<{ id: string }>(
    `INSERT INTO "User" (id, "primaryWalletAddress", "walletProvider", "walletMode", "authProvider", "walletVerifiedAt", "lastLoginAt", "updatedAt")
     VALUES ($1, $2, 'phantom_connect', 'embedded', 'phantom_connect', $3, $3, $3)
     ON CONFLICT ("primaryWalletAddress") DO UPDATE SET
       "walletVerifiedAt" = EXCLUDED."walletVerifiedAt",
       "lastLoginAt" = EXCLUDED."lastLoginAt",
       "updatedAt" = EXCLUDED."updatedAt"
     RETURNING id`,
    [randomUUID(), body.walletAddress, now],
  );

  const userId = userResult.rows[0]?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_USER_UPSERT_FAILED' } }, { status: 500 });
  }

  const session = await createSession({
    userId,
    walletAddress: body.walletAddress,
    ipAddress: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  });

  const response = NextResponse.json(
    {
      ok: true,
      data: {
        user: {
          id: userId,
          walletAddress: body.walletAddress,
        },
        session: {
          id: session.sessionId,
          expiresAt: session.expiresAt.toISOString(),
        },
      },
    },
    { status: 200 },
  );

  response.headers.set('Set-Cookie', buildSessionCookie(session.token, session.expiresAt));
  return response;
}

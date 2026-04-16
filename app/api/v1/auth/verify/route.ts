import { createHash, randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';

import { authPool } from '../../../../../lib/auth/db';
import { consumeAuthNonce } from '../../../../../lib/auth/nonce';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../lib/observability/audit';
import {
  assertRateLimit,
  getClientIpAddress,
  RateLimitExceededError,
} from '../../../../../lib/security/rateLimit';
import { buildSessionCookie, createSession } from '../../../../../lib/auth/session';
import { verifySolanaMessageSignature } from '../../../../../lib/auth/walletVerify';
import { dbPool } from '../../../../../lib/prisma';

interface VerifyBody {
  nonceId?: string;
  walletAddress?: string;
  signatureBase64?: string;
  signedMessage?: string;
}

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  const clientIp = getClientIpAddress(request);
  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    await writeAuditLogSafe({
      requestId,
      actionType: 'AUTH_VERIFY',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_VERIFY_INVALID_JSON',
      httpStatus: 400,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_INVALID_JSON' } }, { status: 400 });
  }

  if (!body.nonceId || !body.walletAddress || !body.signatureBase64 || !body.signedMessage) {
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress ?? null,
      actionType: 'AUTH_VERIFY',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_VERIFY_REQUIRED_FIELDS',
      httpStatus: 400,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_REQUIRED_FIELDS' } }, { status: 400 });
  }

  try {
    void new PublicKey(body.walletAddress);
  } catch {
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress,
      actionType: 'AUTH_VERIFY',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_VERIFY_WALLET_INVALID',
      httpStatus: 400,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_WALLET_INVALID' } }, { status: 400 });
  }

  try {
    assertRateLimit({
      namespace: 'auth_verify_ip',
      keyParts: [clientIp],
      limit: 10,
      windowMs: 60_000,
      errorCode: 'AUTH_VERIFY_RATE_LIMIT_IP',
    });
    assertRateLimit({
      namespace: 'auth_verify_wallet',
      keyParts: [body.walletAddress],
      limit: 5,
      windowMs: 60_000,
      errorCode: 'AUTH_VERIFY_RATE_LIMIT_WALLET',
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      await writeAuditLogSafe({
        requestId,
        walletAddress: body.walletAddress,
        actionType: 'AUTH_VERIFY',
        phase: 'REQUEST',
        status: 'ERROR',
        errorCode: error.message,
        httpStatus: 429,
        metadataJson: { clientIp },
      });
      return NextResponse.json({ ok: false, error: { code: error.message, retryable: true } }, { status: 429 });
    }
    throw error;
  }

  const nonce = await consumeAuthNonce({
    nonceId: body.nonceId,
    walletAddress: body.walletAddress,
    message: body.signedMessage,
  });

  if (nonce === null) {
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress,
      actionType: 'AUTH_VERIFY',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_VERIFY_NONCE_INVALID_OR_REPLAYED',
      httpStatus: 409,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_NONCE_INVALID_OR_REPLAYED' } }, { status: 409 });
  }

  const signatureValid = verifySolanaMessageSignature({
    walletAddress: body.walletAddress,
    message: body.signedMessage,
    signatureBase64: body.signatureBase64,
  });

  if (!signatureValid) {
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress,
      actionType: 'AUTH_VERIFY',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_VERIFY_SIGNATURE_INVALID',
      httpStatus: 401,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_VERIFY_SIGNATURE_INVALID' } }, { status: 401 });
  }

  const now = new Date();
  const walletProvider =
    request.headers.get('x-phantom-provider') === 'injected'
      ? 'phantom_injected'
      : 'phantom_connect';
  const walletMode =
    request.headers.get('x-phantom-provider') === 'injected' ? 'injected' : 'embedded';
  let userResult;
  try {
    userResult = await authPool.query<{ id: string }>(
      `INSERT INTO "User" (id, "primaryWalletAddress", "walletProvider", "walletMode", "authProvider", "walletVerifiedAt", "lastLoginAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'phantom_connect', $5, $5, $5)
       ON CONFLICT ("primaryWalletAddress") DO UPDATE SET
         "walletProvider" = EXCLUDED."walletProvider",
         "walletMode" = EXCLUDED."walletMode",
         "walletVerifiedAt" = EXCLUDED."walletVerifiedAt",
         "lastLoginAt" = EXCLUDED."lastLoginAt",
         "updatedAt" = EXCLUDED."updatedAt"
       RETURNING id`,
      [randomUUID(), body.walletAddress, walletProvider, walletMode, now],
    );
  } catch (error) {
    const fallbackUserId = createHash('sha256')
      .update(`wallet:${body.walletAddress}`)
      .digest('hex');
    console.warn('[auth/verify] falling back to basic user row upsert', {
      walletAddress: body.walletAddress,
      error,
    });
    userResult = await dbPool.query<{ id: string }>(
      `INSERT INTO "User" (id, "updatedAt")
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
       RETURNING id`,
      [fallbackUserId, now],
    );
  }

  const userId = userResult.rows[0]?.id;
  if (!userId) {
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress,
      actionType: 'AUTH_VERIFY',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_VERIFY_USER_UPSERT_FAILED',
      httpStatus: 500,
    });
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

  await writeAuditLogSafe({
    requestId,
    sessionId: session.sessionId,
    userId,
    walletAddress: body.walletAddress,
    actionType: 'AUTH_VERIFY',
    phase: 'REQUEST',
    status: 'SUCCESS',
    httpStatus: 200,
    metadataJson: { clientIp },
  });
  response.headers.set('Set-Cookie', buildSessionCookie(session.token, session.expiresAt));
  return response;
}

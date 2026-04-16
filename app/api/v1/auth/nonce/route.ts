import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';

import { issueAuthNonce } from '../../../../../lib/auth/nonce';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../lib/observability/audit';
import {
  assertRateLimit,
  getClientIpAddress,
  RateLimitExceededError,
} from '../../../../../lib/security/rateLimit';

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  const clientIp = getClientIpAddress(request);
  let body: { walletAddress?: string; chain?: string };
  try {
    body = (await request.json()) as { walletAddress?: string; chain?: string };
  } catch {
    await writeAuditLogSafe({
      requestId,
      walletAddress: null,
      actionType: 'AUTH_NONCE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_NONCE_INVALID_JSON',
      httpStatus: 400,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_INVALID_JSON' } }, { status: 400 });
  }

  if (body.chain !== 'solana') {
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress ?? null,
      actionType: 'AUTH_NONCE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_NONCE_INVALID_CHAIN',
      httpStatus: 400,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_INVALID_CHAIN' } }, { status: 400 });
  }

  if (!body.walletAddress || body.walletAddress.trim().length === 0) {
    await writeAuditLogSafe({
      requestId,
      walletAddress: null,
      actionType: 'AUTH_NONCE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_NONCE_WALLET_REQUIRED',
      httpStatus: 400,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_WALLET_REQUIRED' } }, { status: 400 });
  }

  try {
    assertRateLimit({
      namespace: 'auth_nonce_ip',
      keyParts: [clientIp],
      limit: 10,
      windowMs: 60_000,
      errorCode: 'AUTH_NONCE_RATE_LIMIT_IP',
    });
    assertRateLimit({
      namespace: 'auth_nonce_wallet',
      keyParts: [body.walletAddress],
      limit: 5,
      windowMs: 60_000,
      errorCode: 'AUTH_NONCE_RATE_LIMIT_WALLET',
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      await writeAuditLogSafe({
        requestId,
        walletAddress: body.walletAddress,
        actionType: 'AUTH_NONCE',
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

  try {
    void new PublicKey(body.walletAddress);
  } catch {
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress,
      actionType: 'AUTH_NONCE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_NONCE_WALLET_INVALID',
      httpStatus: 400,
    });
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_WALLET_INVALID' } }, { status: 400 });
  }

  const origin = request.headers.get('origin') ?? 'unknown-origin';
  let data;
  try {
    data = await issueAuthNonce({
      walletAddress: body.walletAddress,
      origin,
    });
  } catch (error) {
    console.error('[auth/nonce] failed to issue auth nonce', {
      walletAddress: body.walletAddress,
      clientIp,
      origin,
      error,
    });
    await writeAuditLogSafe({
      requestId,
      walletAddress: body.walletAddress,
      actionType: 'AUTH_NONCE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'AUTH_NONCE_INTERNAL_ERROR',
      httpStatus: 500,
      metadataJson: {
        clientIp,
        origin,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
              }
            : String(error),
      },
    });
    return NextResponse.json(
      { ok: false, error: { code: 'AUTH_NONCE_INTERNAL_ERROR' } },
      { status: 500 },
    );
  }
  await writeAuditLogSafe({
    requestId,
    walletAddress: body.walletAddress,
    actionType: 'AUTH_NONCE',
    phase: 'REQUEST',
    status: 'SUCCESS',
      httpStatus: 201,
      metadataJson: {
        nonceId: data.nonceId,
        clientIp,
      },
    });

  return NextResponse.json({ ok: true, data }, { status: 201 });
}

import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from '../../../../../lib/auth/requireSession';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../lib/observability/audit';
import { assertRateLimit, RateLimitExceededError } from '../../../../../lib/security/rateLimit';
import { presignSettlementTransaction } from '../../../../../lib/solana/settlementPresign';
import type { SettlementV1PresignRequest } from '../../../../../types/api/settlementV1';

function statusForError(message: string): number {
  if (message.startsWith('ERR_EMPTY_') || message.startsWith('ERR_INVALID_')) {
    return 400;
  }
  if (message.startsWith('ERR_SETTLEMENT_REQUEST_NOT_FOUND')) {
    return 404;
  }
  if (
    message.startsWith('ERR_SETTLEMENT_PRESIGN_TOKEN_INVALID') ||
    message.startsWith('ERR_SETTLEMENT_REQUEST_STATE_INVALID') ||
    message.startsWith('ERR_SETTLEMENT_REQUEST_EXPIRED') ||
    message.startsWith('ERR_SETTLEMENT_TX_MISMATCH_')
  ) {
    return 409;
  }
  return 500;
}

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  let body: Partial<SettlementV1PresignRequest>;
  try {
    body = (await request.json()) as Partial<SettlementV1PresignRequest>;
  } catch {
    await writeAuditLogSafe({
      requestId,
      actionType: 'SETTLEMENT_PRESIGN',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'SETTLEMENT_PRESIGN_INVALID_JSON',
      httpStatus: 400,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'SETTLEMENT_PRESIGN_INVALID_JSON' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSession(request);
    try {
      assertRateLimit({
        namespace: 'settlement_presign_session',
        keyParts: [actor.session.id],
        limit: 60,
        windowMs: 60_000,
        errorCode: 'SETTLEMENT_PRESIGN_RATE_LIMIT_SESSION',
      });
      assertRateLimit({
        namespace: 'settlement_presign_request',
        keyParts: [typeof body.prepareRequestId === 'string' ? body.prepareRequestId : ''],
        limit: 20,
        windowMs: 60_000,
        errorCode: 'SETTLEMENT_PRESIGN_RATE_LIMIT_REQUEST',
      });
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        await writeAuditLogSafe({
          requestId,
          sessionId: actor.session.id,
          userId: actor.user.id,
          walletAddress: actor.session.walletAddress,
          actionType: 'SETTLEMENT_PRESIGN',
          phase: 'REQUEST',
          status: 'ERROR',
          errorCode: error.message,
          httpStatus: 429,
          entityType: 'settlement_request',
          entityId:
            typeof body.prepareRequestId === 'string' ? body.prepareRequestId : null,
        });
        return NextResponse.json({ ok: false, error: { code: error.message, retryable: true } }, { status: 429 });
      }
      throw error;
    }
    const data = await presignSettlementTransaction({
      prepareRequestId:
        typeof body.prepareRequestId === 'string' ? body.prepareRequestId : '',
      presignToken: typeof body.presignToken === 'string' ? body.presignToken : '',
      walletAddress: actor.session.walletAddress,
      transactionBase64: typeof body.transactionBase64 === 'string' ? body.transactionBase64 : '',
    });
    await writeAuditLogSafe({
      requestId,
      sessionId: actor.session.id,
      userId: actor.user.id,
      walletAddress: actor.session.walletAddress,
      actionType: 'SETTLEMENT_PRESIGN',
      phase: 'REQUEST',
      status: 'SUCCESS',
      httpStatus: 200,
      entityType: 'settlement_request',
      entityId:
        typeof body.prepareRequestId === 'string' ? body.prepareRequestId : null,
    });

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      await writeAuditLogSafe({
        requestId,
        actionType: 'SETTLEMENT_PRESIGN',
        phase: 'REQUEST',
        status: 'ERROR',
        errorCode: error.message,
        httpStatus: 401,
      });
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      await writeAuditLogSafe({
        requestId,
        actionType: 'SETTLEMENT_PRESIGN',
        phase: 'REQUEST',
        status: 'ERROR',
        errorCode: error.message,
        httpStatus: 403,
      });
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to presign settlement transaction.';
    await writeAuditLogSafe({
      requestId,
      actionType: 'SETTLEMENT_PRESIGN',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: message,
      httpStatus: statusForError(message),
      entityType: 'settlement_request',
      entityId:
        typeof body.prepareRequestId === 'string' ? body.prepareRequestId : null,
    });
    return NextResponse.json(
      { ok: false, error: { code: message } },
      { status: statusForError(message) },
    );
  }
}

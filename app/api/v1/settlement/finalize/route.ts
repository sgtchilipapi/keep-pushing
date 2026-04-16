import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from '../../../../../lib/auth/requireSession';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../lib/observability/audit';
import { assertRateLimit, RateLimitExceededError } from '../../../../../lib/security/rateLimit';
import { finalizeSettlementPresignRequest } from '../../../../../lib/solana/settlementPresign';
import type { SettlementV1FinalizeRequest } from '../../../../../types/api/settlementV1';

function statusForError(message: string): number {
  if (message.startsWith('ERR_EMPTY_') || message.startsWith('ERR_INVALID_')) {
    return 400;
  }
  if (
    message.startsWith('ERR_SETTLEMENT_REQUEST_NOT_FOUND') ||
    message.startsWith('ERR_SETTLEMENT_BATCH_NOT_FOUND')
  ) {
    return 404;
  }
  if (
    message.startsWith('ERR_SETTLEMENT_REQUEST_STATE_INVALID') ||
    message.startsWith('ERR_SETTLEMENT_REQUEST_EXPIRED')
  ) {
    return 409;
  }
  return 500;
}

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  let body: Partial<SettlementV1FinalizeRequest>;
  try {
    body = (await request.json()) as Partial<SettlementV1FinalizeRequest>;
  } catch {
    await writeAuditLogSafe({
      requestId,
      actionType: 'SETTLEMENT_FINALIZE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'SETTLEMENT_FINALIZE_INVALID_JSON',
      httpStatus: 400,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'SETTLEMENT_FINALIZE_INVALID_JSON' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSession(request);
    try {
      assertRateLimit({
        namespace: 'settlement_finalize_session',
        keyParts: [actor.session.id],
        limit: 30,
        windowMs: 60_000,
        errorCode: 'SETTLEMENT_FINALIZE_RATE_LIMIT_SESSION',
      });
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        await writeAuditLogSafe({
          requestId,
          sessionId: actor.session.id,
          userId: actor.user.id,
          walletAddress: actor.session.walletAddress,
          actionType: 'SETTLEMENT_FINALIZE',
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
    const data = await finalizeSettlementPresignRequest({
      prepareRequestId:
        typeof body.prepareRequestId === 'string' ? body.prepareRequestId : '',
      walletAddress: actor.session.walletAddress,
      transactionSignature:
        typeof body.transactionSignature === 'string' ? body.transactionSignature : '',
    });
    await writeAuditLogSafe({
      requestId,
      sessionId: actor.session.id,
      userId: actor.user.id,
      walletAddress: actor.session.walletAddress,
      actionType: 'SETTLEMENT_FINALIZE',
      phase: 'REQUEST',
      status: 'SUCCESS',
      httpStatus: 200,
      chainSignature:
        typeof body.transactionSignature === 'string' ? body.transactionSignature : null,
      entityType: 'settlement_request',
      entityId:
        typeof body.prepareRequestId === 'string' ? body.prepareRequestId : null,
    });

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      await writeAuditLogSafe({
        requestId,
        actionType: 'SETTLEMENT_FINALIZE',
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
        actionType: 'SETTLEMENT_FINALIZE',
        phase: 'REQUEST',
        status: 'ERROR',
        errorCode: error.message,
        httpStatus: 403,
      });
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to finalize settlement transaction.';
    await writeAuditLogSafe({
      requestId,
      actionType: 'SETTLEMENT_FINALIZE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: message,
      httpStatus: statusForError(message),
      chainSignature:
        typeof body.transactionSignature === 'string' ? body.transactionSignature : null,
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

import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from '../../../../../lib/auth/requireSession';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../lib/observability/audit';
import { assertRateLimit, RateLimitExceededError } from '../../../../../lib/security/rateLimit';
import { prepareSettlementPresignRequest } from '../../../../../lib/solana/settlementPresign';
import type { SettlementV1PrepareRequest } from '../../../../../types/api/settlementV1';

function statusForError(message: string): number {
  if (message.startsWith('ERR_EMPTY_') || message.startsWith('ERR_INVALID_')) {
    return 400;
  }
  if (message.startsWith('ERR_SETTLEMENT_BATCH_NOT_FOUND')) {
    return 404;
  }
  if (
    message.startsWith('ERR_SETTLEMENT_REQUEST_ALREADY_EXISTS') ||
    message.startsWith('ERR_SETTLEMENT_ALREADY_SUBMITTED') ||
    message.startsWith('ERR_NO_PENDING_BATTLES') ||
    message.startsWith('ERR_NO_ELIGIBLE_FIRST_SYNC_BATTLES')
  ) {
    return 409;
  }
  return 500;
}

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  let body: Partial<SettlementV1PrepareRequest>;
  try {
    body = (await request.json()) as Partial<SettlementV1PrepareRequest>;
  } catch {
    await writeAuditLogSafe({
      requestId,
      actionType: 'SETTLEMENT_PREPARE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'SETTLEMENT_PREPARE_INVALID_JSON',
      httpStatus: 400,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'SETTLEMENT_PREPARE_INVALID_JSON' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSessionCharacterAccess(
      request,
      typeof body.characterId === 'string' ? body.characterId : '',
    );
    try {
      assertRateLimit({
        namespace: 'settlement_prepare_session',
        keyParts: [actor.session.id],
        limit: 30,
        windowMs: 60_000,
        errorCode: 'SETTLEMENT_PREPARE_RATE_LIMIT_SESSION',
      });
      assertRateLimit({
        namespace: 'settlement_prepare_character',
        keyParts: [typeof body.characterId === 'string' ? body.characterId : ''],
        limit: 10,
        windowMs: 60_000,
        errorCode: 'SETTLEMENT_PREPARE_RATE_LIMIT_CHARACTER',
      });
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        await writeAuditLogSafe({
          requestId,
          sessionId: actor.session.id,
          userId: actor.user.id,
          walletAddress: actor.session.walletAddress,
          actionType: 'SETTLEMENT_PREPARE',
          phase: 'REQUEST',
          status: 'ERROR',
          errorCode: error.message,
          httpStatus: 429,
          entityType: 'character',
          entityId: typeof body.characterId === 'string' ? body.characterId : null,
        });
        return NextResponse.json({ ok: false, error: { code: error.message, retryable: true } }, { status: 429 });
      }
      throw error;
    }
    const data = await prepareSettlementPresignRequest({
      characterId: typeof body.characterId === 'string' ? body.characterId : '',
      walletAddress: actor.session.walletAddress,
      sessionId: actor.session.id,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '',
    });
    await writeAuditLogSafe({
      requestId,
      sessionId: actor.session.id,
      userId: actor.user.id,
      walletAddress: actor.session.walletAddress,
      actionType: 'SETTLEMENT_PREPARE',
      phase: 'REQUEST',
      status: 'SUCCESS',
      httpStatus: 200,
      entityType: 'character',
      entityId: typeof body.characterId === 'string' ? body.characterId : null,
      metadataJson: {
        prepareRequestId: data.prepareRequestId,
        settlementBatchId: data.settlementBatchId,
      },
    });

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      await writeAuditLogSafe({
        requestId,
        actionType: 'SETTLEMENT_PREPARE',
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
        actionType: 'SETTLEMENT_PREPARE',
        phase: 'REQUEST',
        status: 'ERROR',
        errorCode: error.message,
        httpStatus: 403,
      });
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to prepare settlement presign request.';
    await writeAuditLogSafe({
      requestId,
      actionType: 'SETTLEMENT_PREPARE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: message,
      httpStatus: statusForError(message),
      entityType: 'character',
      entityId: typeof body.characterId === 'string' ? body.characterId : null,
    });
    return NextResponse.json(
      { ok: false, error: { code: message } },
      { status: statusForError(message) },
    );
  }
}

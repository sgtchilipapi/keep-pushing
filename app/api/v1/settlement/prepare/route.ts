import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from '../../../../../lib/auth/requireSession';
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
  let body: Partial<SettlementV1PrepareRequest>;
  try {
    body = (await request.json()) as Partial<SettlementV1PrepareRequest>;
  } catch {
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
    const data = await prepareSettlementPresignRequest({
      characterId: typeof body.characterId === 'string' ? body.characterId : '',
      walletAddress: actor.session.walletAddress,
      sessionId: actor.session.id,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '',
    });

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to prepare settlement presign request.';
    return NextResponse.json(
      { ok: false, error: { code: message } },
      { status: statusForError(message) },
    );
  }
}

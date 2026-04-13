import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from '../../../../../lib/auth/requireSession';
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
  let body: Partial<SettlementV1PresignRequest>;
  try {
    body = (await request.json()) as Partial<SettlementV1PresignRequest>;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'SETTLEMENT_PRESIGN_INVALID_JSON' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSession(request);
    const data = await presignSettlementTransaction({
      prepareRequestId:
        typeof body.prepareRequestId === 'string' ? body.prepareRequestId : '',
      presignToken: typeof body.presignToken === 'string' ? body.presignToken : '',
      walletAddress: actor.session.walletAddress,
      transactionBase64: typeof body.transactionBase64 === 'string' ? body.transactionBase64 : '',
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
      error instanceof Error ? error.message : 'Failed to presign settlement transaction.';
    return NextResponse.json(
      { ok: false, error: { code: message } },
      { status: statusForError(message) },
    );
  }
}

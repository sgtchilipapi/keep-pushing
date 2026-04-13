import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from '../../../../../lib/auth/requireSession';
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
  let body: Partial<SettlementV1FinalizeRequest>;
  try {
    body = (await request.json()) as Partial<SettlementV1FinalizeRequest>;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'SETTLEMENT_FINALIZE_INVALID_JSON' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSession(request);
    const data = await finalizeSettlementPresignRequest({
      prepareRequestId:
        typeof body.prepareRequestId === 'string' ? body.prepareRequestId : '',
      walletAddress: actor.session.walletAddress,
      transactionSignature:
        typeof body.transactionSignature === 'string' ? body.transactionSignature : '',
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
      error instanceof Error ? error.message : 'Failed to finalize settlement transaction.';
    return NextResponse.json(
      { ok: false, error: { code: message } },
      { status: statusForError(message) },
    );
  }
}

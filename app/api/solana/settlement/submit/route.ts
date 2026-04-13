import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from '../../../../../lib/auth/requireSession';
import {
  submitSolanaSettlement,
} from '../../../../../lib/solana/settlementRelay';
import type { SubmitSettlementRouteRequest } from '../../../../../types/api/solana';

function statusForError(message: string): number {
  if (
    message.startsWith('ERR_INVALID_') ||
    message.startsWith('ERR_EMPTY_') ||
    message.startsWith('ERR_SIGNED_') ||
    message.startsWith('ERR_SETTLEMENT_OUT_OF_ORDER')
  ) {
    return 400;
  }

  if (
    message.startsWith('ERR_CHARACTER_NOT_FOUND') ||
    message.startsWith('ERR_SETTLEMENT_BATCH_NOT_FOUND')
  ) {
    return 404;
  }

  if (
    message.startsWith('ERR_INVALID_SETTLEMENT_SUBMISSION') ||
    message.startsWith('ERR_SETTLEMENT_BATCH_RELAY_MISMATCH') ||
    message.startsWith('ERR_SETTLEMENT_PAYLOAD_RELAY_MISMATCH')
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<SubmitSettlementRouteRequest>;

  try {
    body = (await request.json()) as Partial<SubmitSettlementRouteRequest>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body.prepared === undefined || body.prepared === null) {
    return NextResponse.json({ error: 'prepared is required.' }, { status: 400 });
  }

  try {
    const actor = await requireSession(request);
    const prepared = body.prepared as SubmitSettlementRouteRequest['prepared'];
    if (prepared.authority !== actor.session.walletAddress) {
      throw new SessionForbiddenError(
        'ERR_AUTH_WALLET_FORBIDDEN: prepared authority does not match the active session wallet',
      );
    }
    const result = await submitSolanaSettlement({
      settlementBatchId: typeof body.settlementBatchId === 'string' ? body.settlementBatchId : '',
      prepared,
      signedMessageBase64: typeof body.signedMessageBase64 === 'string' ? body.signedMessageBase64 : '',
      signedTransactionBase64:
        typeof body.signedTransactionBase64 === 'string' ? body.signedTransactionBase64 : '',
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : 'Failed to submit Solana settlement.';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}

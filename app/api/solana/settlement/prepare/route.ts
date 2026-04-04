import { NextResponse } from 'next/server';

import {
  prepareSolanaSettlement,
} from '../../../../../lib/solana/settlementRelay';
import type { PrepareSettlementRouteRequest } from '../../../../../types/api/solana';

function statusForError(message: string): number {
  if (
    message.startsWith('ERR_INVALID_') ||
    message.startsWith('ERR_EMPTY_') ||
    message.startsWith('ERR_PLAYER_MUST_PAY')
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
    message.startsWith('ERR_CHARACTER_CHAIN_IDENTITY_MISSING') ||
    message.startsWith('ERR_CHARACTER_AUTHORITY_MISMATCH') ||
    message.startsWith('ERR_SETTLEMENT_ALREADY_SUBMITTED') ||
    message.startsWith('ERR_SETTLEMENT_NOT_RETRYABLE')
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<PrepareSettlementRouteRequest>;

  try {
    body = (await request.json()) as Partial<PrepareSettlementRouteRequest>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const result = await prepareSolanaSettlement({
      characterId: typeof body.characterId === 'string' ? body.characterId : '',
      authority: typeof body.authority === 'string' ? body.authority : '',
      feePayer: typeof body.feePayer === 'string' ? body.feePayer : undefined,
      relayRequestId: typeof body.relayRequestId === 'string' ? body.relayRequestId : undefined,
      playerAuthorizationSignatureBase64:
        typeof body.playerAuthorizationSignatureBase64 === 'string'
          ? body.playerAuthorizationSignatureBase64
          : undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare Solana settlement.';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}

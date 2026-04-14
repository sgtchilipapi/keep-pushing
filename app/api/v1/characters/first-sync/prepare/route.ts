import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from '../../../../../../lib/auth/requireSession';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../../lib/observability/audit';
import {
  prepareSolanaFirstSync,
} from '../../../../../../lib/solana/firstSyncRelay';
import type {
  CharacterFirstSyncV1PrepareRequest,
} from '../../../../../../types/api/characters';

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
    message.startsWith('ERR_CHARACTER_CURSOR_UNAVAILABLE') ||
    message.startsWith('ERR_NO_FIRST_SYNC_BATCH')
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  let body: Partial<CharacterFirstSyncV1PrepareRequest>;

  try {
    body = (await request.json()) as Partial<CharacterFirstSyncV1PrepareRequest>;
  } catch {
    await writeAuditLogSafe({
      requestId,
      actionType: 'FIRST_SYNC_PREPARE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'FIRST_SYNC_PREPARE_INVALID_JSON',
      httpStatus: 400,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'FIRST_SYNC_PREPARE_INVALID_JSON' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSessionCharacterAccess(
      request,
      typeof body.characterId === 'string' ? body.characterId : '',
    );
    const result = await prepareSolanaFirstSync({
      characterId: typeof body.characterId === 'string' ? body.characterId : '',
      authority: actor.session.walletAddress,
      feePayer: undefined,
    });
    await writeAuditLogSafe({
      requestId,
      sessionId: actor.session.id,
      userId: actor.user.id,
      walletAddress: actor.session.walletAddress,
      actionType: 'FIRST_SYNC_PREPARE',
      phase: 'REQUEST',
      status: 'SUCCESS',
      httpStatus: 200,
      entityType: 'character',
      entityId: typeof body.characterId === 'string' ? body.characterId : null,
    });

    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      await writeAuditLogSafe({
        requestId,
        actionType: 'FIRST_SYNC_PREPARE',
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
        actionType: 'FIRST_SYNC_PREPARE',
        phase: 'REQUEST',
        status: 'ERROR',
        errorCode: error.message,
        httpStatus: 403,
      });
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : 'Failed to prepare first sync.';
    await writeAuditLogSafe({
      requestId,
      actionType: 'FIRST_SYNC_PREPARE',
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

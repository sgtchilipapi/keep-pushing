import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from '../../../../../../lib/auth/requireSession';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../../lib/observability/audit';
import { acknowledgeSolanaFirstSync } from '../../../../../../lib/solana/firstSyncRelay';
import type {
  CharacterFirstSyncV1FinalizeRequest,
} from '../../../../../../types/api/characters';

function statusForError(message: string): number {
  if (
    message.startsWith('ERR_INVALID_') ||
    message.startsWith('ERR_EMPTY_')
  ) {
    return 400;
  }

  if (message.startsWith('ERR_CHARACTER_NOT_FOUND')) {
    return 404;
  }

  if (
    message.startsWith('ERR_CHARACTER_AUTHORITY_MISMATCH') ||
    message.startsWith('ERR_CHARACTER_CHAIN_ID_MISMATCH') ||
    message.startsWith('ERR_CHARACTER_ROOT_MISMATCH') ||
    message.startsWith('ERR_CHARACTER_SUBMISSION_STATE') ||
    message.startsWith('ERR_FIRST_SYNC_BATCH_RELAY_MISMATCH')
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  let body: Partial<CharacterFirstSyncV1FinalizeRequest>;

  try {
    body = (await request.json()) as Partial<CharacterFirstSyncV1FinalizeRequest>;
  } catch {
    await writeAuditLogSafe({
      requestId,
      actionType: 'FIRST_SYNC_FINALIZE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'FIRST_SYNC_FINALIZE_INVALID_JSON',
      httpStatus: 400,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'FIRST_SYNC_FINALIZE_INVALID_JSON' } },
      { status: 400 },
    );
  }

  if (body.prepared === undefined || body.prepared === null) {
    await writeAuditLogSafe({
      requestId,
      actionType: 'FIRST_SYNC_FINALIZE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: 'ERR_INVALID_PREPARED: prepared is required',
      httpStatus: 400,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'ERR_INVALID_PREPARED: prepared is required' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSession(request);
    const prepared = body.prepared as CharacterFirstSyncV1FinalizeRequest['prepared'];
    if (prepared.authority !== actor.session.walletAddress) {
      throw new SessionForbiddenError(
        'ERR_AUTH_WALLET_FORBIDDEN: prepared authority does not match the active session wallet',
      );
    }
    const result = await acknowledgeSolanaFirstSync({
      prepared,
      transactionSignature:
        typeof body.transactionSignature === 'string' ? body.transactionSignature : '',
    });
    await writeAuditLogSafe({
      requestId,
      sessionId: actor.session.id,
      userId: actor.user.id,
      walletAddress: actor.session.walletAddress,
      actionType: 'FIRST_SYNC_FINALIZE',
      phase: 'REQUEST',
      status: 'SUCCESS',
      httpStatus: 200,
      chainSignature:
        typeof body.transactionSignature === 'string' ? body.transactionSignature : null,
      entityType: 'character',
      entityId: result.characterId,
    });

    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      await writeAuditLogSafe({
        requestId,
        actionType: 'FIRST_SYNC_FINALIZE',
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
        actionType: 'FIRST_SYNC_FINALIZE',
        phase: 'REQUEST',
        status: 'ERROR',
        errorCode: error.message,
        httpStatus: 403,
      });
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : 'Failed to finalize first sync.';
    await writeAuditLogSafe({
      requestId,
      actionType: 'FIRST_SYNC_FINALIZE',
      phase: 'REQUEST',
      status: 'ERROR',
      errorCode: message,
      httpStatus: statusForError(message),
      chainSignature:
        typeof body.transactionSignature === 'string' ? body.transactionSignature : null,
    });
    return NextResponse.json(
      { ok: false, error: { code: message } },
      { status: statusForError(message) },
    );
  }
}

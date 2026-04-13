import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from '../../../../../../lib/auth/requireSession';
import {
  prepareSolanaCharacterCreation,
} from '../../../../../../lib/solana/characterCreation';
import type {
  CharacterCreateV1PrepareRequest,
} from '../../../../../../types/api/characters';

function statusForError(message: string): number {
  if (
    message.startsWith('ERR_INVALID_') ||
    message.startsWith('ERR_EMPTY_') ||
    message.startsWith('ERR_PLAYER_MUST_PAY')
  ) {
    return 400;
  }

  if (message.startsWith('ERR_CHARACTER_NOT_FOUND')) {
    return 404;
  }

  if (
    message.startsWith('ERR_CHARACTER_ALREADY_CONFIRMED') ||
    message.startsWith('ERR_CHARACTER_AUTHORITY_MISMATCH') ||
    message.startsWith('ERR_CHARACTER_CHAIN_IDENTITY_CORRUPT')
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<CharacterCreateV1PrepareRequest>;

  try {
    body = (await request.json()) as Partial<CharacterCreateV1PrepareRequest>;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'CHARACTER_CREATE_PREPARE_INVALID_JSON' } },
      { status: 400 },
    );
  }

  try {
    const actor = await requireSessionCharacterAccess(
      request,
      typeof body.characterId === 'string' ? body.characterId : '',
    );
    const result = await prepareSolanaCharacterCreation({
      characterId: typeof body.characterId === 'string' ? body.characterId : '',
      authority: actor.session.walletAddress,
      feePayer: undefined,
      initialUnlockedZoneId:
        typeof body.initialUnlockedZoneId === 'number'
          ? body.initialUnlockedZoneId
          : Number.NaN,
    });

    return NextResponse.json(
      { ok: true, data: result },
      { status: result.phase === 'sign_transaction' ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: error.message } }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to prepare character creation.';
    return NextResponse.json(
      { ok: false, error: { code: message } },
      { status: statusForError(message) },
    );
  }
}

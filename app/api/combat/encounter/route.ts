import { NextResponse } from 'next/server';

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from '../../../../lib/auth/requireSession';
import { executeRealEncounter, type ExecuteRealEncounterInput } from '../../../../lib/combat/realEncounter';

function statusForError(message: string): number {
  if (
    message.startsWith('ERR_INVALID_') ||
    message.startsWith('ERR_EMPTY_') ||
    message.startsWith('ERR_UNKNOWN_ZONE_ID')
  ) {
    return 400;
  }

  if (message.startsWith('ERR_CHARACTER_NOT_FOUND')) {
    return 404;
  }

  if (
    message.startsWith('ERR_CHARACTER_NOT_CONFIRMED') ||
    message.startsWith('ERR_CHARACTER_CURSOR_UNAVAILABLE') ||
    message.startsWith('ERR_INITIAL_SETTLEMENT_REQUIRED') ||
    message.startsWith('ERR_ZONE_LOCKED') ||
    message.startsWith('ERR_SEASON_NOT_ACTIVE') ||
    message.startsWith('ERR_ACTIVE_SEASON_UNRESOLVED')
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<ExecuteRealEncounterInput>;

  try {
    body = (await request.json()) as Partial<ExecuteRealEncounterInput>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (
    typeof body.characterId !== 'string' ||
    body.characterId.length === 0 ||
    typeof body.zoneId !== 'number'
  ) {
    return NextResponse.json(
      { error: 'Invalid payload: expected characterId and zoneId.' },
      { status: 400 },
    );
  }

  try {
    await requireSessionCharacterAccess(request, body.characterId);
    const result = await executeRealEncounter({
      characterId: body.characterId,
      zoneId: body.zoneId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : 'Failed to execute real encounter.';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}

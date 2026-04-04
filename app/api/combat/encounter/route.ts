import { NextResponse } from 'next/server';

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
    typeof body.zoneId !== 'number' ||
    typeof body.seed !== 'number'
  ) {
    return NextResponse.json(
      { error: 'Invalid payload: expected characterId, zoneId, and seed.' },
      { status: 400 },
    );
  }

  try {
    const result = await executeRealEncounter({
      characterId: body.characterId,
      zoneId: body.zoneId,
      seed: body.seed,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute real encounter.';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}

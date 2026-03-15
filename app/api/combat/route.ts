import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { simulateBattle } from '../../../engine/battle/battleEngine';
import type { CombatantSnapshot } from '../../../types/combat';

type CombatRequestBody = {
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  seed: number;
};

function isValidEntityId(entityId: string): boolean {
  return /^\d+$/.test(entityId);
}

function isNumericStringId(value: string): boolean {
  return /^\d+$/.test(value);
}

function isSkillTuple(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((skillId) => typeof skillId === 'string' && isNumericStringId(skillId))
  );
}

function isCombatantSnapshot(value: unknown): value is CombatantSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const snapshot = value as Partial<CombatantSnapshot>;

  return (
    !('initiative' in snapshot) &&
    typeof snapshot.entityId === 'string' &&
    isValidEntityId(snapshot.entityId) &&
    typeof snapshot.hp === 'number' &&
    typeof snapshot.hpMax === 'number' &&
    typeof snapshot.atk === 'number' &&
    typeof snapshot.def === 'number' &&
    typeof snapshot.spd === 'number' &&
    typeof snapshot.accuracyBP === 'number' &&
    typeof snapshot.evadeBP === 'number' &&
    isSkillTuple(snapshot.activeSkillIds) &&
    (snapshot.passiveSkillIds === undefined || isSkillTuple(snapshot.passiveSkillIds))
  );
}

export async function POST(request: Request) {
  let body: Partial<CombatRequestBody>;

  try {
    body = (await request.json()) as Partial<CombatRequestBody>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (
    typeof body.seed !== 'number' ||
    !isCombatantSnapshot(body.playerInitial) ||
    !isCombatantSnapshot(body.enemyInitial)
  ) {
    return NextResponse.json(
      { error: 'Invalid payload: expected playerInitial, enemyInitial, and numeric seed.' },
      { status: 400 }
    );
  }

  const result = simulateBattle({
    battleId: randomUUID(),
    seed: body.seed,
    playerInitial: body.playerInitial,
    enemyInitial: body.enemyInitial
  });

  return NextResponse.json(result);
}

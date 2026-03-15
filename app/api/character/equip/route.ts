import { NextResponse } from 'next/server';

import { getPassiveDef } from '../../../../engine/battle/passiveRegistry';
import { getSkillDef } from '../../../../engine/battle/skillRegistry';
import { prisma } from '../../../../lib/prisma';

type EquipPayload = {
  characterId: string;
  activeSkills: string[];
  passiveSkills: string[];
};

function validateUniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

function isNumericStringId(value: string): boolean {
  return /^\d+$/.test(value);
}

export async function POST(request: Request) {
  let body: Partial<EquipPayload>;

  try {
    body = (await request.json()) as Partial<EquipPayload>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (typeof body.characterId !== 'string' || body.characterId.length === 0) {
    return NextResponse.json({ error: 'characterId is required.' }, { status: 400 });
  }

  if (
    !Array.isArray(body.activeSkills) ||
    !Array.isArray(body.passiveSkills) ||
    body.activeSkills.length !== 2 ||
    body.passiveSkills.length !== 2 ||
    !body.activeSkills.every((skillId) => typeof skillId === 'string') ||
    !body.passiveSkills.every((passiveId) => typeof passiveId === 'string')
  ) {
    return NextResponse.json(
      { error: 'Payload must include exactly 2 activeSkills and 2 passiveSkills.' },
      { status: 400 }
    );
  }

  if (!body.activeSkills.every(isNumericStringId) || !body.passiveSkills.every(isNumericStringId)) {
    return NextResponse.json({ error: 'Skill IDs must be numeric strings.' }, { status: 400 });
  }

  if (!validateUniqueIds(body.activeSkills) || !validateUniqueIds(body.passiveSkills)) {
    return NextResponse.json({ error: 'Skills within each loadout must be unique.' }, { status: 400 });
  }

  try {
    body.activeSkills.forEach((skillId) => getSkillDef(skillId));
    body.passiveSkills.forEach((passiveId) => getPassiveDef(passiveId));
  } catch {
    return NextResponse.json({ error: 'Unknown active skill or passive skill.' }, { status: 400 });
  }

  const character = await prisma.character.findUnique(body.characterId);
  if (character === null) {
    return NextResponse.json({ error: 'Character not found.' }, { status: 404 });
  }

  await prisma.character.updateEquip(body.characterId, body.activeSkills, body.passiveSkills);

  return NextResponse.json({
    characterId: body.characterId,
    activeSkills: body.activeSkills,
    passiveSkills: body.passiveSkills
  });
}

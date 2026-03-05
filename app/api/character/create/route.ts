import { NextResponse } from 'next/server';

import { getPassiveDef } from '../../../../engine/battle/passiveRegistry';
import { getSkillDef } from '../../../../engine/battle/skillRegistry';
import { prisma } from '../../../../lib/prisma';

type CreateCharacterPayload = {
  userId: string;
  name?: string;
};

const STARTER_ACTIVE_SKILLS = ['VOLT_STRIKE', 'FINISHING_BLOW'];
const STARTER_PASSIVES = ['EAGLE_EYE', 'EXECUTIONER_FOCUS'];

export async function POST(request: Request) {
  let body: Partial<CreateCharacterPayload>;

  try {
    body = (await request.json()) as Partial<CreateCharacterPayload>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (typeof body.userId !== 'string' || body.userId.length === 0) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique(body.userId);
  if (user === null) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : 'Rookie';

  const character = await prisma.character.create({
    userId: body.userId,
    name,
    hp: 1200,
    hpMax: 1200,
    atk: 120,
    def: 70,
    spd: 100,
    accuracyBP: 8000,
    evadeBP: 1200,
    activeSkills: STARTER_ACTIVE_SKILLS,
    passiveSkills: STARTER_PASSIVES
  });

  STARTER_ACTIVE_SKILLS.forEach((skillId) => getSkillDef(skillId));
  STARTER_PASSIVES.forEach((passiveId) => getPassiveDef(passiveId));

  return NextResponse.json(
    {
      characterId: character.id,
      userId: character.userId,
      name: character.name,
      level: character.level,
      stats: {
        hp: character.hp,
        hpMax: character.hpMax,
        atk: character.atk,
        def: character.def,
        spd: character.spd,
        accuracyBP: character.accuracyBP,
        evadeBP: character.evadeBP
      },
      activeSkills: STARTER_ACTIVE_SKILLS,
      passiveSkills: STARTER_PASSIVES,
      unlockedSkillIds: STARTER_ACTIVE_SKILLS
    },
    { status: 201 }
  );
}

import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/prisma';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (userId === null || userId.length === 0) {
    return NextResponse.json({ error: 'userId query parameter is required.' }, { status: 400 });
  }

  const character = await prisma.character.findByUserId(userId);

  if (character === null) {
    return NextResponse.json({ character: null });
  }

  return NextResponse.json({
    character: {
      characterId: character.id,
      userId: character.userId,
      name: character.name,
      level: character.level,
      exp: character.exp,
      stats: {
        hp: character.hp,
        hpMax: character.hpMax,
        atk: character.atk,
        def: character.def,
        spd: character.spd,
        accuracyBP: character.accuracyBP,
        evadeBP: character.evadeBP
      },
      activeSkills: character.activeSkills,
      passiveSkills: character.passiveSkills,
      unlockedSkillIds: character.unlockedSkillIds,
      inventory: character.inventory
    }
  });
}

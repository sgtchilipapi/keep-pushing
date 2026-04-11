import { NextResponse } from 'next/server';

import { getPassiveDef } from '../../../../engine/battle/passiveRegistry';
import { getSkillDef } from '../../../../engine/battle/skillRegistry';
import {
  CHARACTER_NAME_RESERVATION_TTL_MS,
  assertValidCharacterName,
  normalizeCharacterClassId,
  normalizeCharacterName,
  normalizeCharacterSlotIndex,
} from '../../../../lib/characterIdentity';
import { prisma } from '../../../../lib/prisma';

type CreateCharacterPayload = {
  userId: string;
  name?: string;
  classId?: string;
  slotIndex?: number;
};

const STARTER_ACTIVE_SKILLS = ['1001', '1002'];
const STARTER_PASSIVES = ['2001', '2002'];

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

  let name: string;
  let classId: string;
  let slotIndex: number;
  try {
    name = assertValidCharacterName(body.name ?? '');
    classId = normalizeCharacterClassId(body.classId);
    slotIndex = normalizeCharacterSlotIndex(body.slotIndex);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Invalid character identity payload.',
      },
      { status: 400 }
    );
  }

  let reservationId: string | null = null;

  try {
    const reservation = await prisma.characterNameReservation.createHold({
      userId: body.userId,
      displayName: name,
      normalizedName: normalizeCharacterName(name),
      expiresAt: new Date(Date.now() + CHARACTER_NAME_RESERVATION_TTL_MS),
    });
    reservationId = reservation.id;

    const character = await prisma.character.create({
      userId: body.userId,
      name,
      nameNormalized: normalizeCharacterName(name),
      classId,
      slotIndex,
      chainBootstrapReady: true,
      nameReservationId: reservation.id,
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
        classId: character.classId,
        slotIndex: character.slotIndex,
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
  } catch (error) {
    if (reservationId !== null) {
      await prisma.characterNameReservation.release(reservationId);
    }

    const message =
      error instanceof Error ? error.message : 'Failed to create character.';

    if (
      message.startsWith('ERR_CHARACTER_NAME_TAKEN') ||
      message.includes('Character_userId_slotIndex_key')
    ) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { prisma } from '../prisma';

export interface PrepareFirstSyncCharacterAnchorInput {
  characterId: string;
  authority: string;
  feePayer?: string;
  env?: NodeJS.ProcessEnv;
}

export interface PreparedFirstSyncCharacterAnchor {
  characterId: string;
  authority: string;
  feePayer: string;
  characterCreationTs: number;
  seasonIdAtCreation: number;
  initialUnlockedZoneId: number;
}

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ERR_EMPTY_${field.toUpperCase()}: ${field} is required`);
  }
}

function toUnixTimestampSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function parseConfiguredActiveSeasonId(env: NodeJS.ProcessEnv): number | null {
  const configured = env.RUNANA_ACTIVE_SEASON_ID?.trim() ?? env.RUNANA_SEASON_ID?.trim() ?? '';
  if (configured.length === 0) {
    return null;
  }

  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      'ERR_ACTIVE_SEASON_UNRESOLVED: RUNANA_ACTIVE_SEASON_ID or RUNANA_SEASON_ID must be a non-negative integer',
    );
  }

  return parsed;
}

function resolveInitialUnlockedZoneId(zoneStates: Record<string, number>, highestUnlockedZoneId: number): number {
  const unlockedZoneIds = Object.entries(zoneStates)
    .filter(([, state]) => state >= 1)
    .map(([zoneId]) => Number(zoneId))
    .filter((zoneId) => Number.isInteger(zoneId) && zoneId >= 0)
    .sort((left, right) => left - right);

  return unlockedZoneIds[0] ?? highestUnlockedZoneId;
}

export async function prepareFirstSyncCharacterAnchor(
  input: PrepareFirstSyncCharacterAnchorInput,
): Promise<PreparedFirstSyncCharacterAnchor> {
  assertNonEmptyString(input.characterId, 'characterId');
  assertNonEmptyString(input.authority, 'authority');

  const feePayer = input.feePayer ?? input.authority;
  assertNonEmptyString(feePayer, 'feePayer');

  const character = await prisma.character.findBattleReadyById(input.characterId);
  if (character === null) {
    throw new Error('ERR_CHARACTER_NOT_FOUND: character was not found');
  }
  if (character.chainCreationStatus === 'CONFIRMED') {
    throw new Error('ERR_CHARACTER_ALREADY_CONFIRMED: character is already confirmed on chain');
  }

  const provisionalProgress = await prisma.characterProvisionalProgress.findByCharacterId(character.id);
  if (provisionalProgress === null) {
    throw new Error(
      `ERR_CHARACTER_PROVISIONAL_PROGRESS_NOT_FOUND: character ${character.id} is missing provisional progress`,
    );
  }

  const earliestBattle = await prisma.battleOutcomeLedger.findEarliestForCharacter(character.id);
  const creationTs = toUnixTimestampSeconds(character.createdAt);
  const configuredSeasonId = parseConfiguredActiveSeasonId(input.env ?? process.env);
  const seasonIdAtCreationCandidate =
    earliestBattle?.seasonId ??
    character.chainCreationSeasonId ??
    configuredSeasonId;

  if (
    seasonIdAtCreationCandidate === null ||
    !Number.isInteger(seasonIdAtCreationCandidate) ||
    seasonIdAtCreationCandidate < 0
  ) {
    throw new Error(
      'ERR_ACTIVE_SEASON_UNRESOLVED: could not derive season_id_at_creation from backlog, persisted state, or environment',
    );
  }
  const seasonIdAtCreation = seasonIdAtCreationCandidate;

  return {
    characterId: character.id,
    authority: input.authority,
    feePayer,
    characterCreationTs: creationTs,
    seasonIdAtCreation,
    initialUnlockedZoneId: resolveInitialUnlockedZoneId(
      provisionalProgress.zoneStates,
      provisionalProgress.highestUnlockedZoneId,
    ),
  };
}

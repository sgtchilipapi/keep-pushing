import { randomUUID } from 'node:crypto';

import { PublicKey, type Commitment, type Connection } from '@solana/web3.js';

import { generateBattleSeed, simulateBattle } from '../../engine/battle/battleEngine';
import type { BattleResult } from '../../types/battle';
import { prisma, type PersistedEncounterRecord } from '../prisma';
import {
  fetchCharacterWorldProgressAccount,
  fetchSeasonPolicyAccount,
} from '../solana/runanaAccounts';
import {
  createRunanaConnection,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from '../solana/runanaClient';
import {
  deriveCharacterWorldProgressPda,
  deriveSeasonPolicyPda,
} from '../solana/runanaProgram';
import {
  buildEnemyCombatSnapshot,
  buildPlayerCombatSnapshot,
  loadCharacterBattleReadyRecord,
} from './combatSnapshotAssembly';
import { selectEncounterForZone } from './encounterSelection';
import { buildEncounterSettlementPersistenceInput } from './encounterSettlement';
import {
  applyLocalFirstBattleToProvisionalProgress,
  assertProvisionalZoneAccess,
} from './provisionalProgress';

export interface ExecuteRealEncounterInput {
  characterId: string;
  zoneId: number;
}

export interface ExecuteRealEncounterResult {
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  seed: number;
  battleNonce: number;
  seasonId: number;
  battleTs: number;
  settlementStatus: 'PENDING' | 'AWAITING_FIRST_SYNC';
  battleResult: BattleResult;
}

export interface RealEncounterServiceDependencies {
  connection?: Pick<Connection, 'getAccountInfo'>;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

function assertInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an integer >= ${minimum}`);
  }
}

function currentUnixTimestamp(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

function resolveConfiguredActiveSeasonId(args: {
  env: NodeJS.ProcessEnv;
  fallbackSeasonId: number | null;
  chainCreationSeasonId: number | null;
}): number {
  const configured =
    args.env.RUNANA_ACTIVE_SEASON_ID?.trim() ??
    args.env.RUNANA_SEASON_ID?.trim() ??
    undefined;
  const candidate =
    configured === undefined || configured.length === 0
      ? (args.fallbackSeasonId ?? args.chainCreationSeasonId)
      : Number(configured);

  if (!Number.isInteger(candidate) || (candidate as number) < 0) {
    throw new Error(
      'ERR_ACTIVE_SEASON_UNRESOLVED: configure RUNANA_ACTIVE_SEASON_ID or ensure the character has a reconciled season id',
    );
  }

  return candidate as number;
}

function assertCharacterExists(
  character: Awaited<ReturnType<typeof loadCharacterBattleReadyRecord>>,
): asserts character is NonNullable<Awaited<ReturnType<typeof loadCharacterBattleReadyRecord>>> {
  if (character === null) {
    throw new Error('ERR_CHARACTER_NOT_FOUND: character was not found');
  }
}

function isConfirmedEncounterCharacter(
  character: NonNullable<Awaited<ReturnType<typeof loadCharacterBattleReadyRecord>>>,
): boolean {
  return (
    character.chainCreationStatus === 'CONFIRMED' &&
    character.characterRootPubkey !== null &&
    character.lastReconciledEndNonce !== null &&
    character.lastReconciledStateHash !== null &&
    character.lastReconciledBatchId !== null &&
    character.lastReconciledBattleTs !== null &&
    character.lastReconciledSeasonId !== null
  );
}

function assertConfirmedCharacterEncounterReady(
  character: NonNullable<Awaited<ReturnType<typeof loadCharacterBattleReadyRecord>>>,
): void {
  if (character.chainCreationStatus !== 'CONFIRMED') {
    throw new Error('ERR_CHARACTER_NOT_CONFIRMED: character must be chain-confirmed before encounters');
  }
  if (
    character.characterRootPubkey === null ||
    character.lastReconciledEndNonce === null ||
    character.lastReconciledStateHash === null ||
    character.lastReconciledBatchId === null ||
    character.lastReconciledBattleTs === null ||
    character.lastReconciledSeasonId === null
  ) {
    throw new Error(
      'ERR_CHARACTER_CURSOR_UNAVAILABLE: character is missing the reconciled settlement cursor required for encounters',
    );
  }
}

function assertZoneAccess(zoneId: number, highestUnlockedZoneId: number): void {
  if (zoneId > highestUnlockedZoneId) {
    throw new Error(
      `ERR_ZONE_LOCKED: zone ${zoneId} is not unlocked for the character (highest unlocked ${highestUnlockedZoneId})`,
    );
  }
}

function assertSeasonActive(
  nowTs: number,
  seasonPolicy: { seasonStartTs: bigint; seasonEndTs: bigint },
): void {
  const seasonStartTs = Number(seasonPolicy.seasonStartTs);
  const seasonEndTs = Number(seasonPolicy.seasonEndTs);

  if (nowTs < seasonStartTs || nowTs > seasonEndTs) {
    throw new Error('ERR_SEASON_NOT_ACTIVE: configured encounter season is outside its active battle window');
  }
}

export async function executeRealEncounter(
  input: ExecuteRealEncounterInput,
  deps: RealEncounterServiceDependencies = {},
): Promise<ExecuteRealEncounterResult> {
  assertInteger(input.zoneId, 'zoneId', 0);
  const now = (deps.now ?? (() => new Date()))();
  const battleTs = currentUnixTimestamp(now);
  const env = deps.env ?? process.env;
  const connection = deps.connection ?? createRunanaConnection(env);
  const commitment = deps.commitment ?? resolveRunanaCommitment(env);
  const programId = deps.programId ?? resolveRunanaProgramId(env);

  const character = await loadCharacterBattleReadyRecord(input.characterId);
  assertCharacterExists(character);

  const activeSeasonId = resolveConfiguredActiveSeasonId({
    env,
    fallbackSeasonId: character.lastReconciledSeasonId,
    chainCreationSeasonId: character.chainCreationSeasonId,
  });
  const seasonPolicy = await fetchSeasonPolicyAccount(
    connection as Connection,
    deriveSeasonPolicyPda(activeSeasonId, programId),
    commitment,
  );

  assertSeasonActive(battleTs, seasonPolicy);

  const seed = generateBattleSeed();
  const selectedEncounter = selectEncounterForZone(input.zoneId, seed);
  const playerInitial = buildPlayerCombatSnapshot(character);
  const enemyInitial = buildEnemyCombatSnapshot(selectedEncounter.enemyArchetype);
  const battleId = randomUUID();
  const battleResult = simulateBattle({
    battleId,
    seed,
    playerInitial,
    enemyInitial,
  });
  let persisted: PersistedEncounterRecord;
  let settlementStatus: ExecuteRealEncounterResult['settlementStatus'];

  if (isConfirmedEncounterCharacter(character)) {
    assertConfirmedCharacterEncounterReady(character);

    const characterRootPubkey = new PublicKey(character.characterRootPubkey!);
    const worldProgress = await fetchCharacterWorldProgressAccount(
      connection as Connection,
      deriveCharacterWorldProgressPda(characterRootPubkey, programId),
      commitment,
    );
    assertZoneAccess(input.zoneId, worldProgress.highestUnlockedZoneId);

    persisted = await prisma.battleRecord.allocateNonceAndCreateWithSettlementLedger(
      buildEncounterSettlementPersistenceInput({
        battleId,
        characterId: character.id,
        zoneId: input.zoneId,
        enemyArchetypeId: selectedEncounter.enemyArchetypeId,
        seed,
        battleTs,
        seasonId: seasonPolicy.seasonId,
        playerInitial,
        enemyInitial,
        battleResult,
      }),
    );
    if (persisted.ledger.battleNonce === null) {
      throw new Error(
        'ERR_BATTLE_NONCE_UNAVAILABLE: confirmed-character encounter did not persist a battle nonce',
      );
    }
    settlementStatus = 'PENDING';
  } else {
    const provisionalProgress = await prisma.characterProvisionalProgress.findByCharacterId(character.id);
    if (provisionalProgress === null) {
      throw new Error(
        `ERR_CHARACTER_PROVISIONAL_PROGRESS_NOT_FOUND: character ${character.id} is missing provisional progress`,
      );
    }

    assertProvisionalZoneAccess(input.zoneId, provisionalProgress.highestUnlockedZoneId);
    const updatedProgress = applyLocalFirstBattleToProvisionalProgress({
      progress: provisionalProgress,
      zoneId: input.zoneId,
      characterId: character.id,
      battleResult,
    });

    persisted = await prisma.battleRecord.createAwaitingFirstSyncWithProgress({
      ...buildEncounterSettlementPersistenceInput({
        battleId,
        characterId: character.id,
        zoneId: input.zoneId,
        enemyArchetypeId: selectedEncounter.enemyArchetypeId,
        seed,
        battleTs,
        seasonId: seasonPolicy.seasonId,
        playerInitial,
        enemyInitial,
        battleResult,
      }),
      zoneProgressDelta: updatedProgress.zoneProgressDelta,
      provisionalProgress: {
        highestUnlockedZoneId: updatedProgress.highestUnlockedZoneId,
        highestClearedZoneId: updatedProgress.highestClearedZoneId,
        zoneStates: updatedProgress.zoneStates,
      },
    });
    if (persisted.ledger.battleNonce !== null) {
      throw new Error(
        'ERR_LOCAL_FIRST_NONCE_PRESENT: local-first encounter unexpectedly persisted a finalized battle nonce',
      );
    }
    settlementStatus = 'AWAITING_FIRST_SYNC';
  }

  return {
    battleId: persisted.ledger.battleId,
    characterId: persisted.ledger.characterId,
    zoneId: persisted.ledger.zoneId,
    enemyArchetypeId: persisted.ledger.enemyArchetypeId,
    seed,
    battleNonce: persisted.ledger.localSequence,
    seasonId: persisted.ledger.seasonId,
    battleTs: persisted.ledger.battleTs,
    settlementStatus,
    battleResult,
  };
}

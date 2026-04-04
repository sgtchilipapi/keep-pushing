import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool(
  connectionString
    ? {
        connectionString
      }
    : undefined
);

function createRowId(): string {
  return randomUUID();
}

type CharacterCreateInput = {
  userId: string;
  name: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  activeSkills: string[];
  passiveSkills: string[];
};

export type CharacterChainCreationStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export type BattleOutcomeLedgerStatus = 'PENDING' | 'SEALED' | 'COMMITTED';
export type SettlementBatchStatus = 'SEALED' | 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
export type SettlementSubmissionAttemptStatus = 'STARTED' | 'BROADCAST' | 'CONFIRMED' | 'FAILED' | 'TIMEOUT';

export type CharacterChainState = {
  id: string;
  playerAuthorityPubkey: string | null;
  chainCharacterIdHex: string | null;
  characterRootPubkey: string | null;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationTxSignature: string | null;
  chainCreatedAt: Date | null;
  chainCreationTs: number | null;
  chainCreationSeasonId: number | null;
  lastReconciledEndNonce: number | null;
  lastReconciledStateHash: string | null;
  lastReconciledBatchId: number | null;
  lastReconciledBattleTs: number | null;
  lastReconciledSeasonId: number | null;
  lastReconciledAt: Date | null;
};

export type CharacterBattleReadyRecord = {
  id: string;
  userId: string;
  name: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  playerAuthorityPubkey: string | null;
  chainCharacterIdHex: string | null;
  characterRootPubkey: string | null;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationSeasonId: number | null;
  lastReconciledEndNonce: number | null;
  lastReconciledStateHash: string | null;
  lastReconciledBatchId: number | null;
  lastReconciledBattleTs: number | null;
  lastReconciledSeasonId: number | null;
  activeSkills: string[];
  passiveSkills: string[];
};

export type UpdateCharacterChainIdentityInput = {
  playerAuthorityPubkey: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationTxSignature?: string | null;
  chainCreatedAt?: Date | null;
  chainCreationTs?: number | null;
  chainCreationSeasonId?: number | null;
};

export type UpdateCharacterCursorSnapshotInput = {
  lastReconciledEndNonce: number;
  lastReconciledStateHash: string;
  lastReconciledBatchId: number;
  lastReconciledBattleTs: number;
  lastReconciledSeasonId: number;
  lastReconciledAt?: Date;
};

export type BattleOutcomeLedgerRecord = {
  id: string;
  characterId: string;
  battleId: string;
  battleNonce: number;
  battleTs: number;
  seasonId: number;
  zoneId: number;
  enemyArchetypeId: number;
  zoneProgressDelta: unknown;
  settlementStatus: BattleOutcomeLedgerStatus;
  sealedBatchId: string | null;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBattleOutcomeLedgerInput = {
  characterId: string;
  battleId: string;
  battleNonce: number;
  battleTs: number;
  seasonId: number;
  zoneId: number;
  enemyArchetypeId: number;
  zoneProgressDelta: unknown;
};

export type BattleRecordRecord = {
  id: string;
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  seed: number;
  playerInitial: unknown;
  enemyInitial: unknown;
  winnerEntityId: string;
  roundsPlayed: number;
  events: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBattleRecordInput = {
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  seed: number;
  playerInitial: unknown;
  enemyInitial: unknown;
  winnerEntityId: string;
  roundsPlayed: number;
  events: unknown;
};

export type CreatePersistedEncounterInput = {
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  seed: number;
  playerInitial: unknown;
  enemyInitial: unknown;
  winnerEntityId: string;
  roundsPlayed: number;
  events: unknown;
  battleNonce: number;
  battleTs: number;
  seasonId: number;
  zoneProgressDelta: unknown;
};

export type PersistedEncounterRecord = {
  battleRecord: BattleRecordRecord;
  ledger: BattleOutcomeLedgerRecord;
};

export type SettlementBatchRecord = {
  id: string;
  characterId: string;
  batchId: number;
  startNonce: number;
  endNonce: number;
  battleCount: number;
  firstBattleTs: number;
  lastBattleTs: number;
  seasonId: number;
  startStateHash: string;
  endStateHash: string;
  zoneProgressDelta: unknown;
  encounterHistogram: unknown;
  optionalLoadoutRevision: number | null;
  batchHash: string;
  schemaVersion: number;
  signatureScheme: number;
  status: SettlementBatchStatus;
  failureCategory: string | null;
  failureCode: string | null;
  latestMessageSha256Hex: string | null;
  latestSignedTxSha256Hex: string | null;
  latestTransactionSignature: string | null;
  preparedAt: Date | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSettlementBatchInput = {
  characterId: string;
  batchId: number;
  startNonce: number;
  endNonce: number;
  battleCount: number;
  firstBattleTs: number;
  lastBattleTs: number;
  seasonId: number;
  startStateHash: string;
  endStateHash: string;
  zoneProgressDelta: unknown;
  encounterHistogram: unknown;
  optionalLoadoutRevision?: number | null;
  batchHash: string;
  schemaVersion: number;
  signatureScheme: number;
  sealedBattleIds?: string[];
};

export type UpdateSettlementBatchStatusInput = {
  status: SettlementBatchStatus;
  failureCategory?: string | null;
  failureCode?: string | null;
  latestMessageSha256Hex?: string | null;
  latestSignedTxSha256Hex?: string | null;
  latestTransactionSignature?: string | null;
  preparedAt?: Date | null;
  submittedAt?: Date | null;
  confirmedAt?: Date | null;
  failedAt?: Date | null;
};

export type SettlementSubmissionAttemptRecord = {
  id: string;
  settlementBatchId: string;
  attemptNumber: number;
  status: SettlementSubmissionAttemptStatus;
  messageSha256Hex: string | null;
  signedTransactionSha256Hex: string | null;
  transactionSignature: string | null;
  rpcError: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  resolvedAt: Date | null;
};

export type CreateSettlementSubmissionAttemptInput = {
  settlementBatchId: string;
  attemptNumber: number;
  status?: SettlementSubmissionAttemptStatus;
  messageSha256Hex?: string | null;
  signedTransactionSha256Hex?: string | null;
  transactionSignature?: string | null;
  rpcError?: string | null;
  submittedAt?: Date | null;
  resolvedAt?: Date | null;
};

export type UpdateSettlementSubmissionAttemptInput = {
  status: SettlementSubmissionAttemptStatus;
  messageSha256Hex?: string | null;
  signedTransactionSha256Hex?: string | null;
  transactionSignature?: string | null;
  rpcError?: string | null;
  submittedAt?: Date | null;
  resolvedAt?: Date | null;
};

type CharacterChainStateRow = {
  id: string;
  playerAuthorityPubkey: string | null;
  chainCharacterIdHex: string | null;
  characterRootPubkey: string | null;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationTxSignature: string | null;
  chainCreatedAt: Date | null;
  chainCreationTs: string | number | null;
  chainCreationSeasonId: number | null;
  lastReconciledEndNonce: string | number | null;
  lastReconciledStateHash: string | null;
  lastReconciledBatchId: string | number | null;
  lastReconciledBattleTs: string | number | null;
  lastReconciledSeasonId: number | null;
  lastReconciledAt: Date | null;
};

type BattleOutcomeLedgerRow = {
  id: string;
  characterId: string;
  battleId: string;
  battleNonce: string | number;
  battleTs: string | number;
  seasonId: number;
  zoneId: number;
  enemyArchetypeId: number;
  zoneProgressDeltaJson: unknown;
  settlementStatus: BattleOutcomeLedgerStatus;
  sealedBatchId: string | null;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type BattleRecordRow = {
  id: string;
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  seed: number;
  playerInitialJson: unknown;
  enemyInitialJson: unknown;
  winnerEntityId: string;
  roundsPlayed: number;
  eventsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type SettlementBatchRow = {
  id: string;
  characterId: string;
  batchId: string | number;
  startNonce: string | number;
  endNonce: string | number;
  battleCount: number;
  firstBattleTs: string | number;
  lastBattleTs: string | number;
  seasonId: number;
  startStateHash: string;
  endStateHash: string;
  zoneProgressDeltaJson: unknown;
  encounterHistogramJson: unknown;
  optionalLoadoutRevision: number | null;
  batchHash: string;
  schemaVersion: number;
  signatureScheme: number;
  status: SettlementBatchStatus;
  failureCategory: string | null;
  failureCode: string | null;
  latestMessageSha256Hex: string | null;
  latestSignedTxSha256Hex: string | null;
  latestTransactionSignature: string | null;
  preparedAt: Date | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SettlementSubmissionAttemptRow = {
  id: string;
  settlementBatchId: string;
  attemptNumber: number;
  status: SettlementSubmissionAttemptStatus;
  messageSha256Hex: string | null;
  signedTransactionSha256Hex: string | null;
  transactionSignature: string | null;
  rpcError: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  resolvedAt: Date | null;
};

function parseNullableSafeInteger(value: string | number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`ERR_INVALID_DB_INTEGER: ${field} was not a safe integer`);
  }

  return parsed;
}

function parseRequiredSafeInteger(value: string | number, field: string): number {
  const parsed = parseNullableSafeInteger(value, field);
  if (parsed === null) {
    throw new Error(`ERR_MISSING_DB_INTEGER: ${field} was unexpectedly null`);
  }

  return parsed;
}

function mapCharacterChainState(row: CharacterChainStateRow): CharacterChainState {
  return {
    id: row.id,
    playerAuthorityPubkey: row.playerAuthorityPubkey,
    chainCharacterIdHex: row.chainCharacterIdHex,
    characterRootPubkey: row.characterRootPubkey,
    chainCreationStatus: row.chainCreationStatus,
    chainCreationTxSignature: row.chainCreationTxSignature,
    chainCreatedAt: row.chainCreatedAt,
    chainCreationTs: parseNullableSafeInteger(row.chainCreationTs, 'chainCreationTs'),
    chainCreationSeasonId: row.chainCreationSeasonId,
    lastReconciledEndNonce: parseNullableSafeInteger(row.lastReconciledEndNonce, 'lastReconciledEndNonce'),
    lastReconciledStateHash: row.lastReconciledStateHash,
    lastReconciledBatchId: parseNullableSafeInteger(row.lastReconciledBatchId, 'lastReconciledBatchId'),
    lastReconciledBattleTs: parseNullableSafeInteger(row.lastReconciledBattleTs, 'lastReconciledBattleTs'),
    lastReconciledSeasonId: row.lastReconciledSeasonId,
    lastReconciledAt: row.lastReconciledAt
  };
}

function mapBattleOutcomeLedger(row: BattleOutcomeLedgerRow): BattleOutcomeLedgerRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    battleId: row.battleId,
    battleNonce: parseRequiredSafeInteger(row.battleNonce, 'battleNonce'),
    battleTs: parseRequiredSafeInteger(row.battleTs, 'battleTs'),
    seasonId: row.seasonId,
    zoneId: row.zoneId,
    enemyArchetypeId: row.enemyArchetypeId,
    zoneProgressDelta: row.zoneProgressDeltaJson,
    settlementStatus: row.settlementStatus,
    sealedBatchId: row.sealedBatchId,
    committedAt: row.committedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapBattleRecord(row: BattleRecordRow): BattleRecordRecord {
  return {
    id: row.id,
    battleId: row.battleId,
    characterId: row.characterId,
    zoneId: row.zoneId,
    enemyArchetypeId: row.enemyArchetypeId,
    seed: row.seed,
    playerInitial: row.playerInitialJson,
    enemyInitial: row.enemyInitialJson,
    winnerEntityId: row.winnerEntityId,
    roundsPlayed: row.roundsPlayed,
    events: row.eventsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapSettlementBatch(row: SettlementBatchRow): SettlementBatchRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    batchId: parseRequiredSafeInteger(row.batchId, 'batchId'),
    startNonce: parseRequiredSafeInteger(row.startNonce, 'startNonce'),
    endNonce: parseRequiredSafeInteger(row.endNonce, 'endNonce'),
    battleCount: row.battleCount,
    firstBattleTs: parseRequiredSafeInteger(row.firstBattleTs, 'firstBattleTs'),
    lastBattleTs: parseRequiredSafeInteger(row.lastBattleTs, 'lastBattleTs'),
    seasonId: row.seasonId,
    startStateHash: row.startStateHash,
    endStateHash: row.endStateHash,
    zoneProgressDelta: row.zoneProgressDeltaJson,
    encounterHistogram: row.encounterHistogramJson,
    optionalLoadoutRevision: row.optionalLoadoutRevision,
    batchHash: row.batchHash,
    schemaVersion: row.schemaVersion,
    signatureScheme: row.signatureScheme,
    status: row.status,
    failureCategory: row.failureCategory,
    failureCode: row.failureCode,
    latestMessageSha256Hex: row.latestMessageSha256Hex,
    latestSignedTxSha256Hex: row.latestSignedTxSha256Hex,
    latestTransactionSignature: row.latestTransactionSignature,
    preparedAt: row.preparedAt,
    submittedAt: row.submittedAt,
    confirmedAt: row.confirmedAt,
    failedAt: row.failedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapSettlementSubmissionAttempt(row: SettlementSubmissionAttemptRow): SettlementSubmissionAttemptRecord {
  return {
    id: row.id,
    settlementBatchId: row.settlementBatchId,
    attemptNumber: row.attemptNumber,
    status: row.status,
    messageSha256Hex: row.messageSha256Hex,
    signedTransactionSha256Hex: row.signedTransactionSha256Hex,
    transactionSignature: row.transactionSignature,
    rpcError: row.rpcError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    submittedAt: row.submittedAt,
    resolvedAt: row.resolvedAt
  };
}

export const prisma = {
  user: {
    async create() {
      const result = await pool.query<{ id: string }>(
        'INSERT INTO "User" (id, "updatedAt") VALUES ($1, $2) RETURNING id',
        [createRowId(), new Date()],
      );
      return result.rows[0];
    },
    async findUnique(id: string) {
      const result = await pool.query<{ id: string }>('SELECT id FROM "User" WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] ?? null;
    }
  },
  character: {
    async create(input: CharacterCreateInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const characterId = createRowId();
        const updatedAt = new Date();
        const characterResult = await client.query<{
          id: string;
          userId: string;
          name: string;
          level: number;
          exp: number;
          hp: number;
          hpMax: number;
          atk: number;
          def: number;
          spd: number;
          accuracyBP: number;
          evadeBP: number;
        }>(
          `INSERT INTO "Character"
            (id, "userId", "name", "hp", "hpMax", "atk", "def", "spd", "accuracyBP", "evadeBP", "updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING id, "userId", name, level, exp, hp, "hpMax", atk, def, spd, "accuracyBP", "evadeBP"`,
          [
            characterId,
            input.userId,
            input.name,
            input.hp,
            input.hpMax,
            input.atk,
            input.def,
            input.spd,
            input.accuracyBP,
            input.evadeBP,
            updatedAt
          ]
        );
        const character = characterResult.rows[0];

        for (let index = 0; index < input.activeSkills.length; index += 1) {
          const skillId = input.activeSkills[index];
          await client.query(
            'INSERT INTO "SkillUnlock" (id, "characterId", "skillId") VALUES ($1, $2, $3)',
            [createRowId(), character.id, skillId]
          );
          await client.query(
            'INSERT INTO "EquippedSkill" (id, "characterId", slot, "skillId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), character.id, index, skillId, updatedAt]
          );
        }

        for (let index = 0; index < input.passiveSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedPassive" (id, "characterId", slot, "passiveId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), character.id, index, input.passiveSkills[index], updatedAt]
          );
        }

        await client.query('COMMIT');
        return character;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async findByUserId(userId: string) {
      const characterResult = await pool.query(
        'SELECT id, "userId", name, level, exp, hp, "hpMax", atk, def, spd, "accuracyBP", "evadeBP" FROM "Character" WHERE "userId" = $1 LIMIT 1',
        [userId]
      );
      const character = characterResult.rows[0];
      if (character === undefined) {
        return null;
      }

      const [skills, passives, unlocks, inventory] = await Promise.all([
        pool.query('SELECT "skillId" FROM "EquippedSkill" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "passiveId" FROM "EquippedPassive" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "skillId" FROM "SkillUnlock" WHERE "characterId" = $1 ORDER BY "unlockedAt" ASC', [
          character.id
        ]),
        pool.query('SELECT "itemId", quantity FROM "InventoryItem" WHERE "characterId" = $1 ORDER BY "itemId" ASC', [
          character.id
        ])
      ]);

      return {
        ...character,
        activeSkills: skills.rows.map((row) => row.skillId),
        passiveSkills: passives.rows.map((row) => row.passiveId),
        unlockedSkillIds: unlocks.rows.map((row) => row.skillId),
        inventory: inventory.rows
      };
    },
    async findUnique(id: string) {
      const result = await pool.query('SELECT id FROM "Character" WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] ?? null;
    },
    async findBattleReadyById(characterId: string): Promise<CharacterBattleReadyRecord | null> {
      const characterResult = await pool.query<{
        id: string;
        userId: string;
        name: string;
        hp: number;
        hpMax: number;
        atk: number;
        def: number;
        spd: number;
        accuracyBP: number;
        evadeBP: number;
        playerAuthorityPubkey: string | null;
        chainCharacterIdHex: string | null;
        characterRootPubkey: string | null;
        chainCreationStatus: CharacterChainCreationStatus;
        chainCreationSeasonId: number | null;
        lastReconciledEndNonce: string | number | null;
        lastReconciledStateHash: string | null;
        lastReconciledBatchId: string | number | null;
        lastReconciledBattleTs: string | number | null;
        lastReconciledSeasonId: number | null;
      }>(
        `SELECT
          id,
          "userId",
          name,
          hp,
          "hpMax",
          atk,
          def,
          spd,
          "accuracyBP",
          "evadeBP",
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId"
        FROM "Character"
        WHERE id = $1
        LIMIT 1`,
        [characterId]
      );
      const character = characterResult.rows[0];
      if (character === undefined) {
        return null;
      }

      const [skills, passives] = await Promise.all([
        pool.query<{ skillId: string }>(
          'SELECT "skillId" FROM "EquippedSkill" WHERE "characterId" = $1 ORDER BY slot ASC',
          [character.id]
        ),
        pool.query<{ passiveId: string }>(
          'SELECT "passiveId" FROM "EquippedPassive" WHERE "characterId" = $1 ORDER BY slot ASC',
          [character.id]
        )
      ]);

      return {
        id: character.id,
        userId: character.userId,
        name: character.name,
        hp: character.hp,
        hpMax: character.hpMax,
        atk: character.atk,
        def: character.def,
        spd: character.spd,
        accuracyBP: character.accuracyBP,
        evadeBP: character.evadeBP,
        playerAuthorityPubkey: character.playerAuthorityPubkey,
        chainCharacterIdHex: character.chainCharacterIdHex,
        characterRootPubkey: character.characterRootPubkey,
        chainCreationStatus: character.chainCreationStatus,
        chainCreationSeasonId: character.chainCreationSeasonId,
        lastReconciledEndNonce: parseNullableSafeInteger(
          character.lastReconciledEndNonce,
          'lastReconciledEndNonce'
        ),
        lastReconciledStateHash: character.lastReconciledStateHash,
        lastReconciledBatchId: parseNullableSafeInteger(
          character.lastReconciledBatchId,
          'lastReconciledBatchId'
        ),
        lastReconciledBattleTs: parseNullableSafeInteger(
          character.lastReconciledBattleTs,
          'lastReconciledBattleTs'
        ),
        lastReconciledSeasonId: character.lastReconciledSeasonId,
        activeSkills: skills.rows.map((row) => row.skillId),
        passiveSkills: passives.rows.map((row) => row.passiveId)
      };
    },
    async updateEquip(characterId: string, activeSkills: string[], passiveSkills: string[]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM "EquippedSkill" WHERE "characterId" = $1', [characterId]);
        await client.query('DELETE FROM "EquippedPassive" WHERE "characterId" = $1', [characterId]);

        for (let index = 0; index < activeSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedSkill" (id, "characterId", slot, "skillId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), characterId, index, activeSkills[index], new Date()]
          );
        }
        for (let index = 0; index < passiveSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedPassive" (id, "characterId", slot, "passiveId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), characterId, index, passiveSkills[index], new Date()]
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async updateChainIdentity(characterId: string, input: UpdateCharacterChainIdentityInput) {
      const result = await pool.query<CharacterChainStateRow>(
        `UPDATE "Character"
        SET
          "playerAuthorityPubkey" = $2,
          "chainCharacterIdHex" = $3,
          "characterRootPubkey" = $4,
          "chainCreationStatus" = $5,
          "chainCreationTxSignature" = $6,
          "chainCreatedAt" = $7,
          "chainCreationTs" = $8,
          "chainCreationSeasonId" = $9
        WHERE id = $1
        RETURNING
          id,
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationTxSignature",
          "chainCreatedAt",
          "chainCreationTs",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId",
          "lastReconciledAt"`,
        [
          characterId,
          input.playerAuthorityPubkey,
          input.chainCharacterIdHex,
          input.characterRootPubkey,
          input.chainCreationStatus,
          input.chainCreationTxSignature ?? null,
          input.chainCreatedAt ?? null,
          input.chainCreationTs ?? null,
          input.chainCreationSeasonId ?? null
        ]
      );

      return result.rows[0] ? mapCharacterChainState(result.rows[0]) : null;
    },
    async updateCursorSnapshot(characterId: string, input: UpdateCharacterCursorSnapshotInput) {
      const result = await pool.query<CharacterChainStateRow>(
        `UPDATE "Character"
        SET
          "lastReconciledEndNonce" = $2,
          "lastReconciledStateHash" = $3,
          "lastReconciledBatchId" = $4,
          "lastReconciledBattleTs" = $5,
          "lastReconciledSeasonId" = $6,
          "lastReconciledAt" = $7
        WHERE id = $1
        RETURNING
          id,
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationTxSignature",
          "chainCreatedAt",
          "chainCreationTs",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId",
          "lastReconciledAt"`,
        [
          characterId,
          input.lastReconciledEndNonce,
          input.lastReconciledStateHash,
          input.lastReconciledBatchId,
          input.lastReconciledBattleTs,
          input.lastReconciledSeasonId,
          input.lastReconciledAt ?? new Date()
        ]
      );

      return result.rows[0] ? mapCharacterChainState(result.rows[0]) : null;
    },
    async findChainState(characterId: string) {
      const result = await pool.query<CharacterChainStateRow>(
        `SELECT
          id,
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationTxSignature",
          "chainCreatedAt",
          "chainCreationTs",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId",
          "lastReconciledAt"
        FROM "Character"
        WHERE id = $1
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapCharacterChainState(result.rows[0]) : null;
    }
  },
  battleRecord: {
    async create(input: CreateBattleRecordInput) {
      const result = await pool.query<BattleRecordRow>(
        `INSERT INTO "BattleRecord"
          (
            id,
            "battleId",
            "characterId",
            "zoneId",
            "enemyArchetypeId",
            seed,
            "playerInitialJson",
            "enemyInitialJson",
            "winnerEntityId",
            "roundsPlayed",
            "eventsJson",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12)
        RETURNING
          id,
          "battleId",
          "characterId",
          "zoneId",
          "enemyArchetypeId",
          seed,
          "playerInitialJson",
          "enemyInitialJson",
          "winnerEntityId",
          "roundsPlayed",
          "eventsJson",
          "createdAt",
          "updatedAt"`,
        [
          createRowId(),
          input.battleId,
          input.characterId,
          input.zoneId,
          input.enemyArchetypeId,
          input.seed,
          JSON.stringify(input.playerInitial),
          JSON.stringify(input.enemyInitial),
          input.winnerEntityId,
          input.roundsPlayed,
          JSON.stringify(input.events),
          new Date()
        ]
      );

      return mapBattleRecord(result.rows[0]);
    },
    async findByBattleId(battleId: string) {
      const result = await pool.query<BattleRecordRow>(
        `SELECT
          id,
          "battleId",
          "characterId",
          "zoneId",
          "enemyArchetypeId",
          seed,
          "playerInitialJson",
          "enemyInitialJson",
          "winnerEntityId",
          "roundsPlayed",
          "eventsJson",
          "createdAt",
          "updatedAt"
        FROM "BattleRecord"
        WHERE "battleId" = $1
        LIMIT 1`,
        [battleId]
      );

      return result.rows[0] ? mapBattleRecord(result.rows[0]) : null;
    },
    async createWithSettlementLedger(input: CreatePersistedEncounterInput): Promise<PersistedEncounterRecord> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const battleRecordResult = await client.query<BattleRecordRow>(
          `INSERT INTO "BattleRecord"
            (
              id,
              "battleId",
              "characterId",
              "zoneId",
              "enemyArchetypeId",
              seed,
              "playerInitialJson",
              "enemyInitialJson",
              "winnerEntityId",
              "roundsPlayed",
              "eventsJson",
              "updatedAt"
            )
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12)
          RETURNING
            id,
            "battleId",
            "characterId",
            "zoneId",
            "enemyArchetypeId",
            seed,
            "playerInitialJson",
            "enemyInitialJson",
            "winnerEntityId",
            "roundsPlayed",
            "eventsJson",
            "createdAt",
            "updatedAt"`,
          [
            createRowId(),
            input.battleId,
            input.characterId,
            input.zoneId,
            input.enemyArchetypeId,
            input.seed,
            JSON.stringify(input.playerInitial),
            JSON.stringify(input.enemyInitial),
            input.winnerEntityId,
            input.roundsPlayed,
            JSON.stringify(input.events),
            new Date()
          ]
        );

        const ledgerResult = await client.query<BattleOutcomeLedgerRow>(
          `INSERT INTO "BattleOutcomeLedger"
            (
              id,
              "characterId",
              "battleId",
              "battleNonce",
              "battleTs",
              "seasonId",
              "zoneId",
              "enemyArchetypeId",
              "zoneProgressDeltaJson",
              "updatedAt"
            )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
          RETURNING
            id,
            "characterId",
            "battleId",
            "battleNonce",
            "battleTs",
            "seasonId",
            "zoneId",
            "enemyArchetypeId",
            "zoneProgressDeltaJson",
            "settlementStatus",
            "sealedBatchId",
            "committedAt",
            "createdAt",
            "updatedAt"`,
          [
            createRowId(),
            input.characterId,
            input.battleId,
            input.battleNonce,
            input.battleTs,
            input.seasonId,
            input.zoneId,
            input.enemyArchetypeId,
            JSON.stringify(input.zoneProgressDelta),
            new Date()
          ]
        );

        await client.query('COMMIT');

        return {
          battleRecord: mapBattleRecord(battleRecordResult.rows[0]),
          ledger: mapBattleOutcomeLedger(ledgerResult.rows[0])
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  },
  battleOutcomeLedger: {
    async create(input: CreateBattleOutcomeLedgerInput) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `INSERT INTO "BattleOutcomeLedger"
          (
            id,
            "characterId",
            "battleId",
            "battleNonce",
            "battleTs",
            "seasonId",
            "zoneId",
            "enemyArchetypeId",
            "zoneProgressDeltaJson",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        RETURNING
          id,
          "characterId",
          "battleId",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"`,
        [
          createRowId(),
          input.characterId,
          input.battleId,
          input.battleNonce,
          input.battleTs,
          input.seasonId,
          input.zoneId,
          input.enemyArchetypeId,
          JSON.stringify(input.zoneProgressDelta),
          new Date()
        ]
      );

      return mapBattleOutcomeLedger(result.rows[0]);
    },
    async listNextPendingForCharacter(characterId: string, limit: number) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `SELECT
          id,
          "characterId",
          "battleId",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"
        FROM "BattleOutcomeLedger"
        WHERE "characterId" = $1 AND "settlementStatus" = 'PENDING'
        ORDER BY "battleNonce" ASC
        LIMIT $2`,
        [characterId, limit]
      );

      return result.rows.map(mapBattleOutcomeLedger);
    },
    async findLatestForCharacter(characterId: string) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `SELECT
          id,
          "characterId",
          "battleId",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"
        FROM "BattleOutcomeLedger"
        WHERE "characterId" = $1
        ORDER BY "battleNonce" DESC
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapBattleOutcomeLedger(result.rows[0]) : null;
    },
    async markCommittedForBatch(sealedBatchId: string, committedAt = new Date()) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `UPDATE "BattleOutcomeLedger"
        SET
          "settlementStatus" = 'COMMITTED',
          "committedAt" = $2
        WHERE "sealedBatchId" = $1
        RETURNING
          id,
          "characterId",
          "battleId",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"`,
        [sealedBatchId, committedAt]
      );

      return result.rows.map(mapBattleOutcomeLedger);
    }
  },
  settlementBatch: {
    async createSealed(input: CreateSettlementBatchInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const batchResult = await client.query<SettlementBatchRow>(
          `INSERT INTO "SettlementBatch"
            (
              id,
              "characterId",
              "batchId",
              "startNonce",
              "endNonce",
              "battleCount",
              "firstBattleTs",
              "lastBattleTs",
              "seasonId",
              "startStateHash",
              "endStateHash",
              "zoneProgressDeltaJson",
              "encounterHistogramJson",
              "optionalLoadoutRevision",
              "batchHash",
              "schemaVersion",
              "signatureScheme",
              "updatedAt"
            )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18)
          RETURNING
            id,
            "characterId",
            "batchId",
            "startNonce",
            "endNonce",
            "battleCount",
            "firstBattleTs",
            "lastBattleTs",
            "seasonId",
            "startStateHash",
            "endStateHash",
            "zoneProgressDeltaJson",
            "encounterHistogramJson",
            "optionalLoadoutRevision",
            "batchHash",
            "schemaVersion",
            "signatureScheme",
            "status",
            "failureCategory",
            "failureCode",
            "latestMessageSha256Hex",
            "latestSignedTxSha256Hex",
            "latestTransactionSignature",
            "preparedAt",
            "submittedAt",
            "confirmedAt",
            "failedAt",
            "createdAt",
            "updatedAt"`,
          [
            createRowId(),
            input.characterId,
            input.batchId,
            input.startNonce,
            input.endNonce,
            input.battleCount,
            input.firstBattleTs,
            input.lastBattleTs,
            input.seasonId,
            input.startStateHash,
            input.endStateHash,
            JSON.stringify(input.zoneProgressDelta),
            JSON.stringify(input.encounterHistogram),
            input.optionalLoadoutRevision ?? null,
            input.batchHash,
            input.schemaVersion,
            input.signatureScheme,
            new Date()
          ]
        );

        const batch = batchResult.rows[0];

        if ((input.sealedBattleIds?.length ?? 0) > 0) {
          const sealResult = await client.query(
            `UPDATE "BattleOutcomeLedger"
            SET
              "settlementStatus" = 'SEALED',
              "sealedBatchId" = $1
            WHERE "id" = ANY($2::text[]) AND "characterId" = $3`,
            [batch.id, input.sealedBattleIds, input.characterId]
          );

          if (sealResult.rowCount !== input.sealedBattleIds?.length) {
            throw new Error('ERR_BATTLE_LEDGER_SEAL_MISMATCH: failed to seal the expected battle ledger rows');
          }
        }

        await client.query('COMMIT');
        return mapSettlementBatch(batch);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async findById(id: string) {
      const result = await pool.query<SettlementBatchRow>(
        `SELECT
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"
        FROM "SettlementBatch"
        WHERE id = $1
        LIMIT 1`,
        [id]
      );

      return result.rows[0] ? mapSettlementBatch(result.rows[0]) : null;
    },
    async findNextUnconfirmedForCharacter(characterId: string) {
      const result = await pool.query<SettlementBatchRow>(
        `SELECT
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"
        FROM "SettlementBatch"
        WHERE "characterId" = $1 AND "status" <> 'CONFIRMED'
        ORDER BY "batchId" ASC
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapSettlementBatch(result.rows[0]) : null;
    },
    async listUnconfirmed(limit?: number) {
      const result = await pool.query<SettlementBatchRow>(
        `SELECT
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"
        FROM "SettlementBatch"
        WHERE "status" <> 'CONFIRMED'
        ORDER BY "characterId" ASC, "batchId" ASC
        ${limit === undefined ? '' : 'LIMIT $1'}`,
        limit === undefined ? [] : [limit]
      );

      return result.rows.map(mapSettlementBatch);
    },
    async updateStatus(id: string, input: UpdateSettlementBatchStatusInput) {
      const result = await pool.query<SettlementBatchRow>(
        `UPDATE "SettlementBatch"
        SET
          "status" = $2,
          "failureCategory" = $3,
          "failureCode" = $4,
          "latestMessageSha256Hex" = $5,
          "latestSignedTxSha256Hex" = $6,
          "latestTransactionSignature" = $7,
          "preparedAt" = $8,
          "submittedAt" = $9,
          "confirmedAt" = $10,
          "failedAt" = $11
        WHERE id = $1
        RETURNING
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"`,
        [
          id,
          input.status,
          input.failureCategory ?? null,
          input.failureCode ?? null,
          input.latestMessageSha256Hex ?? null,
          input.latestSignedTxSha256Hex ?? null,
          input.latestTransactionSignature ?? null,
          input.preparedAt ?? null,
          input.submittedAt ?? null,
          input.confirmedAt ?? null,
          input.failedAt ?? null
        ]
      );

      return result.rows[0] ? mapSettlementBatch(result.rows[0]) : null;
    }
  },
  settlementSubmissionAttempt: {
    async create(input: CreateSettlementSubmissionAttemptInput) {
      const result = await pool.query<SettlementSubmissionAttemptRow>(
        `INSERT INTO "SettlementSubmissionAttempt"
          (
            id,
            "settlementBatchId",
            "attemptNumber",
            "status",
            "messageSha256Hex",
            "signedTransactionSha256Hex",
            "transactionSignature",
            "rpcError",
            "submittedAt",
            "resolvedAt",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING
          id,
          "settlementBatchId",
          "attemptNumber",
          "status",
          "messageSha256Hex",
          "signedTransactionSha256Hex",
          "transactionSignature",
          "rpcError",
          "createdAt",
          "updatedAt",
          "submittedAt",
          "resolvedAt"`,
        [
          createRowId(),
          input.settlementBatchId,
          input.attemptNumber,
          input.status ?? 'STARTED',
          input.messageSha256Hex ?? null,
          input.signedTransactionSha256Hex ?? null,
          input.transactionSignature ?? null,
          input.rpcError ?? null,
          input.submittedAt ?? null,
          input.resolvedAt ?? null,
          new Date()
        ]
      );

      return mapSettlementSubmissionAttempt(result.rows[0]);
    },
    async listByBatch(settlementBatchId: string) {
      const result = await pool.query<SettlementSubmissionAttemptRow>(
        `SELECT
          id,
          "settlementBatchId",
          "attemptNumber",
          "status",
          "messageSha256Hex",
          "signedTransactionSha256Hex",
          "transactionSignature",
          "rpcError",
          "createdAt",
          "updatedAt",
          "submittedAt",
          "resolvedAt"
        FROM "SettlementSubmissionAttempt"
        WHERE "settlementBatchId" = $1
        ORDER BY "attemptNumber" ASC`,
        [settlementBatchId]
      );

      return result.rows.map(mapSettlementSubmissionAttempt);
    },
    async update(id: string, input: UpdateSettlementSubmissionAttemptInput) {
      const result = await pool.query<SettlementSubmissionAttemptRow>(
        `UPDATE "SettlementSubmissionAttempt"
        SET
          "status" = $2,
          "messageSha256Hex" = $3,
          "signedTransactionSha256Hex" = $4,
          "transactionSignature" = $5,
          "rpcError" = $6,
          "submittedAt" = $7,
          "resolvedAt" = $8
        WHERE id = $1
        RETURNING
          id,
          "settlementBatchId",
          "attemptNumber",
          "status",
          "messageSha256Hex",
          "signedTransactionSha256Hex",
          "transactionSignature",
          "rpcError",
          "createdAt",
          "updatedAt",
          "submittedAt",
          "resolvedAt"`,
        [
          id,
          input.status,
          input.messageSha256Hex ?? null,
          input.signedTransactionSha256Hex ?? null,
          input.transactionSignature ?? null,
          input.rpcError ?? null,
          input.submittedAt ?? null,
          input.resolvedAt ?? null,
        ]
      );

      return result.rows[0] ? mapSettlementSubmissionAttempt(result.rows[0]) : null;
    }
  }
};

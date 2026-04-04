import { randomBytes } from 'node:crypto';

import { PublicKey, type Commitment, type Connection } from '@solana/web3.js';

import {
  prisma,
  type BattleOutcomeLedgerRecord,
  type CharacterChainState,
  type RebasedBattleNonceAssignment,
} from '../prisma';
import { prepareFirstSyncCharacterAnchor, type PreparedFirstSyncCharacterAnchor } from './firstSyncCharacterAnchor';
import { fetchProgramConfigAccount, fetchSeasonPolicyAccount } from './runanaAccounts';
import {
  createRunanaConnection,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from './runanaClient';
import { sealSettlementBatchDraft, type SealedSettlementBatchDraft, type SettlementSealingCursor } from './settlementSealing';
import {
  computeGenesisStateHashHex,
  deriveCharacterRootPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
} from './runanaProgram';

export interface PrepareFirstSyncRebaseInput {
  characterId: string;
  authority: string;
  feePayer?: string;
  env?: NodeJS.ProcessEnv;
}

export interface PreparedFirstSyncRebase {
  anchor: PreparedFirstSyncCharacterAnchor;
  reservedIdentity: {
    playerAuthorityPubkey: string;
    chainCharacterIdHex: string;
    characterRootPubkey: string;
    chainCreationStatus: CharacterChainState['chainCreationStatus'];
  };
  genesisCursor: SettlementSealingCursor;
  archivedBattleIds: string[];
  rebasedBattles: BattleOutcomeLedgerRecord[];
  batchDrafts: SealedSettlementBatchDraft[];
}

export interface FirstSyncRebasingDependencies {
  connection?: Pick<Connection, 'getAccountInfo'>;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
  generateCharacterIdHex?: () => string;
}

function defaultCharacterIdHex(): string {
  return randomBytes(16).toString('hex');
}

function assertCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

function isRetryableCharacterIdentityCollision(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const maybePgError = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  };
  const constraint =
    typeof maybePgError.constraint === 'string' ? maybePgError.constraint : '';
  const message = typeof maybePgError.message === 'string' ? maybePgError.message : '';

  return (
    maybePgError.code === '23505' &&
    (constraint === 'Character_chainCharacterIdHex_key' ||
      constraint === 'Character_characterRootPubkey_key' ||
      message.includes('chainCharacterIdHex') ||
      message.includes('characterRootPubkey'))
  );
}

async function reserveFirstSyncIdentity(args: {
  anchor: PreparedFirstSyncCharacterAnchor;
  programId: PublicKey;
  generateCharacterIdHex: () => string;
}): Promise<PreparedFirstSyncRebase['reservedIdentity']> {
  const chainState = await prisma.character.findChainState(args.anchor.characterId);
  if (chainState === null) {
    throw new Error(`ERR_CHARACTER_NOT_FOUND: character ${args.anchor.characterId} was not found`);
  }
  if (chainState.chainCreationStatus === 'CONFIRMED') {
    throw new Error('ERR_CHARACTER_ALREADY_CONFIRMED: character is already confirmed on chain');
  }
  if (
    chainState.playerAuthorityPubkey !== null &&
    chainState.playerAuthorityPubkey !== args.anchor.authority
  ) {
    throw new Error(
      'ERR_CHARACTER_AUTHORITY_MISMATCH: reserved first-sync authority does not match persisted state',
    );
  }

  if (chainState.chainCharacterIdHex !== null && chainState.characterRootPubkey !== null) {
    await prisma.character.updateChainIdentity(args.anchor.characterId, {
      playerAuthorityPubkey: args.anchor.authority,
      chainCharacterIdHex: chainState.chainCharacterIdHex,
      characterRootPubkey: chainState.characterRootPubkey,
      chainCreationStatus: 'PENDING',
      chainCreationTs: args.anchor.characterCreationTs,
      chainCreationSeasonId: args.anchor.seasonIdAtCreation,
      chainCreationTxSignature: null,
      chainCreatedAt: null,
    });

    return {
      playerAuthorityPubkey: args.anchor.authority,
      chainCharacterIdHex: chainState.chainCharacterIdHex,
      characterRootPubkey: chainState.characterRootPubkey,
      chainCreationStatus: 'PENDING',
    };
  }

  const authorityPubkey = new PublicKey(args.anchor.authority);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const chainCharacterIdHex = args.generateCharacterIdHex();
    const characterRootPubkey = deriveCharacterRootPda(
      authorityPubkey,
      chainCharacterIdHex,
      args.programId,
    ).toBase58();

    try {
      await prisma.character.updateChainIdentity(args.anchor.characterId, {
        playerAuthorityPubkey: args.anchor.authority,
        chainCharacterIdHex,
        characterRootPubkey,
        chainCreationStatus: 'PENDING',
        chainCreationTs: args.anchor.characterCreationTs,
        chainCreationSeasonId: args.anchor.seasonIdAtCreation,
        chainCreationTxSignature: null,
        chainCreatedAt: null,
      });

      return {
        playerAuthorityPubkey: args.anchor.authority,
        chainCharacterIdHex,
        characterRootPubkey,
        chainCreationStatus: 'PENDING',
      };
    } catch (error) {
      if (attempt < 5 && isRetryableCharacterIdentityCollision(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    'ERR_CHARACTER_ID_COLLISION_EXHAUSTED: could not reserve a unique chain identity for first sync',
  );
}

function currentUnixTimestamp(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

function buildBatchDrafts(args: {
  cursor: SettlementSealingCursor;
  battles: BattleOutcomeLedgerRecord[];
  maxBattlesPerBatch: number;
  maxHistogramEntriesPerBatch: number;
  characterIdHex: string;
}): SealedSettlementBatchDraft[] {
  const drafts: SealedSettlementBatchDraft[] = [];
  let cursor = args.cursor;
  let remaining = [...args.battles].sort((left, right) => left.battleNonce! - right.battleNonce!);

  while (remaining.length > 0) {
    const draft = sealSettlementBatchDraft({
      characterIdHex: args.characterIdHex,
      cursor,
      pendingBattles: remaining,
      maxBattlesPerBatch: args.maxBattlesPerBatch,
      maxHistogramEntriesPerBatch: args.maxHistogramEntriesPerBatch,
    });
    drafts.push(draft);
    const sealed = new Set(draft.sealedBattleIds);
    remaining = remaining.filter((battle) => !sealed.has(battle.id));
    cursor = {
      lastCommittedEndNonce: draft.payload.endNonce,
      lastCommittedStateHash: draft.payload.endStateHash,
      lastCommittedBatchId: draft.payload.batchId,
      lastCommittedBattleTs: draft.payload.lastBattleTs,
      lastCommittedSeasonId: draft.payload.seasonId,
    };
  }

  return drafts;
}

export async function prepareFirstSyncRebase(
  input: PrepareFirstSyncRebaseInput,
  deps: FirstSyncRebasingDependencies = {},
): Promise<PreparedFirstSyncRebase> {
  const connection = deps.connection ?? createRunanaConnection(input.env ?? process.env);
  const commitment = deps.commitment ?? resolveRunanaCommitment(input.env ?? process.env);
  const programId = deps.programId ?? resolveRunanaProgramId(input.env ?? process.env);
  const now = deps.now ?? (() => new Date());
  const generateCharacterIdHex = deps.generateCharacterIdHex ?? defaultCharacterIdHex;

  const anchor = await prepareFirstSyncCharacterAnchor(input);
  const reservedIdentity = await reserveFirstSyncIdentity({
    anchor,
    programId,
    generateCharacterIdHex,
  });

  const [programConfig, awaitingBattles] = await Promise.all([
    fetchProgramConfigAccount(connection as Connection, deriveProgramConfigPda(programId), commitment),
    prisma.battleOutcomeLedger.listAwaitingFirstSyncForCharacter(anchor.characterId, 10_000),
  ]);

  assertCondition(
    awaitingBattles.length > 0,
    'ERR_NO_FIRST_SYNC_BACKLOG',
    'character has no awaiting-first-sync battles to settle',
  );

  const battlesBySeason = new Map<number, BattleOutcomeLedgerRecord[]>();
  for (const battle of awaitingBattles) {
    const list = battlesBySeason.get(battle.seasonId) ?? [];
    list.push(battle);
    battlesBySeason.set(battle.seasonId, list);
  }

  const currentTs = currentUnixTimestamp(now());
  const archivedBattleIds: string[] = [];
  for (const seasonId of battlesBySeason.keys()) {
    const seasonPolicy = await fetchSeasonPolicyAccount(
      connection as Connection,
      deriveSeasonPolicyPda(seasonId, programId),
      commitment,
    );
    if (currentTs > Number(seasonPolicy.commitGraceEndTs)) {
      archivedBattleIds.push(...(battlesBySeason.get(seasonId) ?? []).map((battle) => battle.id));
    }
  }

  if (archivedBattleIds.length > 0) {
    await prisma.battleOutcomeLedger.markArchivedLocalOnly(archivedBattleIds);
  }

  const remainingBattles = awaitingBattles
    .filter((battle) => !archivedBattleIds.includes(battle.id))
    .sort((left, right) => left.localSequence - right.localSequence);
  assertCondition(
    remainingBattles.length > 0,
    'ERR_NO_ELIGIBLE_FIRST_SYNC_BATTLES',
    'all awaiting-first-sync backlog was archived as stale local-only history',
  );

  const assignments: RebasedBattleNonceAssignment[] = remainingBattles.map((battle, index) => ({
    id: battle.id,
    battleNonce: index + 1,
  }));
  const rebasedBattles = await prisma.battleOutcomeLedger.rebaseAwaitingFirstSyncBattleNonces(
    anchor.characterId,
    assignments,
  );

  const characterRootPubkey = new PublicKey(reservedIdentity.characterRootPubkey);
  const genesisCursor: SettlementSealingCursor = {
    lastCommittedEndNonce: 0,
    lastCommittedStateHash: computeGenesisStateHashHex(
      characterRootPubkey,
      reservedIdentity.chainCharacterIdHex,
    ),
    lastCommittedBatchId: 0,
    lastCommittedBattleTs: anchor.characterCreationTs,
    lastCommittedSeasonId: anchor.seasonIdAtCreation,
  };

  const batchDrafts = buildBatchDrafts({
    cursor: genesisCursor,
    battles: rebasedBattles,
    maxBattlesPerBatch: programConfig.maxBattlesPerBatch,
    maxHistogramEntriesPerBatch: programConfig.maxHistogramEntriesPerBatch,
    characterIdHex: reservedIdentity.chainCharacterIdHex,
  });

  return {
    anchor,
    reservedIdentity,
    genesisCursor,
    archivedBattleIds,
    rebasedBattles,
    batchDrafts,
  };
}

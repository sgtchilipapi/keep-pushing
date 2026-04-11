import { Connection, PublicKey, type Commitment } from '@solana/web3.js';

import { prisma, type SettlementBatchRecord } from '../prisma';
import {
  accountStateHashHex,
  fetchCharacterSettlementBatchCursorAccount,
  fetchProgramConfigAccount,
  fetchSeasonPolicyAccount,
} from './runanaAccounts';
import {
  buildSettlementValidationContext,
  dryRunApplyBattleSettlementBatchV1,
} from './settlementBatchValidation';
import {
  sealSettlementBatchDraft,
  settlementBatchRecordToPayload,
  type SealedSettlementBatchDraft,
} from './settlementSealing';
import { createRunanaConnection, resolveRunanaCommitment, resolveRunanaProgramId } from './runanaClient';
import { loadSettlementInstructionAccountEnvelope } from './runanaSettlementEnvelope';
import {
  deriveCharacterBatchCursorPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
} from './runanaProgram';
import type { SettlementBatchPayloadV2, SettlementValidationContext } from '../../types/settlement';

export interface SealNextSettlementBatchResult {
  batch: SettlementBatchRecord;
  payload: SettlementBatchPayloadV2;
  dryRunResult: ReturnType<typeof dryRunApplyBattleSettlementBatchV1>;
  validationContext: SettlementValidationContext;
  wasExistingBatch: boolean;
}

export interface SettlementSealingServiceDependencies {
  connection?: Connection;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
}

function assertCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

function currentUnixTimestamp(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

function toRequiredChainState(characterId: string, chainState: Awaited<ReturnType<typeof prisma.character.findChainState>>) {
  assertCondition(chainState !== null, 'ERR_CHARACTER_NOT_FOUND', `character ${characterId} was not found`);
  assertCondition(
    chainState.playerAuthorityPubkey !== null &&
      chainState.chainCharacterIdHex !== null &&
      chainState.characterRootPubkey !== null,
    'ERR_CHARACTER_CHAIN_IDENTITY_MISSING',
    'character is missing required on-chain identity fields',
  );

  return {
    playerAuthorityPubkey: chainState.playerAuthorityPubkey,
    chainCharacterIdHex: chainState.chainCharacterIdHex,
    characterRootPubkey: chainState.characterRootPubkey,
  };
}

function batchDraftToCreateInput(characterId: string, draft: SealedSettlementBatchDraft) {
  const runSummaries = draft.payload.runSummaries ?? [];
  return {
    characterId,
    batchId: draft.payload.batchId,
    startRunSequence: draft.payload.startRunSequence,
    endRunSequence: draft.payload.endRunSequence,
    runCount: runSummaries.length,
    runSummaries,
    startNonce: draft.payload.startNonce,
    endNonce: draft.payload.endNonce,
    battleCount: draft.payload.battleCount,
    firstBattleTs: draft.payload.firstBattleTs,
    lastBattleTs: draft.payload.lastBattleTs,
    seasonId: draft.payload.seasonId,
    startStateHash: draft.payload.startStateHash,
    endStateHash: draft.payload.endStateHash,
    zoneProgressDelta: runSummaries.flatMap((summary) => summary.zoneProgressDelta),
    encounterHistogram: runSummaries.flatMap((summary) =>
      summary.rewardedEncounterHistogram.map((entry) => ({
        zoneId: summary.zoneId,
        enemyArchetypeId: entry.enemyArchetypeId,
        count: entry.count,
      })),
    ),
    optionalLoadoutRevision: draft.payload.optionalLoadoutRevision ?? null,
    batchHash: draft.payload.batchHash,
    schemaVersion: draft.payload.schemaVersion,
    signatureScheme: draft.payload.signatureScheme,
    sealedBattleIds: draft.sealedBattleIds,
  };
}

function assertCursorSnapshotAvailable(
  characterId: string,
  chainState: Awaited<ReturnType<typeof prisma.character.findChainState>>,
): asserts chainState is NonNullable<Awaited<ReturnType<typeof prisma.character.findChainState>>> & {
  lastReconciledEndNonce: number;
  lastReconciledStateHash: string;
  lastReconciledBatchId: number;
  lastReconciledBattleTs: number;
  lastReconciledSeasonId: number;
} {
  assertCondition(chainState !== null, 'ERR_CHARACTER_NOT_FOUND', `character ${characterId} was not found`);
  assertCondition(
    chainState.lastReconciledEndNonce !== null &&
      chainState.lastReconciledStateHash !== null &&
      chainState.lastReconciledBatchId !== null &&
      chainState.lastReconciledBattleTs !== null &&
      chainState.lastReconciledSeasonId !== null,
    'ERR_CHARACTER_CURSOR_UNAVAILABLE',
    'character is missing the last reconciled cursor snapshot required for sealing',
  );
}

function buildSequentialBatchDrafts(args: {
  cursor: {
    lastCommittedEndNonce: number;
    lastCommittedStateHash: string;
    lastCommittedBatchId: number;
    lastCommittedBattleTs: number;
    lastCommittedSeasonId: number;
  };
  runs: Parameters<typeof sealSettlementBatchDraft>[0]['pendingRuns'];
  maxRunsPerBatch: number;
  maxHistogramEntriesPerBatch: number;
  characterIdHex: string;
}): SealedSettlementBatchDraft[] {
  const drafts: SealedSettlementBatchDraft[] = [];
  let cursor = args.cursor;
  let remaining = [...(args.runs ?? [])].sort(
    (left, right) => (left.closedRunSequence ?? Number.MAX_SAFE_INTEGER) - (right.closedRunSequence ?? Number.MAX_SAFE_INTEGER),
  );

  while (remaining.length > 0) {
    const draft = sealSettlementBatchDraft({
      characterIdHex: args.characterIdHex,
      cursor,
      pendingRuns: remaining,
      maxRunsPerBatch: args.maxRunsPerBatch,
      maxHistogramEntriesPerBatch: args.maxHistogramEntriesPerBatch,
    });
    const sealedRunIds = new Set(draft.sealedRunIds ?? []);

    drafts.push(draft);
    remaining = remaining.filter((run) => !sealedRunIds.has(run.id));
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

async function materializeInitialSettlementBacklog(args: {
  characterId: string;
  chainState: Awaited<ReturnType<typeof prisma.character.findChainState>>;
  connection: Connection;
  commitment?: Commitment;
  programId: PublicKey;
  now: Date;
}) {
  if (args.chainState?.chainCreationStatus !== 'CONFIRMED') {
    return false;
  }

  assertCursorSnapshotAvailable(args.characterId, args.chainState);
  const chainState = args.chainState;

  const programConfig = await fetchProgramConfigAccount(
    args.connection,
    deriveProgramConfigPda(args.programId),
    args.commitment,
  );
  const pendingRuns =
    (await prisma.closedZoneRunSummary?.listNextSettleableForCharacter?.(
      args.characterId,
      10_000,
    )) ?? [];
  if (pendingRuns.length === 0) {
    const awaitingBattles = await prisma.battleOutcomeLedger.listAwaitingFirstSyncForCharacter(
      args.characterId,
      10_000,
    );
    if (awaitingBattles.length === 0) {
      return false;
    }

    const currentTs = currentUnixTimestamp(args.now);
    const battlesBySeason = new Map<number, typeof awaitingBattles>();
    for (const battle of awaitingBattles) {
      const existing = battlesBySeason.get(battle.seasonId) ?? [];
      existing.push(battle);
      battlesBySeason.set(battle.seasonId, existing);
    }

    const archivedBattleIds: string[] = [];
    for (const seasonId of battlesBySeason.keys()) {
      const seasonPolicy = await fetchSeasonPolicyAccount(
        args.connection,
        deriveSeasonPolicyPda(seasonId, args.programId),
        args.commitment,
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

    const rebasedBattles = await prisma.battleOutcomeLedger.rebaseAwaitingFirstSyncBattleNonces(
      args.characterId,
      remainingBattles.map((battle, index) => ({
        id: battle.id,
        battleNonce: chainState.lastReconciledEndNonce + index + 1,
      })),
    );
    const drafts = buildSequentialBatchDrafts({
      cursor: {
        lastCommittedEndNonce: chainState.lastReconciledEndNonce,
        lastCommittedStateHash: chainState.lastReconciledStateHash,
        lastCommittedBatchId: chainState.lastReconciledBatchId,
        lastCommittedBattleTs: chainState.lastReconciledBattleTs,
        lastCommittedSeasonId: chainState.lastReconciledSeasonId,
      },
      runs: [],
      maxRunsPerBatch: programConfig.maxRunsPerBatch,
      maxHistogramEntriesPerBatch: programConfig.maxHistogramEntriesPerBatch,
      characterIdHex: chainState.chainCharacterIdHex!,
    });

    if (drafts.length === 0) {
      const draft = sealSettlementBatchDraft({
        characterIdHex: chainState.chainCharacterIdHex!,
        cursor: {
          lastCommittedEndNonce: chainState.lastReconciledEndNonce,
          lastCommittedStateHash: chainState.lastReconciledStateHash,
          lastCommittedBatchId: chainState.lastReconciledBatchId,
          lastCommittedBattleTs: chainState.lastReconciledBattleTs,
          lastCommittedSeasonId: chainState.lastReconciledSeasonId,
        },
        pendingBattles: rebasedBattles,
        maxBattlesPerBatch: programConfig.maxBattlesPerBatch,
        maxHistogramEntriesPerBatch: programConfig.maxHistogramEntriesPerBatch,
      });
      await prisma.settlementBatch.createSealed(batchDraftToCreateInput(args.characterId, draft));
      return true;
    }
    return false;
  }

  const currentTs = currentUnixTimestamp(args.now);
  const runsBySeason = new Map<number, typeof pendingRuns>();

  for (const run of pendingRuns) {
    const existing = runsBySeason.get(run.seasonId) ?? [];
    existing.push(run);
    runsBySeason.set(run.seasonId, existing);
  }

  const archivedSeasonIds: number[] = [];
  for (const seasonId of runsBySeason.keys()) {
    const seasonPolicy = await fetchSeasonPolicyAccount(
      args.connection,
      deriveSeasonPolicyPda(seasonId, args.programId),
      args.commitment,
    );
    if (currentTs > Number(seasonPolicy.commitGraceEndTs)) {
      archivedSeasonIds.push(seasonId);
    }
  }

  const remainingRuns = pendingRuns
    .filter((run) => !archivedSeasonIds.includes(run.seasonId))
    .sort(
      (left, right) =>
        (left.closedRunSequence ?? Number.MAX_SAFE_INTEGER) - (right.closedRunSequence ?? Number.MAX_SAFE_INTEGER),
    );
  assertCondition(
    remainingRuns.length > 0,
    'ERR_NO_ELIGIBLE_FIRST_SYNC_RUNS',
    'all pending closed-run backlog was archived as stale local-only history',
  );
  const drafts = buildSequentialBatchDrafts({
    cursor: {
      lastCommittedEndNonce: chainState.lastReconciledEndNonce,
      lastCommittedStateHash: chainState.lastReconciledStateHash,
      lastCommittedBatchId: chainState.lastReconciledBatchId,
      lastCommittedBattleTs: chainState.lastReconciledBattleTs,
      lastCommittedSeasonId: chainState.lastReconciledSeasonId,
    },
    runs: remainingRuns,
    maxRunsPerBatch: programConfig.maxRunsPerBatch,
    maxHistogramEntriesPerBatch: programConfig.maxHistogramEntriesPerBatch,
    characterIdHex: chainState.chainCharacterIdHex!,
  });

  for (const draft of drafts) {
    await prisma.settlementBatch.createSealed(batchDraftToCreateInput(args.characterId, draft));
  }

  return true;
}

async function dryRunPayloadAgainstLiveEnvelope(args: {
  connection: Connection;
  commitment?: Commitment;
  programId: PublicKey;
  payload: SettlementBatchPayloadV2;
  playerAuthorityPubkey: string;
  characterRootPubkey: string;
  now: Date;
}) {
  const envelope = await loadSettlementInstructionAccountEnvelope({
    reader: args.connection,
    payload: args.payload,
    playerAuthority: args.playerAuthorityPubkey,
    characterRootPubkey: args.characterRootPubkey,
    commitment: args.commitment,
    programId: args.programId,
  });
  const slot = await args.connection.getSlot(args.commitment);
  const validationArgs = {
    envelope,
    currentUnixTimestamp: currentUnixTimestamp(args.now),
    currentSlot: slot,
    serverSigner: envelope.programConfig.trustedServerSigner.toBase58(),
  };

  return {
    envelope,
    validationContext: buildSettlementValidationContext(validationArgs),
    dryRunResult: dryRunApplyBattleSettlementBatchV1(args.payload, validationArgs),
  };
}

export async function loadOrSealNextSettlementBatchForCharacter(
  characterId: string,
  deps: SettlementSealingServiceDependencies = {},
): Promise<SealNextSettlementBatchResult> {
  const connection = deps.connection ?? createRunanaConnection();
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();
  const now = (deps.now ?? (() => new Date()))();

  const fullChainState = await prisma.character.findChainState(characterId);
  const chainState = toRequiredChainState(characterId, fullChainState);
  const existingBatch = await prisma.settlementBatch.findNextUnconfirmedForCharacter(characterId);

  if (existingBatch !== null) {
    const payload = settlementBatchRecordToPayload(existingBatch, chainState.chainCharacterIdHex);
    const dryRun = await dryRunPayloadAgainstLiveEnvelope({
      connection,
      commitment,
      programId,
      payload,
      playerAuthorityPubkey: chainState.playerAuthorityPubkey,
      characterRootPubkey: chainState.characterRootPubkey,
      now,
    });

    return {
      batch: existingBatch,
      payload,
      dryRunResult: dryRun.dryRunResult,
      validationContext: dryRun.validationContext,
      wasExistingBatch: true,
    };
  }

  const didMaterializeInitialBacklog = await materializeInitialSettlementBacklog({
    characterId,
    chainState: fullChainState,
    connection,
    commitment,
    programId,
    now,
  });
  if (didMaterializeInitialBacklog) {
    const initialBatch = await prisma.settlementBatch.findNextUnconfirmedForCharacter(characterId);
    assertCondition(
      initialBatch !== null,
      'ERR_INITIAL_SETTLEMENT_BATCH_MISSING',
      'initial settlement materialization did not create a retrievable batch',
    );
    const payload = settlementBatchRecordToPayload(initialBatch, chainState.chainCharacterIdHex);
    const dryRun = await dryRunPayloadAgainstLiveEnvelope({
      connection,
      commitment,
      programId,
      payload,
      playerAuthorityPubkey: chainState.playerAuthorityPubkey,
      characterRootPubkey: chainState.characterRootPubkey,
      now,
    });

    return {
      batch: initialBatch,
      payload,
      dryRunResult: dryRun.dryRunResult,
      validationContext: dryRun.validationContext,
      wasExistingBatch: false,
    };
  }

  const characterRootPubkey = new PublicKey(chainState.characterRootPubkey);
  const [liveCursor, programConfig] = await Promise.all([
    fetchCharacterSettlementBatchCursorAccount(
      connection,
      deriveCharacterBatchCursorPda(characterRootPubkey, programId),
      commitment,
    ),
    fetchProgramConfigAccount(connection, deriveProgramConfigPda(programId), commitment),
  ]);

  const pendingRuns = await prisma.closedZoneRunSummary.listNextSettleableForCharacter(
    characterId,
    Math.max(programConfig.maxRunsPerBatch * 4, 256),
  );
  const draft = sealSettlementBatchDraft({
    characterIdHex: chainState.chainCharacterIdHex,
    cursor: {
      lastCommittedEndNonce: Number(liveCursor.lastCommittedEndNonce),
      lastCommittedStateHash: accountStateHashHex(liveCursor.lastCommittedStateHash),
      lastCommittedBatchId: Number(liveCursor.lastCommittedBatchId),
      lastCommittedBattleTs: Number(liveCursor.lastCommittedBattleTs),
      lastCommittedSeasonId: liveCursor.lastCommittedSeasonId,
    },
    pendingRuns,
    maxRunsPerBatch: programConfig.maxRunsPerBatch,
    maxHistogramEntriesPerBatch: programConfig.maxHistogramEntriesPerBatch,
  });

  const dryRun = await dryRunPayloadAgainstLiveEnvelope({
    connection,
    commitment,
    programId,
    payload: draft.payload,
    playerAuthorityPubkey: chainState.playerAuthorityPubkey,
    characterRootPubkey: chainState.characterRootPubkey,
    now,
  });

  const batch = await prisma.settlementBatch.createSealed(batchDraftToCreateInput(characterId, draft));

  return {
    batch,
    payload: draft.payload,
    dryRunResult: dryRun.dryRunResult,
    validationContext: dryRun.validationContext,
    wasExistingBatch: false,
  };
}

import { Connection, PublicKey, type Commitment } from '@solana/web3.js';

import { prisma, type SettlementBatchRecord } from '../prisma';
import {
  accountStateHashHex,
  fetchCharacterSettlementBatchCursorAccount,
  fetchProgramConfigAccount,
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
  return {
    characterId,
    batchId: draft.payload.batchId,
    startNonce: draft.payload.startNonce,
    endNonce: draft.payload.endNonce,
    battleCount: draft.payload.battleCount,
    firstBattleTs: draft.payload.firstBattleTs,
    lastBattleTs: draft.payload.lastBattleTs,
    seasonId: draft.payload.seasonId,
    startStateHash: draft.payload.startStateHash,
    endStateHash: draft.payload.endStateHash,
    zoneProgressDelta: draft.payload.zoneProgressDelta,
    encounterHistogram: draft.payload.encounterHistogram,
    optionalLoadoutRevision: draft.payload.optionalLoadoutRevision ?? null,
    batchHash: draft.payload.batchHash,
    schemaVersion: draft.payload.schemaVersion,
    signatureScheme: draft.payload.signatureScheme,
    sealedBattleIds: draft.sealedBattleIds,
  };
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

  const chainState = toRequiredChainState(characterId, await prisma.character.findChainState(characterId));
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

  const characterRootPubkey = new PublicKey(chainState.characterRootPubkey);
  const [liveCursor, programConfig] = await Promise.all([
    fetchCharacterSettlementBatchCursorAccount(
      connection,
      deriveCharacterBatchCursorPda(characterRootPubkey, programId),
      commitment,
    ),
    fetchProgramConfigAccount(connection, deriveProgramConfigPda(programId), commitment),
  ]);

  const pendingBattles = await prisma.battleOutcomeLedger.listNextPendingForCharacter(
    characterId,
    Math.max(programConfig.maxBattlesPerBatch * 4, 256),
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
    pendingBattles,
    maxBattlesPerBatch: programConfig.maxBattlesPerBatch,
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

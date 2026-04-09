import { NextResponse } from 'next/server';

import { deriveCharacterSyncState } from '../../../lib/characterSync';
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

  const [chainState, provisionalProgress, latestBattle, nextSettlementBatch] = await Promise.all([
    prisma.character.findChainState(character.id),
    prisma.characterProvisionalProgress.findByCharacterId(character.id),
    prisma.battleOutcomeLedger.findLatestForCharacter(character.id),
    prisma.settlementBatch.findNextUnconfirmedForCharacter(character.id),
  ]);

  const syncState = deriveCharacterSyncState({
    chain:
      chainState === null
        ? null
        : {
            chainCreationStatus: chainState.chainCreationStatus,
            lastReconciledBatchId: chainState.lastReconciledBatchId,
          },
    latestBattleSettlementStatus: latestBattle?.settlementStatus ?? null,
    nextSettlementBatch:
      nextSettlementBatch === null
        ? null
        : {
            batchId: nextSettlementBatch.batchId,
            status: nextSettlementBatch.status,
          },
  });

  return NextResponse.json({
    character: {
      characterId: character.id,
      userId: character.userId,
      name: character.name,
      level: character.level,
      exp: character.exp,
      syncPhase: syncState.syncPhase,
      battleEligible: syncState.battleEligible,
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
      inventory: character.inventory,
      chain: chainState === null
        ? null
        : {
            playerAuthorityPubkey: chainState.playerAuthorityPubkey,
            chainCharacterIdHex: chainState.chainCharacterIdHex,
            characterRootPubkey: chainState.characterRootPubkey,
            chainCreationStatus: chainState.chainCreationStatus,
            chainCreationTxSignature: chainState.chainCreationTxSignature,
            chainCreatedAt: chainState.chainCreatedAt,
            chainCreationTs: chainState.chainCreationTs,
            chainCreationSeasonId: chainState.chainCreationSeasonId,
            cursor:
              chainState.lastReconciledEndNonce === null ||
              chainState.lastReconciledStateHash === null ||
              chainState.lastReconciledBatchId === null ||
              chainState.lastReconciledBattleTs === null ||
              chainState.lastReconciledSeasonId === null
                ? null
                : {
                    lastReconciledEndNonce: chainState.lastReconciledEndNonce,
                    lastReconciledStateHash: chainState.lastReconciledStateHash,
                    lastReconciledBatchId: chainState.lastReconciledBatchId,
                    lastReconciledBattleTs: chainState.lastReconciledBattleTs,
                    lastReconciledSeasonId: chainState.lastReconciledSeasonId,
                    lastReconciledAt: chainState.lastReconciledAt,
                  }
          },
      provisionalProgress: provisionalProgress === null
        ? null
        : {
            highestUnlockedZoneId: provisionalProgress.highestUnlockedZoneId,
            highestClearedZoneId: provisionalProgress.highestClearedZoneId,
            zoneStates: provisionalProgress.zoneStates,
          },
      latestBattle: latestBattle === null
        ? null
        : {
            battleId: latestBattle.battleId,
            localSequence: latestBattle.localSequence,
            battleNonce: latestBattle.battleNonce,
            battleTs: latestBattle.battleTs,
            seasonId: latestBattle.seasonId,
            zoneId: latestBattle.zoneId,
            enemyArchetypeId: latestBattle.enemyArchetypeId,
            settlementStatus: latestBattle.settlementStatus,
            sealedBatchId: latestBattle.sealedBatchId,
            committedAt: latestBattle.committedAt,
          },
      nextSettlementBatch: nextSettlementBatch === null
        ? null
        : {
            settlementBatchId: nextSettlementBatch.id,
            batchId: nextSettlementBatch.batchId,
            startNonce: nextSettlementBatch.startNonce,
            endNonce: nextSettlementBatch.endNonce,
            battleCount: nextSettlementBatch.battleCount,
            firstBattleTs: nextSettlementBatch.firstBattleTs,
            lastBattleTs: nextSettlementBatch.lastBattleTs,
            seasonId: nextSettlementBatch.seasonId,
            status: nextSettlementBatch.status,
            latestTransactionSignature: nextSettlementBatch.latestTransactionSignature,
            failureCategory: nextSettlementBatch.failureCategory,
            failureCode: nextSettlementBatch.failureCode,
          }
    }
  });
}

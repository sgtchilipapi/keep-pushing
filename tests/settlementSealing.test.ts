import { Keypair } from '@solana/web3.js';

import {
  buildSettlementValidationContext,
  dryRunApplyBattleSettlementBatchV1,
} from '../lib/solana/settlementBatchValidation';
import {
  sealSettlementBatchDraft,
  settlementBatchRecordToPayload,
} from '../lib/solana/settlementSealing';
import type { BattleOutcomeLedgerRecord, SettlementBatchRecord } from '../lib/prisma';

function battle(overrides: Partial<BattleOutcomeLedgerRecord>): BattleOutcomeLedgerRecord {
  const sequence = overrides.localSequence ?? overrides.battleNonce ?? 1;

  return {
    id: `battle-${sequence}`,
    characterId: 'local-character-1',
    battleId: `battle-id-${sequence}`,
    localSequence: sequence,
    battleNonce: 1,
    battleTs: 1_700_000_100,
    seasonId: 4,
    zoneId: 1,
    enemyArchetypeId: 10,
    zoneProgressDelta: [],
    settlementStatus: 'PENDING',
    sealedBatchId: null,
    committedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('settlementSealing', () => {
  it('seals the next contiguous oldest-first batch with canonical hashes', () => {
    const draft = sealSettlementBatchDraft({
      characterIdHex: '00112233445566778899aabbccddeeff',
      cursor: {
        lastCommittedEndNonce: 0,
        lastCommittedStateHash: '11'.repeat(32),
        lastCommittedBatchId: 0,
        lastCommittedBattleTs: 1_700_000_050,
        lastCommittedSeasonId: 4,
      },
      pendingBattles: [
        battle({
          id: 'a',
          battleNonce: 1,
          battleTs: 1_700_000_100,
          zoneId: 1,
          enemyArchetypeId: 10,
          zoneProgressDelta: [{ zoneId: 2, newState: 1 }],
        }),
        battle({
          id: 'b',
          battleNonce: 2,
          battleTs: 1_700_000_130,
          zoneId: 2,
          enemyArchetypeId: 20,
          zoneProgressDelta: [{ zoneId: 2, newState: 2 }],
        }),
        battle({
          id: 'c',
          battleNonce: 3,
          battleTs: 1_700_000_150,
          zoneId: 1,
          enemyArchetypeId: 10,
          zoneProgressDelta: [],
        }),
      ],
      maxBattlesPerBatch: 20,
      maxHistogramEntriesPerBatch: 20,
    });

    expect(draft.sealedBattleIds).toEqual(['a', 'b', 'c']);
    expect(draft.payload).toMatchObject({
      characterId: '00112233445566778899aabbccddeeff',
      batchId: 1,
      startNonce: 1,
      endNonce: 3,
      battleCount: 3,
      startStateHash: '11'.repeat(32),
      firstBattleTs: 1_700_000_100,
      lastBattleTs: 1_700_000_150,
      seasonId: 4,
      schemaVersion: 2,
      signatureScheme: 0,
      encounterHistogram: [
        { zoneId: 1, enemyArchetypeId: 10, count: 2 },
        { zoneId: 2, enemyArchetypeId: 20, count: 1 },
      ],
      zoneProgressDelta: [{ zoneId: 2, newState: 2 }],
    });
    expect(draft.payload.endStateHash).toHaveLength(64);
    expect(draft.payload.batchHash).toHaveLength(64);
  });

  it('stops sealing at a season boundary instead of crossing seasons', () => {
    const draft = sealSettlementBatchDraft({
      characterIdHex: '00112233445566778899aabbccddeeff',
      cursor: {
        lastCommittedEndNonce: 4,
        lastCommittedStateHash: '22'.repeat(32),
        lastCommittedBatchId: 2,
        lastCommittedBattleTs: 1_700_000_090,
        lastCommittedSeasonId: 4,
      },
      pendingBattles: [
        battle({ id: 'd', battleNonce: 5, seasonId: 4 }),
        battle({ id: 'e', battleNonce: 6, seasonId: 4 }),
        battle({ id: 'f', battleNonce: 7, seasonId: 5 }),
      ],
      maxBattlesPerBatch: 20,
      maxHistogramEntriesPerBatch: 20,
    });

    expect(draft.sealedBattleIds).toEqual(['d', 'e']);
    expect(draft.payload.startNonce).toBe(5);
    expect(draft.payload.endNonce).toBe(6);
    expect(draft.payload.battleCount).toBe(2);
    expect(draft.payload.seasonId).toBe(4);
  });

  it('seals encounter-produced battle rows without requiring zone progress deltas', () => {
    const draft = sealSettlementBatchDraft({
      characterIdHex: '00112233445566778899aabbccddeeff',
      cursor: {
        lastCommittedEndNonce: 0,
        lastCommittedStateHash: '11'.repeat(32),
        lastCommittedBatchId: 0,
        lastCommittedBattleTs: 1_700_000_050,
        lastCommittedSeasonId: 4,
      },
      pendingBattles: [
        battle({
          id: 'encounter-a',
          battleNonce: 1,
          battleTs: 1_700_000_100,
          zoneId: 2,
          enemyArchetypeId: 100,
          zoneProgressDelta: [],
        }),
        battle({
          id: 'encounter-b',
          battleNonce: 2,
          battleTs: 1_700_000_110,
          zoneId: 2,
          enemyArchetypeId: 101,
          zoneProgressDelta: [],
        }),
      ],
      maxBattlesPerBatch: 20,
      maxHistogramEntriesPerBatch: 20,
    });

    expect(draft.sealedBattleIds).toEqual(['encounter-a', 'encounter-b']);
    expect(draft.payload.zoneProgressDelta).toEqual([]);
    expect(draft.payload.encounterHistogram).toEqual([
      { zoneId: 2, enemyArchetypeId: 100, count: 1 },
      { zoneId: 2, enemyArchetypeId: 101, count: 1 },
    ]);
  });

  it('rejects a gap before the oldest pending battle', () => {
    expect(() =>
      sealSettlementBatchDraft({
        characterIdHex: '00112233445566778899aabbccddeeff',
        cursor: {
          lastCommittedEndNonce: 4,
          lastCommittedStateHash: '22'.repeat(32),
          lastCommittedBatchId: 2,
          lastCommittedBattleTs: 1_700_000_090,
          lastCommittedSeasonId: 4,
        },
        pendingBattles: [battle({ battleNonce: 6 })],
        maxBattlesPerBatch: 20,
        maxHistogramEntriesPerBatch: 20,
      }),
    ).toThrow(/ERR_PENDING_NONCE_GAP/);
  });

  it('re-hydrates a stored sealed batch back into canonical payload form', () => {
    const batchRecord: SettlementBatchRecord = {
      id: 'batch-1',
      characterId: 'local-character-1',
      batchId: 3,
      startNonce: 5,
      endNonce: 6,
      battleCount: 2,
      firstBattleTs: 1_700_000_100,
      lastBattleTs: 1_700_000_120,
      seasonId: 4,
      startStateHash: '33'.repeat(32),
      endStateHash: '44'.repeat(32),
      zoneProgressDelta: [{ zoneId: 8, newState: 1 }],
      encounterHistogram: [{ zoneId: 8, enemyArchetypeId: 20, count: 2 }],
      optionalLoadoutRevision: null,
      batchHash: '55'.repeat(32),
      schemaVersion: 2,
      signatureScheme: 0,
      status: 'SEALED',
      failureCategory: null,
      failureCode: null,
      latestMessageSha256Hex: null,
      latestSignedTxSha256Hex: null,
      latestTransactionSignature: null,
      preparedAt: null,
      submittedAt: null,
      confirmedAt: null,
      failedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    expect(
      settlementBatchRecordToPayload(batchRecord, '00112233445566778899aabbccddeeff'),
    ).toEqual({
      characterId: '00112233445566778899aabbccddeeff',
      batchId: 3,
      startNonce: 5,
      endNonce: 6,
      battleCount: 2,
      startStateHash: '33'.repeat(32),
      endStateHash: '44'.repeat(32),
      zoneProgressDelta: [{ zoneId: 8, newState: 1 }],
      encounterHistogram: [{ zoneId: 8, enemyArchetypeId: 20, count: 2 }],
      optionalLoadoutRevision: undefined,
      batchHash: '55'.repeat(32),
      firstBattleTs: 1_700_000_100,
      lastBattleTs: 1_700_000_120,
      seasonId: 4,
      schemaVersion: 2,
      signatureScheme: 0,
    });
  });
});

describe('settlement dry-run envelope bridge', () => {
  it('builds validation context from a live-style envelope and rejects invalid payloads before tx build', () => {
    const authority = Keypair.generate().publicKey;
    const trustedServerSigner = Keypair.generate().publicKey;
    const envelope = {
      playerAuthority: authority,
      primaryZoneProgressPage: {
        pageIndex: 0,
        zoneStates: [1, 0, ...new Array(254).fill(0)],
      },
      additionalZoneProgressPages: [],
      characterRoot: {
        characterId: Buffer.from('00112233445566778899aabbccddeeff', 'hex'),
        authority,
        characterCreationTs: 1_700_000_000n,
      },
      characterStats: {
        level: 1,
        totalExp: 10n,
      },
      characterWorldProgress: {
        highestUnlockedZoneId: 0,
        highestClearedZoneId: 0,
      },
      characterBatchCursor: {
        lastCommittedEndNonce: 0n,
        lastCommittedStateHash: Buffer.from('11'.repeat(32), 'hex'),
        lastCommittedBatchId: 0n,
        lastCommittedBattleTs: 1_700_000_010n,
        lastCommittedSeasonId: 4,
        updatedAtSlot: 99n,
      },
      programConfig: {
        settlementPaused: false,
        maxBattlesPerBatch: 20,
        maxHistogramEntriesPerBatch: 20,
        trustedServerSigner,
      },
      seasonPolicy: {
        seasonId: 4,
        seasonStartTs: 1_700_000_000n,
        seasonEndTs: 1_700_000_400n,
        commitGraceEndTs: 1_700_000_900n,
      },
      zoneRegistries: [
        { zoneId: 0, expMultiplierNum: 1, expMultiplierDen: 1 },
      ],
      zoneEnemySets: [
        { zoneId: 0, allowedEnemyArchetypeIds: [10] },
      ],
      enemyArchetypeRegistries: [
        { enemyArchetypeId: 10, expRewardBase: 30 },
      ],
    } as never;

    const payload = {
      characterId: '00112233445566778899aabbccddeeff',
      batchId: 1,
      startNonce: 1,
      endNonce: 1,
      battleCount: 1,
      startStateHash: '11'.repeat(32),
      endStateHash: '22'.repeat(32),
      zoneProgressDelta: [],
      encounterHistogram: [{ zoneId: 0, enemyArchetypeId: 10, count: 1 }],
      batchHash: '33'.repeat(32),
      firstBattleTs: 1_700_000_020,
      lastBattleTs: 1_700_000_020,
      seasonId: 4,
      schemaVersion: 2 as const,
      signatureScheme: 0 as const,
    };

    const context = buildSettlementValidationContext({
      envelope,
      currentUnixTimestamp: 1_700_000_200,
      currentSlot: 100,
      serverSigner: trustedServerSigner.toBase58(),
    });

    expect(context.playerAuthority).toBe(authority.toBase58());
    expect(context.cursor.lastCommittedStateHash).toBe('11'.repeat(32));
    expect(context.zoneStates.get(0)).toBe(1);

    expect(() =>
      dryRunApplyBattleSettlementBatchV1(
        {
          ...payload,
          startStateHash: 'ff'.repeat(32),
        },
        {
          envelope,
          currentUnixTimestamp: 1_700_000_200,
          currentSlot: 100,
          serverSigner: trustedServerSigner.toBase58(),
        },
      ),
    ).toThrow(/ERR_STATE_HASH_GAP/);
  });
});

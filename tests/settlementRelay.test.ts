import { Keypair } from '@solana/web3.js';

import {
  prepareSolanaSettlement,
} from '../lib/solana/settlementRelay';
import type {
  CharacterChainState,
  SettlementBatchRecord,
} from '../lib/prisma';

function buildBatch(overrides: Partial<SettlementBatchRecord> = {}): SettlementBatchRecord {
  return {
    id: 'batch-1',
    characterId: 'character-1',
    batchId: 1,
    startNonce: 1,
    endNonce: 2,
    battleCount: 2,
    firstBattleTs: 1_700_000_100,
    lastBattleTs: 1_700_000_120,
    seasonId: 4,
    startStateHash: '11'.repeat(32),
    endStateHash: '22'.repeat(32),
    zoneProgressDelta: [{ zoneId: 3, newState: 1 }],
    encounterHistogram: [{ zoneId: 3, enemyArchetypeId: 22, count: 2 }],
    optionalLoadoutRevision: null,
    batchHash: '33'.repeat(32),
    schemaVersion: 2,
    signatureScheme: 1,
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
    createdAt: new Date('2026-04-04T00:00:00.000Z'),
    updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    ...overrides,
  };
}

function buildChainState(characterRootPubkey: string, authority: string): CharacterChainState {
  return {
    id: 'character-1',
    playerAuthorityPubkey: authority,
    chainCharacterIdHex: '00112233445566778899aabbccddeeff',
    characterRootPubkey,
    chainCreationStatus: 'CONFIRMED',
    chainCreationTxSignature: null,
    chainCreatedAt: null,
    chainCreationTs: 1_700_000_000,
    chainCreationSeasonId: 4,
    lastReconciledEndNonce: 0,
    lastReconciledStateHash: '11'.repeat(32),
    lastReconciledBatchId: 0,
    lastReconciledBattleTs: 1_700_000_090,
    lastReconciledSeasonId: 4,
    lastReconciledAt: null,
  };
}

describe('settlementRelay', () => {
  it('returns the player authorization message before transaction assembly', async () => {
    const authority = Keypair.generate().publicKey;
    const characterRoot = Keypair.generate().publicKey;
    const batch = buildBatch();
    const prismaClient = {
      character: {
        findChainState: jest
          .fn()
          .mockResolvedValue(buildChainState(characterRoot.toBase58(), authority.toBase58())),
      },
      settlementBatch: {
        findById: jest.fn().mockResolvedValue(batch),
        findNextUnconfirmedForCharacter: jest.fn().mockResolvedValue(batch),
        updateStatus: jest.fn().mockResolvedValue(batch),
      },
    };

    const result = await prepareSolanaSettlement(
      {
        characterId: 'character-1',
        authority: authority.toBase58(),
      },
      {
        prismaClient: prismaClient as never,
        sealNextSettlementBatch: jest.fn().mockResolvedValue({
          batch,
          payload: {
            characterId: '00112233445566778899aabbccddeeff',
            batchId: batch.batchId,
            startNonce: batch.startNonce,
            endNonce: batch.endNonce,
            battleCount: batch.battleCount,
            startStateHash: batch.startStateHash,
            endStateHash: batch.endStateHash,
            zoneProgressDelta: batch.zoneProgressDelta,
            encounterHistogram: batch.encounterHistogram,
            optionalLoadoutRevision: undefined,
            batchHash: batch.batchHash,
            firstBattleTs: batch.firstBattleTs,
            lastBattleTs: batch.lastBattleTs,
            seasonId: batch.seasonId,
            schemaVersion: 2 as const,
            signatureScheme: 1 as const,
          },
          dryRunResult: {},
          validationContext: {},
          wasExistingBatch: true,
        }),
        loadEnvelope: jest.fn().mockResolvedValue({
          playerAuthority: authority,
          characterRoot: { pubkey: characterRoot },
          characterBatchCursor: {
            lastCommittedEndNonce: 0n,
            lastCommittedBatchId: 0n,
            lastCommittedStateHash: Buffer.from('11'.repeat(32), 'hex'),
            lastCommittedBattleTs: 1_700_000_090n,
            lastCommittedSeasonId: 4,
          },
        }),
      },
    );

    expect(result.phase).toBe('authorize');
    expect(result.settlementBatchId).toBe(batch.id);
    expect(result.permitDomain.batchHash).toBe(batch.batchHash);
    expect(result.payload.signatureScheme).toBe(1);
    expect(result.playerAuthorizationMessageUtf8).toContain('RUNANA Wallet Authorization');
    expect(Buffer.from(result.playerAuthorizationMessageBase64, 'base64').length).toBeGreaterThan(32);
  });

  it('returns a prepared settlement transaction once the permit signature is provided', async () => {
    const authority = Keypair.generate().publicKey;
    const characterRoot = Keypair.generate().publicKey;
    const batch = buildBatch();
    const updatedBatch = { ...batch, status: 'PREPARED' as const, latestMessageSha256Hex: 'aa'.repeat(32) };
    const updateStatus = jest.fn().mockResolvedValue(updatedBatch);
    const prismaClient = {
      character: {
        findChainState: jest
          .fn()
          .mockResolvedValue(buildChainState(characterRoot.toBase58(), authority.toBase58())),
      },
      settlementBatch: {
        findById: jest.fn().mockResolvedValue(batch),
        findNextUnconfirmedForCharacter: jest.fn().mockResolvedValue(batch),
        updateStatus,
      },
    };

    const result = await prepareSolanaSettlement(
      {
        characterId: 'character-1',
        authority: authority.toBase58(),
        playerAuthorizationSignatureBase64: Buffer.from(new Uint8Array(64).fill(7)).toString('base64'),
      },
      {
        prismaClient: prismaClient as never,
        serverSigner: Keypair.generate(),
        addressLookupTableAccounts: [],
        sealNextSettlementBatch: jest.fn().mockResolvedValue({
          batch,
          payload: {
            characterId: '00112233445566778899aabbccddeeff',
            batchId: batch.batchId,
            startNonce: batch.startNonce,
            endNonce: batch.endNonce,
            battleCount: batch.battleCount,
            startStateHash: batch.startStateHash,
            endStateHash: batch.endStateHash,
            zoneProgressDelta: batch.zoneProgressDelta,
            encounterHistogram: batch.encounterHistogram,
            optionalLoadoutRevision: undefined,
            batchHash: batch.batchHash,
            firstBattleTs: batch.firstBattleTs,
            lastBattleTs: batch.lastBattleTs,
            seasonId: batch.seasonId,
            schemaVersion: 2 as const,
            signatureScheme: 1 as const,
          },
          dryRunResult: {},
          validationContext: {},
          wasExistingBatch: true,
        }),
        loadEnvelope: jest.fn().mockResolvedValue({
          playerAuthority: authority,
          characterRoot: { pubkey: characterRoot },
          characterBatchCursor: {
            lastCommittedEndNonce: 0n,
            lastCommittedBatchId: 0n,
            lastCommittedStateHash: Buffer.from('11'.repeat(32), 'hex'),
            lastCommittedBattleTs: 1_700_000_090n,
            lastCommittedSeasonId: 4,
          },
        }),
        buildPreparedSettlement: jest.fn().mockResolvedValue({
          serializedMessageBase64: Buffer.from('message').toString('base64'),
          serializedTransactionBase64: Buffer.from('transaction').toString('base64'),
          recentBlockhash: 'recent-blockhash',
          lastValidBlockHeight: 88,
          serverSignerPubkey: Keypair.generate().publicKey.toBase58(),
          serverAttestationMessageBase64: Buffer.from('server-attestation').toString('base64'),
          playerAuthorizationMessageBase64: Buffer.from('player-authorization').toString('base64'),
        }),
      },
    );

    if (result.phase !== 'sign_transaction') {
      throw new Error('expected sign_transaction phase');
    }

    expect(result.phase).toBe('sign_transaction');
    expect(result.preparedTransaction.kind).toBe('battle_settlement');
    expect(result.preparedTransaction.settlementRelay?.batchId).toBe(batch.batchId);
    expect(updateStatus).toHaveBeenCalled();
  });
});

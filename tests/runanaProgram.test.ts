import { Keypair } from '@solana/web3.js';

import {
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
  deriveRunanaCharacterAccounts,
  referencedEnemyArchetypeIdsFromSettlementPayload,
  referencedZoneIdsFromSettlementPayload,
  referencedZonePageIndicesFromSettlementPayload,
} from '../lib/solana/runanaProgram';

describe('runanaProgram', () => {
  it('derives the canonical character PDA bundle from authority and character id', () => {
    const authority = Keypair.generate().publicKey;
    const characterIdHex = '00112233445566778899aabbccddeeff';
    const characterRoot = deriveCharacterRootPda(authority, characterIdHex);

    expect(deriveRunanaCharacterAccounts(authority, characterIdHex)).toEqual({
      programConfig: expect.anything(),
      characterRoot,
      characterStats: deriveCharacterStatsPda(characterRoot),
      characterWorldProgress: deriveCharacterWorldProgressPda(characterRoot),
      characterBatchCursor: deriveCharacterBatchCursorPda(characterRoot),
    });
  });

  it('sorts and de-duplicates referenced zones, enemies, and zone pages from a settlement payload', () => {
    const payload = {
      characterId: '00112233445566778899aabbccddeeff',
      batchId: 7,
      startNonce: 8,
      endNonce: 10,
      battleCount: 3,
      startStateHash: '11'.repeat(32),
      endStateHash: '22'.repeat(32),
      zoneProgressDelta: [
        { zoneId: 512, newState: 1 as const },
        { zoneId: 3, newState: 2 as const },
      ],
      encounterHistogram: [
        { zoneId: 257, enemyArchetypeId: 42, count: 1 },
        { zoneId: 3, enemyArchetypeId: 10, count: 1 },
        { zoneId: 257, enemyArchetypeId: 10, count: 2 },
      ],
      optionalLoadoutRevision: 9,
      batchHash: '33'.repeat(32),
      firstBattleTs: 1_700_000_100,
      lastBattleTs: 1_700_000_220,
      seasonId: 4,
      schemaVersion: 2 as const,
      signatureScheme: 0 as const,
    };

    expect(referencedZoneIdsFromSettlementPayload(payload)).toEqual([3, 257]);
    expect(referencedEnemyArchetypeIdsFromSettlementPayload(payload)).toEqual([10, 42]);
    expect(referencedZonePageIndicesFromSettlementPayload(payload)).toEqual([0, 1, 2]);
    expect(deriveCharacterZoneProgressPagePda(Keypair.generate().publicKey, 2)).toBeDefined();
  });
});

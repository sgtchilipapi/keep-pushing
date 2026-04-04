jest.mock('../engine/battle/skillRegistry', () => ({
  getSkillDef: jest.fn(() => ({})),
}));

jest.mock('../engine/battle/passiveRegistry', () => ({
  getPassiveDef: jest.fn(() => ({})),
}));

const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
  character: {
    create: jest.fn(),
    updateChainIdentity: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

jest.mock('../lib/solana/runanaAccounts', () => ({
  fetchProgramConfigAccount: jest.fn(async () => ({})),
  fetchSeasonPolicyAccount: jest.fn(async () => ({})),
  fetchZoneRegistryAccount: jest.fn(async () => ({})),
  fetchZoneEnemySetAccount: jest.fn(async () => ({})),
}));

jest.mock('../lib/solana/playerOwnedV0Transactions', () => ({
  buildPreparedVersionedTransaction: jest.fn(async () => ({
    serializedMessageBase64: Buffer.from('message').toString('base64'),
    serializedTransactionBase64: Buffer.from('tx').toString('base64'),
    recentBlockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 42,
  })),
}));

import { Keypair } from '@solana/web3.js';

import { prepareSolanaCharacterCreation } from '../lib/solana/characterCreation';

describe('characterCreation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prismaMock.character.create.mockResolvedValue({
      id: 'character-1',
      userId: 'user-1',
      name: 'Rookie',
      level: 1,
      exp: 0,
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
    });
  });

  it('retries character identity assignment when the generated chain id collides', async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    prismaMock.character.updateChainIdentity
      .mockRejectedValueOnce({
        code: '23505',
        constraint: 'Character_chainCharacterIdHex_key',
        message: 'duplicate key value violates unique constraint "Character_chainCharacterIdHex_key"',
      })
      .mockResolvedValueOnce({
        id: 'character-1',
        playerAuthorityPubkey: authority,
        chainCharacterIdHex: '22'.repeat(16),
        characterRootPubkey: Keypair.generate().publicKey.toBase58(),
        chainCreationStatus: 'PENDING',
        chainCreationTxSignature: null,
        chainCreatedAt: null,
        chainCreationTs: 1_700_000_000,
        chainCreationSeasonId: 4,
        lastReconciledEndNonce: null,
        lastReconciledStateHash: null,
        lastReconciledBatchId: null,
        lastReconciledBattleTs: null,
        lastReconciledSeasonId: null,
        lastReconciledAt: null,
      });

    const result = await prepareSolanaCharacterCreation(
      {
        userId: 'user-1',
        authority,
        seasonIdAtCreation: 4,
        initialUnlockedZoneId: 1,
      },
      {
        connection: {} as never,
        now: () => new Date('2023-11-14T22:13:20.000Z'),
        generateCharacterIdHex: jest
          .fn()
          .mockReturnValueOnce('11'.repeat(16))
          .mockReturnValueOnce('22'.repeat(16)),
      },
    );

    expect(prismaMock.character.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.character.updateChainIdentity).toHaveBeenCalledTimes(2);
    expect(prismaMock.character.updateChainIdentity.mock.calls[0]?.[1]).toMatchObject({
      chainCharacterIdHex: '11'.repeat(16),
    });
    expect(prismaMock.character.updateChainIdentity.mock.calls[1]?.[1]).toMatchObject({
      chainCharacterIdHex: '22'.repeat(16),
    });
    expect(result.character.chain.chainCharacterIdHex).toBe('22'.repeat(16));
    expect(result.preparedTransaction.characterCreationRelay?.chainCharacterIdHex).toBe(
      '22'.repeat(16),
    );
  });
});

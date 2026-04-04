import { Ed25519Program, Keypair, PublicKey } from '@solana/web3.js';

jest.mock('../lib/solana/firstSyncRebasing', () => ({
  prepareFirstSyncRebase: jest.fn(),
}));

jest.mock('../lib/solana/runanaAccounts', () => ({
  fetchProgramConfigAccount: jest.fn(),
}));

import { prepareSolanaFirstSync } from '../lib/solana/firstSyncRelay';
import { prepareFirstSyncRebase } from '../lib/solana/firstSyncRebasing';
import { fetchProgramConfigAccount } from '../lib/solana/runanaAccounts';
import { RUNANA_PROGRAM_ID, computeAnchorInstructionDiscriminator } from '../lib/solana/runanaProgram';

const prepareFirstSyncRebaseMock = jest.mocked(prepareFirstSyncRebase);
const fetchProgramConfigAccountMock = jest.mocked(fetchProgramConfigAccount);

function buildPreparedRebase(authority: string) {
  const chainCharacterIdHex = '11'.repeat(16);
  const characterRootPubkey = Keypair.generate().publicKey.toBase58();

  return {
    anchor: {
      characterId: 'character-1',
      authority,
      feePayer: authority,
      characterCreationTs: 1_700_000_000,
      seasonIdAtCreation: 4,
      initialUnlockedZoneId: 1,
    },
    reservedIdentity: {
      playerAuthorityPubkey: authority,
      chainCharacterIdHex,
      characterRootPubkey,
      chainCreationStatus: 'PENDING' as const,
    },
    genesisCursor: {
      lastCommittedEndNonce: 0,
      lastCommittedBatchId: 0,
      lastCommittedStateHash: '22'.repeat(32),
      lastCommittedBattleTs: 1_700_000_000,
      lastCommittedSeasonId: 4,
    },
    archivedBattleIds: [],
    rebasedBattles: [],
    batchDrafts: [
      {
        payload: {
          characterId: chainCharacterIdHex,
          batchId: 1,
          startNonce: 1,
          endNonce: 2,
          battleCount: 2,
          startStateHash: '22'.repeat(32),
          endStateHash: '33'.repeat(32),
          zoneProgressDelta: [{ zoneId: 1, newState: 2 as const }],
          encounterHistogram: [{ zoneId: 1, enemyArchetypeId: 101, count: 2 }],
          optionalLoadoutRevision: undefined,
          batchHash: '44'.repeat(32),
          firstBattleTs: 1_700_000_010,
          lastBattleTs: 1_700_000_040,
          seasonId: 4,
          schemaVersion: 2 as const,
          signatureScheme: 0 as const,
        },
        sealedBattleIds: ['battle-1', 'battle-2'],
      },
    ],
  };
}

describe('firstSyncRelay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the player authorization message before transaction assembly', async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    prepareFirstSyncRebaseMock.mockResolvedValue(buildPreparedRebase(authority));

    const result = await prepareSolanaFirstSync(
      {
        characterId: 'character-1',
        authority,
      },
      {
        prepareFirstSyncRebase: prepareFirstSyncRebaseMock,
      },
    );

    expect(result.phase).toBe('authorize');
    expect(result.expectedCursor.lastCommittedEndNonce).toBe(0);
    expect(result.permitDomain.playerAuthority).toBe(authority);
    expect(Buffer.from(result.playerAuthorizationMessageBase64, 'base64').length).toBeGreaterThan(
      32,
    );
  });

  it('assembles create-plus-settle instructions in the required order', async () => {
    const authority = Keypair.generate();
    const serverSigner = Keypair.generate();
    const preparedRebase = buildPreparedRebase(authority.publicKey.toBase58());
    const buildPreparedTransaction = jest.fn(async (args: {
      instructions: Array<{ programId: PublicKey; data: Buffer }>;
    }) => {
      const instructionProgramIds = args.instructions.map((instruction) =>
        instruction.programId.toBase58(),
      );
      const instructionDiscriminators = args.instructions
        .filter((instruction) => instruction.programId.equals(RUNANA_PROGRAM_ID))
        .map((instruction) => Buffer.from(instruction.data).subarray(0, 8).toString('hex'));

      expect(instructionProgramIds).toEqual([
        RUNANA_PROGRAM_ID.toBase58(),
        Ed25519Program.programId.toBase58(),
        Ed25519Program.programId.toBase58(),
        RUNANA_PROGRAM_ID.toBase58(),
      ]);
      expect(instructionDiscriminators).toEqual([
        Buffer.from(computeAnchorInstructionDiscriminator('create_character')).toString('hex'),
        Buffer.from(
          computeAnchorInstructionDiscriminator('apply_battle_settlement_batch_v1'),
        ).toString('hex'),
      ]);

      return {
        serializedMessageBase64: Buffer.from('message').toString('base64'),
        serializedTransactionBase64: Buffer.from('transaction').toString('base64'),
        recentBlockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 88,
      };
    });

    prepareFirstSyncRebaseMock.mockResolvedValue(preparedRebase);
    fetchProgramConfigAccountMock.mockResolvedValue({
      trustedServerSigner: serverSigner.publicKey,
    } as Awaited<ReturnType<typeof fetchProgramConfigAccount>>);

    const result = await prepareSolanaFirstSync(
      {
        characterId: 'character-1',
        authority: authority.publicKey.toBase58(),
        playerAuthorizationSignatureBase64: Buffer.from(new Uint8Array(64).fill(5)).toString(
          'base64',
        ),
      },
      {
        connection: {
          getLatestBlockhash: jest.fn().mockResolvedValue({
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 88,
          }),
          getAccountInfo: jest.fn(),
        },
        serverSigner,
        addressLookupTableAccounts: [],
        prepareFirstSyncRebase: prepareFirstSyncRebaseMock,
        buildPreparedTransaction: buildPreparedTransaction as never,
      },
    );

    if (result.phase !== 'sign_transaction') {
      throw new Error('expected sign_transaction phase');
    }

    expect(buildPreparedTransaction).toHaveBeenCalledTimes(1);
    expect(result.preparedTransaction.kind).toBe('player_owned_instruction');
    expect(result.preparedTransaction.characterCreationRelay?.localCharacterId).toBe('character-1');
    expect(result.preparedTransaction.settlementRelay?.batchId).toBe(1);
  });
});

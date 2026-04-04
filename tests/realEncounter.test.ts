jest.mock('../lib/combat/combatSnapshotAssembly', () => ({
  loadCharacterBattleReadyRecord: jest.fn(),
  buildPlayerCombatSnapshot: jest.fn(),
  buildEnemyCombatSnapshot: jest.fn(),
}));

jest.mock('../lib/combat/encounterSelection', () => ({
  selectEncounterForZone: jest.fn(),
}));

jest.mock('../engine/battle/battleEngine', () => ({
  simulateBattle: jest.fn(),
}));

const prismaMock = {
  battleOutcomeLedger: {
    findLatestForCharacter: jest.fn(),
  },
  battleRecord: {
    createWithSettlementLedger: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

jest.mock('../lib/solana/runanaAccounts', () => ({
  fetchCharacterWorldProgressAccount: jest.fn(),
  fetchSeasonPolicyAccount: jest.fn(),
}));

jest.mock('../lib/solana/runanaClient', () => ({
  createRunanaConnection: jest.fn(() => ({})),
  resolveRunanaCommitment: jest.fn(() => 'confirmed'),
  resolveRunanaProgramId: jest.fn(() => 'program-id'),
}));

jest.mock('../lib/solana/runanaProgram', () => ({
  deriveCharacterWorldProgressPda: jest.fn(() => 'world-progress-pda'),
  deriveSeasonPolicyPda: jest.fn(() => 'season-policy-pda'),
}));

import {
  buildEnemyCombatSnapshot,
  buildPlayerCombatSnapshot,
  loadCharacterBattleReadyRecord,
} from '../lib/combat/combatSnapshotAssembly';
import { simulateBattle } from '../engine/battle/battleEngine';
import { selectEncounterForZone } from '../lib/combat/encounterSelection';
import {
  fetchCharacterWorldProgressAccount,
  fetchSeasonPolicyAccount,
} from '../lib/solana/runanaAccounts';
import { executeRealEncounter } from '../lib/combat/realEncounter';

describe('executeRealEncounter', () => {
  const encounterEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    RUNANA_ACTIVE_SEASON_ID: '1',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (loadCharacterBattleReadyRecord as jest.Mock).mockResolvedValue({
      id: 'character-1',
      userId: 'user-1',
      name: 'Rookie',
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      playerAuthorityPubkey: 'authority',
      chainCharacterIdHex: '11'.repeat(16),
      characterRootPubkey: '11111111111111111111111111111111',
      chainCreationStatus: 'CONFIRMED',
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: 4,
      lastReconciledStateHash: '22'.repeat(32),
      lastReconciledBatchId: 1,
      lastReconciledBattleTs: 1000,
      lastReconciledSeasonId: 1,
      activeSkills: ['1001', '1002'],
      passiveSkills: ['2001', '2002'],
    });
    (fetchCharacterWorldProgressAccount as jest.Mock).mockResolvedValue({
      highestUnlockedZoneId: 3,
    });
    (fetchSeasonPolicyAccount as jest.Mock).mockResolvedValue({
      seasonId: 1,
      seasonStartTs: BigInt(1_700_000_000),
      seasonEndTs: BigInt(1_700_200_000),
    });
    (selectEncounterForZone as jest.Mock).mockReturnValue({
      enemyArchetypeId: 100,
      enemyArchetype: { enemyArchetypeId: 100, displayName: 'Scrap Drone', snapshot: {} },
    });
    (buildPlayerCombatSnapshot as jest.Mock).mockReturnValue({
      entityId: 'character-1',
      activeSkillIds: ['1001', '1002'],
    });
    (buildEnemyCombatSnapshot as jest.Mock).mockReturnValue({
      entityId: '100',
      activeSkillIds: ['1001', '1003'],
    });
    (simulateBattle as jest.Mock).mockReturnValue({
      battleId: 'battle-1',
      seed: 77,
      playerInitial: { entityId: 'character-1' },
      enemyInitial: { entityId: '100' },
      events: [{ type: 'ROUND_START', round: 1 }],
      winnerEntityId: 'character-1',
      roundsPlayed: 3,
    });
    prismaMock.battleOutcomeLedger.findLatestForCharacter.mockResolvedValue(null);
    prismaMock.battleRecord.createWithSettlementLedger.mockResolvedValue({
      ledger: {
        battleId: 'battle-1',
        characterId: 'character-1',
        zoneId: 2,
        enemyArchetypeId: 100,
        battleNonce: 5,
        seasonId: 1,
        battleTs: 1_700_000_100,
      },
    });
  });

  it('executes a confirmed real encounter and persists a pending settlement row', async () => {
    const result = await executeRealEncounter(
      {
        characterId: 'character-1',
        zoneId: 2,
        seed: 77,
      },
      {
        now: () => new Date('2023-11-14T22:15:00.000Z'),
        env: encounterEnv,
      },
    );

    expect(selectEncounterForZone).toHaveBeenCalledWith(2, 77);
    expect(prismaMock.battleRecord.createWithSettlementLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'character-1',
        zoneId: 2,
        enemyArchetypeId: 100,
        battleNonce: 5,
        seasonId: 1,
        zoneProgressDelta: [],
      }),
    );
    expect(result).toMatchObject({
      characterId: 'character-1',
      zoneId: 2,
      enemyArchetypeId: 100,
      battleNonce: 5,
      seasonId: 1,
      settlementStatus: 'PENDING',
    });
  });

  it('increments from the latest local battle nonce when pending rows already exist', async () => {
    prismaMock.battleOutcomeLedger.findLatestForCharacter.mockResolvedValue({
      battleNonce: 9,
    });

    await executeRealEncounter(
      {
        characterId: 'character-1',
        zoneId: 2,
        seed: 77,
      },
      {
        now: () => new Date('2023-11-14T22:15:00.000Z'),
        env: encounterEnv,
      },
    );

    expect(prismaMock.battleRecord.createWithSettlementLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        battleNonce: 10,
      }),
    );
  });

  it('rejects characters that are not chain-confirmed', async () => {
    (loadCharacterBattleReadyRecord as jest.Mock).mockResolvedValue({
      chainCreationStatus: 'PENDING',
    });

    await expect(
      executeRealEncounter(
        {
          characterId: 'character-1',
          zoneId: 2,
          seed: 77,
        },
        {
          now: () => new Date('2023-11-14T22:15:00.000Z'),
          env: encounterEnv,
        },
      ),
    ).rejects.toThrow(/ERR_CHARACTER_NOT_CONFIRMED/);
  });

  it('rejects locked zones', async () => {
    (fetchCharacterWorldProgressAccount as jest.Mock).mockResolvedValue({
      highestUnlockedZoneId: 1,
    });

    await expect(
      executeRealEncounter(
        {
          characterId: 'character-1',
          zoneId: 2,
          seed: 77,
        },
        {
          now: () => new Date('2023-11-14T22:15:00.000Z'),
          env: encounterEnv,
        },
      ),
    ).rejects.toThrow(/ERR_ZONE_LOCKED/);
  });
});

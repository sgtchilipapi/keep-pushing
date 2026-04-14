const characterCreationMock = {
  prepareSolanaCharacterCreation: jest.fn(),
  submitSolanaCharacterCreation: jest.fn(),
};

const authMock = {
  requireSession: jest.fn(),
  requireSessionCharacterAccess: jest.fn(),
};
const auditMock = {
  createAuditRequestId: jest.fn(() => 'request-1'),
  writeAuditLogSafe: jest.fn(),
};

jest.mock('../lib/solana/characterCreation', () => ({
  prepareSolanaCharacterCreation: characterCreationMock.prepareSolanaCharacterCreation,
  submitSolanaCharacterCreation: characterCreationMock.submitSolanaCharacterCreation,
}));

jest.mock('../lib/auth/requireSession', () => {
  const actual = jest.requireActual('../lib/auth/requireSession');
  return {
    ...actual,
    requireSession: authMock.requireSession,
    requireSessionCharacterAccess: authMock.requireSessionCharacterAccess,
  };
});
jest.mock('../lib/observability/audit', () => ({
  createAuditRequestId: auditMock.createAuditRequestId,
  writeAuditLogSafe: auditMock.writeAuditLogSafe,
}));

import {
  SessionRequiredError,
} from '../lib/auth/requireSession';
import { POST as preparePOST } from '../app/api/v1/characters/create/prepare/route';
import { POST as finalizePOST } from '../app/api/v1/characters/create/finalize/route';

describe('v1 character create routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.requireSession.mockResolvedValue({
      session: {
        id: 'session-1',
        userId: 'user-1',
        walletAddress: 'wallet-1',
        expiresAt: new Date('2026-05-01T00:00:00.000Z'),
        revokedAt: null,
      },
      user: {
        id: 'user-1',
        primaryWalletAddress: 'wallet-1',
      },
    });
    authMock.requireSessionCharacterAccess.mockResolvedValue({
      session: {
        id: 'session-1',
        userId: 'user-1',
        walletAddress: 'wallet-1',
        expiresAt: new Date('2026-05-01T00:00:00.000Z'),
        revokedAt: null,
      },
      user: {
        id: 'user-1',
        primaryWalletAddress: 'wallet-1',
      },
    });
  });

  it('prepares a character-create transaction using the session wallet as authority', async () => {
    characterCreationMock.prepareSolanaCharacterCreation.mockResolvedValue({
      phase: 'sign_transaction',
      character: {
        characterId: 'character-1',
        userId: 'user-1',
        name: 'Rookie',
        level: 1,
        exp: 0,
        stats: {
          hp: 1200,
          hpMax: 1200,
          atk: 120,
          def: 70,
          spd: 100,
          accuracyBP: 8000,
          evadeBP: 1200,
        },
        activeSkills: ['1001'],
        passiveSkills: ['2001'],
        unlockedSkillIds: ['1001', '2001'],
        chain: {
          playerAuthorityPubkey: 'wallet-1',
          chainCharacterIdHex: '11'.repeat(16),
          characterRootPubkey: 'root-1',
          chainCreationStatus: 'PENDING',
          chainCreationTxSignature: null,
          chainCreatedAt: null,
          chainCreationTs: null,
          chainCreationSeasonId: null,
        },
      },
      preparedTransaction: {
        kind: 'character_create',
        authority: 'wallet-1',
        feePayer: 'sponsor-1',
        serializedMessageBase64: 'message',
        serializedTransactionBase64: 'tx',
        messageSha256Hex: 'hash',
        requiresPlayerSignature: true,
        serverBroadcast: false,
      },
    });

    const response = await preparePOST(
      new Request('http://localhost/api/v1/characters/create/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: 'character-1',
          initialUnlockedZoneId: 1,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(authMock.requireSessionCharacterAccess).toHaveBeenCalledWith(
      expect.any(Request),
      'character-1',
    );
    expect(characterCreationMock.prepareSolanaCharacterCreation).toHaveBeenCalledWith({
      characterId: 'character-1',
      authority: 'wallet-1',
      feePayer: undefined,
      initialUnlockedZoneId: 1,
    });
    expect(json.ok).toBe(true);
    expect(json.data.phase).toBe('sign_transaction');
  });

  it('finalizes a signed character-create transaction for the active session wallet', async () => {
    characterCreationMock.submitSolanaCharacterCreation.mockResolvedValue({
      characterId: 'character-1',
      chainCreationStatus: 'CONFIRMED',
      transactionSignature: 'sig-1',
      chainCharacterIdHex: '11'.repeat(16),
      characterRootPubkey: 'root-1',
      chainCreatedAt: '2026-04-13T00:00:00.000Z',
      cursor: {
        lastCommittedEndNonce: 0,
        lastCommittedStateHash: '22'.repeat(32),
        lastCommittedBatchId: 0,
        lastCommittedBattleTs: 1_700_000_000,
        lastCommittedSeasonId: 4,
      },
    });

    const response = await finalizePOST(
      new Request('http://localhost/api/v1/characters/create/finalize', {
        method: 'POST',
        body: JSON.stringify({
          prepared: {
            kind: 'character_create',
            authority: 'wallet-1',
            feePayer: 'sponsor-1',
            serializedMessageBase64: 'message',
            serializedTransactionBase64: 'tx',
            messageSha256Hex: 'hash',
            requiresPlayerSignature: true,
            serverBroadcast: false,
          },
          signedMessageBase64: 'signed-message',
          signedTransactionBase64: 'signed-tx',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(characterCreationMock.submitSolanaCharacterCreation).toHaveBeenCalledWith({
      prepared: expect.objectContaining({
        authority: 'wallet-1',
      }),
      signedMessageBase64: 'signed-message',
      signedTransactionBase64: 'signed-tx',
    });
    expect(json.ok).toBe(true);
    expect(json.data.transactionSignature).toBe('sig-1');
  });

  it('returns 401 when character create prepare is attempted without an active session', async () => {
    authMock.requireSessionCharacterAccess.mockRejectedValueOnce(new SessionRequiredError());

    const response = await preparePOST(
      new Request('http://localhost/api/v1/characters/create/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: 'character-1',
          initialUnlockedZoneId: 1,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.ok).toBe(false);
  });
});

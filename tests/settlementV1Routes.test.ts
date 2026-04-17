const settlementPresignMock = {
  prepareSettlementPresignRequest: jest.fn(),
  presignSettlementTransaction: jest.fn(),
  finalizeSettlementPresignRequest: jest.fn(),
};

const authMock = {
  requireSession: jest.fn(),
  requireSessionCharacterAccess: jest.fn(),
};
const auditMock = {
  createAuditRequestId: jest.fn(() => "request-1"),
  writeAuditLogSafe: jest.fn(),
};
const rateLimitMock = {
  assertRateLimit: jest.fn(),
  RateLimitExceededError: class extends Error {
    retryAfterSeconds: number;

    constructor(message: string, retryAfterSeconds: number) {
      super(message);
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
};

jest.mock('../lib/solana/settlementPresign', () => ({
  prepareSettlementPresignRequest: settlementPresignMock.prepareSettlementPresignRequest,
  presignSettlementTransaction: settlementPresignMock.presignSettlementTransaction,
  finalizeSettlementPresignRequest: settlementPresignMock.finalizeSettlementPresignRequest,
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
jest.mock('../lib/security/rateLimit', () => ({
  assertRateLimit: rateLimitMock.assertRateLimit,
  RateLimitExceededError: rateLimitMock.RateLimitExceededError,
}));

import {
  SessionRequiredError,
} from '../lib/auth/requireSession';
import { POST as preparePOST } from '../app/api/v1/settlement/prepare/route';
import { POST as presignPOST } from '../app/api/v1/settlement/presign/route';
import { POST as finalizePOST } from '../app/api/v1/settlement/finalize/route';

describe('v1 settlement routes', () => {
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

  it('prepares a settlement presign request from the active session character access', async () => {
    settlementPresignMock.prepareSettlementPresignRequest.mockResolvedValue({
      prepareRequestId: 'request-1',
      zoneRunId: 'run-1',
      runSettlementId: 'run-settlement-1',
      payload: { batchId: 1 },
      preparedTransaction: {
        kind: 'battle_settlement',
        authority: 'wallet-1',
        feePayer: 'sponsor-1',
      },
      presignToken: 'request-1',
      expiresAt: '2026-04-13T00:05:00.000Z',
    });

    const response = await preparePOST(
      new Request('http://localhost/api/v1/settlement/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: 'character-1',
          zoneRunId: 'run-1',
          idempotencyKey: 'idem-1',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(authMock.requireSessionCharacterAccess).toHaveBeenCalledWith(
      expect.any(Request),
      'character-1',
    );
    expect(settlementPresignMock.prepareSettlementPresignRequest).toHaveBeenCalledWith({
      characterId: 'character-1',
      zoneRunId: 'run-1',
      walletAddress: 'wallet-1',
      sessionId: 'session-1',
      idempotencyKey: 'idem-1',
    });
    expect(json.ok).toBe(true);
    expect(json.data.prepareRequestId).toBe('request-1');
  });

  it('maps presign canonical mismatch failures to conflict responses', async () => {
    settlementPresignMock.presignSettlementTransaction.mockRejectedValue(
      new Error('ERR_SETTLEMENT_TX_MISMATCH_PROGRAM_ID: nope'),
    );

    const response = await presignPOST(
      new Request('http://localhost/api/v1/settlement/presign', {
        method: 'POST',
        body: JSON.stringify({
          prepareRequestId: 'request-1',
          presignToken: 'request-1',
          transactionBase64: 'dHgx',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(json.error.code).toContain('ERR_SETTLEMENT_TX_MISMATCH_PROGRAM_ID');
  });

  it('maps finalize replay-signature conflicts to conflict responses', async () => {
    settlementPresignMock.finalizeSettlementPresignRequest.mockRejectedValue(
      new Error(
        'ERR_SETTLEMENT_REQUEST_STATE_INVALID: settlement batch was already submitted with a different transaction signature',
      ),
    );

    const response = await finalizePOST(
      new Request('http://localhost/api/v1/settlement/finalize', {
        method: 'POST',
        body: JSON.stringify({
          prepareRequestId: 'request-1',
          transactionSignature: 'sig-2',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(json.error.code).toContain('ERR_SETTLEMENT_REQUEST_STATE_INVALID');
  });

  it('returns 429 when settlement prepare hits the configured rate limit', async () => {
    rateLimitMock.assertRateLimit.mockImplementationOnce(() => {
      throw new rateLimitMock.RateLimitExceededError(
        'SETTLEMENT_PREPARE_RATE_LIMIT_SESSION: rate limit exceeded',
        60,
      );
    });

    const response = await preparePOST(
      new Request('http://localhost/api/v1/settlement/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: 'character-1',
          zoneRunId: 'run-1',
          idempotencyKey: 'idem-1',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toContain('SETTLEMENT_PREPARE_RATE_LIMIT_SESSION');
  });

  it('returns 429 when settlement presign hits the configured rate limit', async () => {
    rateLimitMock.assertRateLimit.mockImplementationOnce(() => {
      throw new rateLimitMock.RateLimitExceededError(
        'SETTLEMENT_PRESIGN_RATE_LIMIT_SESSION: rate limit exceeded',
        60,
      );
    });

    const response = await presignPOST(
      new Request('http://localhost/api/v1/settlement/presign', {
        method: 'POST',
        body: JSON.stringify({
          prepareRequestId: 'request-1',
          presignToken: 'request-1',
          transactionBase64: 'dHgx',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toContain('SETTLEMENT_PRESIGN_RATE_LIMIT_SESSION');
  });

  it('returns 429 when settlement finalize hits the configured rate limit', async () => {
    rateLimitMock.assertRateLimit.mockImplementationOnce(() => {
      throw new rateLimitMock.RateLimitExceededError(
        'SETTLEMENT_FINALIZE_RATE_LIMIT_SESSION: rate limit exceeded',
        60,
      );
    });

    const response = await finalizePOST(
      new Request('http://localhost/api/v1/settlement/finalize', {
        method: 'POST',
        body: JSON.stringify({
          prepareRequestId: 'request-1',
          transactionSignature: 'sig-1',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toContain('SETTLEMENT_FINALIZE_RATE_LIMIT_SESSION');
  });

  it('returns 401 when finalize is attempted without an active session', async () => {
    authMock.requireSession.mockRejectedValueOnce(new SessionRequiredError());

    const response = await finalizePOST(
      new Request('http://localhost/api/v1/settlement/finalize', {
        method: 'POST',
        body: JSON.stringify({
          prepareRequestId: 'request-1',
          transactionSignature: 'sig-1',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.ok).toBe(false);
  });
});

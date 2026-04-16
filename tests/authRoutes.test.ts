const nonceMock = {
  issueAuthNonce: jest.fn(),
  consumeAuthNonce: jest.fn(),
};

const sessionMock = {
  buildSessionCookie: jest.fn(),
  clearSessionCookie: jest.fn(),
  createSession: jest.fn(),
  parseSessionTokenFromCookieHeader: jest.fn(),
  revokeSessionByToken: jest.fn(),
};

const walletVerifyMock = {
  verifySolanaMessageSignature: jest.fn(),
};

const authPoolMock = {
  query: jest.fn(),
};
const dbPoolMock = {
  query: jest.fn(),
};
const ensureAuthSchemaMock = jest.fn();
const ensureAuthSchemaBestEffortMock = jest.fn(async () => {
  try {
    await ensureAuthSchemaMock();
  } catch {
    // swallow like production helper
  }
});
const auditMock = {
  createAuditRequestId: jest.fn(() => "request-1"),
  writeAuditLogSafe: jest.fn(),
};
const rateLimitMock = {
  assertRateLimit: jest.fn(),
  getClientIpAddress: jest.fn(() => "127.0.0.1"),
  RateLimitExceededError: class extends Error {
    retryAfterSeconds: number;

    constructor(message: string, retryAfterSeconds: number) {
      super(message);
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
};

jest.mock("../lib/auth/nonce", () => ({
  issueAuthNonce: nonceMock.issueAuthNonce,
  consumeAuthNonce: nonceMock.consumeAuthNonce,
}));

jest.mock("../lib/auth/session", () => ({
  buildSessionCookie: sessionMock.buildSessionCookie,
  clearSessionCookie: sessionMock.clearSessionCookie,
  createSession: sessionMock.createSession,
  parseSessionTokenFromCookieHeader: sessionMock.parseSessionTokenFromCookieHeader,
  revokeSessionByToken: sessionMock.revokeSessionByToken,
}));

jest.mock("../lib/auth/walletVerify", () => ({
  verifySolanaMessageSignature: walletVerifyMock.verifySolanaMessageSignature,
}));

jest.mock("../lib/auth/db", () => ({
  authPool: authPoolMock,
  ensureAuthSchema: ensureAuthSchemaMock,
  ensureAuthSchemaBestEffort: ensureAuthSchemaBestEffortMock,
}));
jest.mock("../lib/prisma", () => ({
  dbPool: dbPoolMock,
}));
jest.mock("../lib/observability/audit", () => ({
  createAuditRequestId: auditMock.createAuditRequestId,
  writeAuditLogSafe: auditMock.writeAuditLogSafe,
}));
jest.mock("../lib/security/rateLimit", () => ({
  assertRateLimit: rateLimitMock.assertRateLimit,
  getClientIpAddress: rateLimitMock.getClientIpAddress,
  RateLimitExceededError: rateLimitMock.RateLimitExceededError,
}));

import { POST as noncePOST } from "../app/api/v1/auth/nonce/route";
import { POST as verifyPOST } from "../app/api/v1/auth/verify/route";
import { POST as logoutPOST } from "../app/api/v1/auth/logout/route";

const walletAddress = "11111111111111111111111111111111";

describe("v1 auth routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthSchemaMock.mockResolvedValue(undefined);
    ensureAuthSchemaBestEffortMock.mockImplementation(async () => {
      try {
        await ensureAuthSchemaMock();
      } catch {
        // swallow like production helper
      }
    });
  });

  it("issues a Solana auth nonce", async () => {
    nonceMock.issueAuthNonce.mockResolvedValue({
      nonceId: "nonce-1",
      nonce: "abc123",
      expiresAt: "2026-04-13T12:05:00.000Z",
      messageToSign: "KEEP_PUSHING_AUTH_V1\nwallet:111",
    });

    const response = await noncePOST(
      new Request("http://localhost/api/v1/auth/nonce", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chain: "solana",
          walletAddress,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(ensureAuthSchemaBestEffortMock).toHaveBeenCalled();
    expect(nonceMock.issueAuthNonce).toHaveBeenCalledWith({
      walletAddress,
      origin: "http://localhost:3000",
    });
    expect(json.ok).toBe(true);
    expect(json.data.nonceId).toBe("nonce-1");
  });

  it("continues nonce issuance when auth schema bootstrap fails", async () => {
    ensureAuthSchemaMock.mockRejectedValueOnce(new Error("schema failed"));
    nonceMock.issueAuthNonce.mockResolvedValue({
      nonceId: "nonce-2",
      nonce: "def456",
      expiresAt: "2026-04-13T12:10:00.000Z",
      messageToSign: "KEEP_PUSHING_AUTH_V1\nwallet:222",
    });

    const response = await noncePOST(
      new Request("http://localhost/api/v1/auth/nonce", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chain: "solana",
          walletAddress,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(nonceMock.issueAuthNonce).toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.data.nonceId).toBe("nonce-2");
  });

  it("verifies a wallet login and sets a session cookie", async () => {
    nonceMock.consumeAuthNonce.mockResolvedValue({
      id: "nonce-1",
      message: "signed-message",
    });
    walletVerifyMock.verifySolanaMessageSignature.mockReturnValue(true);
    dbPoolMock.query.mockResolvedValue({
      rows: [{ id: "user-1" }],
    });
    sessionMock.createSession.mockResolvedValue({
      sessionId: "session-1",
      token: "token-1",
      expiresAt: new Date("2026-05-13T00:00:00.000Z"),
    });
    sessionMock.buildSessionCookie.mockReturnValue(
      "kp_session=token-1; Path=/; HttpOnly",
    );

    const response = await verifyPOST(
      new Request("http://localhost/api/v1/auth/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "jest",
        },
        body: JSON.stringify({
          nonceId: "nonce-1",
          walletAddress,
          signatureBase64: "c2ln",
          signedMessage: "signed-message",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(ensureAuthSchemaBestEffortMock).toHaveBeenCalled();
    expect(nonceMock.consumeAuthNonce).toHaveBeenCalledWith({
      nonceId: "nonce-1",
      walletAddress,
      message: "signed-message",
    });
    expect(walletVerifyMock.verifySolanaMessageSignature).toHaveBeenCalledWith({
      walletAddress,
      message: "signed-message",
      signatureBase64: "c2ln",
    });
    expect(sessionMock.createSession).toHaveBeenCalledWith({
      userId: "user-1",
      walletAddress,
      ipAddress: null,
      userAgent: "jest",
    });
    expect(response.headers.get("Set-Cookie")).toContain("kp_session=token-1");
    expect(json.ok).toBe(true);
    expect(json.data.user.id).toBe("user-1");
  });

  it("returns 429 when nonce issuance hits the configured rate limit", async () => {
    rateLimitMock.assertRateLimit.mockImplementationOnce(() => {
      throw new rateLimitMock.RateLimitExceededError(
        "AUTH_NONCE_RATE_LIMIT_IP: rate limit exceeded",
        60,
      );
    });

    const response = await noncePOST(
      new Request("http://localhost/api/v1/auth/nonce", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.1",
        },
        body: JSON.stringify({
          chain: "solana",
          walletAddress,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toContain("AUTH_NONCE_RATE_LIMIT_IP");
  });

  it("returns 429 when auth verify hits the configured rate limit", async () => {
    rateLimitMock.assertRateLimit.mockImplementationOnce(() => {
      throw new rateLimitMock.RateLimitExceededError(
        "AUTH_VERIFY_RATE_LIMIT_IP: rate limit exceeded",
        60,
      );
    });

    const response = await verifyPOST(
      new Request("http://localhost/api/v1/auth/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "jest",
          "x-forwarded-for": "127.0.0.1",
        },
        body: JSON.stringify({
          nonceId: "nonce-1",
          walletAddress,
          signatureBase64: "c2ln",
          signedMessage: "signed-message",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toContain("AUTH_VERIFY_RATE_LIMIT_IP");
  });

  it("revokes the session token on logout and clears the cookie", async () => {
    sessionMock.parseSessionTokenFromCookieHeader.mockReturnValue("token-1");
    sessionMock.clearSessionCookie.mockReturnValue(
      "kp_session=; Path=/; Max-Age=0",
    );

    const response = await logoutPOST(
      new Request("http://localhost/api/v1/auth/logout", {
        method: "POST",
        headers: {
          cookie: "kp_session=token-1",
        },
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(ensureAuthSchemaBestEffortMock).toHaveBeenCalled();
    expect(sessionMock.revokeSessionByToken).toHaveBeenCalledWith("token-1");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(json.ok).toBe(true);
  });
});

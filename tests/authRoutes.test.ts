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
}));

import { POST as noncePOST } from "../app/api/v1/auth/nonce/route";
import { POST as verifyPOST } from "../app/api/v1/auth/verify/route";
import { POST as logoutPOST } from "../app/api/v1/auth/logout/route";

const walletAddress = "11111111111111111111111111111111";

describe("v1 auth routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(nonceMock.issueAuthNonce).toHaveBeenCalledWith({
      walletAddress,
      origin: "http://localhost:3000",
    });
    expect(json.ok).toBe(true);
    expect(json.data.nonceId).toBe("nonce-1");
  });

  it("verifies a wallet login and sets a session cookie", async () => {
    nonceMock.consumeAuthNonce.mockResolvedValue({
      id: "nonce-1",
      message: "signed-message",
    });
    walletVerifyMock.verifySolanaMessageSignature.mockReturnValue(true);
    authPoolMock.query.mockResolvedValue({
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
    expect(sessionMock.revokeSessionByToken).toHaveBeenCalledWith("token-1");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(json.ok).toBe(true);
  });
});

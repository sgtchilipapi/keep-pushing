ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "primaryWalletAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "walletProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "walletMode" TEXT,
  ADD COLUMN IF NOT EXISTS "authProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "walletVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_primaryWalletAddress_key"
  ON "User" ("primaryWalletAddress")
  WHERE "primaryWalletAddress" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "AuthNonce" (
  "id" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "consumedBySessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthNonce_walletAddress_nonce_key"
  ON "AuthNonce" ("walletAddress", "nonce");
CREATE INDEX IF NOT EXISTS "AuthNonce_expiresAt_idx" ON "AuthNonce" ("expiresAt");
CREATE INDEX IF NOT EXISTS "AuthNonce_walletAddress_createdAt_idx" ON "AuthNonce" ("walletAddress", "createdAt");

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session" ("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_revokedAt_expiresAt_idx" ON "Session" ("userId", "revokedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "Session_walletAddress_revokedAt_expiresAt_idx" ON "Session" ("walletAddress", "revokedAt", "expiresAt");

CREATE TABLE IF NOT EXISTS "SettlementRequest" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "sessionId" TEXT,
  "walletAddress" TEXT NOT NULL,
  "batchId" BIGINT NOT NULL,
  "batchHash" TEXT NOT NULL,
  "prepareMessageHash" TEXT NOT NULL,
  "presignedMessageHash" TEXT,
  "status" TEXT NOT NULL,
  "invalidReasonCode" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "preparedAt" TIMESTAMP(3),
  "presignedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementRequest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SettlementRequest_characterId_idempotencyKey_key"
  ON "SettlementRequest" ("characterId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "SettlementRequest_characterId_status_createdAt_idx"
  ON "SettlementRequest" ("characterId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SettlementRequest_walletAddress_status_createdAt_idx"
  ON "SettlementRequest" ("walletAddress", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "TxAuditLog" (
  "id" TEXT NOT NULL,
  "requestId" TEXT,
  "sessionId" TEXT,
  "userId" TEXT,
  "walletAddress" TEXT,
  "actionType" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "errorCode" TEXT,
  "httpStatus" INTEGER,
  "chainSignature" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TxAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TxAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TxAuditLog_actionType_createdAt_idx" ON "TxAuditLog" ("actionType", "createdAt");
CREATE INDEX IF NOT EXISTS "TxAuditLog_walletAddress_createdAt_idx" ON "TxAuditLog" ("walletAddress", "createdAt");
CREATE INDEX IF NOT EXISTS "TxAuditLog_requestId_idx" ON "TxAuditLog" ("requestId");

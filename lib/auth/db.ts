import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

export const authPool = new Pool(
  connectionString
    ? {
        connectionString,
      }
    : undefined,
);

let ensureAuthSchemaPromise: Promise<void> | null = null;

async function runAuthSchemaStatements(): Promise<void> {
  const statements = [
    `ALTER TABLE "User"
      ADD COLUMN IF NOT EXISTS "primaryWalletAddress" TEXT,
      ADD COLUMN IF NOT EXISTS "walletProvider" TEXT,
      ADD COLUMN IF NOT EXISTS "walletMode" TEXT,
      ADD COLUMN IF NOT EXISTS "authProvider" TEXT,
      ADD COLUMN IF NOT EXISTS "walletVerifiedAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_primaryWalletAddress_key"
      ON "User" ("primaryWalletAddress")
      WHERE "primaryWalletAddress" IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS "AuthNonce" (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "AuthNonce_walletAddress_nonce_key"
      ON "AuthNonce" ("walletAddress", "nonce")`,
    `CREATE INDEX IF NOT EXISTS "AuthNonce_expiresAt_idx" ON "AuthNonce" ("expiresAt")`,
    `CREATE INDEX IF NOT EXISTS "AuthNonce_walletAddress_createdAt_idx"
      ON "AuthNonce" ("walletAddress", "createdAt")`,
    `CREATE TABLE IF NOT EXISTS "Session" (
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
      CONSTRAINT "Session_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session" ("tokenHash")`,
    `CREATE INDEX IF NOT EXISTS "Session_userId_revokedAt_expiresAt_idx"
      ON "Session" ("userId", "revokedAt", "expiresAt")`,
    `CREATE INDEX IF NOT EXISTS "Session_walletAddress_revokedAt_expiresAt_idx"
      ON "Session" ("walletAddress", "revokedAt", "expiresAt")`,
  ];

  for (const statement of statements) {
    await authPool.query(statement);
  }
}

export async function ensureAuthSchema(): Promise<void> {
  if (!ensureAuthSchemaPromise) {
    ensureAuthSchemaPromise = runAuthSchemaStatements().catch((error) => {
      ensureAuthSchemaPromise = null;
      throw error;
    });
  }

  await ensureAuthSchemaPromise;
}

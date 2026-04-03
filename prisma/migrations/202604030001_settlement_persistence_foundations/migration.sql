-- CreateEnum
CREATE TYPE "CharacterChainCreationStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "BattleOutcomeLedgerStatus" AS ENUM ('PENDING', 'SEALED', 'COMMITTED');

-- CreateEnum
CREATE TYPE "SettlementBatchStatus" AS ENUM ('SEALED', 'PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "SettlementSubmissionAttemptStatus" AS ENUM ('STARTED', 'BROADCAST', 'CONFIRMED', 'FAILED', 'TIMEOUT');

-- AlterTable
ALTER TABLE "Character"
ADD COLUMN "playerAuthorityPubkey" TEXT,
ADD COLUMN "chainCharacterIdHex" TEXT,
ADD COLUMN "characterRootPubkey" TEXT,
ADD COLUMN "chainCreationStatus" "CharacterChainCreationStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "chainCreationTxSignature" TEXT,
ADD COLUMN "chainCreatedAt" TIMESTAMP(3),
ADD COLUMN "chainCreationTs" BIGINT,
ADD COLUMN "chainCreationSeasonId" INTEGER,
ADD COLUMN "lastReconciledEndNonce" BIGINT,
ADD COLUMN "lastReconciledStateHash" TEXT,
ADD COLUMN "lastReconciledBatchId" BIGINT,
ADD COLUMN "lastReconciledBattleTs" BIGINT,
ADD COLUMN "lastReconciledSeasonId" INTEGER,
ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BattleOutcomeLedger" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "battleNonce" BIGINT NOT NULL,
    "battleTs" BIGINT NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "enemyArchetypeId" INTEGER NOT NULL,
    "zoneProgressDeltaJson" JSONB NOT NULL,
    "settlementStatus" "BattleOutcomeLedgerStatus" NOT NULL DEFAULT 'PENDING',
    "sealedBatchId" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BattleOutcomeLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBatch" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "batchId" BIGINT NOT NULL,
    "startNonce" BIGINT NOT NULL,
    "endNonce" BIGINT NOT NULL,
    "battleCount" INTEGER NOT NULL,
    "firstBattleTs" BIGINT NOT NULL,
    "lastBattleTs" BIGINT NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "startStateHash" TEXT NOT NULL,
    "endStateHash" TEXT NOT NULL,
    "zoneProgressDeltaJson" JSONB NOT NULL,
    "encounterHistogramJson" JSONB NOT NULL,
    "optionalLoadoutRevision" INTEGER,
    "batchHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "signatureScheme" INTEGER NOT NULL,
    "status" "SettlementBatchStatus" NOT NULL DEFAULT 'SEALED',
    "failureCategory" TEXT,
    "failureCode" TEXT,
    "latestMessageSha256Hex" TEXT,
    "latestSignedTxSha256Hex" TEXT,
    "latestTransactionSignature" TEXT,
    "preparedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementSubmissionAttempt" (
    "id" TEXT NOT NULL,
    "settlementBatchId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "SettlementSubmissionAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "messageSha256Hex" TEXT,
    "signedTransactionSha256Hex" TEXT,
    "transactionSignature" TEXT,
    "rpcError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementSubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Character_chainCharacterIdHex_key" ON "Character"("chainCharacterIdHex");

-- CreateIndex
CREATE UNIQUE INDEX "Character_characterRootPubkey_key" ON "Character"("characterRootPubkey");

-- CreateIndex
CREATE INDEX "Character_chainCreationStatus_idx" ON "Character"("chainCreationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BattleOutcomeLedger_battleId_key" ON "BattleOutcomeLedger"("battleId");

-- CreateIndex
CREATE UNIQUE INDEX "BattleOutcomeLedger_characterId_battleNonce_key" ON "BattleOutcomeLedger"("characterId", "battleNonce");

-- CreateIndex
CREATE INDEX "BattleOutcomeLedger_characterId_settlementStatus_battleNonce_idx" ON "BattleOutcomeLedger"("characterId", "settlementStatus", "battleNonce");

-- CreateIndex
CREATE INDEX "BattleOutcomeLedger_sealedBatchId_idx" ON "BattleOutcomeLedger"("sealedBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementBatch_characterId_batchId_key" ON "SettlementBatch"("characterId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementBatch_characterId_batchHash_key" ON "SettlementBatch"("characterId", "batchHash");

-- CreateIndex
CREATE INDEX "SettlementBatch_characterId_status_batchId_idx" ON "SettlementBatch"("characterId", "status", "batchId");

-- CreateIndex
CREATE INDEX "SettlementBatch_characterId_startNonce_endNonce_idx" ON "SettlementBatch"("characterId", "startNonce", "endNonce");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementSubmissionAttempt_settlementBatchId_attemptNumber_key" ON "SettlementSubmissionAttempt"("settlementBatchId", "attemptNumber");

-- CreateIndex
CREATE INDEX "SettlementSubmissionAttempt_settlementBatchId_status_attemptNumber_idx" ON "SettlementSubmissionAttempt"("settlementBatchId", "status", "attemptNumber");

-- AddForeignKey
ALTER TABLE "BattleOutcomeLedger" ADD CONSTRAINT "BattleOutcomeLedger_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleOutcomeLedger" ADD CONSTRAINT "BattleOutcomeLedger_sealedBatchId_fkey" FOREIGN KEY ("sealedBatchId") REFERENCES "SettlementBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementSubmissionAttempt" ADD CONSTRAINT "SettlementSubmissionAttempt_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "SettlementBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

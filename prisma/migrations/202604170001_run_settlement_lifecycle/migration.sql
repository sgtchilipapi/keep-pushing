CREATE TYPE "RunSettlementStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED');

CREATE TYPE "RunSettlementRequestStatus" AS ENUM (
  'PREPARED',
  'PRESIGNED',
  'SUBMITTED',
  'CONFIRMED',
  'INVALIDATED',
  'FAILED'
);

CREATE TABLE "RunSettlement" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "zoneRunId" TEXT NOT NULL,
  "closedRunSequence" BIGINT NOT NULL,
  "settlementSequence" BIGINT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "prepareMessageHash" TEXT NOT NULL,
  "status" "RunSettlementStatus" NOT NULL DEFAULT 'PREPARED',
  "failureCode" TEXT,
  "latestTransactionSignature" TEXT,
  "preparedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RunSettlement_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RunSettlementRequest" (
  "id" TEXT NOT NULL,
  "runSettlementId" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "sessionId" TEXT,
  "walletAddress" TEXT NOT NULL,
  "zoneRunId" TEXT NOT NULL,
  "settlementSequence" BIGINT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "prepareMessageHash" TEXT NOT NULL,
  "presignedMessageHash" TEXT,
  "status" "RunSettlementRequestStatus" NOT NULL DEFAULT 'PREPARED',
  "invalidReasonCode" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "preparedAt" TIMESTAMP(3),
  "presignedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunSettlementRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RunSettlementRequest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RunSettlementRequest_runSettlementId_fkey" FOREIGN KEY ("runSettlementId") REFERENCES "RunSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RunSettlement_zoneRunId_key" ON "RunSettlement"("zoneRunId");
CREATE UNIQUE INDEX "RunSettlement_characterId_settlementSequence_key" ON "RunSettlement"("characterId", "settlementSequence");
CREATE INDEX "RunSettlement_characterId_status_closedRunSequence_idx" ON "RunSettlement"("characterId", "status", "closedRunSequence");

CREATE UNIQUE INDEX "RunSettlementRequest_characterId_zoneRunId_idempotencyKey_key"
  ON "RunSettlementRequest"("characterId", "zoneRunId", "idempotencyKey");
CREATE INDEX "RunSettlementRequest_characterId_status_createdAt_idx"
  ON "RunSettlementRequest"("characterId", "status", "createdAt");
CREATE INDEX "RunSettlementRequest_walletAddress_status_createdAt_idx"
  ON "RunSettlementRequest"("walletAddress", "status", "createdAt");
CREATE UNIQUE INDEX "RunSettlementRequest_active_runSettlementId_key"
  ON "RunSettlementRequest"("runSettlementId")
  WHERE "status" IN ('PREPARED', 'PRESIGNED', 'SUBMITTED');
CREATE UNIQUE INDEX "RunSettlementRequest_id_presignedMessageHash_key"
  ON "RunSettlementRequest"("id", "presignedMessageHash")
  WHERE "presignedMessageHash" IS NOT NULL;

INSERT INTO "RunSettlement" (
  "id",
  "characterId",
  "zoneRunId",
  "closedRunSequence",
  "settlementSequence",
  "payloadHash",
  "prepareMessageHash",
  "status",
  "failureCode",
  "latestTransactionSignature",
  "preparedAt",
  "submittedAt",
  "confirmedAt",
  "failedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(batch.id || ':' || closed."zoneRunId"),
  closed."characterId",
  closed."zoneRunId",
  closed."closedRunSequence",
  closed."closedRunSequence",
  batch."batchHash",
  COALESCE(batch."latestMessageSha256Hex", ''),
  CASE
    WHEN batch."status" = 'PREPARED' THEN 'PREPARED'::"RunSettlementStatus"
    WHEN batch."status" = 'SUBMITTED' THEN 'SUBMITTED'::"RunSettlementStatus"
    WHEN batch."status" = 'CONFIRMED' THEN 'CONFIRMED'::"RunSettlementStatus"
    ELSE 'FAILED'::"RunSettlementStatus"
  END,
  batch."failureCode",
  batch."latestTransactionSignature",
  batch."preparedAt",
  batch."submittedAt",
  batch."confirmedAt",
  batch."failedAt",
  batch."createdAt",
  batch."updatedAt"
FROM "SettlementBatch" batch
JOIN LATERAL jsonb_array_elements(batch."runSummariesJson") AS summary ON TRUE
JOIN "ClosedZoneRunSummary" closed
  ON closed."characterId" = batch."characterId"
 AND closed."closedRunSequence" = ((summary ->> 'closedRunSequence')::bigint)
WHERE closed."closedRunSequence" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "RunSettlement" existing
    WHERE existing."zoneRunId" = closed."zoneRunId"
  );

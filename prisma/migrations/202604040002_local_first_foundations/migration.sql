-- Local-first battle foundations:
-- 1. provisional DB-backed progression for unsynced characters
-- 2. pre-first-sync battle lifecycle states
-- 3. separate local ordering from final rebased settlement nonce

ALTER TYPE "BattleOutcomeLedgerStatus" ADD VALUE IF NOT EXISTS 'AWAITING_FIRST_SYNC';
ALTER TYPE "BattleOutcomeLedgerStatus" ADD VALUE IF NOT EXISTS 'LOCAL_ONLY_ARCHIVED';

CREATE TABLE "CharacterProvisionalProgress" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "highestUnlockedZoneId" INTEGER NOT NULL,
    "highestClearedZoneId" INTEGER NOT NULL,
    "zoneStatesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterProvisionalProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterProvisionalProgress_characterId_key"
ON "CharacterProvisionalProgress"("characterId");

CREATE INDEX "CharacterProvisionalProgress_highestUnlockedZoneId_highestClearedZo_idx"
ON "CharacterProvisionalProgress"("highestUnlockedZoneId", "highestClearedZoneId");

ALTER TABLE "BattleOutcomeLedger"
ADD COLUMN "localSequence" BIGINT;

UPDATE "BattleOutcomeLedger"
SET "localSequence" = "battleNonce";

ALTER TABLE "BattleOutcomeLedger"
ALTER COLUMN "localSequence" SET NOT NULL,
ALTER COLUMN "battleNonce" DROP NOT NULL;

CREATE UNIQUE INDEX "BattleOutcomeLedger_characterId_localSequence_key"
ON "BattleOutcomeLedger"("characterId", "localSequence");

CREATE INDEX "BattleOutcomeLedger_characterId_settlementStatus_localSequence_idx"
ON "BattleOutcomeLedger"("characterId", "settlementStatus", "localSequence");

INSERT INTO "CharacterProvisionalProgress"
  ("id", "characterId", "highestUnlockedZoneId", "highestClearedZoneId", "zoneStatesJson", "createdAt", "updatedAt")
SELECT
  c."id" || '-provisional',
  c."id",
  1,
  0,
  '{"1":1}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Character" c
LEFT JOIN "CharacterProvisionalProgress" p ON p."characterId" = c."id"
WHERE p."characterId" IS NULL;

ALTER TABLE "CharacterProvisionalProgress"
ADD CONSTRAINT "CharacterProvisionalProgress_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

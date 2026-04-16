ALTER TABLE "ClosedZoneRunSummary"
ADD COLUMN "settleable" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "closedRunSequence" BIGINT,
ADD COLUMN "firstRewardedBattleTs" BIGINT,
ADD COLUMN "lastRewardedBattleTs" BIGINT;

CREATE INDEX "ClosedZoneRunSummary_characterId_settleable_closedRunSequence_idx"
ON "ClosedZoneRunSummary" ("characterId", "settleable", "closedRunSequence");

ALTER TABLE "SettlementBatch"
ADD COLUMN "startRunSequence" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "endRunSequence" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "runCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "runSummariesJson" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX "SettlementBatch_characterId_startRunSequence_endRunSequence_idx"
ON "SettlementBatch" ("characterId", "startRunSequence", "endRunSequence");

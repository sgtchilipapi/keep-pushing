CREATE TYPE "ActiveZoneRunState" AS ENUM ('TRAVERSING', 'AWAITING_BRANCH', 'POST_BATTLE_PAUSE');
CREATE TYPE "ZoneRunTerminalStatus" AS ENUM ('COMPLETED', 'FAILED', 'ABANDONED', 'EXPIRED', 'SEASON_CUTOFF');

ALTER TABLE "BattleRecord"
ADD COLUMN "zoneRunId" TEXT,
ADD COLUMN "nodeId" TEXT,
ADD COLUMN "subnodeId" TEXT,
ADD COLUMN "playerFinalJson" JSONB,
ADD COLUMN "enemyFinalJson" JSONB,
ADD COLUMN "rewardEligible" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "BattleOutcomeLedger"
ADD COLUMN "zoneRunId" TEXT;

CREATE TABLE "ActiveZoneRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "topologyVersion" INTEGER NOT NULL,
    "topologyHash" TEXT NOT NULL,
    "state" "ActiveZoneRunState" NOT NULL,
    "currentNodeId" TEXT NOT NULL,
    "stateJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActiveZoneRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClosedZoneRunSummary" (
    "id" TEXT NOT NULL,
    "zoneRunId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "topologyVersion" INTEGER NOT NULL,
    "topologyHash" TEXT NOT NULL,
    "terminalStatus" "ZoneRunTerminalStatus" NOT NULL,
    "rewardedBattleCount" INTEGER NOT NULL,
    "rewardedEncounterHistogramJson" JSONB NOT NULL,
    "zoneProgressDeltaJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClosedZoneRunSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ZoneRunActionLog" (
    "id" TEXT NOT NULL,
    "zoneRunId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "nodeId" TEXT,
    "subnodeId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZoneRunActionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActiveZoneRun_characterId_key" ON "ActiveZoneRun"("characterId");
CREATE UNIQUE INDEX "ClosedZoneRunSummary_zoneRunId_key" ON "ClosedZoneRunSummary"("zoneRunId");

CREATE INDEX "BattleRecord_characterId_zoneRunId_createdAt_idx" ON "BattleRecord"("characterId", "zoneRunId", "createdAt");
CREATE INDEX "BattleOutcomeLedger_characterId_zoneRunId_localSequence_idx" ON "BattleOutcomeLedger"("characterId", "zoneRunId", "localSequence");
CREATE INDEX "ActiveZoneRun_characterId_zoneId_state_idx" ON "ActiveZoneRun"("characterId", "zoneId", "state");
CREATE INDEX "ClosedZoneRunSummary_characterId_createdAt_idx" ON "ClosedZoneRunSummary"("characterId", "createdAt");
CREATE INDEX "ClosedZoneRunSummary_characterId_zoneId_terminalStatus_idx" ON "ClosedZoneRunSummary"("characterId", "zoneId", "terminalStatus");
CREATE INDEX "ZoneRunActionLog_zoneRunId_createdAt_idx" ON "ZoneRunActionLog"("zoneRunId", "createdAt");
CREATE INDEX "ZoneRunActionLog_characterId_createdAt_idx" ON "ZoneRunActionLog"("characterId", "createdAt");

ALTER TABLE "ActiveZoneRun"
ADD CONSTRAINT "ActiveZoneRun_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosedZoneRunSummary"
ADD CONSTRAINT "ClosedZoneRunSummary_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ZoneRunActionLog"
ADD CONSTRAINT "ZoneRunActionLog_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

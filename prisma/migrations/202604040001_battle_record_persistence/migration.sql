CREATE TABLE "BattleRecord" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "enemyArchetypeId" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,
    "playerInitialJson" JSONB NOT NULL,
    "enemyInitialJson" JSONB NOT NULL,
    "winnerEntityId" TEXT NOT NULL,
    "roundsPlayed" INTEGER NOT NULL,
    "eventsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BattleRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BattleRecord_battleId_key" ON "BattleRecord"("battleId");
CREATE INDEX "BattleRecord_characterId_createdAt_idx" ON "BattleRecord"("characterId", "createdAt");
CREATE INDEX "BattleRecord_characterId_zoneId_enemyArchetypeId_idx" ON "BattleRecord"("characterId", "zoneId", "enemyArchetypeId");

ALTER TABLE "BattleRecord" ADD CONSTRAINT "BattleRecord_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

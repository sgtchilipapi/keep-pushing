CREATE TABLE "ZoneRunMutationDedup" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneRunMutationDedup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ZoneRunMutationDedup_characterId_requestKey_key"
ON "ZoneRunMutationDedup"("characterId", "requestKey");

CREATE INDEX "ZoneRunMutationDedup_characterId_createdAt_idx"
ON "ZoneRunMutationDedup"("characterId", "createdAt");

ALTER TABLE "ZoneRunMutationDedup"
ADD CONSTRAINT "ZoneRunMutationDedup_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

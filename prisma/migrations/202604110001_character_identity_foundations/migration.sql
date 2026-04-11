CREATE TYPE "CharacterNameReservationStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED', 'EXPIRED');

ALTER TABLE "Character"
ADD COLUMN "nameNormalized" TEXT,
ADD COLUMN "classId" TEXT NOT NULL DEFAULT 'soldier',
ADD COLUMN "slotIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "chainBootstrapReady" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Character"
SET "nameNormalized" = lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
WHERE "nameNormalized" IS NULL;

ALTER TABLE "Character"
ALTER COLUMN "nameNormalized" SET NOT NULL;

CREATE TABLE "CharacterNameReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "status" "CharacterNameReservationStatus" NOT NULL DEFAULT 'HELD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterNameReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Character_nameNormalized_idx" ON "Character"("nameNormalized");
CREATE UNIQUE INDEX "Character_userId_slotIndex_key" ON "Character"("userId", "slotIndex");

CREATE INDEX "CharacterNameReservation_normalizedName_active_idx"
ON "CharacterNameReservation"("normalizedName", "active");

CREATE INDEX "CharacterNameReservation_userId_status_expiresAt_idx"
ON "CharacterNameReservation"("userId", "status", "expiresAt");

CREATE UNIQUE INDEX "CharacterNameReservation_active_normalized_name_key"
ON "CharacterNameReservation"("normalizedName")
WHERE "active" = true;

ALTER TABLE "CharacterNameReservation"
ADD CONSTRAINT "CharacterNameReservation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterNameReservation"
ADD CONSTRAINT "CharacterNameReservation_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

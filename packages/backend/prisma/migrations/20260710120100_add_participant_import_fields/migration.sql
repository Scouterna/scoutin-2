-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "importErrors" JSONB,
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "ParticipantGroup" ADD COLUMN     "importErrors" JSONB,
ADD COLUMN     "metadata" JSONB;

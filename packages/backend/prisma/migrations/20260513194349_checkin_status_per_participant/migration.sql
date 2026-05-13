-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "confirmedCheckedInAt" TIMESTAMP(3),
ADD COLUMN     "preliminaryCheckedInAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CheckinSession" ADD COLUMN "kioskId" UUID;

-- AddForeignKey
ALTER TABLE "CheckinSession" ADD CONSTRAINT "CheckinSession_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

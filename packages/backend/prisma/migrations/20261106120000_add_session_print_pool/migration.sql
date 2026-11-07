-- AlterTable
ALTER TABLE "CheckinSession" ADD COLUMN "printPoolId" UUID;

-- AddForeignKey
ALTER TABLE "CheckinSession" ADD CONSTRAINT "CheckinSession_printPoolId_fkey" FOREIGN KEY ("printPoolId") REFERENCES "PrintPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

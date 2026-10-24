-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN     "printPoolId" UUID;

-- CreateTable
CREATE TABLE "PrintRelay" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "hostname" TEXT,
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintRelay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintPool" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "profile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serial" TEXT NOT NULL,
    "name" TEXT,
    "model" TEXT,
    "port" INTEGER,
    "dpi" INTEGER,
    "widthDots" INTEGER,
    "lengthDots" INTEGER,
    "relayId" UUID,
    "poolId" UUID,
    "state" TEXT NOT NULL DEFAULT 'offline',
    "stateDetail" TEXT,
    "stateSeq" BIGINT NOT NULL DEFAULT 0,
    "config" JSONB,
    "configAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "poolId" UUID,
    "targetPrinterId" UUID,
    "source" TEXT NOT NULL,
    "createdById" UUID,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "template" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "sessionId" UUID,
    "kioskId" UUID,
    "reprintOfId" UUID,
    "relayId" UUID,
    "printerId" UUID,
    "leaseId" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leasedAt" TIMESTAMP(3),
    "sendingAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJobEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobId" UUID NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "printerId" UUID,
    "leaseId" UUID,
    "reason" TEXT,
    "actor" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintJobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintRelay_keyHash_key" ON "PrintRelay"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "PrintPool_name_key" ON "PrintPool"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_serial_key" ON "Printer"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_idempotencyKey_key" ON "PrintJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrintJob_poolId_state_createdAt_idx" ON "PrintJob"("poolId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_targetPrinterId_state_createdAt_idx" ON "PrintJob"("targetPrinterId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_printerId_state_idx" ON "PrintJob"("printerId", "state");

-- CreateIndex
CREATE INDEX "PrintJob_relayId_state_idx" ON "PrintJob"("relayId", "state");

-- CreateIndex
CREATE INDEX "PrintJobEvent_jobId_at_idx" ON "PrintJobEvent"("jobId", "at");

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_printPoolId_fkey" FOREIGN KEY ("printPoolId") REFERENCES "PrintPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_relayId_fkey" FOREIGN KEY ("relayId") REFERENCES "PrintRelay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "PrintPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "PrintPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_targetPrinterId_fkey" FOREIGN KEY ("targetPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJobEvent" ADD CONSTRAINT "PrintJobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;


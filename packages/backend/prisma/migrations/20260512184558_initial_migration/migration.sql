-- CreateTable
CREATE TABLE "Kiosk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskSetupToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "KioskSetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configFile" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckinLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configFile" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckinSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinSessionStepData" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stepId" TEXT NOT NULL,
    "idInFlow" TEXT,
    "evaluatedInputs" JSONB NOT NULL,
    "outputs" JSONB,
    "completedAt" TIMESTAMP(3),
    "autoCompleted" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckinSessionStepData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinSubject" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkinSessionId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckinSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinActor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participantId" UUID,
    "sessionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckinActor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lookupValues" TEXT[],
    "dataSource" TEXT NOT NULL,
    "idInDataSource" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "subGroup" TEXT,
    "participantGroupId" UUID,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipantGroup" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dataSource" TEXT NOT NULL,
    "idInDataSource" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ParticipantGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_keyHash_key" ON "Kiosk"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "KioskSetupToken_code_key" ON "KioskSetupToken"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CheckinActor_sessionId_key" ON "CheckinActor"("sessionId");

-- CreateIndex
CREATE INDEX "Participant_lookupValues_idx" ON "Participant" USING GIN ("lookupValues");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_dataSource_idInDataSource_key" ON "Participant"("dataSource", "idInDataSource");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipantGroup_dataSource_idInDataSource_key" ON "ParticipantGroup"("dataSource", "idInDataSource");

-- AddForeignKey
ALTER TABLE "CheckinSessionStepData" ADD CONSTRAINT "CheckinSessionStepData_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CheckinSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinSubject" ADD CONSTRAINT "CheckinSubject_checkinSessionId_fkey" FOREIGN KEY ("checkinSessionId") REFERENCES "CheckinSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinSubject" ADD CONSTRAINT "CheckinSubject_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinActor" ADD CONSTRAINT "CheckinActor_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinActor" ADD CONSTRAINT "CheckinActor_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CheckinSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_participantGroupId_fkey" FOREIGN KEY ("participantGroupId") REFERENCES "ParticipantGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

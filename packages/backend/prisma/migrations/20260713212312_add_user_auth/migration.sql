-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

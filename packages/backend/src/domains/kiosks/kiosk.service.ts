import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../app/prisma.ts";
import { PrismaClientKnownRequestError } from "../../generated/prisma/internal/prismaNamespace.ts";

function isNotFound(e: unknown): boolean {
  return e instanceof PrismaClientKnownRequestError && e.code === "P2025";
}

// Unambiguous uppercase alphanumeric: no 0/O (look alike), no 1/I/L (look alike)
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_EXPIRY_MINUTES = 15;

function generateSetupCode(): string {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function createKioskSetupToken() {
  const code = generateSetupCode();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);
  await prisma.kioskSetupToken.create({ data: { code, expiresAt } });
  return { code, expiresAt };
}

export async function activateKiosk(rawCode: string, name: string) {
  const stripped = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped.length !== 8) {
    return { success: false, error: "Invalid code" } as const;
  }
  const code = `${stripped.slice(0, 4)}-${stripped.slice(4)}`;

  const token = await prisma.kioskSetupToken.findUnique({ where: { code } });

  if (!token) return { success: false, error: "Invalid code" } as const;
  if (token.usedAt)
    return { success: false, error: "Code already used" } as const;
  if (token.expiresAt < new Date())
    return { success: false, error: "Code expired" } as const;

  const key = randomBytes(32).toString("hex");
  const keyHash = hashKey(key);

  const kiosk = await prisma.$transaction(async (tx) => {
    const kiosk = await tx.kiosk.create({
      data: { name, keyHash },
    });
    await tx.kioskSetupToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });
    return kiosk;
  });

  return { success: true, key, kioskId: kiosk.id } as const;
}

export async function validateKioskKey(key: string): Promise<boolean> {
  const keyHash = hashKey(key);
  try {
    await prisma.kiosk.update({
      where: { keyHash },
      data: { lastSeenAt: new Date() },
      select: { id: true },
    });
    return true;
  } catch (e) {
    if (!isNotFound(e))
      console.error("Unexpected error in validateKioskKey:", e);
    return false;
  }
}

export async function renameKiosk(id: string, name: string) {
  try {
    return await prisma.kiosk.update({
      where: { id },
      data: { name },
      select: { id: true, name: true },
    });
  } catch (e) {
    if (!isNotFound(e)) console.error("Unexpected error in renameKiosk:", e);
    return null;
  }
}

export async function deleteKiosk(id: string): Promise<boolean> {
  try {
    await prisma.kiosk.delete({ where: { id } });
    return true;
  } catch (e) {
    if (!isNotFound(e)) console.error("Unexpected error in deleteKiosk:", e);
    return false;
  }
}

export async function listKiosks() {
  return prisma.kiosk.findMany({
    select: { id: true, name: true, lastSeenAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

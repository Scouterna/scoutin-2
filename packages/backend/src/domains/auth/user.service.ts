import { prisma } from "../../app/prisma.ts";
import config from "../../config/config.ts";
import { logger } from "../../core/logging/logger.ts";
import { hashPassword, verifyPassword } from "./password.ts";

const log = logger.child({ module: "auth" });

const ADMIN_ROLE = "admin";

/** A user without the password hash - safe to return to clients. */
export interface SafeUser {
  id: string;
  username: string;
  roles: string[];
  createdAt: Date;
}

const SAFE_SELECT = {
  id: true,
  username: true,
  roles: true,
  createdAt: true,
} as const;

/** Thrown when an operation would remove the last account holding the admin
 * role, which would lock everyone out. Routes translate this to a 409. */
export class LastAdminError extends Error {
  constructor() {
    super("Cannot remove the last admin");
    this.name = "LastAdminError";
  }
}

function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { roles: { has: ADMIN_ROLE } } });
}

export async function verifyCredentials(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

export function listUsers(): Promise<SafeUser[]> {
  return prisma.user.findMany({
    select: SAFE_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

export async function createUser(input: {
  username: string;
  password: string;
  roles: string[];
}): Promise<SafeUser> {
  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      username: input.username,
      passwordHash,
      roles: input.roles,
    },
    select: SAFE_SELECT,
  });
}

export async function updateUser(
  id: string,
  input: { roles: string[] },
): Promise<SafeUser> {
  // Guard against demoting the last admin out of the admin role.
  if (!input.roles.includes(ADMIN_ROLE)) {
    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.roles.includes(ADMIN_ROLE) && (await countAdmins()) <= 1) {
      throw new LastAdminError();
    }
  }
  return prisma.user.update({
    where: { id },
    data: { roles: input.roles },
    select: SAFE_SELECT,
  });
}

export async function resetPassword(
  id: string,
  newPassword: string,
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}

export async function deleteUser(id: string): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id } });
  if (target?.roles.includes(ADMIN_ROLE) && (await countAdmins()) <= 1) {
    throw new LastAdminError();
  }
  await prisma.user.delete({ where: { id } });
}

/** On boot: seed a default admin from BOOTSTRAP_ADMIN_USERNAME/PASSWORD if the
 * user table is empty. Idempotent - does nothing once any user exists. */
export async function ensureDefaultAdmin(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;

  const username = config.BOOTSTRAP_ADMIN_USERNAME;
  const password = config.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) {
    log.warn(
      "No users exist and BOOTSTRAP_ADMIN_USERNAME/BOOTSTRAP_ADMIN_PASSWORD " +
        "are unset - nobody can log in. Set them to bootstrap an admin account.",
    );
    return;
  }

  await createUser({
    username,
    password,
    roles: [ADMIN_ROLE],
  });
  log.info({ username }, "Seeded default admin account");
}

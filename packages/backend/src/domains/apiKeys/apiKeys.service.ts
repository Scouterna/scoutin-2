import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { prisma } from "../../app/prisma.ts";
import { hashSecret, readBearerToken } from "../../core/auth/secrets.ts";
import { getLogger } from "../../core/logging/logger.ts";
import type { AppEnv } from "../../core/websocket/types.ts";
import { recordAudit } from "../audit/audit.service.ts";

export const API_PERMISSIONS = ["participants:read"] as const;
export type ApiPermission = (typeof API_PERMISSIONS)[number];

/** Swedish labels for the admin UI, one per permission. */
export const API_PERMISSION_LABELS: Record<ApiPermission, string> = {
  "participants:read": "Läsa deltagare och incheckningsstatus",
};

export type AuthenticatedApiKey = {
  id: string;
  name: string;
  permissions: ApiPermission[];
};

const KEY_PREFIX = "sci_";
const KEY_PREFIX_SHOWN_LENGTH = 12;

const ADMIN_SELECT = {
  id: true,
  name: true,
  prefix: true,
  permissions: true,
  createdBy: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

function isApiPermission(value: string): value is ApiPermission {
  return (API_PERMISSIONS as readonly string[]).includes(value);
}

export function listApiPermissions() {
  return API_PERMISSIONS.map((permission) => ({
    permission,
    label: API_PERMISSION_LABELS[permission],
  }));
}

/** Creates a key. The raw key is returned here and never again. */
export async function createApiKey(input: {
  name: string;
  permissions: ApiPermission[];
  createdBy: string | null;
}) {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiKey.create({
    data: {
      name: input.name,
      prefix: key.slice(0, KEY_PREFIX_SHOWN_LENGTH),
      keyHash: hashSecret(key),
      permissions: input.permissions,
      createdBy: input.createdBy,
    },
    select: ADMIN_SELECT,
  });
  return { ...row, key };
}

export async function listApiKeys() {
  return prisma.apiKey.findMany({
    select: ADMIN_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

/** Returns null when the key doesn't exist. */
export async function updateApiKey(
  id: string,
  patch: { name?: string; permissions?: ApiPermission[] },
) {
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) return null;
  return prisma.apiKey.update({
    where: { id },
    data: { name: patch.name, permissions: patch.permissions },
    select: ADMIN_SELECT,
  });
}

/** Returns null when the key doesn't exist. Revoking twice keeps the first date. */
export async function revokeApiKey(id: string) {
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.revokedAt) {
    return prisma.apiKey.findUniqueOrThrow({
      where: { id },
      select: ADMIN_SELECT,
    });
  }
  return prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: ADMIN_SELECT,
  });
}

/**
 * The key's identity and permissions, or null for an unknown or revoked key.
 * Permission strings that are no longer in API_PERMISSIONS grant nothing.
 * Updates `lastUsedAt` on every call.
 */
export async function authenticateApiKey(
  key: string,
): Promise<AuthenticatedApiKey | null> {
  const row = await prisma.apiKey.findFirst({
    where: { keyHash: hashSecret(key), revokedAt: null },
    select: { id: true, name: true, permissions: true },
  });
  if (!row) return null;
  await prisma.apiKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return {
    id: row.id,
    name: row.name,
    permissions: row.permissions.filter(isApiPermission),
  };
}

export const requireApiKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readBearerToken(c.req.header("authorization"));
  const apiKey = token ? await authenticateApiKey(token) : null;
  if (!apiKey) {
    getLogger(c).warn("Public API request without a valid API key");
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("apiKey", apiKey);
  c.set("logger", getLogger(c).child({ apiKeyId: apiKey.id }));
  await next();
};

/**
 * 403 when the key lacks `permission`. The denial is audited under
 * `auditAction`, with no participant, since the key is known here.
 */
export function requirePermission(
  permission: ApiPermission,
  auditAction: string,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const apiKey = c.get("apiKey");
    if (!apiKey?.permissions.includes(permission)) {
      if (apiKey) {
        await recordAudit({
          actor: `api-key:${apiKey.id}`,
          action: auditAction,
          details: { participantId: null },
        });
      }
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  };
}

import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { Hono } from "hono";
import type { AppEnv } from "../../core/websocket/types.ts";
import { recordAudit } from "../audit/audit.service.ts";
import { getAuthUser } from "../auth/auth.service.ts";
import {
  API_PERMISSIONS,
  createApiKey,
  listApiKeys,
  listApiPermissions,
  revokeApiKey,
  updateApiKey,
} from "./apiKeys.service.ts";

const Permission = type.enumerated(...API_PERMISSIONS);
// A key with no permissions can do nothing; removing all of them is revoking.
const Permissions = Permission.array().atLeastLength(1);

const CreateBody = type({
  name: "string > 0",
  permissions: Permissions,
});

const UpdateBody = type({
  "name?": "string > 0",
  "permissions?": Permissions,
});

/** Guarded by requireAdmin (mounted under the admin router in app/admin.ts). */
export const apiKeysAdminRouter = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json({ apiKeys: await listApiKeys() });
  })
  .get("/permissions", (c) => {
    return c.json({ permissions: listApiPermissions() });
  })
  .post("/", arktypeValidator("json", CreateBody), async (c) => {
    const body = c.req.valid("json");
    const { key, ...apiKey } = await createApiKey({
      ...body,
      createdBy: getAuthUser(c).username,
    });
    await recordAudit({
      actor: getAuthUser(c).username,
      action: "api-key.create",
      details: {
        apiKeyId: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
      },
    });
    return c.json({ apiKey, key }, 201);
  })
  .patch("/:id", arktypeValidator("json", UpdateBody), async (c) => {
    const apiKey = await updateApiKey(c.req.param("id"), c.req.valid("json"));
    if (!apiKey) return c.json({ error: "Not found" }, 404);
    await recordAudit({
      actor: getAuthUser(c).username,
      action: "api-key.update",
      details: {
        apiKeyId: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
      },
    });
    return c.json({ apiKey });
  })
  .post("/:id/revoke", async (c) => {
    const apiKey = await revokeApiKey(c.req.param("id"));
    if (!apiKey) return c.json({ error: "Not found" }, 404);
    await recordAudit({
      actor: getAuthUser(c).username,
      action: "api-key.revoke",
      details: {
        apiKeyId: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
      },
    });
    return c.json({ apiKey });
  });

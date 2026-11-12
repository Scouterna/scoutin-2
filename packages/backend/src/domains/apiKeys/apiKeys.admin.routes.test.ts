import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../core/websocket/types.ts";

const recordAudit = vi.fn();
const createApiKey = vi.fn();
const updateApiKey = vi.fn();
const revokeApiKey = vi.fn();
const listApiKeys = vi.fn();

vi.mock("../audit/audit.service.ts", () => ({ recordAudit }));
vi.mock("../auth/auth.service.ts", () => ({
  getAuthUser: (c: { get: (k: string) => unknown }) => c.get("user"),
}));
vi.mock("./apiKeys.service.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apiKeys.service.ts")>()),
  createApiKey,
  updateApiKey,
  revokeApiKey,
  listApiKeys,
}));
vi.mock("../../app/prisma.ts", () => ({ prisma: {} }));
vi.mock("../../config/config.ts", () => ({ default: { NODE_ENV: "test" } }));

const { apiKeysAdminRouter } = await import("./apiKeys.admin.routes.ts");

const app = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    c.set("user", { sub: "u1", username: "alice", roles: ["admin"] });
    await next();
  })
  .route("/", apiKeysAdminRouter);

const row = {
  id: "k1",
  name: "App",
  prefix: "sci_abcd1234",
  permissions: ["participants:read"],
  createdBy: "alice",
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
};

function post(path: string, body: unknown, method = "POST") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /", () => {
  it("returns the key once and audits without it", async () => {
    createApiKey.mockResolvedValue({ ...row, key: "sci_secretsecret" });

    const res = await post("/", {
      name: "App",
      permissions: ["participants:read"],
    });
    const body = (await res.json()) as { key: string };

    expect(res.status).toBe(201);
    expect(body.key).toBe("sci_secretsecret");
    expect(createApiKey).toHaveBeenCalledWith({
      name: "App",
      permissions: ["participants:read"],
      createdBy: "alice",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      actor: "alice",
      action: "api-key.create",
      details: {
        apiKeyId: "k1",
        name: "App",
        permissions: ["participants:read"],
      },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain(
      "sci_secretsecret",
    );
  });

  it("rejects an unknown permission", async () => {
    const res = await post("/", { name: "App", permissions: ["nope"] });
    expect(res.status).toBe(400);
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("rejects a key with no permissions", async () => {
    const res = await post("/", { name: "App", permissions: [] });
    expect(res.status).toBe(400);
    expect(createApiKey).not.toHaveBeenCalled();
  });
});

describe("GET /", () => {
  it("lists keys", async () => {
    listApiKeys.mockResolvedValue([row]);
    const res = await app.request("/");
    expect(((await res.json()) as { apiKeys: unknown[] }).apiKeys).toHaveLength(
      1,
    );
  });
});

describe("GET /permissions", () => {
  it("lists permissions with labels", async () => {
    const res = await app.request("/permissions");
    expect(await res.json()).toEqual({
      permissions: [
        {
          permission: "participants:read",
          label: "Läsa deltagare och incheckningsstatus",
        },
      ],
    });
  });
});

describe("PATCH /:id", () => {
  it("updates and audits", async () => {
    updateApiKey.mockResolvedValue({ ...row, name: "Renamed" });

    const res = await post("/k1", { name: "Renamed" }, "PATCH");

    expect(res.status).toBe(200);
    expect(updateApiKey).toHaveBeenCalledWith("k1", { name: "Renamed" });
    expect(recordAudit.mock.calls[0]?.[0].action).toBe("api-key.update");
  });

  it("rejects removing every permission", async () => {
    const res = await post("/k1", { permissions: [] }, "PATCH");
    expect(res.status).toBe(400);
    expect(updateApiKey).not.toHaveBeenCalled();
  });

  it("is 404 for an unknown key, without audit", async () => {
    updateApiKey.mockResolvedValue(null);
    const res = await post("/nope", { name: "x" }, "PATCH");
    expect(res.status).toBe(404);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("POST /:id/revoke", () => {
  it("revokes and audits", async () => {
    revokeApiKey.mockResolvedValue({ ...row, revokedAt: new Date() });

    const res = await app.request("/k1/revoke", { method: "POST" });

    expect(res.status).toBe(200);
    expect(recordAudit.mock.calls[0]?.[0].action).toBe("api-key.revoke");
  });

  it("is 404 for an unknown key", async () => {
    revokeApiKey.mockResolvedValue(null);
    const res = await app.request("/nope/revoke", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiKeyFindFirst = vi.fn();
const apiKeyUpdate = vi.fn();
const apiKeyCreate = vi.fn();
const recordAudit = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: {
    apiKey: {
      findFirst: apiKeyFindFirst,
      update: apiKeyUpdate,
      create: apiKeyCreate,
    },
  },
}));
vi.mock("../../config/config.ts", () => ({ default: { NODE_ENV: "test" } }));
vi.mock("../audit/audit.service.ts", () => ({ recordAudit }));

const { hashSecret } = await import("../../core/auth/secrets.ts");
const { authenticateApiKey, createApiKey, requireApiKey, requirePermission } =
  await import("./apiKeys.service.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createApiKey", () => {
  it("stores only the hash and returns the raw key once", async () => {
    apiKeyCreate.mockImplementation(async ({ data }) => ({
      id: "k1",
      ...data,
    }));

    const result = await createApiKey({
      name: "App",
      permissions: ["participants:read"],
      createdBy: "admin",
    });

    expect(result.key).toMatch(/^sci_[A-Za-z0-9_-]{43}$/);
    const data = apiKeyCreate.mock.calls[0]?.[0].data;
    expect(data.keyHash).toBe(hashSecret(result.key));
    expect(data.prefix).toBe(result.key.slice(0, 12));
    expect(JSON.stringify(data)).not.toContain(result.key);
  });
});

describe("authenticateApiKey", () => {
  it("returns the key and updates lastUsedAt on every call", async () => {
    apiKeyFindFirst.mockResolvedValue({
      id: "k1",
      name: "App",
      permissions: ["participants:read"],
    });

    for (let i = 0; i < 2; i++) {
      expect(await authenticateApiKey("sci_good")).toEqual({
        id: "k1",
        name: "App",
        permissions: ["participants:read"],
      });
    }

    expect(apiKeyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { keyHash: hashSecret("sci_good"), revokedAt: null },
      }),
    );
    expect(apiKeyUpdate).toHaveBeenCalledTimes(2);
    expect(apiKeyUpdate.mock.calls[0]?.[0].data.lastUsedAt).toBeInstanceOf(
      Date,
    );
  });

  it("returns null for an unknown or revoked key", async () => {
    apiKeyFindFirst.mockResolvedValue(null);

    expect(await authenticateApiKey("sci_unknown")).toBeNull();
    expect(apiKeyUpdate).not.toHaveBeenCalled();
  });

  it("drops permission strings that are no longer defined", async () => {
    apiKeyFindFirst.mockResolvedValue({
      id: "k1",
      name: "App",
      permissions: ["participants:read", "participants:write"],
    });

    expect((await authenticateApiKey("sci_good"))?.permissions).toEqual([
      "participants:read",
    ]);
  });
});

function makeApp() {
  return new Hono()
    .use("*", requireApiKey)
    .get("/read", requirePermission("participants:read", "test.read"), (c) =>
      c.json({ ok: true }),
    );
}

describe("requireApiKey", () => {
  it("is 401 without a header, with another scheme, and with an unknown key", async () => {
    apiKeyFindFirst.mockResolvedValue(null);
    const app = makeApp();

    const cases: Record<string, string>[] = [
      {},
      { Authorization: "Basic abc" },
      { Authorization: "Bearer sci_unknown" },
    ];
    for (const headers of cases) {
      const res = await app.request("/read", { headers });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("requirePermission", () => {
  it("passes a key with the permission", async () => {
    apiKeyFindFirst.mockResolvedValue({
      id: "k1",
      name: "App",
      permissions: ["participants:read"],
    });

    const res = await makeApp().request("/read", {
      headers: { Authorization: "Bearer sci_good" },
    });

    expect(res.status).toBe(200);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("is 403 and audited for a key without it", async () => {
    apiKeyFindFirst.mockResolvedValue({
      id: "k1",
      name: "App",
      permissions: [],
    });

    const res = await makeApp().request("/read", {
      headers: { Authorization: "Bearer sci_good" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(recordAudit).toHaveBeenCalledWith({
      actor: "api-key:k1",
      action: "test.read",
      details: { participantId: null },
    });
  });

  it("grants nothing for a stale permission string", async () => {
    apiKeyFindFirst.mockResolvedValue({
      id: "k1",
      name: "App",
      permissions: ["participants:write"],
    });

    const res = await makeApp().request("/read", {
      headers: { Authorization: "Bearer sci_good" },
    });

    expect(res.status).toBe(403);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const findUnique = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: { kiosk: { update, findUnique } },
}));
vi.mock("../../core/logging/logger.ts", () => ({
  logger: { error: vi.fn() },
}));

const { kiosksRouter } = await import("./kiosks.routes.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /me", () => {
  it("rejects a request without a key", async () => {
    const res = await kiosksRouter.request("/me");
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an unknown key", async () => {
    update.mockRejectedValue(new Error("not found"));
    const res = await kiosksRouter.request("/me", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("returns the kiosk name and its print pool", async () => {
    update.mockResolvedValue({ id: "k1" });
    findUnique.mockResolvedValue({
      name: "Desk 1",
      printPool: {
        name: "Entrance",
        printers: [{ serial: "A1", name: null, state: "ready" }],
        _count: { jobs: 2 },
      },
    });

    const res = await kiosksRouter.request("/me", {
      headers: { Authorization: "Bearer key" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Desk 1",
      printPool: {
        name: "Entrance",
        printers: [{ serial: "A1", name: null, state: "ready" }],
        queued: 2,
      },
    });
  });
});

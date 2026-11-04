import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: { checkinSession: { findUnique } },
}));
vi.mock("../../config/config.ts", () => ({
  default: { TOKEN_SECRET: "test-secret" },
}));
vi.mock("../workflows/step.service.ts", () => ({
  getStepStatuses: vi.fn(),
}));

const { sessionsAdminRouter } = await import("./sessions.admin.routes.ts");
const { verifyJWT, signJWT } = await import("./tokens.ts");
const { createSessionToken } = await import("./session.service.ts");
beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /:id/token", () => {
  it("issues a staff token", async () => {
    findUnique.mockResolvedValue({ id: "s4" });

    const res = await sessionsAdminRouter.request("/s4/token", {
      method: "POST",
    });
    const { token } = (await res.json()) as { token: string };
    const verified = await verifyJWT(token);

    expect(verified.valid && verified.payload["urn:scoutin:role"]).toBe(
      "staff",
    );
  });
});

describe("session tokens", () => {
  it("defaults to kiosk", async () => {
    const verified = await verifyJWT(await createSessionToken("s4"));
    expect(verified.valid && verified.payload["urn:scoutin:role"]).toBe(
      "kiosk",
    );
  });

  it("still verifies a token issued before roles existed", async () => {
    const verified = await verifyJWT(
      await signJWT({ "urn:scoutin:sessionId": "s4" }),
    );
    expect(verified.valid).toBe(true);
    expect(verified.valid && verified.payload["urn:scoutin:role"]).toBe(
      undefined,
    );
  });
});

import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

vi.mock("./prisma.ts", () => ({ prisma: { user: { findUnique } } }));
vi.mock("../config/config.ts", () => ({
  default: { TOKEN_SECRET: "test-secret", NODE_ENV: "test" },
}));
vi.mock("../core/jobs/jobRunner.ts", () => ({
  DATA_IMPORT_JOB: "data-import",
  jobRunner: {
    list: () => [{ name: "data-import" }],
    runNow: vi.fn().mockResolvedValue(undefined),
  },
}));

// These read files or env at import time; the routes under test don't use them.
vi.mock("../domains/participants/data.service.ts", () => ({}));
vi.mock("../domains/blocklist/blocklist.service.ts", () => ({}));

const { adminRouter } = await import("./admin.ts");

async function cookieFor(userId: string) {
  const token = await new SignJWT()
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("urn:scoutin:admin-session")
    .setAudience("urn:scoutin:admin-session")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("test-secret"));
  return `admin_session=${token}`;
}

function asRole(role: string) {
  findUnique.mockResolvedValue({ id: "u1", username: "u", roles: [role] });
  return cookieFor("u1");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin route guards for operators", () => {
  it("can list jobs", async () => {
    const res = await adminRouter.request("/jobs", {
      headers: { Cookie: await asRole("operator") },
    });
    expect(res.status).toBe(200);
  });

  it("can run a job", async () => {
    const res = await adminRouter.request("/jobs/data-import/run", {
      method: "POST",
      headers: { Cookie: await asRole("operator") },
    });
    expect(res.status).toBe(202);
  });

  it("can trigger a reimport", async () => {
    const res = await adminRouter.request("/participants/reimport", {
      method: "POST",
      headers: { Cookie: await asRole("operator") },
    });
    expect(res.status).toBe(204);
  });

  it("is still kept out of admin-only paths", async () => {
    const res = await adminRouter.request("/users", {
      headers: { Cookie: await asRole("operator") },
    });
    expect(res.status).toBe(403);
  });
});

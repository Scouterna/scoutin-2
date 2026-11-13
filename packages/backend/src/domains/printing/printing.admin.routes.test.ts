import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const printerAction = vi.fn();
const getPrinter = vi.fn();
const recordAudit = vi.fn();

class RelayActionError extends Error {}

vi.mock("../../app/prisma.ts", () => ({ prisma: {} }));
vi.mock("../../core/logging/logger.ts", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock("./dispatch.service.ts", () => ({ dispatch: vi.fn() }));
vi.mock("./relay.socket.ts", () => ({
  printerAction,
  relayAction: vi.fn(),
  RelayActionError,
}));
vi.mock("./printers.service.ts", () => ({
  getPrinter,
  createPool: vi.fn(),
  deletePool: vi.fn(),
  listPools: vi.fn(),
  listPrinters: vi.fn(),
  listRelays: vi.fn(),
  renameRelay: vi.fn(),
  revokeRelay: vi.fn(),
  setKioskPool: vi.fn(),
  updatePool: vi.fn(),
  updatePrinter: vi.fn(),
}));
vi.mock("../audit/audit.service.ts", () => ({ recordAudit }));
vi.mock("../auth/auth.service.ts", () => ({
  getAuthUser: () => ({ username: "admin" }),
}));

const { printingAdminRouter } = await import("./printing.admin.routes.ts");
const { loadProfiles } = await import("./profiles.service.ts");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "profiles-routes-test-"));
  const file = join(dir, "profiles.yml");
  await writeFile(
    file,
    'badge:\n  media.speed: "3.0"\n  print.tone: "15.0"\nother:\n  media.speed: "4.0"\n',
  );
  const status = await loadProfiles(file);
  expect(status.problems).toEqual([]);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  printerAction.mockResolvedValue({ ok: true });
});

function post(body: unknown, id = "p1") {
  return printingAdminRouter.request(`/printers/${id}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const printerWith = (pool: { profile: string | null } | null) => ({
  id: "p1",
  serial: "SN1",
  pool,
});

describe("POST /printers/:id/actions applyProfile", () => {
  it("uses the pool's profile and sends exactly its settings", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: "badge" }));
    const res = await post({ kind: "applyProfile" });
    expect(res.status).toBe(200);
    expect(printerAction).toHaveBeenCalledWith("SN1", "applyProfile", {
      "media.speed": "3.0",
      "print.tone": "15.0",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      actor: "admin",
      action: "printing.printer.applyProfile",
      details: { printerId: "p1", profile: "badge", ok: true },
    });
  });

  it("lets an explicit profile override the pool's", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: "badge" }));
    const res = await post({ kind: "applyProfile", profile: "other" });
    expect(res.status).toBe(200);
    expect(printerAction).toHaveBeenCalledWith("SN1", "applyProfile", {
      "media.speed": "4.0",
    });
    expect(recordAudit.mock.calls[0]?.[0].details.profile).toBe("other");
  });

  it("works with an explicit profile when there is no pool", async () => {
    getPrinter.mockResolvedValue(printerWith(null));
    const res = await post({ kind: "applyProfile", profile: "other" });
    expect(res.status).toBe(200);
  });

  it("returns 404 for an unknown printer", async () => {
    getPrinter.mockResolvedValue(null);
    const res = await post({ kind: "applyProfile", profile: "badge" });
    expect(res.status).toBe(404);
    expect(printerAction).not.toHaveBeenCalled();
  });

  it("returns 400 when the printer has no pool", async () => {
    getPrinter.mockResolvedValue(printerWith(null));
    const res = await post({ kind: "applyProfile" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no pool");
    expect(printerAction).not.toHaveBeenCalled();
  });

  it("returns 400 when the pool has no profile", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: null }));
    const res = await post({ kind: "applyProfile" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("pool has no profile");
    expect(printerAction).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown profile and names it", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: "missing" }));
    const res = await post({ kind: "applyProfile" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('"missing"');
    expect(printerAction).not.toHaveBeenCalled();
  });

  it("never passes client-sent settings to the printer", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: "badge" }));
    const res = await post({
      kind: "applyProfile",
      settings: { "device.languages": "none" },
    });
    if (res.status === 200) {
      expect(printerAction).toHaveBeenCalledWith("SN1", "applyProfile", {
        "media.speed": "3.0",
        "print.tone": "15.0",
      });
    } else {
      expect(printerAction).not.toHaveBeenCalled();
    }
  });

  it("maps a disconnected printer to 409", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: "badge" }));
    printerAction.mockRejectedValue(new RelayActionError("not connected"));
    const res = await post({ kind: "applyProfile" });
    expect(res.status).toBe(409);
  });
});

describe("POST /printers/:id/actions other kinds", () => {
  it("still runs calibrate without a profile", async () => {
    getPrinter.mockResolvedValue(printerWith(null));
    const res = await post({ kind: "calibrate" });
    expect(res.status).toBe(200);
    expect(printerAction).toHaveBeenCalledWith("SN1", "calibrate");
  });

  it("still runs cancelBuffer", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: "badge" }));
    const res = await post({ kind: "cancelBuffer" });
    expect(res.status).toBe(200);
    expect(printerAction).toHaveBeenCalledWith("SN1", "cancelBuffer");
  });

  it("rejects a profile on calibrate", async () => {
    getPrinter.mockResolvedValue(printerWith({ profile: "badge" }));
    const res = await post({ kind: "calibrate", profile: "badge" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("only applies to applyProfile");
    expect(printerAction).not.toHaveBeenCalled();
  });
});

describe("GET /profiles", () => {
  it("lists the loaded profiles and the problems", async () => {
    const res = await printingAdminRouter.request("/profiles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      profiles: [
        {
          name: "badge",
          settings: { "media.speed": "3.0", "print.tone": "15.0" },
        },
        { name: "other", settings: { "media.speed": "4.0" } },
      ],
      problems: [],
    });
  });
});

import { type } from "arktype";
import { describe, expect, it, vi } from "vitest";

const createRelay = vi.fn();
vi.mock("../../app/prisma.ts", () => ({
  prisma: { printRelay: { create: createRelay } },
}));

const {
  listPendingEnrollments,
  lookupEnrollment,
  pairEnrollment,
  pickColors,
  pollEnrollment,
  startEnrollment,
  PAIRING_COLORS,
} = await import("./enrollment.service.ts");
const { relayMessages } = await import("./protocol.ts");
const { pngSize, render, RenderError } = await import("./render.ts");

// Just a PNG signature and IHDR chunk: enough for pngSize and render.
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 1; // bit depth
  return b;
}

describe("protocol", () => {
  it("accepts hello with null lists, as Go sends empty slices", () => {
    const h = relayMessages.hello({
      version: "abc",
      hostname: "pi",
      printers: null,
      journal: null,
    });
    if (h instanceof type.errors) throw new Error(h.summary);
    expect(h.printers).toEqual([]);
    expect(h.journal).toEqual([]);
  });

  it("parses a hello with printers and a journal", () => {
    const h = relayMessages.hello({
      version: "abc",
      hostname: "pi",
      printers: [{ serial: "D8J1", product: "ZD421", port: 2 }],
      journal: [
        {
          serial: "D8J1",
          jobId: "j",
          leaseId: "l",
          phase: "intent",
          counterBefore: 18234,
        },
      ],
    });
    if (h instanceof type.errors) throw new Error(h.summary);
    expect(h.printers[0]?.port).toBe(2);
    expect(h.journal[0]?.phase).toBe("intent");
  });

  it("rejects a journal entry with an unknown phase", () => {
    const h = relayMessages.hello({
      version: "abc",
      hostname: "pi",
      printers: [],
      journal: [{ serial: "D8J1", jobId: "j", leaseId: "l", phase: "maybe" }],
    });
    expect(h).toBeInstanceOf(type.errors);
  });

  it("parses an action result with per-setting results", () => {
    const r = relayMessages["printer:actionResult"]({
      actionId: "a",
      serial: "D8J1",
      ok: false,
      results: { "ezpl.tear_off": { applied: false, value: "34" } },
    });
    expect(r).not.toBeInstanceOf(type.errors);
  });
});

describe("pairing codes", () => {
  it("picks four palette colors, avoiding taken codes", () => {
    // All but one of the 625 codes taken: it must find the free one.
    const all: string[] = [];
    for (const a of PAIRING_COLORS)
      for (const b of PAIRING_COLORS)
        for (const c of PAIRING_COLORS)
          for (const d of PAIRING_COLORS) all.push([a, b, c, d].join(","));
    const free = "pink,white,yellow,red";
    const taken = new Set(all.filter((c) => c !== free));
    expect(pickColors(taken).join(",")).toBe(free);
  });
});

describe("enrollment", () => {
  it("pairs by colors and hands the key over once", async () => {
    const started = startEnrollment({ hostname: "pi", printers: [], ip: null });
    if (started === "rate_limited") throw new Error("rate limited");
    const { enrollmentId, secret, colors } = started;

    expect(pollEnrollment(enrollmentId, "wrong")).toBe("unauthorized");
    expect(pollEnrollment(enrollmentId, secret)).toEqual({ status: "pending" });
    expect(lookupEnrollment(colors)?.hostname).toBe("pi");
    // The pending list never carries the colors.
    expect(listPendingEnrollments()[0]).not.toHaveProperty("colors");

    createRelay.mockImplementation(async ({ data }) => ({
      id: "r1",
      name: data.name,
      hostname: data.hostname,
    }));
    const [first, second] = await Promise.all([
      pairEnrollment(colors, "Desk 1"),
      pairEnrollment(colors, "Desk 1"),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(createRelay).toHaveBeenCalledTimes(1);
    expect(lookupEnrollment(colors)).toBeNull();

    const paired = pollEnrollment(enrollmentId, secret);
    expect(paired).toMatchObject({ status: "paired" });
    expect(pollEnrollment(enrollmentId, secret)).toBe("not_found");
  });

  it("frees the colors again when creating the relay fails", async () => {
    const started = startEnrollment({
      hostname: "pi2",
      printers: [],
      ip: null,
    });
    if (started === "rate_limited") throw new Error("rate limited");
    createRelay.mockRejectedValueOnce(new Error("db down"));
    await expect(pairEnrollment(started.colors, "x")).rejects.toThrow();
    expect(lookupEnrollment(started.colors)?.hostname).toBe("pi2");
  });
});

describe("render", () => {
  it("reads the size from the PNG header", () => {
    expect(pngSize(pngHeader(832, 1224))).toEqual({ width: 832, height: 1224 });
  });

  it("rejects what isn't a PNG", () => {
    expect(() => pngSize(Buffer.from("not a png at all, really not"))).toThrow(
      RenderError,
    );
  });

  it("renders the png template from base64", async () => {
    const png = pngHeader(100, 50);
    const r = await render("png", { png: png.toString("base64") });
    expect(r).toMatchObject({ width: 100, height: 50 });
    expect(r.png.equals(png)).toBe(true);
  });

  it("fails unknown templates and missing values permanently", async () => {
    await expect(render("badge", {})).rejects.toThrow(RenderError);
    await expect(render("png", {})).rejects.toThrow(RenderError);
  });
});

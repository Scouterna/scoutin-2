import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; idempotencyKey: string; state: string };
let rows: Row[] = [];
let nextId = 0;
const sessionFindUnique = vi.fn();
const jobEventCreate = vi.fn();
const jobFindFirst = vi.fn();
const jobUpdateMany = vi.fn();

const tx = {
  printJob: {
    create: async ({ data }: { data: { idempotencyKey: string } }) => {
      const row = { ...data, id: `j${nextId++}`, state: "queued" };
      rows.push(row);
      return row;
    },
    findFirst: jobFindFirst,
    updateMany: jobUpdateMany,
  },
  printJobEvent: { create: jobEventCreate },
};
vi.mock("../../app/prisma.ts", () => ({
  prisma: {
    checkinSession: { findUnique: sessionFindUnique },
    printJob: {
      findMany: async ({
        where,
      }: {
        where: { idempotencyKey: { startsWith: string } };
      }) =>
        rows.filter((r) =>
          r.idempotencyKey.startsWith(where.idempotencyKey.startsWith),
        ),
    },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));
vi.mock("../../core/logging/logger.ts", () => ({
  logger: { error: vi.fn() },
}));

const { createJobsForStep, listJobsForStep, parseStepJobKey } = await import(
  "./step-print.service.ts"
);
const { onJobFinished, transition } = await import("./jobs.service.ts");

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  nextId = 0;
  sessionFindUnique.mockResolvedValue({
    kioskId: "k1",
    kiosk: { printPoolId: "p1" },
  });
});

const args = (stepKey = "badge", items: object[] = [{ a: 1 }, { a: 2 }]) => ({
  sessionId: "s1",
  stepKey,
  template: "badge",
  items,
});

describe("createJobsForStep", () => {
  it("returns no-pool without a kiosk", async () => {
    sessionFindUnique.mockResolvedValue({ kioskId: null, kiosk: null });
    expect(await createJobsForStep(args())).toEqual({
      ok: false,
      reason: "no-pool",
    });
    expect(rows).toHaveLength(0);
  });

  it("returns no-pool when the kiosk has no pool", async () => {
    sessionFindUnique.mockResolvedValue({
      kioskId: "k1",
      kiosk: { printPoolId: null },
    });
    expect((await createJobsForStep(args())).ok).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("creates one job per item", async () => {
    const r = await createJobsForStep(args());
    expect(r.ok && r.jobs.map((j) => j.idempotencyKey)).toEqual([
      "s1:badge:0",
      "s1:badge:1",
    ]);
  });

  it("creates no duplicates when run twice, and returns all jobs", async () => {
    await createJobsForStep(args());
    const r = await createJobsForStep(
      args("badge", [{ a: 1 }, { a: 2 }, { a: 3 }]),
    );
    expect(rows).toHaveLength(3);
    expect(r.ok && r.jobs).toHaveLength(3);
  });
});

describe("listJobsForStep", () => {
  it("does not match a step whose key has this one as a prefix", async () => {
    await createJobsForStep(args("badge", [{}]));
    await createJobsForStep(args("badge2", [{}, {}]));
    expect(await listJobsForStep("s1", "badge")).toHaveLength(1);
    expect(await listJobsForStep("s1", "badge2")).toHaveLength(2);
  });

  it("does not match a step whose key continues with a colon", async () => {
    await createJobsForStep(args("badge", [{}]));
    await createJobsForStep(args("badge:extra", [{}, {}]));
    expect(await listJobsForStep("s1", "badge")).toHaveLength(1);
    expect(await listJobsForStep("s1", "badge:extra")).toHaveLength(2);
  });

  it("orders by index numerically", async () => {
    await createJobsForStep(
      args(
        "b",
        Array.from({ length: 11 }, () => ({})),
      ),
    );
    rows.reverse();
    const keys = (await listJobsForStep("s1", "b")).map(
      (j) => j.idempotencyKey,
    );
    expect(keys[2]).toBe("s1:b:2");
    expect(keys[10]).toBe("s1:b:10");
  });
});

describe("onJobFinished", () => {
  beforeEach(() => {
    jobFindFirst.mockResolvedValue({
      state: "sending",
      printerId: null,
      leaseId: null,
      sessionId: "s1",
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("fires on finishing transitions only", async () => {
    const listener = vi.fn();
    const off = onJobFinished(listener);
    await transition({ jobId: "j", from: ["queued"], to: "leased" });
    expect(listener).not.toHaveBeenCalled();
    await transition({ jobId: "j", from: ["sending"], to: "printed" });
    expect(listener).toHaveBeenCalledWith({
      jobId: "j",
      sessionId: "s1",
      state: "printed",
    });
    off();
    await transition({ jobId: "j", from: ["sending"], to: "failed" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the transition did not move", async () => {
    const listener = vi.fn();
    const off = onJobFinished(listener);
    jobFindFirst.mockResolvedValue(null);
    expect(
      await transition({ jobId: "j", from: ["sending"], to: "printed" }),
    ).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("a throwing listener breaks neither the transition nor the others", async () => {
    const bad = vi.fn().mockRejectedValue(new Error("boom"));
    const good = vi.fn();
    const offBad = onJobFinished(bad);
    const offGood = onJobFinished(good);
    expect(
      await transition({ jobId: "j", from: ["sending"], to: "canceled" }),
    ).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});

describe("parseStepJobKey", () => {
  it("parses a step key with colons", () => {
    expect(parseStepJobKey("s1:printer:print:3")).toEqual({
      sessionId: "s1",
      stepKey: "printer:print",
      index: 3,
    });
  });

  it("returns null without trailing digits or for null", () => {
    expect(parseStepJobKey("s1:badge:x")).toBeNull();
    expect(parseStepJobKey("s1:badge")).toBeNull();
    expect(parseStepJobKey(null)).toBeNull();
  });

  it("round-trips the key createJobsForStep writes", async () => {
    await createJobsForStep(args("a:b", [{ a: 1 }, { a: 2 }]));
    expect(parseStepJobKey(rows[1]?.idempotencyKey ?? null)).toEqual({
      sessionId: "s1",
      stepKey: "a:b",
      index: 1,
    });
  });
});

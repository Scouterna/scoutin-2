// Admin API for printing (docs/printer-proxy-spec.md): pairing relays,
// printers and pools, and jobs.
import { arktypeValidator } from "@hono/arktype-validator";
import { type } from "arktype";
import { type Context, Hono } from "hono";
import { getLogger } from "../../core/logging/logger.ts";
import type { AppEnv } from "../../core/websocket/types.ts";
import { PrismaClientKnownRequestError } from "../../generated/prisma/internal/prismaNamespace.ts";
import { recordAudit } from "../audit/audit.service.ts";
import { getAuthUser } from "../auth/auth.service.ts";
import { dispatch } from "./dispatch.service.ts";
import {
  listPendingEnrollments,
  lookupEnrollment,
  PAIRING_COLORS,
  pairEnrollment,
} from "./enrollment.service.ts";
import {
  cancelJob,
  createJobs,
  getJob,
  JOB_STATES,
  listJobs,
  type NewJob,
  resolveUnknown,
} from "./jobs.service.ts";
import {
  createPool,
  deletePool,
  getPrinter,
  listPools,
  listPrinters,
  listRelays,
  renameRelay,
  revokeRelay,
  setKioskPool,
  updatePool,
  updatePrinter,
} from "./printers.service.ts";
import {
  printerAction,
  RelayActionError,
  relayAction,
} from "./relay.socket.ts";
import { PNG_TEMPLATE, pngSize, RenderError } from "./render.ts";

const Color = type.enumerated(...PAIRING_COLORS);
// Admin enters the four colors in LED order.
const CodeEntry = type({ colors: Color.array().exactlyLength(4) });
const PairBody = CodeEntry.and({ name: "string > 0" });
const NameBody = type({ name: "string > 0" });
const RelayActionBody = type({ kind: "'reboot' | 'poweroff'" });
const PrinterActionBody = type({
  kind: "'applyProfile' | 'calibrate' | 'cancelBuffer'",
  "settings?": { "[string]": "string" },
});
const PrinterPatch = type({
  "name?": "string | null",
  "poolId?": "string.uuid | null",
});
const PoolBody = type({ name: "string > 0", "profile?": "string | null" });
const PoolPatch = type({ "name?": "string > 0", "profile?": "string | null" });
const KioskPoolBody = type({ poolId: "string.uuid | null" });
const JobsQuery = type({
  "state?": type.enumerated(...JOB_STATES),
  "poolId?": "string.uuid",
  "printerId?": "string.uuid",
});
// A ready-made 1-bit PNG, base64, to a pool or one printer. Until the
// template renderer exists, this is how admin prints.
const PngJobBody = type({
  png: "string > 0",
  "copies?": "1 <= number.integer <= 50",
}).and(type({ poolId: "string.uuid" }).or({ printerId: "string.uuid" }));
const ResolveBody = type({ resolution: "'printed' | 'dismissed'" });

/** Runs a relay/printer action, audits it, and maps "not connected" to 409. */
async function runAction(
  c: Context<AppEnv>,
  action: string,
  details: Record<string, string>,
  run: () => Promise<{ ok: boolean }>,
) {
  try {
    const result = await run();
    await recordAudit({
      actor: getAuthUser(c).username,
      action,
      details: { ...details, ok: result.ok },
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof RelayActionError)
      return c.json({ error: err.message }, 409);
    throw err;
  }
}

export const printingAdminRouter = new Hono<AppEnv>()
  // ── Relays and pairing ──
  .get("/relays", async (c) => c.json({ relays: await listRelays() }))
  .patch("/relays/:id", arktypeValidator("json", NameBody), async (c) => {
    const relay = await renameRelay(
      c.req.param("id"),
      c.req.valid("json").name,
    );
    if (!relay) return c.json({ error: "Relay not found" }, 404);
    return c.json(relay);
  })
  .post("/relays/:id/revoke", async (c) => {
    const relay = await revokeRelay(c.req.param("id"));
    if (!relay) return c.json({ error: "Relay not found" }, 404);
    await recordAudit({
      actor: getAuthUser(c).username,
      action: "printing.relay.revoke",
      details: { relayId: relay.id },
    });
    return c.body(null, 204);
  })
  .post(
    "/relays/:id/actions",
    arktypeValidator("json", RelayActionBody),
    async (c) => {
      const { kind } = c.req.valid("json");
      const relayId = c.req.param("id");
      return runAction(c, `printing.relay.${kind}`, { relayId }, () =>
        relayAction(relayId, kind),
      );
    },
  )
  // Finds the enrollment a code belongs to, so admin can confirm the hostname
  // and printers before pairing. Never lists codes.
  .post("/pairing/lookup", arktypeValidator("json", CodeEntry), async (c) => {
    const found = lookupEnrollment(c.req.valid("json").colors);
    if (!found) return c.json({ error: "No relay is showing that code" }, 404);
    return c.json(found);
  })
  .post("/pairing", arktypeValidator("json", PairBody), async (c) => {
    const body = c.req.valid("json");
    const relay = await pairEnrollment(body.colors, body.name);
    if (!relay) return c.json({ error: "No relay is showing that code" }, 404);
    await recordAudit({
      actor: getAuthUser(c).username,
      action: "printing.relay.pair",
      details: {
        relayId: relay.id,
        name: relay.name,
        hostname: relay.hostname,
      },
    });
    return c.json(relay, 201);
  })
  .get("/pairing/pending", (c) => c.json({ pending: listPendingEnrollments() }))

  // ── Printers ──
  .get("/printers", async (c) => c.json({ printers: await listPrinters() }))
  .patch("/printers/:id", arktypeValidator("json", PrinterPatch), async (c) => {
    const printer = await updatePrinter(c.req.param("id"), c.req.valid("json"));
    if (!printer) return c.json({ error: "Printer not found" }, 404);
    // A printer joining a pool may have that pool's queue to take on.
    dispatch();
    return c.json(printer);
  })
  .post(
    "/printers/:id/actions",
    arktypeValidator("json", PrinterActionBody),
    async (c) => {
      const body = c.req.valid("json");
      if (body.kind === "applyProfile" && !body.settings) {
        return c.json({ error: "applyProfile needs settings" }, 400);
      }
      const printer = await getPrinter(c.req.param("id"));
      if (!printer) return c.json({ error: "Printer not found" }, 404);
      return runAction(
        c,
        `printing.printer.${body.kind}`,
        { printerId: printer.id },
        () => printerAction(printer.serial, body.kind, body.settings),
      );
    },
  )

  // ── Pools ──
  .get("/pools", async (c) => c.json({ pools: await listPools() }))
  .post("/pools", arktypeValidator("json", PoolBody), async (c) => {
    try {
      return c.json(await createPool(c.req.valid("json")), 201);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === "P2002")
        return c.json({ error: "A pool with that name exists" }, 409);
      throw err;
    }
  })
  .patch("/pools/:id", arktypeValidator("json", PoolPatch), async (c) => {
    const pool = await updatePool(c.req.param("id"), c.req.valid("json"));
    if (!pool) return c.json({ error: "Pool not found" }, 404);
    return c.json(pool);
  })
  .delete("/pools/:id", async (c) => {
    const result = await deletePool(c.req.param("id"));
    if (result === "has_jobs") {
      return c.json(
        { error: "The pool still has jobs; move or cancel them" },
        409,
      );
    }
    if (!result) return c.json({ error: "Pool not found" }, 404);
    return c.body(null, 204);
  })
  .put(
    "/kiosks/:id/pool",
    arktypeValidator("json", KioskPoolBody),
    async (c) => {
      const kiosk = await setKioskPool(
        c.req.param("id"),
        c.req.valid("json").poolId,
      );
      if (!kiosk) return c.json({ error: "Kiosk not found" }, 404);
      return c.json(kiosk);
    },
  )

  // ── Jobs ──
  .get("/jobs", arktypeValidator("query", JobsQuery), async (c) =>
    c.json({ jobs: await listJobs(c.req.valid("query")) }),
  )
  .get("/jobs/:id", async (c) => {
    const job = await getJob(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  })
  .post("/jobs/png", arktypeValidator("json", PngJobBody), async (c) => {
    const body = c.req.valid("json");
    try {
      // The header is all pngSize reads; skip decoding the whole image.
      pngSize(Buffer.from(body.png.slice(0, 32), "base64"));
    } catch (err) {
      if (err instanceof RenderError)
        return c.json({ error: err.message }, 400);
      throw err;
    }
    const user = getAuthUser(c);
    const target =
      "poolId" in body
        ? { poolId: body.poolId }
        : { targetPrinterId: body.printerId };
    const job: NewJob = {
      template: PNG_TEMPLATE,
      values: { png: body.png },
      source: "admin",
      createdById: user.sub,
      ...target,
    };
    const jobs = await createJobs(
      Array.from({ length: body.copies ?? 1 }, () => job),
      user.username,
    );
    getLogger(c).info(
      { jobs: jobs.length, ...target },
      "Admin print jobs queued",
    );
    dispatch();
    return c.json(
      { jobs: jobs.map((j) => ({ id: j.id, state: j.state })) },
      201,
    );
  })
  .post("/jobs/:id/cancel", async (c) => {
    const ok = await cancelJob(
      c.req.param("id"),
      getAuthUser(c).username,
    ).catch(() => false);
    if (!ok) return c.json({ error: "Only queued jobs can be canceled" }, 409);
    return c.body(null, 204);
  })
  .post(
    "/jobs/:id/resolve",
    arktypeValidator("json", ResolveBody),
    async (c) => {
      const ok = await resolveUnknown(
        c.req.param("id"),
        c.req.valid("json").resolution,
        getAuthUser(c).username,
      ).catch(() => false);
      if (!ok)
        return c.json({ error: "Only unknown jobs can be resolved" }, 409);
      return c.body(null, 204);
    },
  );

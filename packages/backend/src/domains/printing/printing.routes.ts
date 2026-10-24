// Public relay endpoints: enrollment (docs/printer-proxy-spec.md) and the
// expected relay version. No admin session; relays authenticate with
// their enrollment secret where needed.

import { arktypeValidator } from "@hono/arktype-validator";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type } from "arktype";
import { Hono } from "hono";
import config from "../../config/config.ts";
import { getLogger } from "../../core/logging/logger.ts";
import type { AppEnv } from "../../core/websocket/types.ts";
import { pollEnrollment, startEnrollment } from "./enrollment.service.ts";
import { PrinterInfo } from "./protocol.ts";

const EnrollBody = type({
  hostname: "string",
  printers: PrinterInfo.array().or("null"),
});

// Bundles are the GitHub Releases the CI publishes (build-image.yml).
const RELEASES = "https://github.com/Scouterna/scoutin-2/releases/download";

export const printingRouter = new Hono<AppEnv>()
  .post("/enroll", arktypeValidator("json", EnrollBody), (c) => {
    const body = c.req.valid("json");
    // Behind the ingress, the client is the first X-Forwarded-For hop.
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      getConnInfo(c).remote.address ||
      null;
    const result = startEnrollment({
      hostname: body.hostname,
      printers: body.printers ?? [],
      ip,
    });
    if (result === "rate_limited") {
      return c.json({ error: "too many enrollments" }, 429);
    }
    getLogger(c).info(
      { enrollmentId: result.enrollmentId, hostname: body.hostname, ip },
      "Print relay enrollment started",
    );
    return c.json(result, 201);
  })
  .get("/enroll/:id", (c) => {
    const secret = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!secret) return c.json({ error: "missing secret" }, 401);
    const result = pollEnrollment(c.req.param("id"), secret);
    if (result === "not_found") return c.json({ error: "not found" }, 404);
    if (result === "unauthorized")
      return c.json({ error: "wrong secret" }, 401);
    return c.json(result);
  })
  // The relay version this server expects, for `printer-proxy update`.
  // Public, so it works before pairing too.
  .get("/version", (c) => {
    const version = config.PRINT_RELAY_VERSION;
    const sha256 = config.PRINT_RELAY_SHA256;
    if (!version || !sha256) return c.json({ error: "no relay version" }, 404);
    const file = `printer-proxy-${version}-linux-arm64.tar.gz`;
    return c.json({
      version,
      url: `${RELEASES}/printer-proxy/${version}/${file}`,
      sha256,
    });
  });

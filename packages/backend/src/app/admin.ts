import { Hono } from "hono";
import { kiosksAdminRouter } from "../domains/kiosks/kiosks.admin.routes.ts";
import { participantsAdminRouter } from "../domains/participants/participants.admin.routes.ts";
import { reportsAdminRouter } from "../domains/participants/reports.admin.routes.ts";
import { linksAdminRouter } from "../domains/sessions/links.admin.routes.ts";
import { sessionsAdminRouter } from "../domains/sessions/sessions.admin.routes.ts";

export const adminRouter = new Hono()
  .route("/sessions", sessionsAdminRouter)
  .route("/kiosks", kiosksAdminRouter)
  .route("/links", linksAdminRouter)
  .route("/participants", participantsAdminRouter)
  .route("/reports", reportsAdminRouter);

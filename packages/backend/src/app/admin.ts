import { Hono } from "hono";
import { kiosksAdminRouter } from "../domains/kiosks/kiosks.admin.routes.ts";
import { linksAdminRouter } from "../domains/sessions/links.admin.routes.ts";
import { sessionsAdminRouter } from "../domains/sessions/sessions.admin.routes.ts";

export const adminRouter = new Hono()
  .route("/sessions", sessionsAdminRouter)
  .route("/kiosks", kiosksAdminRouter)
  .route("/links", linksAdminRouter);

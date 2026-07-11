import { Hono } from "hono";
import { requireAdminAuth } from "../domains/admin/adminAuth.service.ts";
import { kiosksAdminRouter } from "../domains/kiosks/kiosks.admin.routes.ts";
import { participantsAdminRouter } from "../domains/participants/participants.admin.routes.ts";
import { reportsAdminRouter } from "../domains/participants/reports.admin.routes.ts";
import { linksAdminRouter } from "../domains/sessions/links.admin.routes.ts";
import { sessionsAdminRouter } from "../domains/sessions/sessions.admin.routes.ts";

// Guards every route below - login/logout live outside this router entirely
// (see app.ts, mounted at /api/admin/auth) so they stay reachable when
// there's no session yet.
export const adminRouter = new Hono()
  .use("*", requireAdminAuth)
  .get("/me", (c) => c.json({ authenticated: true }))
  .route("/sessions", sessionsAdminRouter)
  .route("/kiosks", kiosksAdminRouter)
  .route("/links", linksAdminRouter)
  .route("/participants", participantsAdminRouter)
  .route("/reports", reportsAdminRouter);

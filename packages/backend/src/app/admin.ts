import { Hono } from "hono";
import type { AppEnv } from "../core/websocket/types.ts";
import { requireAdmin, requireStaff } from "../domains/auth/auth.service.ts";
import { usersAdminRouter } from "../domains/auth/users.admin.routes.ts";
import { blocklistAdminRouter } from "../domains/blocklist/blocklist.admin.routes.ts";
import { jobsAdminRouter } from "../domains/jobs/jobs.admin.routes.ts";
import { kiosksAdminRouter } from "../domains/kiosks/kiosks.admin.routes.ts";
import { participantsAdminRouter } from "../domains/participants/participants.admin.routes.ts";
import { reportsAdminRouter } from "../domains/participants/reports.admin.routes.ts";
import { linksAdminRouter } from "../domains/sessions/links.admin.routes.ts";
import { sessionsAdminRouter } from "../domains/sessions/sessions.admin.routes.ts";

// Two roles: "operator" (day-to-day check-in: reports, sessions, undo-checkin)
// and "admin" (everything, incl. user/kiosk/link management, data reimport, and
// the anonymity-sensitive blocklist). requireStaff gates the whole API to any
// logged-in panel user; the extra requireAdmin guards below narrow the sensitive
// paths to admins. Authentication is local (username/password → session cookie);
// the unguarded /api/admin/auth/me endpoint tells the frontend when to log in.
export const adminRouter = new Hono<AppEnv>()
  .use("*", requireStaff)
  .use("/users/*", requireAdmin)
  .use("/kiosks/*", requireAdmin)
  .use("/links/*", requireAdmin)
  .use("/blocklist/*", requireAdmin)
  .use("/jobs/*", requireAdmin)
  .use("/participants/reimport", requireAdmin)
  .get("/me", (c) => c.json({ authenticated: true, user: c.get("user") }))
  .route("/users", usersAdminRouter)
  .route("/sessions", sessionsAdminRouter)
  .route("/kiosks", kiosksAdminRouter)
  .route("/links", linksAdminRouter)
  .route("/participants", participantsAdminRouter)
  .route("/jobs", jobsAdminRouter)
  .route("/reports", reportsAdminRouter)
  .route("/blocklist", blocklistAdminRouter);

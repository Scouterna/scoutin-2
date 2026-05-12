import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { cors } from "hono/cors";
import config from "../config/config.ts";
import { kiosksRouter } from "../domains/kiosks/kiosks.routes.ts";
import { loadAllDataSourcesIntoDatabase } from "../domains/participants/data.service.ts";
import { sessionRouter } from "../domains/sessions/session.routes.ts";
import { router as sessionSocketRouter } from "../domains/sessions/session.socket.ts";
import { stepRouter } from "../domains/workflows/step.routes.ts";
import { loadPlugins } from "../domains/workflows/steps.ts";
import { adminRouter } from "./admin.ts";
import { activeWebSocketConnections, registry } from "./metrics.ts";

// TODO: Move this to a job runner
await loadAllDataSourcesIntoDatabase();

// Load plugins before creating the app
await loadPlugins();

const app = config.BASE_PATH
  ? (new Hono().basePath(config.BASE_PATH || "/") as Hono)
  : new Hono();

const { printMetrics, registerMetrics } = prometheus({
  registry,
});

app.use("*", registerMetrics);
app.get("/metrics", printMetrics);

if (config.NODE_ENV === "development") {
  app.use("/api/*", cors());
}

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

if (config.NODE_ENV === "production") {
  // Serve frontend static assets. Registered before API routes so requests
  // for existing files (including /) are handled immediately. Non-file paths
  // fall through (next()) and are caught by API routes or the SPA fallback.
  app.use(serveStatic({ root: "./public" }));
}

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

const routes = app
  .route("/api/session", sessionRouter)
  .route("/api/step", stepRouter)
  .route("/api/admin", adminRouter)
  .route("/api/kiosk", kiosksRouter)
  .get(
    "/ws/session",
    upgradeWebSocket(async (c) => {
      // Simulate delay for testing purposes
      // await new Promise((resolve) => setTimeout(resolve, 1500));

      activeWebSocketConnections.inc();

      return {
        onMessage: sessionSocketRouter.onMessage(c),
        onClose() {
          activeWebSocketConnections.dec();
          console.log("WebSocket connection closed");
          c.get("wsUnregister")?.();
        },
      };
    }),
  );

if (config.NODE_ENV === "production") {
  // SPA fallback: return index.html for any path not matched above (client-side routes).
  app.use(
    serveStatic({ root: "./public", rewriteRequestPath: () => "/index.html" }),
  );
}

export { app, injectWebSocket };
export type AppType = typeof routes;

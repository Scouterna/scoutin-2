import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { cors } from "hono/cors";
import config from "../config/config.ts";
import { getLogger, logger } from "../core/logging/logger.ts";
import type { AppEnv } from "../core/websocket/types.ts";
import { kiosksRouter } from "../domains/kiosks/kiosks.routes.ts";
import { sessionRouter } from "../domains/sessions/session.routes.ts";
import { router as sessionSocketRouter } from "../domains/sessions/session.socket.ts";
import { stepRouter } from "../domains/workflows/step.routes.ts";
import { loadPlugins } from "../domains/workflows/steps.ts";
import { adminRouter } from "./admin.ts";
import { activeWebSocketConnections, registry } from "./metrics.ts";

// Load plugins before creating the app
await loadPlugins();

const app = config.BASE_PATH
  ? (new Hono<AppEnv>().basePath(config.BASE_PATH || "/") as Hono<AppEnv>)
  : new Hono<AppEnv>();

const { printMetrics, registerMetrics } = prometheus({
  registry,
});

app.use("*", registerMetrics);
app.get("/metrics", printMetrics);

app.use("/api/*", async (c, next) => {
  const reqId = crypto.randomUUID();
  const reqLogger = logger.child({
    reqId,
    method: c.req.method,
    path: c.req.path,
  });
  c.set("reqId", reqId);
  c.set("logger", reqLogger);

  await next();

  const status = c.res.status;
  const logLine = status >= 500 ? "error" : status >= 400 ? "warn" : "debug";
  reqLogger[logLine]({ status }, "Request completed");
});

if (config.NODE_ENV === "development") {
  app.use("/api/*", cors());
}

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const basePath = config.BASE_PATH;

if (config.NODE_ENV === "production") {
  // serveStatic uses c.req.path (full URL path), not the basePath-relative path,
  // so we must strip the prefix manually.
  app.use(
    serveStatic({
      root: "./public",
      rewriteRequestPath: basePath ? (p) => p.replace(basePath, "") : undefined,
    }),
  );
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

      const connId = crypto.randomUUID();
      c.set("connId", connId);
      c.set("logger", logger.child({ connId }));

      getLogger(c).info("WebSocket connection opened");
      activeWebSocketConnections.inc();

      return {
        onMessage: sessionSocketRouter.onMessage(c),
        onClose() {
          activeWebSocketConnections.dec();
          getLogger(c).info("WebSocket connection closed");
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

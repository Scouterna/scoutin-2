import { serve } from "@hono/node-server";
import config, { loadConfig } from "./config/config.ts";

loadConfig();

async function main() {
  // Use dynamic import to make sure config is loaded before app is imported
  const { app, injectWebSocket } = await import("./app/app.ts");
  const { logger } = await import("./core/logging/logger.ts");
  const { jobRunner, DATA_IMPORT_JOB, CHECKIN_WRITEBACK_JOB } = await import(
    "./core/jobs/jobRunner.ts"
  );
  // Dynamic import (like app.ts above): data.service reads config at module
  // evaluation time, so it must not be imported until after loadConfig() ran.
  const { loadAllDataSourcesIntoDatabase, writeBackAllDataSources } =
    await import("./domains/participants/data.service.ts");

  const server = serve(
    {
      fetch: app.fetch,
      port: config.PORT,
      hostname: "0.0.0.0",
    },
    (info) => {
      logger.info(`Server is running on http://localhost:${info.port}`);
    },
  );

  injectWebSocket(server);

  // Recurring jobs. Both handlers are idempotent and no-arg. The runner guards
  // against a job overlapping itself (and against a manual reimport overlapping
  // the scheduled one, since the reimport route triggers the same job via
  // runNow), isolates per-run errors, and drains in-flight runs on shutdown.
  // An intervalMs of 0 disables scheduling for that job (manual-only).
  jobRunner.register({
    name: DATA_IMPORT_JOB,
    intervalMs: config.DATA_IMPORT_INTERVAL_MS,
    handler: loadAllDataSourcesIntoDatabase,
  });
  jobRunner.register({
    name: CHECKIN_WRITEBACK_JOB,
    intervalMs: config.CHECKIN_SYNC_INTERVAL_MS,
    handler: writeBackAllDataSources,
  });
  jobRunner.start();

  // Graceful shutdown: stop accepting connections and drain both in-flight
  // HTTP/WS connections (server.close) and in-flight jobs, so we don't cut a
  // check-in or exit mid-import. A hard backstop guarantees the process exits
  // within the grace window even if a connection or job refuses to settle
  // (safe: the jobs are idempotent and heal next run). Runtime-agnostic —
  // works the same under k8s (SIGTERM) or a plain process (Ctrl-C).
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    const forceExit = setTimeout(() => {
      logger.warn({}, "Shutdown grace period exceeded, forcing exit");
      process.exit(0);
    }, config.SHUTDOWN_GRACE_MS);
    forceExit.unref();

    const closeConnections = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await Promise.all([
      closeConnections,
      jobRunner.stop({ deadlineMs: config.SHUTDOWN_GRACE_MS }),
    ]);

    clearTimeout(forceExit);
    logger.info({}, "Shutdown complete");
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

await main();

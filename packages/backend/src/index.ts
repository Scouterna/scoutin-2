import { serve } from "@hono/node-server";
import config, { loadConfig } from "./config/config.ts";
import type { Logger } from "./core/logging/logger.ts";

loadConfig();

async function main() {
  // Use dynamic import to make sure config is loaded before app is imported
  const { app, injectWebSocket } = await import("./app/app.ts");
  const { logger } = await import("./core/logging/logger.ts");

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

  await startCheckinWriteBack(logger);
}

/**
 * Periodically pushes check-in state back to data-source providers. Runs only
 * from the real server entry (not tests). Skips a tick if the previous run is
 * still in flight, and a run's failure never stops the schedule. Set
 * CHECKIN_SYNC_INTERVAL_MS to 0 to disable.
 */
async function startCheckinWriteBack(logger: Logger) {
  const intervalMs = config.CHECKIN_SYNC_INTERVAL_MS;
  if (intervalMs <= 0) {
    logger.info(
      {},
      "Check-in write-back disabled (CHECKIN_SYNC_INTERVAL_MS=0)",
    );
    return;
  }

  // Dynamic import (like app.ts above): data.service reads config at module
  // evaluation time, so it must not be imported until after loadConfig() has
  // run in main(). Imported once here, not per tick.
  const { writeBackAllDataSources } = await import(
    "./domains/participants/data.service.ts"
  );

  let running = false;
  setInterval(async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      await writeBackAllDataSources();
    } catch (err) {
      logger.error({ err }, "Check-in write-back cycle failed");
    } finally {
      running = false;
    }
  }, intervalMs);

  logger.info({ intervalMs }, "Check-in write-back scheduled");
}

await main();

import { serve } from "@hono/node-server";
import config, { loadConfig } from "./config.ts";

loadConfig();

async function main() {
  // Use dynamic import to make sure config is loaded before app is imported
  const { app, injectWebSocket } = await import("./app.ts");

  const server = serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      console.log(`Server is running on http://localhost:${info.port}`);
    },
  );

  injectWebSocket(server);
}

await main();

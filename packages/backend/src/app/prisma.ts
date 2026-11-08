import { PrismaPg } from "@prisma/adapter-pg";
import config from "../config/config.ts";
import { PrismaClient } from "../generated/prisma/client.ts";

// The pg driver adapter ignores `?schema=` in the URL, so the schema is passed
// explicitly. prisma.config.ts applies the same DATABASE_SCHEMA to migrations.
const adapter = new PrismaPg(
  { connectionString: config.DATABASE_URL },
  { schema: config.DATABASE_SCHEMA },
);
export const prisma = new PrismaClient({
  adapter,
  // log: ["query", "info", "warn", "error"],
});

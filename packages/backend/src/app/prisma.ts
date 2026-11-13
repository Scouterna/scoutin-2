import { PrismaPg } from "@prisma/adapter-pg";
import config from "../config/config.ts";
import { PrismaClient } from "../generated/prisma/client.ts";

// The pg driver adapter ignores `?schema=` in the URL, so the schema is passed
// explicitly. prisma.config.ts applies the same DATABASE_SCHEMA to migrations.
// The adapter's `schema` only qualifies Prisma's own queries; search_path makes
// raw SQL ($queryRaw) resolve unqualified tables in the same schema.
const adapter = new PrismaPg(
  {
    connectionString: config.DATABASE_URL,
    options: `-c search_path=${config.DATABASE_SCHEMA}`,
  },
  { schema: config.DATABASE_SCHEMA },
);
export const prisma = new PrismaClient({
  adapter,
  // log: ["query", "info", "warn", "error"],
});

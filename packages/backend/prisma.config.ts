import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { assertNoSchemaConflict } from "./src/config/databaseSchema.ts";

// The Prisma CLI picks the Postgres schema from `?schema=` in the URL. Set it
// from DATABASE_SCHEMA so migrations land where the app looks (see
// src/config/databaseSchema.ts).
// biome-ignore lint/style/noProcessEnv: the CLI config loads outside the app config (src/config/config.ts), and Prisma's env() throws when unset.
const schema = process.env.DATABASE_SCHEMA || "public";
assertNoSchemaConflict(env("DATABASE_URL"), schema);
const url = new URL(env("DATABASE_URL"));
url.searchParams.set("schema", schema);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: url.toString(),
  },
});

/**
 * The Postgres schema comes from DATABASE_SCHEMA, not from `?schema=` in
 * DATABASE_URL: the app's pg adapter ignores the URL parameter, and the
 * deployed URL comes from a secret we can't edit. A URL schema that disagrees
 * would be silently ignored, so refuse to start instead. Used by both the app
 * config and prisma.config.ts (migrations).
 */
export function assertNoSchemaConflict(
  databaseUrl: string,
  databaseSchema: string,
): void {
  const urlSchema = new URL(databaseUrl).searchParams.get("schema");
  if (urlSchema !== null && urlSchema !== databaseSchema) {
    throw new Error(
      `DATABASE_URL sets ?schema=${urlSchema} but the schema in use is "${databaseSchema}". ` +
        "The URL parameter is ignored: set DATABASE_SCHEMA instead and drop ?schema= from the URL.",
    );
  }
}

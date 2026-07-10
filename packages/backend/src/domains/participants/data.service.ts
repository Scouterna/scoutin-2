import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { lookupHashSeconds } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import config from "../../config/config.ts";
import type { DataSource } from "../../config/dataSourceConfig.ts";
import { loadDataSourceConfig } from "../../config/dataSourceConfigLoader.ts";
import { logger } from "../../core/logging/logger.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { enricherRegistry } from "../workflows/steps.ts";
import { importGoogleSheetsData } from "./googlesheets.ts";
import { importScoutnetData } from "./scoutnet.ts";

/**
 * `importErrors` (on Participant and ParticipantGroup) is the single source of
 * truth for whether a row failed import/enrichment: a non-empty object holds
 * one reason per failure source, while SQL NULL (never flagged) or an empty
 * object {} (self-healed) both mean "clean". These two definitions are the
 * shared query-layer and in-memory encodings of that predicate - use them
 * everywhere instead of re-deriving, so the encoding lives in exactly one place.
 */
export const NO_IMPORT_ERROR_WHERE = {
  OR: [
    { importErrors: { equals: Prisma.DbNull } },
    { importErrors: { equals: {} } },
  ],
};

export function hasImportErrors(importErrors: unknown): boolean {
  return (
    importErrors != null &&
    typeof importErrors === "object" &&
    Object.keys(importErrors as object).length > 0
  );
}

// TODO: Don't just load it from an arbitrary file, but have it configurable
export const dataSourceConfig = await loadDataSourceConfig(
  await readFile("./config/dataSourceConfig.yml", "utf-8"),
);

const secret = Buffer.from(config.DATASOURCE_HASHING_SECRET);
const salt = Buffer.from(config.DATASOURCE_HASHING_SALT);

export function hashLookupValue(value: string): string {
  const end = lookupHashSeconds.startTimer();
  const hashedValue = createHmac("sha256", secret)
    .update(salt)
    .update(value)
    .digest("hex");
  end();
  return hashedValue;
}

export async function findParticipantsByLookupValue(value: string) {
  const hashedValue = hashLookupValue(value);

  return await prisma.participant.findMany({
    where: {
      lookupValues: {
        has: hashedValue,
      },
      deletedAt: null,
      ...NO_IMPORT_ERROR_WHERE,
    },
  });
}

export async function getSubjectCandidates(actorParticipantId: string) {
  const actorParticipant = await prisma.participant.findUnique({
    where: { id: actorParticipantId },
    include: {
      participantGroup: {
        include: {
          participants: {
            where: { deletedAt: null, ...NO_IMPORT_ERROR_WHERE },
          },
        },
      },
    },
  });

  if (!actorParticipant) {
    return [];
  }

  // An errored group's membership data can't be trusted - exclude the whole
  // group rather than surfacing a possibly-incomplete participant list.
  if (hasImportErrors(actorParticipant.participantGroup?.importErrors)) {
    return [];
  }

  return actorParticipant.participantGroup?.participants ?? [];
}

export async function loadDataSourceIntoDatabase(
  dataSource: DataSource,
  dataSourceName: string,
) {
  let processed: { participantIds: string[]; groupIds: string[] };

  if (dataSource.provider === "scoutnet") {
    processed = await importScoutnetData(dataSource, dataSourceName);
  } else if (dataSource.provider === "googlesheets") {
    processed = await importGoogleSheetsData(dataSource, dataSourceName);
  } else {
    // biome-ignore lint/suspicious/noExplicitAny: This is a case that shouldn't happen, but maybe could
    const providerName = (dataSource as any).provider;

    throw new Error(`Data source provider "${providerName}" not supported`);
  }

  await reconcileDataSource(dataSourceName, processed, dataSource.enrichWith);
}

export async function loadAllDataSourcesIntoDatabase() {
  for (const [dataSourceName, dataSource] of Object.entries(
    dataSourceConfig.dataSources,
  )) {
    await loadDataSourceIntoDatabase(dataSource, dataSourceName);
  }
}

/**
 * Runs after a provider's import completes successfully. Recomputed fully
 * every cycle (never accumulating):
 *  - soft-deletes participants for this data source that weren't part of
 *    this cycle's processed set (cancelled/removed at the source). A
 *    participant that reappears is automatically un-deleted by the
 *    provider's self-heal upsert on their next successful import.
 *  - runs each configured enricher over every non-deleted entity of its
 *    target type, writing results to a namespaced `metadata` key. A throw
 *    records a per-source reason under `importErrors[enricherName]`, leaving
 *    every other source's key (e.g. `provider`, or a different enricher)
 *    untouched; a success clears only that enricher's own key. Because
 *    `importErrors` is the single source of truth (non-empty => errored),
 *    multiple simultaneous failure sources for the same entity are recorded
 *    and cleared independently instead of collapsing into one boolean.
 */
export async function reconcileDataSource(
  dataSourceName: string,
  processed: { participantIds: string[]; groupIds: string[] },
  enrichWith: Record<string, string> | undefined,
) {
  const log = logger.child({ dataSource: dataSourceName });

  await prisma.participant.updateMany({
    where: {
      dataSource: dataSourceName,
      idInDataSource: { notIn: processed.participantIds },
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });

  if (!enrichWith) return;

  for (const [metadataKey, enricherName] of Object.entries(enrichWith)) {
    const enricher = enricherRegistry.get(enricherName);
    if (!enricher) {
      log.warn(
        { enricherName, metadataKey },
        "Unknown import enricher referenced in enrichWith, skipping",
      );
      continue;
    }

    const entities =
      enricher.target === "group"
        ? await prisma.participantGroup.findMany({
            where: { dataSource: dataSourceName },
          })
        : await prisma.participant.findMany({
            where: { dataSource: dataSourceName, deletedAt: null },
          });

    for (const entity of entities) {
      const enricherLog = log.child({
        enricherName,
        target: enricher.target,
        entityId: entity.id,
      });

      const existingErrors =
        (entity.importErrors as Record<string, string> | null) ?? {};

      try {
        const value = await enricher.enrich(entity, {
          dataSourceName,
          logger: enricherLog,
        });

        // Success (even with no data to write) means this source is healthy -
        // clear only its own key, leaving every other source's key (another
        // enricher, or a "provider" import failure) untouched.
        const hadOwnError = enricherName in existingErrors;
        const remainingErrors = Object.fromEntries(
          Object.entries(existingErrors).filter(
            ([key]) => key !== enricherName,
          ),
        );

        if (value === null || value === undefined) {
          if (!hadOwnError) continue;

          const importErrors = JSON.parse(JSON.stringify(remainingErrors));

          if (enricher.target === "group") {
            await prisma.participantGroup.update({
              where: { id: entity.id },
              data: { importErrors },
            });
          } else {
            await prisma.participant.update({
              where: { id: entity.id },
              data: { importErrors },
            });
          }
          continue;
        }

        const existingMetadata =
          (entity.metadata as Record<string, unknown> | null) ?? {};
        // Making sure that what we try to store in the database is actually
        // serializable, and to satisfy Prisma's InputJsonValue typing (same
        // pattern as step.service.ts's completeStep).
        const metadata = JSON.parse(
          JSON.stringify({ ...existingMetadata, [metadataKey]: value }),
        );
        const importErrors = JSON.parse(JSON.stringify(remainingErrors));

        if (enricher.target === "group") {
          await prisma.participantGroup.update({
            where: { id: entity.id },
            data: { metadata, importErrors },
          });
        } else {
          await prisma.participant.update({
            where: { id: entity.id },
            data: { metadata, importErrors },
          });
        }
      } catch (err) {
        enricherLog.warn(
          { err },
          "Import enricher threw, flagging entity with import error",
        );

        const reason = err instanceof Error ? err.message : String(err);
        const importErrors = JSON.parse(
          JSON.stringify({ ...existingErrors, [enricherName]: reason }),
        );

        if (enricher.target === "group") {
          await prisma.participantGroup.update({
            where: { id: entity.id },
            data: { importErrors },
          });
        } else {
          await prisma.participant.update({
            where: { id: entity.id },
            data: { importErrors },
          });
        }
      }
    }
  }
}

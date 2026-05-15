import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { lookupHashSeconds } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import config from "../../config/config.ts";
import type { DataSource } from "../../config/dataSourceConfig.ts";
import { loadDataSourceConfig } from "../../config/dataSourceConfigLoader.ts";
import { importGoogleSheetsData } from "./googlesheets.ts";
import { importScoutnetData } from "./scoutnet.ts";

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
    },
  });
}

export async function getSubjectCandidates(actorParticipantId: string) {
  const actorParticipant = await prisma.participant.findUnique({
    where: { id: actorParticipantId },
    include: { participantGroup: { include: { participants: true } } },
  });

  if (!actorParticipant) {
    return [];
  }

  return actorParticipant.participantGroup?.participants ?? [];
}

export async function loadDataSourceIntoDatabase(
  dataSource: DataSource,
  dataSourceName: string,
) {
  if (dataSource.provider === "scoutnet") {
    await importScoutnetData(dataSource, dataSourceName);
    return;
  }

  if (dataSource.provider === "googlesheets") {
    await importGoogleSheetsData(dataSource, dataSourceName);
    return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: This is a case that shouldn't happen, but maybe could
  const providerName = (dataSource as any).provider;

  throw new Error(`Data source provider "${providerName}" not supported`);
}

export async function loadAllDataSourcesIntoDatabase() {
  for (const [dataSourceName, dataSource] of Object.entries(
    dataSourceConfig.dataSources,
  )) {
    await loadDataSourceIntoDatabase(dataSource, dataSourceName);
  }
}

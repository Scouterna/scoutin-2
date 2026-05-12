import { readFile } from "node:fs/promises";
import { hash } from "argon2";
import { lookupHashSeconds } from "../../app/metrics.ts";
import { prisma } from "../../app/prisma.ts";
import config from "../../config/config.ts";
import type { DataSource } from "../../config/dataSourceConfig.ts";
import { loadDataSourceConfig } from "../../config/dataSourceConfigLoader.ts";
import { importScoutnetData } from "./scoutnet.ts";

// TODO: Don't just load it from an arbitrary file, but have it configurable
export const dataSourceConfig = await loadDataSourceConfig(
  await readFile("./config/dataSourceConfig.yml", "utf-8"),
);

const secret = Buffer.from(config.DATASOURCE_HASHING_SECRET);
const salt = Buffer.from(config.DATASOURCE_HASHING_SALT);

export async function hashLookupValue(value: string): Promise<string> {
  const end = lookupHashSeconds.startTimer();
  const hashedValue = await hash(value, { secret, salt });
  end();
  return hashedValue;
}

export async function findParticipantsByLookupValue(value: string) {
  const hashedValue = await hashLookupValue(value);

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

  throw new Error(
    `Data source provider "${dataSource.provider}" not supported`,
  );
}

export async function loadAllDataSourcesIntoDatabase() {
  for (const [dataSourceName, dataSource] of Object.entries(
    dataSourceConfig.dataSources,
  )) {
    await loadDataSourceIntoDatabase(dataSource, dataSourceName);
  }
}

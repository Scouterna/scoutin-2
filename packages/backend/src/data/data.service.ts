import { readFile } from "node:fs/promises";
import { hash } from "argon2";
import config from "../config.ts";
import { lookupHashSeconds } from "../metrics.ts";
import { prisma } from "../prisma.ts";
import { type DataSource, loadDataSourceConfig } from "./dataSource.ts";
import { importScoutnetData } from "./scoutnet.ts";

const dataSourceConfig = await loadDataSourceConfig(
  await readFile("./dataSourceConfig.yml", "utf-8"),
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

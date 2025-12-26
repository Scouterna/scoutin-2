// One signup might be for multiple projects. To support this, one instance of
// Scoutin should be configurable with multiple data sources. A data source is
// typically a project in Scoutnet, but it could theoretically be something else
// in the future.
//
// This setup makes it possible to have one Scoutin instance for multiple
// Scoutnet projects, which is useful for bigger events such as Jamborees where
// group signups and volunteer signups might happen in different projects.
//
// Each data source must have a unique identifier, which is used for things like
// mapping signups to the correct data source.

import { type } from "arktype";
import { parse } from "yaml";
import { ScoutnetDataSource } from "./scoutnet.ts";

export const DataSource = type.or(ScoutnetDataSource);
export type DataSource = typeof DataSource.infer;

export const DataSourceConfig = type({
  dataSources: type.Record(type.string, DataSource),
});
export type DataSourceConfig = typeof DataSourceConfig.infer;

function replaceEnvVariables(value: string): string {
  return value.replace(/\$\{([a-z0-9_]+)\}/gi, (_, varName) => {
    // biome-ignore lint/style/noProcessEnv: This is correct usage
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Environment variable ${varName} is not defined`);
    }
    return envValue;
  });
}

function replaceEnvVariablesInObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return replaceEnvVariables(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(replaceEnvVariablesInObject) as T;
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceEnvVariablesInObject(value);
    }
    return result as T;
  }

  return obj;
}

export function loadDataSourceConfig(
  dataSourceConfigString: string,
): DataSourceConfig {
  const rawDataSourceConfig = parse(dataSourceConfigString);
  const dataSourceConfig = DataSourceConfig(rawDataSourceConfig);

  if (dataSourceConfig instanceof type.errors) {
    throw new Error(
      `Data source configuration validation failed:\n${dataSourceConfig.summary}`,
    );
  }

  return replaceEnvVariablesInObject(dataSourceConfig);
}

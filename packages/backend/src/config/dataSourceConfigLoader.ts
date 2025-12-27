import { parse } from "yaml";
import { DataSourceConfig } from "./dataSourceConfig.ts";
import { type } from "arktype";

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

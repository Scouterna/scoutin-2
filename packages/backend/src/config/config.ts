/** biome-ignore-all lint/style/noProcessEnv: This is the only file in the whole project where we should access process.env */

import { type } from "arktype";

const Config = type({
  "+": "delete",
  PORT: type("string.integer>0")
    .pipe((value) => Number.parseInt(value, 10))
    .default("3000"),
  NODE_ENV: type("'development' | 'production'").default("development"),
  BASE_PATH: type("string").default(""),
  "LOG_LEVEL?": type(
    "'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'",
  ),
  DATABASE_URL: type("string"),
  TOKEN_SECRET: type("string"),
  DATASOURCE_HASHING_SECRET: type("string"),
  DATASOURCE_HASHING_SALT: type("string"),
});
type Config = typeof Config.infer;

let rawConfig: Config;

export function loadConfig() {
  const parsedConfig = Config(process.env);

  if (parsedConfig instanceof type.errors) {
    throw new Error(
      `Configuration validation failed:\n${parsedConfig.summary}`,
    );
  }

  rawConfig = parsedConfig;
}

const config = new Proxy({} as Config, {
  get(_, prop: keyof Config) {
    if (rawConfig) return rawConfig[prop];

    if (
      !process.env.SUPPRESS_CONFIG_WARNINGS ||
      process.env.SUPPRESS_CONFIG_WARNINGS === "false"
    ) {
      // The logger itself depends on config being loaded, so it can't be used here.
      // biome-ignore lint/suspicious/noConsole: bootstrap warning before the logger is available
      console.warn(`Accessing property ${prop} before config is loaded`);
    }
    return undefined;
  },
});

export default config as Config;
export type { Config };

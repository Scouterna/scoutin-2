/** biome-ignore-all lint/style/noProcessEnv: This is the only file in the whole project where we should access process.env */

import { type } from "arktype";

const Config = type({
  "+": "delete",
  PORT: type("string.integer>0")
    .pipe((value) => Number.parseInt(value, 10))
    .default("3000"),
  DATABASE_URL: type.string,
  TOKEN_SECRET: type.string,
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
      console.warn(`Accessing property ${prop} before config is loaded`);
    }
    return undefined;
  },
});

export default config as Config;
export type { Config };

import { Histogram, Registry } from "prom-client";

export const registry = new Registry();

export const lookupHashSeconds = new Histogram({
  name: "lookup_hash_seconds",
  help: "Time taken to hash lookup values in seconds",
  registers: [registry],
});

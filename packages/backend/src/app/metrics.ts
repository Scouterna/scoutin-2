import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const registry = new Registry();

export const lookupHashSeconds = new Histogram({
  name: "lookup_hash_seconds",
  help: "Time taken to hash lookup values in seconds",
  registers: [registry],
});

export const activeWebSocketConnections = new Gauge({
  name: "active_websocket_connections",
  help: "Number of active WebSocket connections",
  registers: [registry],
});

export const authAttempts = new Counter({
  name: "auth_attempts_total",
  help: "Total number of authentication attempts",
  labelNames: ["outcome"],
  registers: [registry],
});

export const stepCompletions = new Counter({
  name: "step_completions_total",
  help: "Total number of step completions",
  labelNames: ["step_id"],
  registers: [registry],
});

export const stepMethodCallSeconds = new Histogram({
  name: "step_method_call_seconds",
  help: "Time taken to execute a step method in seconds",
  labelNames: ["step_id", "method_name"],
  registers: [registry],
});

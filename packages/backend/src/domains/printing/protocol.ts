// The /ws/print-relay wire protocol (docs/printer-proxy-spec.md). This is
// the contract with deployed Pis: change it only in ways old relays accept, or
// together with a relay release. The Go side is printer-proxy/internal/cloud.
import { type } from "arktype";

export const PrinterInfo = type({
  serial: "string > 0",
  "product?": "string",
  // 1-based desk port; absent if unknown.
  "port?": "number.integer",
});
export type PrinterInfo = typeof PrinterInfo.infer;

const JournalEntry = type({
  serial: "string > 0",
  jobId: "string",
  leaseId: "string",
  phase: "'intent' | 'result'",
  "counterBefore?": "number",
  "outcome?": "string",
});

// Relay → server, by message name.
export const relayMessages = {
  hello: type({
    version: "string",
    hostname: "string",
    // Go sends an empty list as null.
    printers: PrinterInfo.array()
      .or("null")
      .pipe((v) => v ?? []),
    journal: JournalEntry.array()
      .or("null")
      .pipe((v) => v ?? []),
  }),
  "printer:attached": PrinterInfo,
  "printer:detached": type({ serial: "string > 0" }),
  "printer:status": type({
    serial: "string > 0",
    seq: "number.integer",
    state: "string",
    "detail?": "string",
    "dpi?": "number.integer",
    "widthDots?": "number.integer",
    "lengthDots?": "number.integer",
  }),
  "printer:ready": type({ serial: "string > 0" }),
  "job:begin": type({ jobId: "string", leaseId: "string" }),
  "job:release": type({ jobId: "string", leaseId: "string", reason: "string" }),
  "job:result": type({
    jobId: "string",
    leaseId: "string",
    outcome: "string",
    "reason?": "string",
  }),
  "printer:config": type({
    serial: "string > 0",
    settings: type({ "[string]": "string" })
      .or("null")
      .pipe((v) => v ?? {}),
  }),
  "printer:actionResult": type({
    actionId: "string",
    serial: "string",
    ok: "boolean",
    "results?": { "[string]": { applied: "boolean", value: "string" } },
    "restart?": "boolean",
    "error?": "string",
  }),
  "relay:actionResult": type({
    actionId: "string",
    ok: "boolean",
    "error?": "string",
  }),
} as const;

export type RelayMessageName = keyof typeof relayMessages;
export type RelayMessage<N extends RelayMessageName> =
  (typeof relayMessages)[N]["infer"];

export type PrinterActionKind = "applyProfile" | "calibrate" | "cancelBuffer";
export type RelayActionKind = "reboot" | "poweroff";

// Server → relay.
export type ServerMessage =
  | { name: "welcome"; data: { relayId: string; epoch: number } }
  | {
      name: "job:offer";
      data: {
        jobId: string;
        leaseId: string;
        serial: string;
        png: string; // base64
        widthDots: number;
        heightDots: number;
      };
    }
  | {
      name: "job:beginAck";
      data: { jobId: string; leaseId: string; ok: boolean };
    }
  | { name: "job:resultAck"; data: { jobId: string; leaseId: string } }
  | {
      name: "printer:action";
      data: {
        actionId: string;
        serial: string;
        kind: PrinterActionKind;
        settings?: Record<string, string>;
      };
    }
  | {
      name: "relay:action";
      data: { actionId: string; kind: RelayActionKind };
    };

export type PrinterActionResult = RelayMessage<"printer:actionResult">;
export type RelayActionResult = RelayMessage<"relay:actionResult">;

import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

type Detail = { label: string; value: string };
type DetailSection = { title?: string; rows: Detail[] };
type DetailSectionInput = {
  title?: string;
  rows: { label: string; value: unknown }[];
};

// A detail's value as one line of text: lists joined, empty values dropped.
function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(formatValue).filter(Boolean).join(", ");
  }
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export const message: StepImplementation = {
  id: "base:message",
  inputs: type({
    "title?": "string",
    "message?": "string",
    // These may be authored as `{ sv, en }` in config; the flow engine
    // resolves them to plain strings for the session language before we see
    // them.
    "buttonText?": "string",
    "requireAcknowledgement?": "boolean",
    "acknowledgementText?": "string",
    // Shows an "Avbryt" button that ends the session.
    "allowCancel?": "boolean",
    // Sections of label/value rows shown under the message, e.g. for checking
    // registered details. Each section is its own two-column grid, filled row
    // by row in config order. Values usually come from `${{ }}` expressions;
    // lists are joined, rows with no value and sections with no rows are left
    // out.
    "details?": type({
      "title?": "string",
      rows: type({ label: "string", value: "unknown" }).array(),
    }).array(),
  }),
  hooks: {
    async onStepStart(ctx) {
      const {
        title,
        message,
        buttonText,
        requireAcknowledgement,
        acknowledgementText,
        allowCancel,
        details,
      } = ctx.getInputs() as {
        title?: string;
        message?: string;
        buttonText?: string;
        requireAcknowledgement?: boolean;
        acknowledgementText?: string;
        allowCancel?: boolean;
        details?: DetailSectionInput[];
      };
      const actor = await ctx.getActor();

      const interpolate = (s: string) =>
        s
          .replace("{actor.firstName}", actor?.participant.firstName ?? "")
          .replace("{actor.lastName}", actor?.participant.lastName ?? "");

      await ctx.showScreen("base:message:message", {
        title: title ? interpolate(String(title)) : undefined,
        message: message ? interpolate(String(message)) : undefined,
        buttonText,
        requireAcknowledgement,
        acknowledgementText,
        allowCancel,
        details: details
          ?.map(
            (section): DetailSection => ({
              title: section.title,
              rows: section.rows
                .map((d) => ({ label: d.label, value: formatValue(d.value) }))
                .filter((d) => d.value !== ""),
            }),
          )
          .filter((section) => section.rows.length > 0),
      });
    },
  },
  publicMethods: {
    confirm: {
      async handler(ctx) {
        await ctx.setCompleted();
      },
    },
  },
};

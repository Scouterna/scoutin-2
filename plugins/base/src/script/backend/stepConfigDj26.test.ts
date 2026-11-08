import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runScript } from "./runner.ts";

// Runs the badge script of stepConfig.dj26.yml, with the same variables the
// engine would give it, on sample subjects.
type Step = { uses: string; id?: string; with?: Record<string, unknown> };
const config = parse(
  readFileSync(
    join(
      import.meta.dirname,
      "../../../../../packages/backend/config/stepConfig.dj26.yml",
    ),
    "utf-8",
  ),
) as { steps: Step[] };
const step = config.steps.find((s) => s.id === "badges");
const { variables, script } = (step?.with ?? {}) as {
  variables: Record<string, unknown>;
  script: string;
};

type Badge = Record<string, string | undefined>;
const badge = (
  subGroup: string | null,
  answers: Record<string, string | string[] | null> = {},
): Badge => {
  const [result] = runScript({
    code: script,
    variables: {
      ...variables,
      subject: {
        firstName: "Anna",
        lastName: "Svensson",
        subGroup,
        idInDataSource: "1234567",
        metadata: { group: { name: "Testkåren" }, badge: answers },
      },
    },
  }) as Badge[];
  return result as Badge;
};

describe("stepConfig.dj26.yml badges script", () => {
  it("is found in the config", () => {
    expect(step?.uses).toBe("base:script");
  });
  it("carries name, group, member number and the subgroup as the type", () => {
    const b = badge("delegate");
    expect([
      b.firstName,
      b.lastName,
      b.group,
      b.memberNumber,
      b.participantType,
    ]).toEqual(["Anna", "Svensson", "Testkåren", "1234567", "delegate"]);
  });
  it("passes the answers through as text", () => {
    expect(
      badge("volunteer", {
        role: ["Kock", "Sekreterare"],
        delegateNumber: "512",
        preparationGroup: "Bläckfisken – 10",
        lunchSaturday: "Hajkbanan",
        lunchSunday: " Bläckfisk ",
        dinnerSaturday: "Fisk",
      }),
    ).toMatchObject({
      participantSubtype: "Kock, Sekreterare",
      delegateNumber: "512",
      preparationGroup: "Bläckfisken – 10",
      lunchSaturday: "Hajkbanan",
      lunchSunday: "Bläckfisk",
      dinnerSaturday: "Fisk",
    });
  });
  it("leaves out missing and empty answers", () => {
    const b = badge("participant", { role: null, lunchSunday: " " });
    expect(b.participantSubtype).toBeUndefined();
    expect(b.lunchSunday).toBeUndefined();
    expect(b.delegateNumber).toBeUndefined();
  });
});

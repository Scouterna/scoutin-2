import { describe, expect, it } from "vitest";
import { specialNeeds } from "./specialNeeds.ts";

const entity = () => ({
  id: "p1",
  dataSource: "staff",
  idInDataSource: "1",
  firstName: "Alice",
  lastName: "Andersson",
});

const ctx = (
  options: unknown,
  sourceRecord: unknown,
  providerContext?: unknown,
) => ({
  dataSourceName: "staff",
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  sourceRecord,
  options,
  providerContext,
});

describe("jamboree26:specialNeeds enricher", () => {
  it("maps each configured field name to its question's answer", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { dietGluten: "88306", medicalElectricity: "88329" } },
        { questions: { "88306": "1", "88329": null } },
      ),
    );

    expect(result).toEqual({ dietGluten: "1", medicalElectricity: null });
  });

  it("returns null for a configured field whose question ID has no answer entry at all", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { dietGluten: "88306" } },
        { questions: { "99999": "1" } },
      ),
    );

    expect(result).toEqual({ dietGluten: null });
  });

  it("returns null (no data) when no questions are configured for this event", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(undefined, { questions: { "88306": "1" } }),
    );

    expect(result).toBeNull();
  });

  it("returns null (no data) when the questions map is an empty object", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx({ questions: {} }, { questions: {} }),
    );

    expect(result).toBeNull();
  });

  it("is fail-safe (all null) when questions is entirely absent from the source record", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx({ questions: { dietGluten: "88306" } }, {}),
    );

    expect(result).toEqual({ dietGluten: null });
  });

  it("is fail-safe (all null) when there is no source record at all", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx({ questions: { dietGluten: "88306" } }, undefined),
    );

    expect(result).toEqual({ dietGluten: null });
  });

  it("is fail-safe (all null) when the source record doesn't match the expected shape", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { dietGluten: "88306" } },
        { questions: "not-an-object" },
      ),
    );

    expect(result).toEqual({ dietGluten: null });
  });

  it("is fail-safe (no data) when options doesn't match the expected shape", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx({ questions: { dietGluten: 123 } }, { questions: { "88306": "1" } }),
    );

    expect(result).toBeNull();
  });

  it("handles a realistic multi-question config end to end", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        {
          questions: {
            dietGluten: "88306",
            dietNotter: "89332",
            dietOther: "88286",
            medicalElectricity: "88329",
            absenceLagerperiodLimited: "90179",
            absenceLagerperiodDays: "90180",
          },
        },
        {
          questions: {
            "88306": "1",
            "89332": null,
            "88286": "Extra allergisk mot kiwi",
            "88329": null,
            "90179": "1",
            "90180": ["61760"],
          },
        },
      ),
    );

    expect(result).toEqual({
      dietGluten: "1",
      dietNotter: null,
      dietOther: "Extra allergisk mot kiwi",
      medicalElectricity: null,
      absenceLagerperiodLimited: "1",
      absenceLagerperiodDays: ["61760"],
    });
  });

  it("falls back to raw choice IDs for a multiselect ('days') question when no provider context is available", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { absenceForlagerDays: "90176" } },
        { questions: { "90176": ["61760", "61761"] } },
      ),
    );

    expect(result).toEqual({ absenceForlagerDays: ["61760", "61761"] });
  });

  it("translates multiselect choice IDs to their labels via provider context", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { absenceForlagerDays: "90176" } },
        { questions: { "90176": ["61760", "61761"] } },
        {
          "90176": {
            "61760": "Lördag 11 juli",
            "61761": "Söndag 12 juli",
          },
        },
      ),
    );

    expect(result).toEqual({
      absenceForlagerDays: ["Lördag 11 juli", "Söndag 12 juli"],
    });
  });

  it("falls back to the raw choice ID for a selection missing from provider context (data drift)", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { absenceForlagerDays: "90176" } },
        { questions: { "90176": ["61760", "99999"] } },
        { "90176": { "61760": "Lördag 11 juli" } },
      ),
    );

    expect(result).toEqual({
      absenceForlagerDays: ["Lördag 11 juli", "99999"],
    });
  });

  it("does not attempt to translate plain string answers (checkbox/text), even with provider context present", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { dietGluten: "88306" } },
        { questions: { "88306": "1" } },
        { "88306": { "0": "unchecked", "1": "checked" } },
      ),
    );

    expect(result).toEqual({ dietGluten: "1" });
  });

  it("is fail-safe (falls back to raw IDs) when provider context doesn't match the expected shape", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { absenceForlagerDays: "90176" } },
        { questions: { "90176": ["61760"] } },
        "not-an-object",
      ),
    );

    expect(result).toEqual({ absenceForlagerDays: ["61760"] });
  });

  it("returns null for an empty multiselect answer", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { absenceForlagerDays: "90176" } },
        { questions: { "90176": [] } },
      ),
    );

    expect(result).toEqual({ absenceForlagerDays: [] });
  });

  it("regression: an unrelated multiselect answer elsewhere in the participant's form must not null out every configured field (real bug - 93% of a real project's participants hit this)", () => {
    const result = specialNeeds.enrich(
      entity(),
      ctx(
        { questions: { dietGluten: "88306", medicalElectricity: "88329" } },
        {
          questions: {
            "88306": "1",
            "88329": "0",
            // Unrelated multiselect question, not configured by this event,
            // but present on virtually every real participant's raw record.
            "90174": ["61760"],
          },
        },
      ),
    );

    expect(result).toEqual({ dietGluten: "1", medicalElectricity: "0" });
  });
});

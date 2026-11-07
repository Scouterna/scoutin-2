import { describe, expect, it } from "vitest";
import { formAnswers } from "./formAnswers.ts";

const options = {
  questions: { role: "111244" },
  otherAnswers: { role: { choice: "74291", question: "111280" } },
};
const providerContext = {
  "111244": { "74290": "Kock", "74291": "Annan roll" },
};
// biome-ignore lint/suspicious/noExplicitAny: test helper for the enricher context
const run = (questions: Record<string, unknown>): any =>
  // biome-ignore lint/suspicious/noExplicitAny: test helper for the enricher context
  (formAnswers.enrich as any)(
    {},
    { options, sourceRecord: { questions }, providerContext },
  );

describe("scoutnet:formAnswers", () => {
  it("translates a choice to its label", () => {
    expect(run({ "111244": ["74290"] })).toEqual({ role: ["Kock"] });
  });
  it("replaces the other choice with the free text", () => {
    expect(run({ "111244": ["74291"], "111280": " Sekreterare " })).toEqual({
      role: ["Sekreterare"],
    });
  });
  it("keeps the label when the free text is empty", () => {
    expect(run({ "111244": "74291", "111280": "" })).toEqual({
      role: "Annan roll",
    });
  });
  it("is null when unanswered", () => {
    expect(run({})).toEqual({ role: null });
  });
});

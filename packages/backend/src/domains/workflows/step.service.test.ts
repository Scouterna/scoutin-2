import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/prisma.ts", () => ({ prisma: {} }));
vi.mock("../participants/data.service.ts", () => ({
  dataSourceConfig: { dataSources: {} },
}));

const { matchesStepData } = await import("./step.service.ts");

describe("matchesStepData", () => {
  it("matches a step with an id by its id", () => {
    const def = { uses: "base:message", id: "confirmDetails" };
    expect(
      matchesStepData(
        { stepId: "base:message", idInFlow: "confirmDetails" },
        def,
      ),
    ).toBe(true);
    expect(
      matchesStepData({ stepId: "base:message", idInFlow: "other" }, def),
    ).toBe(false);
  });

  it("matches a step without an id only to a record without one", () => {
    const def = { uses: "base:message" };
    expect(
      matchesStepData({ stepId: "base:message", idInFlow: null }, def),
    ).toBe(true);
    // An earlier step of the same implementation that has an id must not count
    // as this one: the flow would skip it.
    expect(
      matchesStepData(
        { stepId: "base:message", idInFlow: "confirmDetails" },
        def,
      ),
    ).toBe(false);
  });
});

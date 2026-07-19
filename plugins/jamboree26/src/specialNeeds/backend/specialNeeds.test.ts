import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrow = vi.fn();

vi.mock("@scouterna/scoutin-backend/plugin-services", () => ({
  prisma: {
    participant: { findUniqueOrThrow },
  },
}));

const { specialNeedsStep } = await import("./specialNeeds.ts");

const actor = {
  actor: { id: "actor-1" },
  participant: {
    id: "p1",
    firstName: "Alice",
    lastName: "Andersson",
    dataSource: "staff",
  },
};

function makeCtx({
  getActor = vi.fn().mockResolvedValue(actor),
  variant,
}: {
  getActor?: ReturnType<typeof vi.fn>;
  variant?: "adult" | "child";
} = {}) {
  return {
    getActor,
    getInputs: vi.fn().mockReturnValue(variant ? { variant } : {}),
    setCompleted: vi.fn(),
    showScreen: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake StepMethodContext for this test
  } as any;
}

function withMetadata(
  specialNeeds: Record<string, string | string[] | null> | null,
) {
  findUniqueOrThrow.mockResolvedValue({
    metadata: specialNeeds == null ? null : { specialNeeds },
  });
}

// Independent reimplementation of the step's date-range generation, used to
// build expected day tables without hand-writing 12/13/5-entry arrays - this
// still exercises the step's actual output, just via a computed expectation.
function allPresent(
  start: [number, number],
  end: [number, number],
): { date: string; present: boolean }[] {
  const days: { date: string; present: boolean }[] = [];
  const cursor = new Date(2026, start[0] - 1, start[1]);
  const last = new Date(2026, end[0] - 1, end[1]);
  while (cursor <= last) {
    days.push({
      date: `${cursor.getDate()}/${cursor.getMonth() + 1}`,
      present: true,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function allAbsent(
  days: { date: string; present: boolean }[],
): { date: string; present: boolean }[] {
  return days.map((d) => ({ ...d, present: false }));
}

function withAbsent(
  days: { date: string; present: boolean }[],
  absentDates: string[],
) {
  return days.map((d) =>
    absentDates.includes(d.date) ? { ...d, present: false } : d,
  );
}

const FORLAGER_ALL_PRESENT = allPresent([7, 11], [7, 22]);
const LAGERPERIOD_ALL_PRESENT = allPresent([7, 22], [8, 3]);
const EFTERLAGER_ALL_PRESENT = allPresent([8, 3], [8, 7]);

// The default when `periodsAttending` doesn't select a period at all
// (including when it's entirely missing/unanswered) - per the form's own
// gating logic, that means "not attending", not "fully present".
const NOT_ATTENDING_ANYTHING = [
  { label: "Förläger", days: allAbsent(FORLAGER_ALL_PRESENT) },
  { label: "Lägerperiod", days: allAbsent(LAGERPERIOD_ALL_PRESENT) },
  { label: "Efterläger", days: allAbsent(EFTERLAGER_ALL_PRESENT) },
];

// Convenience: explicitly selects all three periods in periodsAttending, for
// tests exercising per-day granularity within an attended period.
const ATTENDING_ALL_PERIODS = ["61759", "61760", "61761"];

const DEFAULT_DIET = { allergens: [], other: null };

// Child variant: one table over the whole camp range (11 juli - 7 augusti),
// present only on the days explicitly listed in the positive attend-list.
const CHILD_FULL_RANGE = allPresent([7, 11], [8, 7]);
function childPresentOn(dates: string[]): { date: string; present: boolean }[] {
  return CHILD_FULL_RANGE.map((d) => ({
    ...d,
    present: dates.includes(d.date),
  }));
}

beforeEach(() => {
  findUniqueOrThrow.mockReset();
});

describe("jamboree26:specialNeeds step", () => {
  it("always shows the screen; with no periodsAttending answer, every period defaults to not-attending (fully absent)", async () => {
    withMetadata(null);
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it("defaults to not-attending when every configured field is null/blank and periodsAttending is absent", async () => {
    withMetadata({
      dietGluten: null,
      medicalElectricity: null,
      absenceLagerperiodDays: null,
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it('treats a checkbox value of "0" or "false" as unchecked', async () => {
    withMetadata({
      dietGluten: "0",
      medicalElectricity: "false",
      periodsAttending: ATTENDING_ALL_PERIODS,
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: [
          { label: "Förläger", days: FORLAGER_ALL_PRESENT },
          { label: "Lägerperiod", days: LAGERPERIOD_ALL_PRESENT },
          { label: "Efterläger", days: EFTERLAGER_ALL_PRESENT },
        ],
      },
    );
  });

  it("shows only the checked diet allergens, in the fixed label order (unaffected by attendance)", async () => {
    withMetadata({
      dietGluten: "1",
      dietLaktos: null,
      dietNotter: "1",
      dietSesam: "0",
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: { allergens: ["Gluten", "Nötter och jordnötter"], other: null },
        medicalElectricityNeeded: false,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it("shows checked diet preferences (not just allergens) alongside allergens", async () => {
    withMetadata({
      dietVegan: "1",
      dietHalal: "1",
      dietNotkott: "0",
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: {
          allergens: [
            "Halal",
            "Vegan (avstår helt från allt med animaliskt ursprung)",
          ],
          other: null,
        },
        medicalElectricityNeeded: false,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it("includes free-text diet info even with no allergen checkboxes ticked", async () => {
    withMetadata({ dietOther: "Extra allergisk mot kiwi" });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: { allergens: [], other: "Extra allergisk mot kiwi" },
        medicalElectricityNeeded: false,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it("shows the medical electricity need when checked", async () => {
    withMetadata({ medicalElectricity: "1" });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: true,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it("marks specific absent days within an attended period, leaving every other day present", async () => {
    withMetadata({
      periodsAttending: ATTENDING_ALL_PERIODS,
      absenceForlagerDays: ["Lördag 11 juli", "Söndag 12 juli"],
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: [
          {
            label: "Förläger",
            days: withAbsent(FORLAGER_ALL_PRESENT, ["11/7", "12/7"]),
          },
          { label: "Lägerperiod", days: LAGERPERIOD_ALL_PRESENT },
          { label: "Efterläger", days: EFTERLAGER_ALL_PRESENT },
        ],
      },
    );
  });

  it("marks absent days across multiple attended periods independently", async () => {
    withMetadata({
      periodsAttending: ATTENDING_ALL_PERIODS,
      absenceLagerperiodDays: ["Onsdag 22 juli"],
      absenceEfterlagerDays: ["Fredag 7 augusti"],
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: [
          { label: "Förläger", days: FORLAGER_ALL_PRESENT },
          {
            label: "Lägerperiod",
            days: withAbsent(LAGERPERIOD_ALL_PRESENT, ["22/7"]),
          },
          {
            label: "Efterläger",
            days: withAbsent(EFTERLAGER_ALL_PRESENT, ["7/8"]),
          },
        ],
      },
    );
  });

  it("treats an empty days array within an attended period the same as no answer (all present)", async () => {
    withMetadata({
      periodsAttending: ATTENDING_ALL_PERIODS,
      absenceForlagerDays: [],
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: [
          { label: "Förläger", days: FORLAGER_ALL_PRESENT },
          { label: "Lägerperiod", days: LAGERPERIOD_ALL_PRESENT },
          { label: "Efterläger", days: EFTERLAGER_ALL_PRESENT },
        ],
      },
    );
  });

  it("forces a whole period to fully absent when it's excluded from periodsAttending, even if per-day answers exist for it", async () => {
    withMetadata({
      // Only selected Förläger and Efterläger - Lägerperiod deliberately left out.
      periodsAttending: [
        "Förlägret (före 22 juli)",
        "Post-camp (after August 3)",
      ],
      // Shouldn't matter - Lägerperiod wasn't attended, so this is ignored.
      absenceLagerperiodDays: ["Onsdag 22 juli"],
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: [
          { label: "Förläger", days: FORLAGER_ALL_PRESENT },
          { label: "Lägerperiod", days: allAbsent(LAGERPERIOD_ALL_PRESENT) },
          { label: "Efterläger", days: EFTERLAGER_ALL_PRESENT },
        ],
      },
    );
  });

  it("still respects a period's own per-day answer for a period that IS selected in periodsAttending", async () => {
    withMetadata({
      periodsAttending: ATTENDING_ALL_PERIODS,
      absenceForlagerDays: ["Lördag 11 juli"],
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: [
          {
            label: "Förläger",
            days: withAbsent(FORLAGER_ALL_PRESENT, ["11/7"]),
          },
          { label: "Lägerperiod", days: LAGERPERIOD_ALL_PRESENT },
          { label: "Efterläger", days: EFTERLAGER_ALL_PRESENT },
        ],
      },
    );
  });

  it("matches periodsAttending by raw choice ID as a fallback when label translation isn't available", async () => {
    withMetadata({ periodsAttending: ["61759"] });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: [
          { label: "Förläger", days: FORLAGER_ALL_PRESENT },
          { label: "Lägerperiod", days: allAbsent(LAGERPERIOD_ALL_PRESENT) },
          { label: "Efterläger", days: allAbsent(EFTERLAGER_ALL_PRESENT) },
        ],
      },
    );
  });

  it("forces every period to fully absent when periodsAttending was never answered at all, even with per-day answers present (the form gates on it - never answering means never attending)", async () => {
    withMetadata({ absenceForlagerDays: ["Lördag 11 juli"] });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it("completes silently (fail-safe) when metadata doesn't match the expected shape, defaulting to not-attending anything", async () => {
    findUniqueOrThrow.mockResolvedValue({
      metadata: { specialNeeds: "not-an-object" },
    });
    const ctx = makeCtx();

    await specialNeedsStep.hooks?.onStepStart?.(ctx);

    expect(ctx.setCompleted).not.toHaveBeenCalled();
    expect(ctx.showScreen).toHaveBeenCalledWith(
      "jamboree26:specialNeeds:info",
      {
        diet: DEFAULT_DIET,
        medicalElectricityNeeded: false,
        absence: NOT_ATTENDING_ANYTHING,
      },
    );
  });

  it("completes via the confirm public method", async () => {
    const ctx = makeCtx();

    await specialNeedsStep.publicMethods?.confirm.handler(ctx, {});

    expect(ctx.setCompleted).toHaveBeenCalledTimes(1);
  });

  it("throws when there is no actor in context", async () => {
    const ctx = makeCtx({ getActor: vi.fn().mockResolvedValue(null) });

    await expect(specialNeedsStep.hooks?.onStepStart?.(ctx)).rejects.toThrow(
      /No actor found/,
    );
  });

  describe("child variant", () => {
    it("marks present only the days explicitly listed in the positive attend-list", async () => {
      withMetadata({ attendanceDays: ["Torsdag 23 juli", "Fredag 24 juli"] });
      const ctx = makeCtx({ variant: "child" });

      await specialNeedsStep.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "jamboree26:specialNeeds:info",
        {
          diet: DEFAULT_DIET,
          medicalElectricityNeeded: false,
          absence: [
            {
              label: "Deltar på lägret",
              days: childPresentOn(["23/7", "24/7"]),
            },
          ],
        },
      );
    });

    it("parses attend-list labels that carry an '(inget lägis)' suffix", async () => {
      withMetadata({ attendanceDays: ["Onsdag 5 augusti (inget lägis)"] });
      const ctx = makeCtx({ variant: "child" });

      await specialNeedsStep.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "jamboree26:specialNeeds:info",
        {
          diet: DEFAULT_DIET,
          medicalElectricityNeeded: false,
          absence: [
            { label: "Deltar på lägret", days: childPresentOn(["5/8"]) },
          ],
        },
      );
    });

    it("defaults to absent on every day when no attend-list answer is present", async () => {
      withMetadata(null);
      const ctx = makeCtx({ variant: "child" });

      await specialNeedsStep.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "jamboree26:specialNeeds:info",
        {
          diet: DEFAULT_DIET,
          medicalElectricityNeeded: false,
          absence: [{ label: "Deltar på lägret", days: childPresentOn([]) }],
        },
      );
    });

    it("renders diet and medical identically to the adult variant (shared field names)", async () => {
      withMetadata({
        dietGluten: "1",
        dietOther: "extrem selektiv ätstörning",
        medicalElectricity: "1",
        attendanceDays: ["Lördag 18 juli"],
      });
      const ctx = makeCtx({ variant: "child" });

      await specialNeedsStep.hooks?.onStepStart?.(ctx);

      expect(ctx.showScreen).toHaveBeenCalledWith(
        "jamboree26:specialNeeds:info",
        {
          diet: { allergens: ["Gluten"], other: "extrem selektiv ätstörning" },
          medicalElectricityNeeded: true,
          absence: [
            { label: "Deltar på lägret", days: childPresentOn(["18/7"]) },
          ],
        },
      );
    });
  });
});

import { describe, expect, it } from "vitest";
import { firstAttendingDate } from "./attendance.ts";

describe("firstAttendingDate (adult)", () => {
  it("returns the first day of the earliest selected period when no days are marked absent", () => {
    expect(
      firstAttendingDate(
        { periodsAttending: ["Förlägret (före 22 juli)"] },
        "adult",
      ),
    ).toBe("2026-07-11");
  });

  it("skips days marked absent at the start of an attended period", () => {
    expect(
      firstAttendingDate(
        {
          periodsAttending: ["Förlägret (före 22 juli)"],
          absenceForlagerDays: ["Lördag 11 juli", "Söndag 12 juli"],
        },
        "adult",
      ),
    ).toBe("2026-07-13");
  });

  it("uses the raw choice ID as a period matcher when the label wasn't resolved", () => {
    expect(firstAttendingDate({ periodsAttending: ["61760"] }, "adult")).toBe(
      "2026-07-22",
    );
  });

  it("falls through to the next attended period when an earlier one isn't selected", () => {
    expect(
      firstAttendingDate(
        { periodsAttending: ["Post-camp (after August 3)"] },
        "adult",
      ),
    ).toBe("2026-08-03");
  });

  it("returns an earlier attended period's present day even when a later period is also selected", () => {
    expect(
      firstAttendingDate(
        {
          periodsAttending: [
            "Förlägret (före 22 juli)",
            "Lägerperioden (22 juli - 3 augusti)",
          ],
          absenceForlagerDays: ["Lördag 11 juli"],
        },
        "adult",
      ),
    ).toBe("2026-07-12");
  });

  it("returns null when no period is selected", () => {
    expect(firstAttendingDate({}, "adult")).toBeNull();
    expect(
      firstAttendingDate({ absenceForlagerDays: ["Lördag 11 juli"] }, "adult"),
    ).toBeNull();
  });
});

describe("firstAttendingDate (child)", () => {
  it("returns the earliest explicitly attended day", () => {
    expect(
      firstAttendingDate(
        { attendanceDays: ["Torsdag 23 juli", "Fredag 24 juli"] },
        "child",
      ),
    ).toBe("2026-07-23");
  });

  it("finds the earliest day regardless of answer order", () => {
    expect(
      firstAttendingDate(
        { attendanceDays: ["Fredag 24 juli", "Torsdag 23 juli"] },
        "child",
      ),
    ).toBe("2026-07-23");
  });

  it("ignores unparseable labels (e.g. an untranslated raw choice ID)", () => {
    expect(
      firstAttendingDate(
        { attendanceDays: ["99999", "Onsdag 5 augusti (inget lägis)"] },
        "child",
      ),
    ).toBe("2026-08-05");
  });

  it("returns null for an empty or missing attend-list", () => {
    expect(firstAttendingDate({ attendanceDays: [] }, "child")).toBeNull();
    expect(firstAttendingDate({}, "child")).toBeNull();
  });
});

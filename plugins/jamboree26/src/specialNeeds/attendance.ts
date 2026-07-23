// Pure, framework-agnostic attendance interpretation for jamboree26 (2026). The
// enricher (see enrichers/specialNeeds.ts) and the special-needs step (see
// backend/specialNeeds.ts) both consume this - the enricher to precompute the
// export's "first attending day" column at import time, the step to render the
// day-by-day table on screen. Keeping it here (no prisma / plugin-api imports)
// lets both use the exact same date logic instead of duplicating it.
//
// Input is the resolved-label map the jamboree26:specialNeeds enricher writes
// under metadata.specialNeeds: field name -> raw Scoutnet answer, where the
// "days"/"periods" multiselects have already had their choice IDs translated to
// labels like "Lördag 11 juli" (weekday + day + Swedish month).

export type SpecialNeedsMetadata = Record<string, string | string[] | null>;

export type DayPresence = { date: string; present: boolean };
export type AbsencePeriod = { label: string; days: DayPresence[] };

// Event-specific date ranges - each period's full, inclusive day range, used to
// render a day-by-day presence table regardless of whether the person marked any
// absence at all. Matches the exact ranges Scoutnet's own multiselect choices
// span for these three questions (verified empirically - see
// stormote6-followup.md), given here directly rather than derived from
// Scoutnet's opaque numeric choice IDs.
const EVENT_YEAR = 2026;

// A separate multiselect question ("Perioder du önskar delta" - which whole
// periods someone wants to attend at all, question 90174) gates the rest of the
// adult form: the per-day "which days can't you attend" follow-up for a period is
// only shown to someone who said yes to that period. So NOT selecting a period
// here - whether explicitly left out, or never asked/answered - means "not
// attending that period", full stop: the whole period renders as absent every
// day. `attendanceMatchers` lists every string that means "this period is
// selected" - both the real Scoutnet choice label (confirmed empirically) and
// its raw choice ID, since the enricher only translates IDs to labels when its
// provider-context lookup succeeds that import cycle, falling back to the raw ID.
const PERIOD_ATTENDANCE_FIELD = "periodsAttending";
const ABSENCE_PERIODS: {
  daysField: string;
  label: string;
  start: { month: number; day: number };
  end: { month: number; day: number };
  attendanceMatchers: string[];
}[] = [
  {
    daysField: "absenceForlagerDays",
    label: "Förläger",
    start: { month: 7, day: 11 },
    end: { month: 7, day: 22 },
    attendanceMatchers: ["61759", "Förlägret (före 22 juli)"],
  },
  {
    daysField: "absenceLagerperiodDays",
    label: "Lägerperiod",
    start: { month: 7, day: 22 },
    end: { month: 8, day: 3 },
    attendanceMatchers: ["61760", "Lägerperioden (22 juli - 3 augusti)"],
  },
  {
    daysField: "absenceEfterlagerDays",
    label: "Efterläger",
    start: { month: 8, day: 3 },
    end: { month: 8, day: 7 },
    attendanceMatchers: ["61761", "Post-camp (after August 3)"],
  },
];

// Child variant (fee 32359, "medföljande barn" form) attendance model. Unlike
// the adult form's three period-gated *absence* sub-questions, the child form
// asks a single positive multiselect - "Barnet deltar på lägret följande dagar"
// (question 91058) - listing every camp day the child attends. So the default is
// the inverse of the adult model: a day is present only if it's explicitly in
// that answer, absent otherwise. The full camp range spans the form's own
// earliest-to-latest choice (11 juli - 7 augusti 2026).
const CHILD_ATTENDANCE_FIELD = "attendanceDays";
const CHILD_ATTENDANCE = {
  label: "Deltar på lägret",
  start: { month: 7, day: 11 },
  end: { month: 8, day: 7 },
};

const SWEDISH_MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  mars: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  augusti: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

// The enricher resolves each answer to Scoutnet's own choice label, e.g.
// "Lördag 11 juli" (weekday + day + Swedish month name). Parsed back into a
// day/month pair to match against a period's full date range - this only depends
// on that label format, not on Scoutnet's numeric choice IDs (opaque, and could
// differ if the form is ever rebuilt). Returns null (silently ignored by the
// caller) if a label doesn't match the expected format - e.g. the enricher's own
// fallback to a raw, untranslated choice ID when its label lookup failed.
function parseDayMonth(label: string): { day: number; month: number } | null {
  const match = label.match(/(\d{1,2})\s+([a-zA-ZåäöÅÄÖ]+)/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = SWEDISH_MONTHS[match[2].toLowerCase()];
  return month ? { day, month } : null;
}

function dayMonthKey(month: number, day: number): string {
  return `${month}-${day}`;
}

// Turn a multiselect answer (array of resolved labels) into the set of "M-D"
// keys it names, dropping anything unparseable. Non-array values (a missing or
// malformed answer) yield an empty set.
function labelsToDayMonthSet(
  raw: string | string[] | null | undefined,
): Set<string> {
  const labels = Array.isArray(raw) ? raw : [];
  return new Set(
    labels
      .map(parseDayMonth)
      .filter((x): x is { day: number; month: number } => x != null)
      .map((x) => dayMonthKey(x.month, x.day)),
  );
}

function dateRange(
  start: { month: number; day: number },
  end: { month: number; day: number },
): Date[] {
  const days: Date[] = [];
  const cursor = new Date(EVENT_YEAR, start.month - 1, start.day);
  const last = new Date(EVENT_YEAR, end.month - 1, end.day);
  while (cursor <= last) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function formatShortDate(date: Date): string {
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// True only when this period's identifier is actually present in the
// periodsAttending answer. Missing/null (never answered) is treated exactly like
// "answered but didn't select this period" - not attending - per the form's own
// gating logic, not as some third "unknown" state.
function isAttendingPeriod(
  period: (typeof ABSENCE_PERIODS)[number],
  specialNeeds: SpecialNeedsMetadata,
): boolean {
  const raw = specialNeeds[PERIOD_ATTENDANCE_FIELD];
  const answers = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return period.attendanceMatchers.some((matcher) => answers.includes(matcher));
}

// One period's presence resolved to actual Date objects (before any string
// formatting). The single source of truth both public functions below derive
// from, so the exported "first attending day" and the on-screen day-by-day table
// can never disagree about who is present when.
type PeriodPresence = {
  label: string;
  days: { date: Date; present: boolean }[];
};

/**
 * The day-by-day presence, by variant, over actual Dates. Child: one table over
 * the whole camp range, present only on the days explicitly listed in the
 * positive attend-list. Adult: always all three periods, where not attending a
 * period at all (see isAttendingPeriod) forces every day absent regardless of the
 * day-level sub-answer; only within an attended period does the per-day breakdown
 * apply, an unmarked day rendering as present.
 */
function computePeriodPresence(
  specialNeeds: SpecialNeedsMetadata,
  variant: "adult" | "child",
): PeriodPresence[] {
  if (variant === "child") {
    const attendDayMonths = labelsToDayMonthSet(
      specialNeeds[CHILD_ATTENDANCE_FIELD],
    );
    return [
      {
        label: CHILD_ATTENDANCE.label,
        days: dateRange(CHILD_ATTENDANCE.start, CHILD_ATTENDANCE.end).map(
          (date) => ({
            date,
            present: attendDayMonths.has(
              dayMonthKey(date.getMonth() + 1, date.getDate()),
            ),
          }),
        ),
      },
    ];
  }

  return ABSENCE_PERIODS.map((period) => {
    const attending = isAttendingPeriod(period, specialNeeds);
    const absentDayMonths = labelsToDayMonthSet(specialNeeds[period.daysField]);
    return {
      label: period.label,
      days: dateRange(period.start, period.end).map((date) => ({
        date,
        present:
          attending &&
          !absentDayMonths.has(
            dayMonthKey(date.getMonth() + 1, date.getDate()),
          ),
      })),
    };
  });
}

/**
 * The day-by-day presence table(s) for a person, with dates as short "D/M"
 * display strings for the on-screen special-needs table (see the step).
 */
export function computeAbsence(
  specialNeeds: SpecialNeedsMetadata,
  variant: "adult" | "child",
): AbsencePeriod[] {
  return computePeriodPresence(specialNeeds, variant).map((period) => ({
    label: period.label,
    days: period.days.map((d) => ({
      date: formatShortDate(d.date),
      present: d.present,
    })),
  }));
}

/**
 * The earliest day the person is actually present, as an ISO `yyyy-mm-dd`
 * string, or null if they aren't present on any day (adult: no period selected,
 * or absent on every day of every selected period; child: an empty attend-list).
 * Periods are in date order and each range is ascending, so the first present day
 * found scanning computePeriodPresence in order is the earliest overall.
 */
export function firstAttendingDate(
  specialNeeds: SpecialNeedsMetadata,
  variant: "adult" | "child",
): string | null {
  for (const period of computePeriodPresence(specialNeeds, variant)) {
    for (const day of period.days) {
      if (day.present) return formatIsoDate(day.date);
    }
  }
  return null;
}

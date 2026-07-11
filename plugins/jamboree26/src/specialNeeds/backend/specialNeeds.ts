import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// Structural subset of Participant.metadata this step reads: a flat map of
// field name -> raw Scoutnet answer, written by the jamboree26:specialNeeds
// enricher (see enrichers/specialNeeds.ts, dataSourceConfig.yml for the
// field-name -> question-ID mapping for this event). Multiselect questions
// (the "days" fields) come back as an array of selected choice IDs rather
// than a string - confirmed empirically against a real project, see
// stormote6-followup.md. The enricher has no domain knowledge of what these
// fields mean - this step does, via the field name constants below. A
// missing/malformed key is treated the same as "nothing registered" rather
// than an error, since there's nothing unsafe about showing a clean-slate
// screen (unlike the compliance gate, which fails closed).
const Metadata = type({
  "specialNeeds?": type.Record("string", "string | string[] | null"),
});

// Field-name convention this step groups by - a code contract with whatever
// field names a data source's `enrichWith.specialNeeds.options.questions`
// entry uses (see dataSourceConfig.yml). Reusing this step for a future
// event's same three categories (diet/medical/absence) needs only a config
// change; a genuinely new category needs a code change here too.
const DIET_ALLERGEN_FIELDS: { field: string; label: string }[] = [
  { field: "dietGluten", label: "Gluten" },
  { field: "dietLaktos", label: "Laktos" },
  { field: "dietMjolkprotein", label: "Mjölkprotein" },
  { field: "dietAgg", label: "Ägg" },
  { field: "dietSoja", label: "Soja, baljväxter och lupin" },
  { field: "dietFisk", label: "Fisk" },
  { field: "dietKraftdjur", label: "Kräftdjur" },
  { field: "dietBlotdjur", label: "Blötdjur (snäckor, musslor och bläckfisk)" },
  { field: "dietNotter", label: "Nötter och jordnötter" },
  { field: "dietSesam", label: "Sesamfrön" },
  { field: "dietSelleri", label: "Selleri" },
  { field: "dietSenap", label: "Senap" },
  { field: "dietSulfit", label: "Sulfit" },
  { field: "dietNotkott", label: "Äter ej nötkött" },
  { field: "dietFlaskkott", label: "Äter ej fläskkött" },
  { field: "dietHalal", label: "Halal" },
  {
    field: "dietVegan",
    label: "Vegan (avstår helt från allt med animaliskt ursprung)",
  },
  {
    field: "dietLaktoOvoVegetarian",
    label:
      "Lakto-ovo-vegetarian (vegetariskt med tillägg av ägg och mejeriprodukter)",
  },
  {
    field: "dietPescetarian",
    label: "Pescetarian (mejeriprodukter, ägg, fisk och skaldjur)",
  },
];
const DIET_OTHER_FIELD = "dietOther";
const MEDICAL_ELECTRICITY_FIELD = "medicalElectricity";

// Event-specific date ranges (jamboree26, 2026) - each period's full,
// inclusive day range, used to render a day-by-day presence table
// regardless of whether the person marked any absence at all. Matches the
// exact ranges Scoutnet's own multiselect choices span for these three
// questions (verified empirically - see stormote6-followup.md), given here
// directly rather than derived from Scoutnet's choice IDs so this doesn't
// depend on undocumented, opaque numeric IDs.
const EVENT_YEAR = 2026;
// A separate multiselect question ("Perioder du önskar delta" - which whole
// periods someone wants to attend at all, question 90174) gates the rest of
// the form: it's the *first* question, and the per-day "which days can't you
// attend" follow-up for a period is only shown to someone who said yes to
// that period in the first place. So NOT selecting a period here - whether
// because they explicitly left it out, or never got asked/never answered
// the question at all - means "not attending that period", full stop: the
// whole period renders as absent every day, regardless of (and overriding)
// whatever the per-day sub-question happens to contain. `attendanceMatchers`
// lists every string that means "this period is selected" - both the real
// Scoutnet choice label (confirmed empirically) and its raw choice ID, since
// the enricher only translates IDs to labels when its provider-context
// lookup succeeds that import cycle, falling back to the raw ID otherwise.
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

// True only when this period's identifier is actually present in the
// periodsAttending answer. Missing/null (never answered) is treated exactly
// like "answered but didn't select this period" - not attending - per the
// form's own gating logic (see comment above), not as some third "unknown"
// state.
function isAttendingPeriod(
  period: (typeof ABSENCE_PERIODS)[number],
  specialNeeds: Record<string, string | string[] | null>,
): boolean {
  const raw = specialNeeds[PERIOD_ATTENDANCE_FIELD];
  const answers = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return period.attendanceMatchers.some((matcher) => answers.includes(matcher));
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

// The enricher resolves each absence answer to Scoutnet's own choice label,
// e.g. "Lördag 11 juli" (weekday + day + Swedish month name). Parsed back
// into a day/month pair to match against this period's full date range -
// this only depends on that label format, not on Scoutnet's numeric choice
// IDs (which are opaque and could differ if the form is ever rebuilt).
// Returns null (silently ignored by the caller) if a label doesn't match
// the expected format - e.g. the enricher's own fallback to a raw, untranslated
// choice ID when its label lookup failed that import cycle.
function parseDayMonth(label: string): { day: number; month: number } | null {
  const match = label.match(/(\d{1,2})\s+([a-zA-ZåäöÅÄÖ]+)/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = SWEDISH_MONTHS[match[2].toLowerCase()];
  return month ? { day, month } : null;
}

function formatShortDate(date: Date): string {
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

function buildDayTable(
  period: (typeof ABSENCE_PERIODS)[number],
  rawDays: string | string[] | null | undefined,
): { date: string; present: boolean }[] {
  const absentLabels = Array.isArray(rawDays) ? rawDays : [];
  const absentDayMonths = new Set(
    absentLabels
      .map(parseDayMonth)
      .filter((x): x is { day: number; month: number } => x != null)
      .map((x) => `${x.month}-${x.day}`),
  );

  return dateRange(period.start, period.end).map((date) => ({
    date: formatShortDate(date),
    present: !absentDayMonths.has(`${date.getMonth() + 1}-${date.getDate()}`),
  }));
}

// Confirmed empirically against a real project (see stormote6-followup.md):
// checkbox answers are always plain strings ("0"/"1"), never arrays. Still
// guards against an array here defensively (a field misconfigured against
// the wrong question type shouldn't crash the step) by treating it as
// "not checked".
function isChecked(value: string | string[] | null | undefined): boolean {
  if (value == null || value === "" || Array.isArray(value)) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false";
}

function isBlankString(
  value: string | null | undefined,
): value is null | undefined {
  return value == null || value.trim() === "";
}

type SpecialNeedsPayload = {
  diet: { allergens: string[]; other: string | null };
  medicalElectricityNeeded: boolean;
  absence: { label: string; days: { date: string; present: boolean }[] }[];
};

function buildPayload(
  specialNeeds: Record<string, string | string[] | null>,
): SpecialNeedsPayload {
  const allergens = DIET_ALLERGEN_FIELDS.filter((f) =>
    isChecked(specialNeeds[f.field]),
  ).map((f) => f.label);
  const other = specialNeeds[DIET_OTHER_FIELD];
  const otherText = Array.isArray(other) ? null : other;

  const medicalElectricityNeeded = isChecked(
    specialNeeds[MEDICAL_ELECTRICITY_FIELD],
  );

  // Always all three periods. Not attending a period at all (see
  // isAttendingPeriod) overrides the per-day table entirely - every day
  // shows absent, regardless of whatever the day-level sub-answer contains.
  // Only when the period is actually attended does the per-day breakdown
  // apply, and an unmarked day within it renders as present.
  const absence = ABSENCE_PERIODS.map((p) => {
    const days = buildDayTable(p, specialNeeds[p.daysField]);
    const attending = isAttendingPeriod(p, specialNeeds);
    return {
      label: p.label,
      days: attending ? days : days.map((d) => ({ ...d, present: false })),
    };
  });

  return {
    diet: { allergens, other: isBlankString(otherText) ? null : otherText },
    medicalElectricityNeeded,
    absence,
  };
}

/**
 * Informational step for the staff self-check-in flow: always shows the
 * person their full registered special-needs picture (diet/allergens,
 * medical need for electricity, a day-by-day attendance table for all three
 * camp periods), computed at import time by the jamboree26:specialNeeds
 * enricher from their Scoutnet registration answers (see
 * enrichers/specialNeeds.ts, dataSourceConfig.yml). Every category is always
 * shown - this is a deliberate confirmation screen, not a conditional alert.
 * Note the absence default is "not attending", not "fully present": a period
 * the person didn't select in `periodsAttending` (including simply never
 * having answered that question) renders as absent every day, since the
 * form's own logic only asks about specific missed days *within* a period
 * someone already said they're attending (see isAttendingPeriod).
 */
export const specialNeedsStep: StepImplementation = {
  id: "jamboree26:specialNeeds",
  hooks: {
    async onStepStart(ctx) {
      const actor = await ctx.getActor();

      if (!actor) {
        throw new Error(
          "No actor found in context when starting jamboree26:specialNeeds step",
        );
      }

      const participant = await prisma.participant.findUniqueOrThrow({
        where: { id: actor.participant.id },
        select: { metadata: true },
      });

      const parsed = Metadata(participant.metadata ?? {});
      const specialNeeds =
        parsed instanceof type.errors ? undefined : parsed.specialNeeds;

      const payload = buildPayload(specialNeeds ?? {});

      await ctx.showScreen("jamboree26:specialNeeds:info", payload);
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

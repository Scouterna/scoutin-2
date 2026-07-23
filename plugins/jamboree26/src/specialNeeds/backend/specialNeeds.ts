import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type { StepImplementation } from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";
import { type AbsencePeriod, computeAbsence } from "../attendance.ts";

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

// `with` config for the step. `variant` selects how attendance is computed and
// which fields it reads - diet and medical are identical across variants (the
// data source's enrichWith maps each form's question IDs onto the same field
// names, see dataSourceConfig.yml), so only the attendance model differs:
// - `adult` (default): the funktionär form's period-gate (periodsAttending) +
//   per-period *absence* multiselects. Absent by default; see ABSENCE_PERIODS.
// - `child`: the "medföljande barn" form's single positive attend-list
//   multiselect (attendanceDays). Present only on explicitly selected days;
//   see CHILD_ATTENDANCE.
const Inputs = type({
  "variant?": "'adult' | 'child'",
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

// Uppdrag: which function/section/unit this person is assigned to on-site.
// Populated only from the funktionär (staff) form - the child form has no
// equivalent - so any of these may legitimately be blank/missing.
const ASSIGNMENT_FIELDS: { field: string; label: string }[] = [
  { field: "assignmentFunction", label: "Funktion" },
  { field: "assignmentSection", label: "Sektion" },
  { field: "assignmentAvdelning", label: "Avdelning" },
];

// Confirmed empirically against a real project (see stormote6-followup.md):
// checkbox answers are always plain strings ("0"/"1"), never arrays. Still
// guards against an array here defensively (a field misconfigured against
// the wrong question type shouldn't crash the step) by treating it as
// "not checked".
//
// Allow-list (fail-CLOSED), not a deny-list: only known "checked" tokens count
// as checked; anything else - including "0", "false", "", null, an array, or an
// unexpected label - is treated as unchecked. A prior deny-list version returned
// true for any non-"0"/"false" string, so when the enricher leaked the localized
// checkbox label "unchecked" (see enrichers/specialNeeds.ts) every unticked box
// rendered as checked. The enricher now keeps raw "0"/"1", so "1"/"true" already
// suffice; "checked" is kept as belt-and-suspenders so a genuine tick still shows
// if a label ever leaks again, while "unchecked" fails closed.
function isChecked(value: string | string[] | null | undefined): boolean {
  if (value == null || Array.isArray(value)) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" || normalized === "true" || normalized === "checked"
  );
}

function isBlankString(
  value: string | null | undefined,
): value is null | undefined {
  return value == null || value.trim() === "";
}

type SpecialNeedsPayload = {
  assignment: { label: string; value: string }[];
  diet: { allergens: string[]; other: string | null };
  medicalElectricityNeeded: boolean;
  absence: AbsencePeriod[];
};

function buildPayload(
  specialNeeds: Record<string, string | string[] | null>,
  variant: "adult" | "child",
): SpecialNeedsPayload {
  const allergens = DIET_ALLERGEN_FIELDS.filter((f) =>
    isChecked(specialNeeds[f.field]),
  ).map((f) => f.label);
  const other = specialNeeds[DIET_OTHER_FIELD];
  const otherText = Array.isArray(other) ? null : other;

  const medicalElectricityNeeded = isChecked(
    specialNeeds[MEDICAL_ELECTRICITY_FIELD],
  );

  // Attendance is the one part that differs by variant (diet/medical above are
  // identical - same field names, per-form question IDs handled in config); the
  // per-variant interpretation lives in the shared attendance module so the
  // import-time enricher (which precomputes the export's first-attending-day
  // column) and this screen agree exactly.
  const absence = computeAbsence(specialNeeds, variant);

  const assignment = ASSIGNMENT_FIELDS.flatMap(({ field, label }) => {
    const raw = specialNeeds[field];
    const value = Array.isArray(raw) ? null : raw;
    return isBlankString(value) ? [] : [{ label, value }];
  });

  return {
    assignment,
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
 *
 * Two variants via the `variant` input (default `adult`): the child variant
 * (fee 32359, "medföljande barn") shares the diet/medical display entirely and
 * differs only in attendance - a single positive attend-list rather than the
 * adult period-gate/absence model (see Inputs and buildChildAttendance).
 */
export const specialNeedsStep: StepImplementation = {
  id: "jamboree26:specialNeeds",
  inputs: Inputs,
  hooks: {
    async onStepStart(ctx) {
      const actor = await ctx.getActor();

      if (!actor) {
        throw new Error(
          "No actor found in context when starting jamboree26:specialNeeds step",
        );
      }

      const inputs = ctx.getInputs() as typeof Inputs.infer;
      const variant = inputs.variant ?? "adult";

      const participant = await prisma.participant.findUniqueOrThrow({
        where: { id: actor.participant.id },
        select: { metadata: true },
      });

      const parsed = Metadata(participant.metadata ?? {});
      const specialNeeds =
        parsed instanceof type.errors ? undefined : parsed.specialNeeds;

      const payload = buildPayload(specialNeeds ?? {}, variant);

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

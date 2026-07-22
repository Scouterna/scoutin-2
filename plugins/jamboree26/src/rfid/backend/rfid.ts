import { prisma } from "@scouterna/scoutin-backend/plugin-services";
import type {
  StepImplementation,
  StepMethodContext,
} from "@scouterna/scoutin-plugin-api/backend";
import { type } from "arktype";

// This step's id, and - since ctx.writeResultData namespaces by step id - the
// key its chip assignment lives under inside Participant.resultData (the
// output-side counterpart to import `metadata`; see schema.prisma). Reused for
// the reverse lookup below, so the write key and the read/query key can't
// drift. A one-off jamboree26 feature: no dedicated column, just this key in
// the generic resultData store.
const STEP_ID = "jamboree26:rfid";

// Structural subset of Participant.resultData this step reads/writes: the chip
// currently handed out to this person, if any. `assignedAt` is informational
// bookkeeping (when the tag was handed out), not read back here.
const RfidEntry = type({
  chipId: "string",
  "assignedAt?": "string",
});

// Inputs for the `scan` method: the raw tag ID the reader typed before Enter.
const ScanInputs = type({
  chipId: "string",
});

type ScanPayload = {
  // Who the tag is being handed out to (the self-checking-in staff member).
  participantName: string;
  // The chip this person already has in the DB, if any - drives the pre-scan
  // "already has a tag" warning. Null when they have none yet.
  existingChipId: string | null;
  // Set once a tag has been bound this session -> the screen switches to its
  // success state (confirmation + Continue) instead of the scanning prompt.
  // Null while still waiting to scan.
  assignedChipId: string | null;
  // Set when the scanned tag already belongs to someone else. The screen shows
  // whose it is and offers to take it over (the `steal` method re-binds it to
  // this person). Null when there's no conflict.
  conflict: { chipId: string; ownerName: string } | null;
  // A generic message for a non-conflict problem (e.g. an empty scan),
  // re-shown on the scanning prompt. Null when there's nothing to report.
  error: string | null;
};

// Reads this participant's current chip assignment from resultData, tolerating
// a missing/malformed key (treated as "no chip") rather than throwing - there's
// nothing unsafe about showing the clean-slate scan screen.
function readChipId(resultData: unknown): string | null {
  if (resultData == null || typeof resultData !== "object") return null;
  const entry = (resultData as Record<string, unknown>)[STEP_ID];
  const parsed = RfidEntry(entry ?? {});
  return parsed instanceof type.errors ? null : parsed.chipId;
}

// The scanning-prompt payload for a participant, before any tag is bound this
// session. Individual handlers spread overrides (conflict, error, success) on
// top.
function scanningPayload(
  participantName: string,
  existingChipId: string | null,
): ScanPayload {
  return {
    participantName,
    existingChipId,
    assignedChipId: null,
    conflict: null,
    error: null,
  };
}

// Binds a tag to a participant and switches the screen to its success state.
// The operator confirms (Continue -> `confirm`) to advance the flow.
async function bindTagAndShowSuccess(
  ctx: StepMethodContext,
  participantId: string,
  participantName: string,
  chipId: string,
): Promise<void> {
  // writeResultData namespaces under this step's id and preserves any other
  // resultData / the import-owned metadata.
  await ctx.writeResultData(participantId, {
    chipId,
    assignedAt: new Date().toISOString(),
  });

  await ctx.showScreen("jamboree26:rfid:scan", {
    participantName,
    existingChipId: null,
    assignedChipId: chipId,
    conflict: null,
    error: null,
  } satisfies ScanPayload);
}

// The participant currently holding a tag, if any. Used both to reject a scan
// and to identify whose tag is being taken over on a steal. Deliberately does
// NOT filter out soft-deleted participants: a physical tag held by someone who
// was later removed from the data source is still physically taken, so treating
// it as free would silently hand the same chip to two people (and a re-imported
// participant would then collide with whoever got the chip meanwhile).
function findTagOwner(chipId: string) {
  return prisma.participant.findFirst({
    where: {
      resultData: { path: [STEP_ID, "chipId"], equals: chipId },
    },
    select: { id: true, firstName: true, lastName: true },
  });
}

// This participant's current chip id, or null if they have none. Wraps the
// single-row read used by the scan/confirm re-prompts and the initial screen.
async function loadChipId(participantId: string): Promise<string | null> {
  const participant = await prisma.participant.findUniqueOrThrow({
    where: { id: participantId },
    select: { resultData: true },
  });
  return readChipId(participant.resultData);
}

/**
 * RFID tag handout for the staff self-check-in flow (single person per
 * session). The operator scans a tag - a keyboard-wedge reader that types the
 * tag ID then Enter - which is then bound to the checking-in person.
 *
 * The chip<->person mapping is stored under the `jamboree26:rfid` key in the
 * generic Participant.resultData Json column (no feature-specific schema), so
 * the Participant row is the single source of truth: no duplication into
 * session/step state, and both lookups are a single query.
 *
 * Behaviour:
 * - If the person already has a tag, the scan screen warns before scanning
 *   (they can still scan a replacement - the old tag is freed).
 * - Scanning a tag already bound to someone else shows a conflict naming the
 *   current holder; the operator can scan a different tag or take it over
 *   (`steal`), which re-binds it and clears the previous holder.
 * - Scanning an unused tag (or re-scanning the person's own tag) binds it and
 *   shows a success confirmation; the operator presses Continue (`confirm`) to
 *   advance. `confirm` only advances when a tag is actually bound.
 * - `skip` completes the step without handing out a tag, leaving any existing
 *   assignment untouched.
 *
 * Uniqueness isn't DB-enforced (resultData is a Json column); it's enforced
 * here by the lookup-before-write below. For a single operator handing out
 * tags one at a time the TOCTOU window is negligible.
 */
export const rfidStep: StepImplementation = {
  id: STEP_ID,
  hooks: {
    async onStepStart(ctx) {
      const actor = await ctx.getActor();
      if (!actor) {
        throw new Error(
          "No actor found in context when starting jamboree26:rfid step",
        );
      }

      const payload = scanningPayload(
        `${actor.participant.firstName} ${actor.participant.lastName}`,
        await loadChipId(actor.participant.id),
      );

      await ctx.showScreen("jamboree26:rfid:scan", payload);
    },
  },
  publicMethods: {
    // A scan from the reader. Rejects a tag already bound to someone else
    // (offering a takeover via `steal`); otherwise binds it and shows success.
    scan: {
      inputs: ScanInputs,
      async handler(ctx, rawInputs) {
        const { chipId: rawChipId } = rawInputs as typeof ScanInputs.infer;
        const chipId = rawChipId.trim();

        const actor = await ctx.getActor();
        if (!actor) {
          throw new Error("No actor found in context for jamboree26:rfid scan");
        }

        const participantName = `${actor.participant.firstName} ${actor.participant.lastName}`;

        // Defensive: an empty scan (reader fired Enter with no data) just
        // re-prompts rather than binding an empty tag.
        if (chipId === "") {
          await ctx.showScreen("jamboree26:rfid:scan", {
            ...scanningPayload(
              participantName,
              await loadChipId(actor.participant.id),
            ),
            error: "Ingen tagg avlästes. Försök igen.",
          } satisfies ScanPayload);
          return;
        }

        const owner = await findTagOwner(chipId);

        if (owner && owner.id !== actor.participant.id) {
          await ctx.showScreen("jamboree26:rfid:scan", {
            ...scanningPayload(
              participantName,
              await loadChipId(actor.participant.id),
            ),
            conflict: {
              chipId,
              ownerName: `${owner.firstName} ${owner.lastName}`,
            },
          } satisfies ScanPayload);
          return;
        }

        // Unused tag, or the person re-scanning their own tag: bind it. The
        // success path reads the row only once (inside writeResultData).
        await bindTagAndShowSuccess(
          ctx,
          actor.participant.id,
          participantName,
          chipId,
        );
      },
    },
    // Takes a tag over from its current owner and re-binds it to this person -
    // the action behind the "Ta över taggen" button in the conflict box.
    steal: {
      inputs: ScanInputs,
      async handler(ctx, rawInputs) {
        const { chipId: rawChipId } = rawInputs as typeof ScanInputs.infer;
        const chipId = rawChipId.trim();
        if (chipId === "") return;

        const actor = await ctx.getActor();
        if (!actor) {
          throw new Error(
            "No actor found in context for jamboree26:rfid steal",
          );
        }

        // Re-resolve the owner now - it may have changed since the scan.
        const owner = await findTagOwner(chipId);

        // Bind the tag to this person FIRST, then clear it from the previous
        // owner. These are two separate writes (not one transaction): doing the
        // bind first means a failure in between leaves the tag on *this* person
        // - the outcome the operator intended - rather than on nobody. Any stale
        // entry left on the old owner still surfaces as a re-stealable conflict
        // on a later scan. Writing null leaves the namespaced key present but
        // empty, which readChipId and the owner lookup both treat as "no tag".
        await bindTagAndShowSuccess(
          ctx,
          actor.participant.id,
          `${actor.participant.firstName} ${actor.participant.lastName}`,
          chipId,
        );

        if (owner && owner.id !== actor.participant.id) {
          await ctx.writeResultData(owner.id, null);
        }
      },
    },
    // Continue after a successful scan: advance the flow.
    confirm: {
      async handler(ctx) {
        const actor = await ctx.getActor();
        if (!actor) {
          throw new Error(
            "No actor found in context for jamboree26:rfid confirm",
          );
        }

        // Only advance if a tag was actually bound. Guards against a stale or
        // duplicate `confirm` (the double-send race) arriving before any
        // successful scan, which would otherwise complete check-in with no tag.
        // Skipping without a tag is a separate, explicit choice - see `skip`.
        if ((await loadChipId(actor.participant.id)) === null) {
          await ctx.showScreen(
            "jamboree26:rfid:scan",
            scanningPayload(
              `${actor.participant.firstName} ${actor.participant.lastName}`,
              null,
            ),
          );
          return;
        }

        await ctx.setCompleted();
      },
    },
    // Skip handing out a tag entirely, leaving any existing assignment intact.
    skip: {
      async handler(ctx) {
        await ctx.setCompleted();
      },
    },
  },
};

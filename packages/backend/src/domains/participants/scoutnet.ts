import {
  createAuthorizationHeader,
  createClient,
  type ScoutnetClient,
} from "@scouterna/scoutnet";
import { type } from "arktype";
import { prisma } from "../../app/prisma.ts";
import { BaseDataSource } from "../../config/baseDataSource.ts";
import { evaluateExpressionsInString } from "../../core/expressions/expressions.ts";
import { type Logger, logger } from "../../core/logging/logger.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import type { DataSourceImportResult } from "./data.service.ts";
import { hashIdentifier, mergeJsonKey } from "./data.service.ts";

export const ScoutnetDataSource = BaseDataSource.and({
  provider: "'scoutnet'",
  providerOptions: {
    projectId: type("string | number").pipe((v) => String(v)),
    "feeIds?": type("(string | number)[]").pipe((arr) =>
      arr.map((v) => String(v)),
    ),
    includeIndividuals: "boolean",
    includeGroups: "boolean",
    "subGroupConditions?": type.Record("string", { condition: "string" }),
    keys: {
      groups: "string",
      participants: "string",
      checkin: "string",
      questions: "string",
    },
  },
});
export type ScoutnetDataSource = typeof ScoutnetDataSource.infer;

// The import write phase is deliberately NOT wrapped in a transaction. Every
// upsert here is independent and idempotent, so a shared transaction bought
// nothing except a shared deadline (Prisma caps one at 5s by default) that a
// single slow row could blow - taking every healthy row batched with it down
// too. That failed twice as the roster grew: first as one all-or-nothing
// $transaction around the whole import, then as chunks of 100 (both P2028).
//
// Concurrency is as much the point as the removed deadline: this phase is
// latency-bound rather than CPU- or lock-bound, so keeping a handful of upserts
// in flight cuts wall-clock roughly proportionally. Capped well below the pg
// pool (10 by default) so kiosk lookups sharing this process aren't starved of
// connections mid-import.
const IMPORT_CONCURRENCY = 5;

interface ImportOp {
  /** `idInDataSource` of the row this op writes, for failure logging. */
  id: string;
  op: Prisma.PrismaPromise<unknown>;
}

/**
 * Runs every op with bounded concurrency, attempting all of them even when some
 * fail, then throws once at the end if any did.
 *
 * Failures are per-row instead of per-batch, so one bad row no longer costs the
 * rest of the roster. The final throw is deliberate even though partial
 * progress has already landed: on the import path it aborts the cycle before
 * `reconcileDataSource`, whose soft-delete pass acts on the *absence* of a
 * participant from this cycle's processed set and so must never run on a
 * partially written import. The next cycle heals it - both the import and the
 * write-back are idempotent.
 *
 * Also used by the check-in write-back for its `syncState` bookkeeping, where
 * per-row isolation matters for a second reason: a row already pushed to
 * Scoutnet must get its `syncedAt` recorded even if a sibling row's write
 * fails, or it gets re-pushed (and re-commented) next cycle.
 */
async function commitAll(ops: ImportOp[], log: Logger): Promise<void> {
  const failures: { id: string; err: unknown }[] = [];
  let next = 0;

  const worker = async () => {
    while (next < ops.length) {
      const entry = ops[next++];
      if (!entry) return;
      try {
        await entry.op;
      } catch (err) {
        failures.push({ id: entry.id, err });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(IMPORT_CONCURRENCY, ops.length) }, worker),
  );

  if (failures.length === 0) return;

  for (const { id, err } of failures) {
    log.error({ err, idInDataSource: id }, "Database write failed");
  }

  throw new Error(
    `${failures.length} of ${ops.length} database writes failed (see preceding logs)`,
  );
}

/**
 * Primary keys of this data source's groups, keyed by `idInDataSource`.
 *
 * Read after the group upserts so participants can set the `participantGroupId`
 * scalar directly instead of going through a nested `connect`. A nested write
 * disqualifies Prisma's single-statement `INSERT ... ON CONFLICT DO UPDATE`
 * path, turning every participant upsert into several sequential round trips -
 * the bulk of what made the old transactional write phase time out.
 */
async function loadGroupIdsByIdInDataSource(
  dataSourceName: string,
): Promise<Map<string, string>> {
  const groups = await prisma.participantGroup.findMany({
    where: { dataSource: dataSourceName },
    select: { id: true, idInDataSource: true },
  });

  return new Map(groups.map((g) => [g.idInDataSource, g.id]));
}

function getClient() {
  return createClient({
    baseUrl: "https://scoutnet.se/api",
  });
}

const ScoutnetGroup = type({
  groupId: type("number | string").pipe((v) => String(v)),
  name: "string",
  project_stats: type.Record("string", {
    project_id: type("number | string").pipe((v) => String(v)),
    group_participants: "number",
  }),
});

const ScoutnetParticipant = type({
  member_no: type("number | string").pipe((v) => String(v)),
  first_name: "string",
  last_name: "string",
  fee_id: type("number | string").pipe((v) => String(v)),
  "ssno?": "string",
  "date_of_birth?": "string",
  "cancelled?": "boolean",
  "group_registration_info?": {
    "group_id?": type("number | string | null"),
  },
});

export async function importScoutnetData(
  dataSource: ScoutnetDataSource,
  dataSourceName: string,
): Promise<DataSourceImportResult> {
  const start = performance.now();
  const log = logger.child({ dataSource: dataSourceName });
  log.info("Starting import of Scoutnet data");

  const client = getClient();

  // TODO: Care about includeIndividuals and includeGroups. Some events could have both groups and individuals.

  let processedGroupIds: string[] = [];
  let groupSourceRecords = new Map<string, unknown>();

  if (dataSource.providerOptions.includeGroups) {
    const {
      valid: groups,
      invalidGroups,
      sourceRecords: groupRecords,
    } = await getGroups(client, dataSource, log);
    processedGroupIds = groups.map((g) => g.groupId);
    groupSourceRecords = groupRecords;

    await commitAll(
      [
        ...groups.map((g) => ({
          id: g.groupId,
          op: prisma.participantGroup.upsert({
            where: {
              dataSource_idInDataSource: {
                dataSource: dataSourceName,
                idInDataSource: g.groupId,
              },
            },
            create: {
              dataSource: dataSourceName,
              idInDataSource: g.groupId,
              name: g.name,
            },
            update: {
              name: g.name,
              // Self-heal: a group that imports successfully again is no
              // longer in an error state.
              importErrors: {},
            },
          }),
        })),
        // Flag rows that already exist but failed validation this cycle. A
        // no-op for groups that were never successfully imported before. Flat
        // overwrite of importErrors.provider is safe here: this row still gets
        // revisited by reconcileDataSource's enrich pass moments later in the
        // same cycle, which only ever touches its own enricher key and never
        // this "provider" key.
        ...invalidGroups.map(({ id, reason }) => ({
          id,
          op: prisma.participantGroup.updateMany({
            where: { dataSource: dataSourceName, idInDataSource: id },
            data: { importErrors: { provider: reason } },
          }),
        })),
      ],
      log,
    );
  }

  const {
    valid: participants,
    invalidParticipants,
    sourceRecords: participantSourceRecords,
  } = await getParticipants(client, dataSource, log);

  const questionChoiceLabels = await getQuestionChoiceLabels(
    client,
    dataSource,
    log,
  );

  // Cancelled/removed participants are excluded from `participants` above (see
  // getParticipants) and therefore from `processedParticipantIds` below. The
  // reconcile pass in data.service.ts soft-deletes any previously-imported
  // participant for this data source that isn't in that set.

  const lookupValuesByParticipantId = new Map<string, string[]>();

  for (const p of participants) {
    const rawLookupValues = [p.member_no];

    if (p.date_of_birth && p.ssno) {
      // We store the full SSNO and assume that if the century is not included
      // when searching for a participant, it will be added before querying
      // the database.
      rawLookupValues.push(`${p.date_of_birth.replaceAll("-", "")}-${p.ssno}`);
    }

    const lookupValues = rawLookupValues.map(hashIdentifier);

    lookupValuesByParticipantId.set(p.member_no, lookupValues);
  }

  const processedParticipantIds: string[] = [];
  const skippedMissingGroups: { id: string; reason: string }[] = [];

  // Only consulted when this data source imports groups. Sources with
  // `includeGroups: false` (individual registrations) have no ParticipantGroup
  // rows to link to, so any `group_id` on their raw records is ignored - as it
  // effectively was before, when the equivalent `connect` could only ever have
  // failed for them.
  const groupIdsByIdInDataSource = dataSource.providerOptions.includeGroups
    ? await loadGroupIdsByIdInDataSource(dataSourceName)
    : new Map<string, string>();

  const upsertOps = participants.flatMap((p) => {
    const lookupValues = lookupValuesByParticipantId.get(p.member_no);

    if (!lookupValues) {
      throw new Error(`No lookup values found for participant ${p.member_no}`);
    }

    const sourceGroupId = p.group_registration_info?.group_id;
    let participantGroupId: string | undefined;

    if (dataSource.providerOptions.includeGroups) {
      if (!sourceGroupId) {
        log.warn(
          { memberNo: p.member_no },
          "Participant is missing group information, but groups are included in the data source. This participant will be skipped.",
        );
        skippedMissingGroups.push({
          id: p.member_no,
          reason:
            "Missing group information (group_id absent while includeGroups is enabled)",
        });
        return [];
      }

      participantGroupId = groupIdsByIdInDataSource.get(String(sourceGroupId));

      // The group exists at the source but has no row here - its own upsert
      // failed this cycle, or the group list and the participant list
      // disagree. Flagged and skipped rather than written with a dangling
      // reference; the previous `connect` raised on this case, which failed the
      // whole import.
      if (!participantGroupId) {
        log.warn(
          { memberNo: p.member_no, groupId: String(sourceGroupId) },
          "Participant references a group that was not imported, skipping participant.",
        );
        skippedMissingGroups.push({
          id: p.member_no,
          reason: `References group ${sourceGroupId}, which is not present in this data source`,
        });
        return [];
      }
    }

    const subGroup = resolveSubGroup(dataSource, p, log);

    processedParticipantIds.push(p.member_no);

    return [
      {
        id: p.member_no,
        op: prisma.participant.upsert({
          where: {
            dataSource_idInDataSource: {
              dataSource: dataSourceName,
              idInDataSource: p.member_no,
            },
          },
          create: {
            dataSource: dataSourceName,
            idInDataSource: p.member_no,
            firstName: p.first_name,
            lastName: p.last_name,
            lookupValues,
            participantGroupId,
            subGroup,
          },
          update: {
            firstName: p.first_name,
            lastName: p.last_name,
            lookupValues,
            participantGroupId,
            subGroup,
            // Self-heal: a participant that imports successfully again is no
            // longer in an error state or (formerly) soft-deleted.
            importErrors: {},
            deletedAt: null,
          },
        }),
      },
    ];
  });

  // Flag rows that already exist but failed validation, or that couldn't be
  // linked to a group, this cycle. A no-op for participants that were never
  // successfully imported before. Flat overwrite of importErrors.provider is
  // safe: a flagged-here participant is by construction absent from
  // processedParticipantIds, so reconcileDataSource's soft-delete pass sets
  // deletedAt on it this same cycle, and the enrich pass only visits
  // deletedAt: null rows - no enricher key gets re-added onto it regardless.
  const errorFlagOps = [...invalidParticipants, ...skippedMissingGroups].map(
    ({ id, reason }) => ({
      id,
      op: prisma.participant.updateMany({
        where: { dataSource: dataSourceName, idInDataSource: id },
        data: { importErrors: { provider: reason } },
      }),
    }),
  );

  await commitAll([...upsertOps, ...errorFlagOps], log);

  const end = performance.now();
  log.info(
    { durationSeconds: Number(((end - start) / 1000).toFixed(2)) },
    "Finished import of Scoutnet data",
  );

  return {
    participantIds: processedParticipantIds,
    groupIds: processedGroupIds,
    sourceRecords: {
      participant: participantSourceRecords,
      group: groupSourceRecords,
    },
    providerContext: questionChoiceLabels,
  };
}

/**
 * Fetches the question-ID -> choice-ID -> human-readable label lookup for
 * every form on this project, via `/project/get/questions`. This is separate
 * from the participants endpoint: answers to multiselect/choice questions
 * (e.g. which camp days someone is absent) come back on the participant
 * record as raw choice IDs, not labels - confirmed empirically against a
 * real project (see stormote6-followup.md). This endpoint is the only way to
 * resolve those IDs to their displayed text (e.g. "Lördag 11 juli").
 *
 * Fetched once per import cycle (not per participant) since it's shared,
 * project-level data. Best-effort: any failure is logged and swallowed
 * rather than failing the whole import - an enricher reading
 * `providerContext` just falls back to raw IDs when it's `undefined`.
 */
async function getQuestionChoiceLabels(
  client: ScoutnetClient,
  dataSource: ScoutnetDataSource,
  log: Logger,
): Promise<Record<string, Record<string, string>> | undefined> {
  try {
    const authHeader = createAuthorizationHeader({
      resourceId: dataSource.providerOptions.projectId,
      key: dataSource.providerOptions.keys.questions,
    });

    // Without form_id this endpoint only returns the list of form IDs on the
    // project (see `messages` hint in the response) - fetch that first, then
    // fetch each form's actual question definitions.
    const formsRes = await client.GET("/project/get/questions", {
      headers: { Authorization: authHeader },
    });

    if ("error" in formsRes) {
      throw new Error(
        `Failed to fetch question forms from Scoutnet: ${formsRes.response.status}`,
      );
    }

    const formIds = Object.keys(formsRes.data.forms ?? {});
    const labels: Record<string, Record<string, string>> = {};

    for (const formId of formIds) {
      const res = await client.GET("/project/get/questions", {
        params: { query: { form_id: Number(formId) } },
        headers: { Authorization: authHeader },
      });

      if ("error" in res) {
        log.warn(
          { formId, status: res.response.status },
          "Failed to fetch questions for a form, skipping",
        );
        continue;
      }

      for (const [questionId, question] of Object.entries(
        res.data.questions ?? {},
      )) {
        if (!question?.choices) continue;
        const choiceLabels: Record<string, string> = {};
        // The choices map's own keys already match the choice IDs that
        // appear in a participant's answer array (confirmed empirically -
        // both are the same value, just string key vs. numeric `.value`).
        for (const [choiceId, choice] of Object.entries(question.choices)) {
          if (choice?.option != null) choiceLabels[choiceId] = choice.option;
        }
        labels[questionId] = choiceLabels;
      }
    }

    return labels;
  } catch (err) {
    log.warn({ err }, "Failed to fetch Scoutnet question choice labels");
    return undefined;
  }
}

// --- Check-in write-back -----------------------------------------------------
//
// Push local check-in state back to Scoutnet via the bulk `PUT /project/checkin`
// endpoint. The endpoint takes a map of member_no -> { checked_in, attended,
// comment } and returns per-member result lists, so one request handles many
// participants. We push only deltas: a participant is "dirty" when the check-in
// value we want Scoutnet to have differs from the value we last successfully
// pushed (tracked in `syncState.scoutnet.checkin`).

// How many members to send per PUT. The endpoint is bulk, but we chunk to keep
// request bodies bounded on very large deltas. Unrelated to IMPORT_CONCURRENCY:
// this bounds one HTTP request, not database writes.
const CHECKIN_WRITEBACK_CHUNK_SIZE = 500;

// A member Scoutnet reports as not_found/no_member - or omits from its response
// entirely - is retried on an exponential backoff (its project membership may
// still be propagating, so the failure is often transient) rather than
// abandoned. This bounds retry volume without permanently dropping the
// check-in the way a hard suppress-forever would.
const CHECKIN_RETRY_BASE_MS = 60_000; // first retry after ~1 min
const CHECKIN_RETRY_MAX_MS = 60 * 60_000; // capped at 1 hour

const CheckinSyncState = type({
  // ISO string of the confirmedCheckedInAt value we last successfully pushed,
  // or null when we last pushed a checked-out state. Absent = never synced.
  "syncedAt?": "string | null",
  // Last write-back error for observability.
  "error?": "string",
  // The desired value we last failed to push (a per-member not_found/no_member,
  // or a member Scoutnet omitted from its response). Combined with `retryAfter`
  // this throttles - but never permanently suppresses - retries of that value.
  "erroredValue?": "string | null",
  // ISO timestamp before which we won't re-attempt `erroredValue`. Once it
  // passes the member is retried, so a transient failure (e.g. membership still
  // propagating) recovers on its own without the desired value changing.
  "retryAfter?": "string | null",
  // Consecutive failed attempts for `erroredValue`, driving the exponential
  // backoff. Reset once the desired value changes or a push succeeds.
  "errorCount?": "number",
});
type CheckinSyncState = typeof CheckinSyncState.infer;

// The whole `syncState` Json column: namespaced by provider then concern. Only
// scoutnet.checkin is declared; other keys are tolerated (arktype keeps
// undeclared keys) so future providers/concerns don't trip validation.
const ParticipantSyncState = type({
  "scoutnet?": {
    "checkin?": CheckinSyncState,
  },
});

type WriteBackParticipant = {
  id: string;
  idInDataSource: string;
  confirmedCheckedInAt: Date | null;
  deletedAt: Date | null;
  syncState: unknown;
};

function readCheckinSyncState(syncState: unknown): CheckinSyncState {
  // syncState is a Prisma Json field (typed `unknown`) - validate rather than
  // trust. Anything malformed (or absent) falls back to "never synced".
  const parsed = ParticipantSyncState(syncState ?? {});
  if (parsed instanceof type.errors) return {};
  return parsed.scoutnet?.checkin ?? {};
}

/**
 * Merges a new `scoutnet.checkin` sub-object into a participant's existing
 * `syncState`, preserving any other provider/concern keys at both levels (same
 * never-flat-merge discipline as the enricher metadata writes). Built from the
 * shared `mergeJsonKey` helper so the namespaced-Json encoding lives in one
 * place.
 */
function mergeCheckinSyncState(
  existing: unknown,
  checkin: CheckinSyncState,
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return mergeJsonKey(
    base,
    "scoutnet",
    mergeJsonKey(base.scoutnet, "checkin", checkin),
  );
}

/**
 * The check-in value we want Scoutnet to reflect for this participant, as an
 * ISO string (checked in at that time) or null (checked out). A soft-deleted
 * participant is forced to null so a previously-synced check-in gets one final
 * "grace pass" checkout before we go silent on them.
 */
function desiredCheckinValue(p: WriteBackParticipant): string | null {
  if (p.deletedAt) return null;
  return p.confirmedCheckedInAt ? p.confirmedCheckedInAt.toISOString() : null;
}

function isDirty(p: WriteBackParticipant, now: Date): boolean {
  const state = readCheckinSyncState(p.syncState);
  const desired = desiredCheckinValue(p);
  const synced = state.syncedAt ?? null;
  if (desired === synced) return false;
  // A value that previously failed is retried on a backoff, not suppressed
  // forever: the member may become valid in Scoutnet later (e.g. their project
  // membership finishes propagating) without the desired value changing. Only
  // skip while we're still inside the backoff window; a missing `retryAfter`
  // (older state, or never set) falls through and retries immediately.
  if (
    (state.erroredValue ?? null) === desired &&
    state.retryAfter != null &&
    now.getTime() < new Date(state.retryAfter).getTime()
  ) {
    return false;
  }
  return true;
}

/**
 * "YYYY-MM-DD HH:mm" in Europe/Stockholm - the form the comment is read in
 * inside Scoutnet. sv-SE already renders short dates as ISO-style.
 */
const stockholmDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "short",
});

function buildComment(
  p: WriteBackParticipant,
  desired: string | null,
  actorName: string | undefined,
  now: Date,
): string {
  if (desired && p.confirmedCheckedInAt) {
    const by = actorName ? ` av ${actorName}` : "";
    return `Incheckad via Scoutin${by} ${stockholmDateTime.format(p.confirmedCheckedInAt)}`;
  }
  return `Utcheckad via Scoutin ${stockholmDateTime.format(now)}`;
}

/**
 * Resolves, for each given participant id, the name of the actor (leader/kiosk
 * operator) who most recently checked them in - for the check-in comment. Only
 * meaningful for participants currently checked in; a checkout can't resolve an
 * actor anyway because undo deletes the CheckinSubject link. Self-check-ins
 * (actor == subject) resolve to undefined so the comment omits a redundant name.
 */
async function resolveActorNames(
  participantIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (participantIds.length === 0) return names;

  // One row per participant - their most recent check-in - instead of loading
  // every historical subject link and its nested session/actor graph only to
  // discard all but the newest per participant in memory. `distinct` requires
  // its column(s) to lead `orderBy`, then createdAt desc picks the newest.
  const subjects = await prisma.checkinSubject.findMany({
    where: { participantId: { in: participantIds } },
    orderBy: [{ participantId: "asc" }, { createdAt: "desc" }],
    distinct: ["participantId"],
    select: {
      participantId: true,
      checkinSession: {
        select: {
          actor: {
            select: {
              participant: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      },
    },
  });

  for (const subject of subjects) {
    if (names.has(subject.participantId)) continue;
    const actor = subject.checkinSession.actor?.participant;
    if (!actor) continue;
    // Skip self-check-in - "av <own name>" adds nothing.
    if (actor.id === subject.participantId) continue;
    names.set(subject.participantId, `${actor.firstName} ${actor.lastName}`);
  }

  return names;
}

/**
 * Pushes check-in deltas for a single Scoutnet data source back to Scoutnet.
 * Idempotent and delta-based: safe to run on a schedule. See the block comment
 * above for the dirty/sync-state model.
 */
export async function writeBackScoutnetCheckins(
  dataSource: ScoutnetDataSource,
  dataSourceName: string,
): Promise<void> {
  const log = logger.child({ dataSource: dataSourceName });

  // Prefilter in SQL to skip the majority that can never be dirty: a row that
  // was never checked in AND never synced has desired === synced === null. Any
  // row that is checked in, or that carries sync bookkeeping (covering undo and
  // the soft-delete grace pass), is loaded and dirty-checked in memory.
  const candidates: WriteBackParticipant[] = await prisma.participant.findMany({
    where: {
      dataSource: dataSourceName,
      OR: [
        { confirmedCheckedInAt: { not: null } },
        { syncState: { not: Prisma.DbNull } },
      ],
    },
    select: {
      id: true,
      idInDataSource: true,
      confirmedCheckedInAt: true,
      deletedAt: true,
      syncState: true,
    },
  });

  const now = new Date();
  const dirty = candidates.filter((p) => isDirty(p, now));
  if (dirty.length === 0) return;

  // Actor names only needed for participants we're checking IN.
  const checkInIds = dirty
    .filter((p) => desiredCheckinValue(p) !== null)
    .map((p) => p.id);
  const actorNames = await resolveActorNames(checkInIds);

  const client = getClient();
  const authHeader = createAuthorizationHeader({
    resourceId: dataSource.providerOptions.projectId,
    key: dataSource.providerOptions.keys.checkin,
  });

  log.info({ count: dirty.length }, "Writing back check-in state to Scoutnet");

  for (let i = 0; i < dirty.length; i += CHECKIN_WRITEBACK_CHUNK_SIZE) {
    const chunk = dirty.slice(i, i + CHECKIN_WRITEBACK_CHUNK_SIZE);

    const body: Record<
      string,
      { checked_in: 0 | 1; attended: 0 | 1; comment: string }
    > = {};
    for (const p of chunk) {
      const desired = desiredCheckinValue(p);
      body[p.idInDataSource] = {
        checked_in: desired ? 1 : 0,
        // Mirror checked_in: on a checkout `attended` MUST be 0, otherwise
        // Scoutnet files the member under checked_out_attended and its
        // attendance reports count an undone check-in as having attended.
        attended: desired ? 1 : 0,
        comment: buildComment(p, desired, actorNames.get(p.id), now),
      };
    }

    const res = await client.PUT("/project/checkin", {
      headers: { Authorization: authHeader },
      body,
    });

    if ("error" in res) {
      // Transient failure: leave the whole chunk dirty (no syncState write) so
      // it retries next cycle. Don't fail the other data sources.
      log.error(
        { status: res.response.status, chunkSize: chunk.length },
        "Scoutnet check-in write-back request failed, will retry next cycle",
      );
      continue;
    }

    // `data` is typed as always-present on a 2xx, but at runtime openapi-fetch
    // yields undefined for an empty/non-JSON body - guard so we don't deref it.
    const { data: result, response } = res;
    if (!result) {
      // No per-member result lists means we can't tell what landed. Treat like
      // a transient failure: leave the whole chunk dirty (no syncState write)
      // and retry next cycle.
      log.error(
        { status: response.status, chunkSize: chunk.length },
        "Scoutnet check-in write-back returned no body, will retry next cycle",
      );
      continue;
    }

    const succeeded = new Set(
      [
        ...(result.checked_in ?? []),
        ...(result.checked_out_attended ?? []),
        ...(result.checked_out_not_attended ?? []),
        ...(result.unchanged ?? []),
      ].map(String),
    );
    const perMemberError = new Map<string, string>();
    for (const id of result.not_found ?? [])
      perMemberError.set(String(id), "not_found");
    for (const id of result.no_member ?? [])
      perMemberError.set(String(id), "no_member");

    const ops: ImportOp[] = [];
    const unaccounted: string[] = [];
    for (const p of chunk) {
      const desired = desiredCheckinValue(p);
      if (succeeded.has(p.idInDataSource)) {
        // Success clears any prior error/backoff and records the value now in
        // Scoutnet.
        ops.push({
          id: p.idInDataSource,
          op: prisma.participant.update({
            where: { id: p.id },
            data: {
              syncState: mergeCheckinSyncState(p.syncState, {
                syncedAt: desired,
              }),
            },
          }),
        });
        continue;
      }

      // Not confirmed by Scoutnet: either a per-member error it reported, or a
      // member it omitted from every result list (shouldn't happen). Both are
      // retried on an exponential backoff so they neither hammer the endpoint
      // every cycle (re-sending a fresh checkout comment each time) nor get
      // abandoned permanently.
      const reason = perMemberError.get(p.idInDataSource) ?? "no_result";
      if (reason === "no_result") unaccounted.push(p.idInDataSource);

      const existing = readCheckinSyncState(p.syncState);
      const sameValue = (existing.erroredValue ?? null) === desired;
      const errorCount = (sameValue ? (existing.errorCount ?? 0) : 0) + 1;
      const backoffMs = Math.min(
        CHECKIN_RETRY_BASE_MS * 2 ** (errorCount - 1),
        CHECKIN_RETRY_MAX_MS,
      );
      ops.push({
        id: p.idInDataSource,
        op: prisma.participant.update({
          where: { id: p.id },
          data: {
            syncState: mergeCheckinSyncState(p.syncState, {
              // Keep the last good synced value; only record the failure + when
              // to next retry.
              syncedAt: existing.syncedAt ?? null,
              error: reason,
              erroredValue: desired,
              errorCount,
              retryAfter: new Date(now.getTime() + backoffMs).toISOString(),
            }),
          },
        }),
      });
    }

    if (unaccounted.length > 0) {
      log.warn(
        { members: unaccounted },
        "Scoutnet response omitted these members from all result lists; backing off before retry",
      );
    }

    await commitAll(ops, log);
  }
}

async function getGroups(
  client: ScoutnetClient,
  dataSource: ScoutnetDataSource,
  log: Logger,
): Promise<{
  valid: (typeof ScoutnetGroup.infer)[];
  invalidGroups: { id: string; reason: string }[];
  sourceRecords: Map<string, unknown>;
}> {
  const res = await client.GET("/project/get/groups", {
    headers: {
      Authorization: createAuthorizationHeader({
        resourceId: dataSource.providerOptions.projectId,
        key: dataSource.providerOptions.keys.groups,
      }),
    },
  });

  if ("error" in res) {
    throw new Error(
      `Failed to fetch groups from Scoutnet: ${res.response.status}`,
    );
  }

  const allGroups = Object.values(res.data).flatMap((org) =>
    Object.values(org.regions ?? {}).flatMap((region) =>
      Object.values(region.districts ?? {}).flatMap((district) =>
        Object.entries(district.groups),
      ),
    ),
  );

  const valid: (typeof ScoutnetGroup.infer)[] = [];
  const invalidGroups: { id: string; reason: string }[] = [];
  const sourceRecords = new Map<string, unknown>();

  for (const [groupId, g] of allGroups) {
    const out = ScoutnetGroup({ groupId, ...g });
    if (out instanceof type.errors) {
      log.warn(
        { groupId, issues: out.summary },
        "Invalid group data from Scoutnet",
      );
      // The group ID itself comes from the raw object key, independent of
      // whether the rest of the record validated, so we can still flag an
      // already-imported row even when validation fails.
      invalidGroups.push({ id: String(groupId), reason: out.summary });
      continue;
    }

    const groupParticipants =
      out.project_stats?.[dataSource.providerOptions.projectId]
        ?.group_participants ?? 0;

    if (groupParticipants <= 0) {
      log.warn(
        {
          groupId: out.groupId,
          projectId: dataSource.providerOptions.projectId,
        },
        "Group has no participants registered for project, skipping",
      );
      // Not a data error - just not part of this project. Leave as-is.
      continue;
    }

    valid.push(out);
    // Raw record (before ScoutnetGroup validation stripped it down), so an
    // enricher can read provider fields the app's own group model doesn't
    // carry. Keyed the same way as the upserted row's idInDataSource.
    sourceRecords.set(out.groupId, g);
  }

  return { valid, invalidGroups, sourceRecords };
}

async function getParticipants(
  client: ScoutnetClient,
  dataSource: ScoutnetDataSource,
  log: Logger,
): Promise<{
  valid: ScoutnetParticipantOut[];
  invalidParticipants: { id: string; reason: string }[];
  sourceRecords: Map<string, unknown>;
}> {
  const res = await client.GET("/project/get/participants", {
    headers: {
      Authorization: createAuthorizationHeader({
        resourceId: dataSource.providerOptions.projectId,
        key: dataSource.providerOptions.keys.participants,
      }),
    },
  });

  if ("error" in res) {
    throw new Error(
      `Failed to fetch participants from Scoutnet: ${res.response.status}`,
    );
  }

  if (!res.data.participants || Array.isArray(res.data.participants)) {
    throw new Error("No participants data received from Scoutnet");
  }

  const valid: ScoutnetParticipantOut[] = [];
  const invalidParticipants: { id: string; reason: string }[] = [];
  const sourceRecords = new Map<string, unknown>();

  for (const p of Object.values(res.data.participants)) {
    const out = ScoutnetParticipant(p);
    if (out instanceof type.errors) {
      log.warn(
        { memberNo: p.member_no, issues: out.summary },
        "Invalid participant data from Scoutnet",
      );
      // Best effort: only flag an existing row if we can identify which one
      // this raw record corresponds to.
      if (p.member_no != null) {
        invalidParticipants.push({
          id: String(p.member_no),
          reason: out.summary,
        });
      }
      continue;
    }

    // Cancelled participants are treated the same as participants removed
    // from the source entirely: excluded here, then soft-deleted by the
    // reconcile pass in data.service.ts if they were previously imported.
    if (out.cancelled) {
      continue;
    }

    if (
      dataSource.providerOptions.feeIds &&
      dataSource.providerOptions.feeIds.length > 0 &&
      !dataSource.providerOptions.feeIds.includes(out.fee_id)
    ) {
      continue;
    }

    valid.push(out);
    // Raw record (before ScoutnetParticipant validation stripped fields like
    // pc_details/pc_courses), so an enricher can read provider fields the
    // app's own participant model doesn't carry. out.member_no is already
    // normalized to the same string used as idInDataSource.
    sourceRecords.set(out.member_no, p);
  }

  return { valid, invalidParticipants, sourceRecords };
}

type ScoutnetParticipantOut = typeof ScoutnetParticipant.infer;

function resolveSubGroup(
  dataSource: ScoutnetDataSource,
  participant: ScoutnetParticipantOut,
  log: Logger,
): string | null {
  const conditions = dataSource.providerOptions.subGroupConditions;
  if (!conditions) return null;

  const context = { participant };

  for (const [key, { condition }] of Object.entries(conditions)) {
    const result = evaluateExpressionsInString(condition, context);
    if (typeof result === "string") {
      log.warn(
        { subGroupKey: key },
        "Subgroup condition did not evaluate to a boolean, skipping",
      );
      continue;
    }
    if (result.number()) return key;
  }

  return null;
}

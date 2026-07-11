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
import type { DataSourceImportResult } from "./data.service.ts";
import { hashLookupValue } from "./data.service.ts";

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

    await prisma.$transaction([
      ...groups.map((g) =>
        prisma.participantGroup.upsert({
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
      ),
      // Flag rows that already exist but failed validation this cycle. A
      // no-op for groups that were never successfully imported before. Flat
      // overwrite of importErrors.provider is safe here: this row still gets
      // revisited by reconcileDataSource's enrich pass moments later in the
      // same cycle, which only ever touches its own enricher key and never
      // this "provider" key.
      ...invalidGroups.map(({ id, reason }) =>
        prisma.participantGroup.updateMany({
          where: { dataSource: dataSourceName, idInDataSource: id },
          data: { importErrors: { provider: reason } },
        }),
      ),
    ]);
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

    const lookupValues = rawLookupValues.map(hashLookupValue);

    lookupValuesByParticipantId.set(p.member_no, lookupValues);
  }

  const processedParticipantIds: string[] = [];
  const skippedMissingGroups: { id: string; reason: string }[] = [];

  const upsertOps = participants.flatMap((p) => {
    const lookupValues = lookupValuesByParticipantId.get(p.member_no);

    if (!lookupValues) {
      throw new Error(`No lookup values found for participant ${p.member_no}`);
    }

    const groupId = p.group_registration_info?.group_id;

    if (dataSource.providerOptions.includeGroups && !groupId) {
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

    const participantGroup = groupId
      ? {
          connect: {
            dataSource_idInDataSource: {
              dataSource: dataSourceName,
              idInDataSource: String(groupId),
            },
          },
        }
      : undefined;

    const subGroup = resolveSubGroup(dataSource, p, log);

    processedParticipantIds.push(p.member_no);

    return [
      prisma.participant.upsert({
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
          participantGroup,
          subGroup,
        },
        update: {
          firstName: p.first_name,
          lastName: p.last_name,
          lookupValues,
          participantGroup,
          subGroup,
          // Self-heal: a participant that imports successfully again is no
          // longer in an error state or (formerly) soft-deleted.
          importErrors: {},
          deletedAt: null,
        },
      }),
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
    ({ id, reason }) =>
      prisma.participant.updateMany({
        where: { dataSource: dataSourceName, idInDataSource: id },
        data: { importErrors: { provider: reason } },
      }),
  );

  await prisma.$transaction([...upsertOps, ...errorFlagOps]);

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

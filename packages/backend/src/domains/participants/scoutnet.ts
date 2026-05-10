import {
  createAuthorizationHeader,
  createClient,
  type ScoutnetClient,
} from "@scouterna/scoutnet";
import { type } from "arktype";
import { prisma } from "../../app/prisma.ts";
import { evaluateExpressionsInString } from "../../core/expressions/expressions.ts";
import { hashLookupValue } from "./data.service.ts";

export const ScoutnetDataSource = type({
  name: "Record<string, string>",
  provider: "'scoutnet'",
  projectId: type("string | number").pipe((v) => String(v)),
  /**
   * If provided, only participants registered with these fee IDs will be imported.
   */
  "feeIds?": type("(string | number)[]").pipe((arr) =>
    arr.map((v) => String(v)),
  ),
  includeIndividuals: "boolean",
  includeGroups: "boolean",
  /**
   * Sub groups are evaluated in order for each participant. The first matching sub group is chosen.
   */
  "subGroups?": type.Record("string", {
    name: "Record<string, string>",
    condition: "string",
  }),
  keys: {
    groups: "string",
    participants: "string",
    checkin: "string",
    questions: "string",
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
) {
  const start = performance.now();
  console.log(
    `Starting import of Scoutnet data for data source "${dataSourceName}"...`,
  );

  const client = getClient();

  // TODO: Care about includeIndividuals and includeGroups. Some events could have both groups and individuals.

  if (dataSource.includeGroups) {
    const groups = await getGroups(client, dataSource);
    await prisma.$transaction(
      groups.map((g) =>
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
          },
        }),
      ),
    );
  }

  const participants = await getParticipants(client, dataSource);

  // TODO: Make sure we soft delete cancelled participants and participants that
  // are no longer present in Scoutnet. Soft delete should entail keeping them
  // in the database so that our relations don't break, but marking them as
  // deleted and anonymizing personal data.
  // TODO: Actually, delete anything that exists in the database but was not in
  // the filtered array. This means that if a participant is cancelled or
  // removed from Scoutnet, they will be deleted from our database.

  const lookupValuesByParticipantId = new Map<string, string[]>();

  for (const p of participants) {
    const rawLookupValues = [p.member_no];

    if (p.date_of_birth && p.ssno) {
      // We store the full SSNO and assume that if the century is not included
      // when searching for a participant, it will be added before querying
      // the database.
      rawLookupValues.push(`${p.date_of_birth.replaceAll("-", "")}-${p.ssno}`);
    }

    const lookupValues = await Promise.all(
      rawLookupValues.map(hashLookupValue),
    );

    lookupValuesByParticipantId.set(p.member_no, lookupValues);
  }

  await prisma.$transaction(
    participants.flatMap((p) => {
      const lookupValues = lookupValuesByParticipantId.get(p.member_no);

      if (!lookupValues) {
        throw new Error(
          `No lookup values found for participant ${p.member_no}`,
        );
      }

      const groupId = p.group_registration_info?.group_id;

      if (dataSource.includeGroups && !groupId) {
        console.warn(
          `Participant ${p.member_no} is missing group information, but groups are included in the data source. This participant will be skipped.`,
        );
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

      const subGroup = resolveSubGroup(dataSource, p);

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
          },
        }),
      ];
    }),
  );

  const end = performance.now();
  console.log(
    `Finished import of Scoutnet data for data source "${dataSourceName}" in ${(
      (end - start) / 1000
    ).toFixed(2)} seconds.`,
  );
}

async function getGroups(
  client: ScoutnetClient,
  dataSource: ScoutnetDataSource,
) {
  const res = await client.GET("/project/get/groups", {
    headers: {
      Authorization: createAuthorizationHeader({
        resourceId: dataSource.projectId,
        key: dataSource.keys.groups,
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

  return (
    allGroups
      // Remap data to validated group objects
      .flatMap(([groupId, g]) => {
        const out = ScoutnetGroup({ groupId, ...g });
        if (out instanceof type.errors) {
          console.warn(
            `Invalid group data from Scoutnet for group "${groupId}": ${out.summary}`,
          );
          return [];
        }
        return [out];
      })
      // Filter out groups that do not match criteria
      .filter((g) => {
        const groupParticipants =
          g.project_stats?.[dataSource.projectId]?.group_participants ?? 0;

        if (groupParticipants <= 0) {
          console.warn(
            `Group "${g.groupId}" has no participants registered for project ${dataSource.projectId}, skipping...`,
          );
          return false;
        }

        return true;
      })
  );
}

async function getParticipants(
  client: ScoutnetClient,
  dataSource: ScoutnetDataSource,
) {
  const res = await client.GET("/project/get/participants", {
    headers: {
      Authorization: createAuthorizationHeader({
        resourceId: dataSource.projectId,
        key: dataSource.keys.participants,
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

  return (
    Object.values(res.data.participants)
      // Remap data to validated participant objects
      .flatMap((p) => {
        const out = ScoutnetParticipant(p);
        if (out instanceof type.errors) {
          console.warn(
            `Invalid participant data from Scoutnet for participant "${p.member_no}": ${out.summary}`,
          );
          return [];
        }
        return [out];
      })
      // Filter out participants that do not match criteria
      .filter((p) => {
        if (p.cancelled) {
          return false;
        }

        if (!dataSource.feeIds || dataSource.feeIds.length === 0) {
          return true;
        }

        return dataSource.feeIds.includes(p.fee_id);
      })
  );
}

type ScoutnetParticipantOut = typeof ScoutnetParticipant.infer;

function resolveSubGroup(
  dataSource: ScoutnetDataSource,
  participant: ScoutnetParticipantOut,
): string | null {
  if (!dataSource.subGroups) return null;

  const context = { participant };

  for (const [key, subGroup] of Object.entries(dataSource.subGroups)) {
    const result = evaluateExpressionsInString(subGroup.condition, context);
    if (typeof result === "string") {
      console.warn(
        `Subgroup condition for "${key}" did not evaluate to a boolean, skipping.`,
      );
      continue;
    }
    if (result.number()) return key;
  }

  return null;
}

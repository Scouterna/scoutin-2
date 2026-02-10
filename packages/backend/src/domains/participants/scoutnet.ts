import { createAuthorizationHeader, createClient } from "@scouterna/scoutnet";
import { type } from "arktype";
import { prisma } from "../../app/prisma.ts";
import { hashLookupValue } from "./data.service.ts";

export const ScoutnetDataSource = type({
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
  keys: type({
    groups: "string",
    participants: "string",
    checkin: "string",
    questions: "string",
  }),
});
export type ScoutnetDataSource = typeof ScoutnetDataSource.infer;

function getClient() {
  return createClient({
    baseUrl: "https://scoutnet.se/api",
  });
}

const ScoutnetParticipant = type({
  member_no: type("number | string").pipe((v) => String(v)),
  first_name: "string",
  last_name: "string",
  fee_id: type("number | string").pipe((v) => String(v)),
  "ssno?": "string",
  "date_of_birth?": "string",
  "cancelled?": "boolean",
});

export async function importScoutnetData(
  dataSource: ScoutnetDataSource,
  dataSourceName: string,
) {
  const client = getClient();

  // TODO: Care about includeIndividuals and includeGroups. Some events could have both groups and individuals.

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

  const participants = Object.values(res.data.participants)
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
    });

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
    participants.map((p) => {
      const lookupValues = lookupValuesByParticipantId.get(p.member_no);

      if (!lookupValues) {
        throw new Error(
          `No lookup values found for participant ${p.member_no}`,
        );
      }

      return prisma.participant.upsert({
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
        },
        update: {
          firstName: p.first_name,
          lastName: p.last_name,
          lookupValues,
        },
      });
    }),
  );
}

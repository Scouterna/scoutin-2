import { createAuthorizationHeader, createClient } from "@scouterna/scoutnet";
import { type } from "arktype";
import { prisma } from "../app/prisma.ts";
import { hashLookupValue } from "./data.service.ts";

export const ScoutnetDataSource = type({
  provider: "'scoutnet'",
  projectId: "string | number",
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
  "ssno?": "string",
  "date_of_birth?": "string",
  "cancelled?": "boolean",
});

export async function importScoutnetData(
  dataSource: ScoutnetDataSource,
  dataSourceName: string,
) {
  const client = getClient();

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

  const participants = Object.values(res.data.participants);
  const validParticipants = participants.flatMap((p) => {
    const out = ScoutnetParticipant(p);
    if (out instanceof type.errors) {
      console.warn(
        `Invalid participant data from Scoutnet for participant "${p.member_no}": ${out.summary}`,
      );
      return [];
    }
    return [out];
  });

  // TODO: Make sure we soft delete cancelled participants and participants that
  // are no longer present in Scoutnet. Soft delete should entail keeping them
  // in the database so that our relations don't break, but marking them as
  // deleted and anonymizing personal data.

  const lookupValuesByParticipantId = new Map<string, string[]>();

  for (const p of validParticipants) {
    const rawLookupValues = [p.member_no];

    if (p.date_of_birth && p.ssno) {
      // We store the full SSNO and assume that if the century is not included
      // when searching for a participant, it will be added before querying
      // the database.
      rawLookupValues.push(`${p.date_of_birth.replaceAll("-", "")}${p.ssno}`);
    }

    const lookupValues = await Promise.all(
      rawLookupValues.map(hashLookupValue),
    );

    lookupValuesByParticipantId.set(p.member_no, lookupValues);
  }

  await prisma.$transaction(
    validParticipants.map((p) => {
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

import { prisma } from "../../app/prisma.ts";
import { recursivelyEvaluateExpressions } from "../../core/expressions/expressions.ts";
import { logger } from "../../core/logging/logger.ts";
import type { Participant } from "../../generated/prisma/client.ts";
import { dataSourceConfig } from "../participants/data.service.ts";
import { checkinStatus } from "../participants/reports.service.ts";

const log = logger.child({ module: "publicApi" });

export type PublicParticipant = {
  id: string;
  dataSource: string;
  idInDataSource: string;
  checkinStatus: ReturnType<typeof checkinStatus>;
  confirmedCheckedInAt: string | null;
  preliminaryCheckedInAt: string | null;
  firstName: string;
  lastName: string;
  subGroup: string | null;
  fields: Record<string, unknown>;
};

type ParticipantRow = Participant;

/**
 * Evaluates the data source's `publicApi.fields` for one participant. An
 * expression that fails to evaluate gives null for that field.
 */
function evaluateFields(
  dataSource: string,
  participant: ParticipantRow,
): Record<string, unknown> {
  const expressions =
    dataSourceConfig.dataSources[dataSource]?.publicApi?.fields ?? {};
  const context = { participant };

  const fields: Record<string, unknown> = {};
  for (const [name, expression] of Object.entries(expressions)) {
    try {
      fields[name] =
        recursivelyEvaluateExpressions(expression, context) ?? null;
    } catch (error) {
      log.warn({ error, dataSource, field: name }, "Public API field failed");
      fields[name] = null;
    }
  }
  return fields;
}

/**
 * The participant as the public API shows it, or null when the data source or
 * participant is unknown or the participant is cancelled (`deletedAt` set).
 * Rows with import errors are answered like any other.
 */
export async function getPublicParticipant(
  dataSource: string,
  idInDataSource: string,
): Promise<PublicParticipant | null> {
  if (!Object.hasOwn(dataSourceConfig.dataSources, dataSource)) return null;

  const participant = await prisma.participant.findUnique({
    where: {
      dataSource_idInDataSource: { dataSource, idInDataSource },
      deletedAt: null,
    },
  });
  if (!participant) return null;

  return {
    id: participant.id,
    dataSource: participant.dataSource,
    idInDataSource: participant.idInDataSource,
    checkinStatus: checkinStatus(participant),
    confirmedCheckedInAt:
      participant.confirmedCheckedInAt?.toISOString() ?? null,
    preliminaryCheckedInAt:
      participant.preliminaryCheckedInAt?.toISOString() ?? null,
    firstName: participant.firstName,
    lastName: participant.lastName,
    subGroup: participant.subGroup,
    fields: evaluateFields(dataSource, participant),
  };
}

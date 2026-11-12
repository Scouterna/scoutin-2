import { join } from "node:path";
import { type } from "arktype";
import { Hono } from "hono";
import {
  describeRoute,
  openAPIRouteHandler,
  resolver,
  validator,
} from "hono-openapi";
import config from "../../config/config.ts";
import type { DataSourceConfig } from "../../config/dataSourceConfig.ts";
import type { AppEnv } from "../../core/websocket/types.ts";
import {
  requireApiKey,
  requirePermission,
} from "../apiKeys/apiKeys.service.ts";
import { recordAudit } from "../audit/audit.service.ts";
import { dataSourceConfig } from "../participants/data.service.ts";
import { getPublicParticipant } from "./publicApi.service.ts";

const AUDIT_ACTION = "public-api.participants.read";

const ParticipantResponse = type({
  id: "string",
  dataSource: "string",
  idInDataSource: "string",
  checkinStatus: "'confirmed' | 'preliminaryOnly' | 'missing'",
  confirmedCheckedInAt: "string | null",
  preliminaryCheckedInAt: "string | null",
  firstName: "string",
  lastName: "string",
  subGroup: "string | null",
  fields: "Record<string, unknown>",
});

const ErrorResponse = (code: string) => type({ error: type.unit(code) });

const Params = type({
  dataSource: "string > 0",
  idInDataSource: "string > 0",
});

/**
 * The documented 200 body: the static shape with `dataSource` narrowed to the
 * configured data source names and `fields` to the keys the config exposes. A
 * key is required when every data source exposes it.
 */
export function buildParticipantSchema(config: DataSourceConfig) {
  const sources = Object.entries(config.dataSources);
  if (sources.length === 0) return ParticipantResponse;

  const keysOf = (source: DataSourceConfig["dataSources"][string]) =>
    Object.keys(source.publicApi?.fields ?? {});
  const allKeys = new Set(sources.flatMap(([, source]) => keysOf(source)));
  const fields: Record<string, string> = {};
  for (const key of allKeys) {
    const everywhere = sources.every(([, source]) =>
      keysOf(source).includes(key),
    );
    fields[everywhere ? key : `${key}?`] = "unknown";
  }

  return ParticipantResponse.merge({
    dataSource: type.enumerated(...sources.map(([name]) => name)),
    fields,
  });
}

const DocumentedParticipant = buildParticipantSchema(dataSourceConfig);

const bearerSecurity = [{ bearerAuth: [] }];

function json(schema: Parameters<typeof resolver>[0], description: string) {
  return {
    description,
    content: { "application/json": { schema: resolver(schema) } },
  };
}

export const publicApiRouter = new Hono<AppEnv>();

publicApiRouter
  // Declared before requireApiKey so the spec needs no key.
  .get(
    "/openapi.json",
    openAPIRouteHandler(publicApiRouter, {
      documentation: {
        info: { title: "Scoutin public API", version: "1.0.0" },
        servers: [{ url: join(config.BASE_PATH, "/api/public/v1") }],
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
      },
    }),
  )
  .use("*", requireApiKey)
  .get(
    "/data-sources/:dataSource/participants/:idInDataSource",
    describeRoute({
      summary: "Get a participant and their check-in status",
      security: bearerSecurity,
      responses: {
        200: json(DocumentedParticipant, "The participant"),
        400: json(ErrorResponse("bad_request"), "Invalid parameters"),
        401: json(ErrorResponse("unauthorized"), "Missing or invalid API key"),
        403: json(
          ErrorResponse("forbidden"),
          "The key lacks participants:read",
        ),
        404: json(
          ErrorResponse("not_found"),
          "Unknown data source or participant",
        ),
      },
    }),
    requirePermission("participants:read", AUDIT_ACTION),
    validator<typeof Params, "param", AppEnv, string>(
      "param",
      Params,
      async (result, c) => {
        if (!result.success) {
          await recordAudit({
            actor: `api-key:${c.get("apiKey")?.id}`,
            action: AUDIT_ACTION,
            details: { participantId: null },
          });
          return c.json({ error: "bad_request" as const }, 400);
        }
      },
    ),
    async (c) => {
      const { dataSource, idInDataSource } = c.req.valid("param");
      const participant = await getPublicParticipant(
        dataSource,
        idInDataSource,
      );

      await recordAudit({
        actor: `api-key:${c.get("apiKey")?.id}`,
        action: AUDIT_ACTION,
        details: { participantId: participant?.id ?? null },
      });

      if (!participant) return c.json({ error: "not_found" as const }, 404);
      return c.json(
        participant satisfies typeof ParticipantResponse.infer,
        200,
      );
    },
  );

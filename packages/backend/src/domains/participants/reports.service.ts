import ExcelJS from "exceljs";
import { prisma } from "../../app/prisma.ts";
import type { EnrichWithEntry } from "../../config/baseDataSource.ts";
import {
  DEFAULT_LANGUAGE,
  resolveLocalized,
} from "../../core/i18n/localized.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { enricherRegistry } from "../workflows/steps.ts";
import {
  dataSourceConfig,
  hashIdentifier,
  hasImportErrors,
  resolveEnrichEntry,
} from "./data.service.ts";

/**
 * Resolves a localized `{ sv: "...", en: "..." }`-style name map to a single
 * display string, falling back to the raw config key so a misconfigured or
 * missing name never disappears from a report. The locale fallback chain
 * itself lives in `core/i18n/localized.ts`.
 */
export function pickLocalizedName(
  map: Record<string, string> | undefined,
  locale: string,
  fallbackKey: string,
): string {
  if (!map) return fallbackKey;
  return resolveLocalized(map, locale) || fallbackKey;
}

export type StatusBucket =
  | "confirmed"
  | "preliminaryOnly"
  | "missing"
  | "importError"
  | "cancelled";

export const STATUS_BUCKETS: StatusBucket[] = [
  "confirmed",
  "preliminaryOnly",
  "missing",
  "importError",
  "cancelled",
];

export type StatusCounts = Record<StatusBucket, number> & { total: number };

function emptyCounts(): StatusCounts {
  return {
    confirmed: 0,
    preliminaryOnly: 0,
    missing: 0,
    importError: 0,
    cancelled: 0,
    total: 0,
  };
}

function addTo(counts: StatusCounts, bucket: StatusBucket) {
  counts[bucket] += 1;
  counts.total += 1;
}

/**
 * Single, mutually-exclusive precedence so the five buckets are disjoint and
 * sum to `total`: cancelled/import-errored participants are surfaced *for*
 * staff (mirroring getSessionContext's deliberate filter-bypass) rather than
 * hidden, so those states win over an otherwise-confirmed check-in - e.g. a
 * participant confirmed and later cancelled is reported as "cancelled".
 */
function classifyParticipant(p: {
  deletedAt: Date | null;
  importErrors: unknown;
  confirmedCheckedInAt: Date | null;
  preliminaryCheckedInAt: Date | null;
}): StatusBucket {
  if (p.deletedAt != null) return "cancelled";
  if (hasImportErrors(p.importErrors)) return "importError";
  if (p.confirmedCheckedInAt != null) return "confirmed";
  if (p.preliminaryCheckedInAt != null) return "preliminaryOnly";
  return "missing";
}

export type MemberRow = {
  id: string;
  memberNumber: string;
  firstName: string;
  lastName: string;
  subGroup: string | null;
  subGroupName: string | null;
  status: StatusBucket;
  confirmedCheckedInAt: string | null;
  preliminaryCheckedInAt: string | null;
  hasImportErrors: boolean;
  importErrors: unknown;
  metadata: Record<string, unknown>;
};

export type GroupNode = {
  id: string | null;
  name: string;
  kind: "group" | "subGroup" | "ungrouped";
  counts: StatusCounts;
  hasImportErrors: boolean;
  // Raw reasons, same shape/semantics as MemberRow.importErrors - staff should
  // see *why* a group is flagged, not just that it is (mirrors getSessionContext).
  importErrors: unknown;
  groupMetadata: Record<string, unknown>;
  members: MemberRow[];
};

export type SourceNode = {
  key: string;
  name: string;
  hierarchical: boolean;
  memberMetadataColumns: string[];
  groupMetadataColumns: string[];
  counts: StatusCounts;
  groups: GroupNode[];
};

export type RosterResponse = {
  generatedAt: string;
  locale: string;
  sources: SourceNode[];
};

function pickKeys(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): Record<string, unknown> {
  if (!record) return {};
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in record) picked[key] = record[key];
  }
  return picked;
}

/** Splits a source's `enrichWith` map into member-level vs group-level metadata
 * keys, based on each referenced enricher's registered `target`. An unknown or
 * unregistered enricher name defaults to member-level - conservative, since
 * that's where the vast majority of enrichers write. */
function splitMetadataColumns(
  enrichWith: Record<string, EnrichWithEntry> | undefined,
) {
  const memberMetadataColumns: string[] = [];
  const groupMetadataColumns: string[] = [];

  for (const [metadataKey, rawEntry] of Object.entries(enrichWith ?? {})) {
    const { name: enricherName } = resolveEnrichEntry(rawEntry);
    const enricher = enricherRegistry.get(enricherName);
    if (enricher?.target === "group") {
      groupMetadataColumns.push(metadataKey);
    } else {
      memberMetadataColumns.push(metadataKey);
    }
  }

  return { memberMetadataColumns, groupMetadataColumns };
}

type ParticipantRow = {
  id: string;
  idInDataSource: string;
  dataSource: string;
  firstName: string;
  lastName: string;
  subGroup: string | null;
  participantGroupId: string | null;
  preliminaryCheckedInAt: Date | null;
  confirmedCheckedInAt: Date | null;
  metadata: unknown;
  importErrors: unknown;
  deletedAt: Date | null;
};

type ParticipantGroupRow = {
  id: string;
  dataSource: string;
  name: string;
  metadata: unknown;
  importErrors: unknown;
};

function toMemberRow(
  p: ParticipantRow,
  subGroupName: string | null,
  memberMetadataColumns: string[],
): MemberRow {
  return {
    id: p.id,
    // idInDataSource holds the Scoutnet member number for the scoutnet source
    // (see scoutnet.ts, where it's set from member_no).
    memberNumber: p.idInDataSource,
    firstName: p.firstName,
    lastName: p.lastName,
    subGroup: p.subGroup,
    subGroupName,
    status: classifyParticipant(p),
    confirmedCheckedInAt: p.confirmedCheckedInAt?.toISOString() ?? null,
    preliminaryCheckedInAt: p.preliminaryCheckedInAt?.toISOString() ?? null,
    hasImportErrors: hasImportErrors(p.importErrors),
    importErrors: p.importErrors ?? null,
    metadata: pickKeys(
      p.metadata as Record<string, unknown> | null,
      memberMetadataColumns,
    ),
  };
}

function emptyGroupNode(
  id: string | null,
  name: string,
  kind: GroupNode["kind"],
): GroupNode {
  return {
    id,
    name,
    kind,
    counts: emptyCounts(),
    hasImportErrors: false,
    importErrors: null,
    groupMetadata: {},
    members: [],
  };
}

/**
 * Builds the full staff-facing roster across every configured data source.
 * Mirrors getSessionContext's philosophy: query participants/groups with NO
 * deletedAt/import-error filtering, then classify in memory - cancelled and
 * errored entities must be visible here even though the kiosk hides them.
 *
 * Grouping is derived from the data, not from provider-specific config: a
 * source with at least one ParticipantGroup is rendered as a group tree
 * (expand a group -> members); a source with none is flat and, when its
 * config declares subGroups, is instead bucketed by subGroup.
 */
export async function buildRoster(opts?: {
  locale?: string;
  sourceKey?: string;
}): Promise<RosterResponse> {
  const locale = opts?.locale ?? DEFAULT_LANGUAGE;

  const configuredKeys = Object.keys(dataSourceConfig.dataSources);
  const sourceKeys = opts?.sourceKey
    ? configuredKeys.filter((key) => key === opts.sourceKey)
    : configuredKeys;

  const [groups, participants] = await Promise.all([
    prisma.participantGroup.findMany({
      where: { dataSource: { in: sourceKeys } },
      select: {
        id: true,
        dataSource: true,
        name: true,
        metadata: true,
        importErrors: true,
      },
    }) as Promise<ParticipantGroupRow[]>,
    prisma.participant.findMany({
      where: { dataSource: { in: sourceKeys } },
      select: {
        id: true,
        idInDataSource: true,
        dataSource: true,
        firstName: true,
        lastName: true,
        subGroup: true,
        participantGroupId: true,
        preliminaryCheckedInAt: true,
        confirmedCheckedInAt: true,
        metadata: true,
        importErrors: true,
        deletedAt: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }) as Promise<ParticipantRow[]>,
  ]);

  // A dataSource value present in the DB but no longer in config (e.g. a
  // removed event) still needs to surface, per the surface-issues-not-hide
  // philosophy - synthesize a source node for it instead of silently
  // dropping its participants/groups from the report.
  const orphanKeys = new Set<string>();
  for (const row of [...groups, ...participants]) {
    if (!(row.dataSource in dataSourceConfig.dataSources)) {
      orphanKeys.add(row.dataSource);
    }
  }

  const sourceNodes = new Map<string, SourceNode>();
  const groupNodesBySource = new Map<string, Map<string, GroupNode>>();

  for (const key of [...sourceKeys, ...orphanKeys]) {
    const config = dataSourceConfig.dataSources[key];
    const { memberMetadataColumns, groupMetadataColumns } =
      splitMetadataColumns(config?.enrichWith);

    sourceNodes.set(key, {
      key,
      name: config ? pickLocalizedName(config.name, locale, key) : key,
      // Determined below once groups are indexed, since it must reflect the
      // actual data (does this source have any ParticipantGroup rows), not a
      // provider-specific config flag.
      hierarchical: false,
      memberMetadataColumns,
      groupMetadataColumns,
      counts: emptyCounts(),
      groups: [],
    });
    groupNodesBySource.set(key, new Map());
  }

  // Index real ParticipantGroups first, so participants can be routed to them.
  for (const group of groups) {
    const source = sourceNodes.get(group.dataSource);
    if (!source) continue;

    source.hierarchical = true;

    const config = dataSourceConfig.dataSources[group.dataSource];
    const { groupMetadataColumns } = splitMetadataColumns(config?.enrichWith);

    const node = emptyGroupNode(group.id, group.name, "group");
    node.hasImportErrors = hasImportErrors(group.importErrors);
    node.importErrors = group.importErrors ?? null;
    node.groupMetadata = pickKeys(
      group.metadata as Record<string, unknown> | null,
      groupMetadataColumns,
    );

    groupNodesBySource.get(group.dataSource)?.set(group.id, node);
    source.groups.push(node);
  }

  for (const p of participants) {
    const source = sourceNodes.get(p.dataSource);
    if (!source) continue;

    const config = dataSourceConfig.dataSources[p.dataSource];
    const subGroupName = p.subGroup
      ? pickLocalizedName(
          config?.subGroups?.[p.subGroup]?.name,
          locale,
          p.subGroup,
        )
      : null;

    const member = toMemberRow(p, subGroupName, source.memberMetadataColumns);
    const nodesByKey = groupNodesBySource.get(p.dataSource);

    let node: GroupNode | undefined;

    if (source.hierarchical) {
      const nodeKey = p.participantGroupId ?? "__ungrouped__";
      node = nodesByKey?.get(nodeKey);
      if (!node) {
        node = emptyGroupNode(
          p.participantGroupId,
          p.participantGroupId ? p.participantGroupId : "Utan grupp",
          "ungrouped",
        );
        nodesByKey?.set(nodeKey, node);
        source.groups.push(node);
      }
    } else if (config?.subGroups) {
      const nodeKey = p.subGroup ?? "__ungrouped__";
      node = nodesByKey?.get(nodeKey);
      if (!node) {
        node = emptyGroupNode(
          p.subGroup,
          subGroupName ?? "Utan undergrupp",
          "subGroup",
        );
        nodesByKey?.set(nodeKey, node);
        source.groups.push(node);
      }
    } else {
      // Fully flat source, no subGroups configured: a single node holding
      // everyone.
      const nodeKey = "__flat__";
      node = nodesByKey?.get(nodeKey);
      if (!node) {
        node = emptyGroupNode(null, source.name, "ungrouped");
        nodesByKey?.set(nodeKey, node);
        source.groups.push(node);
      }
    }

    node.members.push(member);
    addTo(node.counts, member.status);
    addTo(source.counts, member.status);
  }

  return {
    generatedAt: new Date().toISOString(),
    locale,
    sources: Array.from(sourceNodes.values()),
  };
}

export type SourceSummary = {
  key: string;
  name: string;
  counts: StatusCounts;
};

export type RosterSummaryResponse = {
  generatedAt: string;
  locale: string;
  sources: SourceSummary[];
};

/**
 * Lightweight counts-only roster for the live-polled dashboard view. Unlike
 * buildRoster, this selects only the scalar fields classifyParticipant needs
 * and never queries ParticipantGroup at all, so its cost stays flat
 * regardless of total participant count - the full nested buildRoster (all
 * fields, every group, every member) is reserved for the on-demand CSV
 * export, never fetched on a poll interval. Shipping that full payload to the
 * browser every few seconds is what made the dashboard unusable at scale.
 */
export async function buildRosterSummary(opts?: {
  locale?: string;
}): Promise<RosterSummaryResponse> {
  const locale = opts?.locale ?? DEFAULT_LANGUAGE;
  const sourceKeys = Object.keys(dataSourceConfig.dataSources);

  const participants = await prisma.participant.findMany({
    where: { dataSource: { in: sourceKeys } },
    select: {
      dataSource: true,
      confirmedCheckedInAt: true,
      preliminaryCheckedInAt: true,
      importErrors: true,
      deletedAt: true,
    },
  });

  const countsByKey = new Map<string, StatusCounts>();
  for (const key of sourceKeys) countsByKey.set(key, emptyCounts());

  const orphanKeys = new Set<string>();
  for (const p of participants) {
    if (!countsByKey.has(p.dataSource)) {
      countsByKey.set(p.dataSource, emptyCounts());
      orphanKeys.add(p.dataSource);
    }
    const counts = countsByKey.get(p.dataSource);
    if (counts) addTo(counts, classifyParticipant(p));
  }

  const sources: SourceSummary[] = [...sourceKeys, ...orphanKeys].map((key) => {
    const config = dataSourceConfig.dataSources[key];
    return {
      key,
      name: config ? pickLocalizedName(config.name, locale, key) : key,
      counts: countsByKey.get(key) ?? emptyCounts(),
    };
  });

  return { generatedAt: new Date().toISOString(), locale, sources };
}

export type SearchResultRow = MemberRow & {
  sourceName: string;
  groupName: string | null;
};

export type ParticipantListResult = {
  results: SearchResultRow[];
  // Total matching the active filters (search + status), ignoring limit/offset
  // - lets the client show a count and know when to stop paging.
  total: number;
  // Per-bucket counts for the current search, deliberately computed *without*
  // the status filter applied, so the status pills always show the full
  // breakdown and toggling one pill never changes another's count.
  statusCounts: Record<StatusBucket, number>;
};

function emptyBucketCounts(): Record<StatusBucket, number> {
  return {
    confirmed: 0,
    preliminaryOnly: 0,
    missing: 0,
    importError: 0,
    cancelled: 0,
  };
}

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

type RawSearchRow = ParticipantRow & { groupName: string | null };

/**
 * SQL mirror of classifyParticipant's precedence, computing the same five
 * disjoint status buckets Postgres-side so the browse view can filter by
 * status without shipping the full roster to the browser. importErrors is a
 * jsonb column (Prisma `Json`); "has errors" means a non-empty object, matching
 * hasImportErrors (a jsonb `null` or `{}` is not an error).
 */
const STATUS_CASE_SQL = Prisma.sql`
  CASE
    WHEN p."deletedAt" IS NOT NULL THEN 'cancelled'
    WHEN p."importErrors" IS NOT NULL
      AND jsonb_typeof(p."importErrors") = 'object'
      AND p."importErrors" <> '{}'::jsonb THEN 'importError'
    WHEN p."confirmedCheckedInAt" IS NOT NULL THEN 'confirmed'
    WHEN p."preliminaryCheckedInAt" IS NOT NULL THEN 'preliminaryOnly'
    ELSE 'missing'
  END
`;

/**
 * Server-side, paginated participant listing, pushed down to Postgres instead
 * of shipping the full roster to the browser for client-side filtering - the
 * latter doesn't scale past a few thousand participants (it was the actual
 * cause of the reported lag at ~20k rows).
 *
 * With no `query` it browses everyone (the admin "Deltagare" list); with one it
 * matches per whitespace-separated word, each word required to hit firstName OR
 * lastName, so "anders sagnell" matches "Anders Baba Sagnell" without a computed
 * full-name column. `statuses`, when given, restricts to those buckets
 * (undefined = all; empty = none). Results are windowed with LIMIT/OFFSET and a
 * fully-specified, stable ORDER BY (id as final tiebreaker) so paging can't
 * shuffle or duplicate rows across pages.
 */
export async function listParticipants(opts?: {
  query?: string;
  statuses?: StatusBucket[];
  limit?: number;
  offset?: number;
  locale?: string;
}): Promise<ParticipantListResult> {
  const locale = opts?.locale ?? DEFAULT_LANGUAGE;
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(opts?.limit ?? DEFAULT_PAGE_SIZE)),
  );

  const sourceKeys = Object.keys(dataSourceConfig.dataSources);
  if (sourceKeys.length === 0) {
    return { results: [], total: 0, statusCounts: emptyBucketCounts() };
  }

  // Base predicate shared by the rows page and the status breakdown: data
  // source scope plus the name search, but *not* the status filter.
  const baseConditions: ReturnType<typeof Prisma.sql>[] = [
    Prisma.sql`p."dataSource" IN (${Prisma.join(sourceKeys)})`,
  ];

  const words = (opts?.query ?? "").trim().split(/\s+/).filter(Boolean);
  for (const word of words) {
    const pattern = `%${word}%`;
    // Match on name OR on a hashed identifier: identifiers (member number,
    // personnummer) are only stored as hashes in lookupValues, never as plain
    // text, so ILIKE can't find them - hash the word the same way import does
    // and test array membership. Non-identifier words simply won't match a hash.
    const identifierHash = hashIdentifier(word);
    baseConditions.push(
      Prisma.sql`(p."firstName" ILIKE ${pattern} OR p."lastName" ILIKE ${pattern} OR ${identifierHash} = ANY(p."lookupValues"))`,
    );
  }

  const baseWhere = Prisma.join(baseConditions, " AND ");

  const statuses = opts?.statuses;
  const noneVisible = statuses !== undefined && statuses.length === 0;
  // Skip the status predicate when every bucket is visible - it's a pure
  // no-op filter then, and dropping it lets Postgres avoid evaluating the CASE.
  const partialStatusFilter =
    statuses !== undefined &&
    statuses.length > 0 &&
    statuses.length < STATUS_BUCKETS.length;

  const rowConditions = [...baseConditions];
  if (partialStatusFilter) {
    rowConditions.push(
      Prisma.sql`(${STATUS_CASE_SQL}) IN (${Prisma.join(statuses)})`,
    );
  }
  const rowWhere = Prisma.join(rowConditions, " AND ");

  // "Everything hidden" would produce `IN ()` (invalid SQL) and can never
  // match, so skip the rows query entirely - but still run the breakdown so
  // the pills keep showing their counts.
  const rowsPromise = noneVisible
    ? Promise.resolve([] as RawSearchRow[])
    : prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
      SELECT
        p.id,
        p."idInDataSource",
        p."dataSource",
        p."firstName",
        p."lastName",
        p."subGroup",
        p."participantGroupId",
        p."preliminaryCheckedInAt",
        p."confirmedCheckedInAt",
        p.metadata,
        p."importErrors",
        p."deletedAt",
        g.name AS "groupName"
      FROM "Participant" p
      LEFT JOIN "ParticipantGroup" g ON g.id = p."participantGroupId"
      WHERE ${rowWhere}
      ORDER BY p."lastName" ASC, p."firstName" ASC, p.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

  const [rows, breakdownRows] = await Promise.all([
    rowsPromise,
    prisma.$queryRaw<{ status: StatusBucket; count: bigint }[]>(Prisma.sql`
      SELECT (${STATUS_CASE_SQL}) AS status, COUNT(*)::bigint AS count
      FROM "Participant" p
      WHERE ${baseWhere}
      GROUP BY status
    `),
  ]);

  const statusCounts = emptyBucketCounts();
  for (const row of breakdownRows) {
    if (row.status in statusCounts)
      statusCounts[row.status] = Number(row.count);
  }

  // Total under the active status filter = sum of the visible buckets (all of
  // them when no filter is set). Disjoint buckets, so this equals a filtered
  // COUNT without a second query.
  const visibleBuckets = statuses ?? STATUS_BUCKETS;
  const total = visibleBuckets.reduce((sum, b) => sum + statusCounts[b], 0);

  const results = rows.map((p) => {
    const config = dataSourceConfig.dataSources[p.dataSource];
    const { memberMetadataColumns } = splitMetadataColumns(config?.enrichWith);
    const subGroupName = p.subGroup
      ? pickLocalizedName(
          config?.subGroups?.[p.subGroup]?.name,
          locale,
          p.subGroup,
        )
      : null;

    return {
      ...toMemberRow(p, subGroupName, memberMetadataColumns),
      sourceName: config
        ? pickLocalizedName(config.name, locale, p.dataSource)
        : p.dataSource,
      groupName: p.groupName,
    };
  });

  return { results, total, statusCounts };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Turns a single metadata value into a flat map of column path -> cell string.
 * Metadata values are arbitrary JSON: enrichers write plain strings, multiselect
 * arrays (jamboree26:specialNeeds), and nested objects (scoutnet:safeFromHarm
 * writes `{ completed, completedAt, source }`). Without flattening, an object
 * value stringifies to the useless "[object Object]".
 *
 * - primitive/null -> a single cell keyed by `prefix`
 * - array -> a single cell, elements scalarized and joined with "; " (multiselect
 *   answers are string[], so this reads naturally in one column)
 * - plain object -> recurse, expanding each entry into its own `prefix.key`
 *   column (so `safeFromHarm` becomes `safeFromHarm.completed`, etc.)
 */
function flattenMetadataValue(
  value: unknown,
  prefix: string,
): Record<string, string> {
  if (value === null || value === undefined) {
    return { [prefix]: "" };
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { [prefix]: String(value) };
  }
  if (Array.isArray(value)) {
    const joined = value
      .map((el) =>
        el === null || el === undefined || typeof el === "object"
          ? // Nested objects/arrays inside a list have no sensible column
            // expansion; JSON keeps them lossless rather than "[object Object]".
            el == null
            ? ""
            : JSON.stringify(el)
          : String(el),
      )
      .join("; ");
    return { [prefix]: joined };
  }
  // Plain object: expand each entry into its own leaf column.
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flattenMetadataValue(child, `${prefix}.${key}`));
  }
  return out;
}

/**
 * Flattens a roster into a header row plus one row per member. Fixed columns
 * come first, followed by a dynamic, sorted union of every member's flattened
 * metadata leaf columns (blank when a given member lacks that column). Shared by
 * both the CSV and XLSX exporters so they always agree on columns and values.
 */
export function rosterToRows(roster: RosterResponse): {
  headers: string[];
  rows: string[][];
} {
  const fixedColumns = [
    "source",
    "group",
    "subGroup",
    "memberNumber",
    "firstName",
    "lastName",
    "status",
    "confirmedCheckedInAt",
    "preliminaryCheckedInAt",
    "hasImportErrors",
  ];

  // The candidate metadata keys per source (the enrichWith-declared columns).
  const metadataKeys = Array.from(
    new Set(roster.sources.flatMap((s) => s.memberMetadataColumns)),
  );

  // Pass 1: flatten every member's metadata to discover the full set of leaf
  // columns (an object value expands into several), then sort for stable output.
  const flattenedByMember: Record<string, string>[] = [];
  const metadataColumnSet = new Set<string>();

  for (const source of roster.sources) {
    for (const group of source.groups) {
      for (const member of group.members) {
        const flat: Record<string, string> = {};
        for (const key of metadataKeys) {
          if (key in member.metadata) {
            Object.assign(
              flat,
              flattenMetadataValue(member.metadata[key], key),
            );
          }
        }
        flattenedByMember.push(flat);
        for (const col of Object.keys(flat)) metadataColumnSet.add(col);
      }
    }
  }

  const metadataColumns = Array.from(metadataColumnSet).sort();
  const headers = [...fixedColumns, ...metadataColumns];

  // Pass 2: emit fixed cells + one cell per sorted leaf column.
  const rows: string[][] = [];
  let memberIndex = 0;
  for (const source of roster.sources) {
    for (const group of source.groups) {
      for (const member of group.members) {
        const flat = flattenedByMember[memberIndex++] ?? {};
        rows.push([
          source.name,
          group.kind === "group" || group.kind === "subGroup" ? group.name : "",
          member.subGroupName ?? "",
          member.memberNumber,
          member.firstName,
          member.lastName,
          member.status,
          member.confirmedCheckedInAt ?? "",
          member.preliminaryCheckedInAt ?? "",
          String(member.hasImportErrors),
          ...metadataColumns.map((col) => flat[col] ?? ""),
        ]);
      }
    }
  }

  return { headers, rows };
}

/**
 * Flattens a roster into RFC-4180 CSV: one row per member, fixed columns plus
 * a dynamic union of every source's member-level metadata columns (blank when
 * a given member's source doesn't declare that column). Prefixed with a UTF-8
 * BOM so Excel renders non-ASCII (Swedish) characters correctly.
 */
export function rosterToCsv(roster: RosterResponse): string {
  const { headers, rows } = rosterToRows(roster);
  const body = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  return `﻿${body}`;
}

/**
 * Renders a roster as a real .xlsx workbook (single "Roster" sheet) with a bold
 * header row. Same columns/rows as rosterToCsv via the shared rosterToRows.
 */
export async function rosterToXlsx(
  roster: RosterResponse,
): Promise<ArrayBuffer> {
  const { headers, rows } = rosterToRows(roster);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Roster");
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  sheet.addRows(rows);

  // exceljs's writeBuffer resolves to its own Buffer type (extends ArrayBuffer);
  // return it directly so Hono's c.body accepts it without a Node Buffer copy.
  return workbook.xlsx.writeBuffer();
}

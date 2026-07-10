import { prisma } from "../../app/prisma.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { enricherRegistry } from "../workflows/steps.ts";
import { dataSourceConfig, hasImportErrors } from "./data.service.ts";

const DEFAULT_LOCALE = "sv";

/**
 * Resolves a localized `{ sv: "...", en: "..." }`-style name map to a single
 * display string. No i18n framework exists in this codebase - the rest of the
 * app reads `.name.sv` directly (see SelectSubjectScreen.tsx) - so this picks
 * the requested locale, falling back to Swedish, then any available value,
 * then the raw config key so a misconfigured/missing name never disappears.
 */
export function pickLocalizedName(
  map: Record<string, string> | undefined,
  locale: string,
  fallbackKey: string,
): string {
  if (!map) return fallbackKey;
  return (
    map[locale] ?? map[DEFAULT_LOCALE] ?? Object.values(map)[0] ?? fallbackKey
  );
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
function splitMetadataColumns(enrichWith: Record<string, string> | undefined) {
  const memberMetadataColumns: string[] = [];
  const groupMetadataColumns: string[] = [];

  for (const [metadataKey, enricherName] of Object.entries(enrichWith ?? {})) {
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
  const locale = opts?.locale ?? DEFAULT_LOCALE;

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
  const locale = opts?.locale ?? DEFAULT_LOCALE;
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

const MIN_SEARCH_QUERY_LENGTH = 2;
const MAX_SEARCH_RESULTS = 200;
// Trigram similarity cutoff for typo tolerance (e.g. "malcom" -> "Malcolm").
// Explicit literal rather than the pg_trgm.similarity_threshold GUC, so it's
// visible here and easy to retune - not a scientifically derived number, a
// starting point to sanity-check against real names.
const TYPO_SIMILARITY_THRESHOLD = 0.4;

type RawSearchRow = ParticipantRow & { groupName: string | null };

/**
 * Server-side name search, pushed down to Postgres with a LIMIT instead of
 * shipping the full roster to the browser for client-side filtering - the
 * latter doesn't scale past a few thousand participants (it was the actual
 * cause of the reported lag at ~20k rows). Matches per whitespace-separated
 * word, each word required to hit firstName OR lastName, so "anders
 * sagnell" matches "Anders Baba Sagnell" without a computed full-name column.
 *
 * Uses a raw query (not the usual findMany({ where })) because it needs two
 * Postgres extensions Prisma's fluent filter DSL can't call as SQL functions:
 * unaccent() for accent-insensitive matching ("e" finding "é"), and pg_trgm's
 * similarity() for typo tolerance ("malcom" finding "Malcolm") - additive
 * alongside the exact/substring match, never narrowing it. Still fully
 * parameterized via Prisma.sql/Prisma.join - no string-built SQL, so no
 * injection risk.
 */
export async function searchRoster(
  query: string,
  opts?: { locale?: string },
): Promise<SearchResultRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) return [];

  const locale = opts?.locale ?? DEFAULT_LOCALE;
  const sourceKeys = Object.keys(dataSourceConfig.dataSources);
  const words = trimmed.split(/\s+/).filter(Boolean);

  const wordConditions = words.map((word) => {
    const pattern = `%${word}%`;
    return Prisma.sql`(
      unaccent(p."firstName") ILIKE unaccent(${pattern})
      OR unaccent(p."lastName") ILIKE unaccent(${pattern})
      OR similarity(unaccent(p."firstName"), unaccent(${word})) > ${TYPO_SIMILARITY_THRESHOLD}
      OR similarity(unaccent(p."lastName"), unaccent(${word})) > ${TYPO_SIMILARITY_THRESHOLD}
    )`;
  });

  const rows = await prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
    SELECT
      p.id,
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
    WHERE p."dataSource" IN (${Prisma.join(sourceKeys)})
      AND ${Prisma.join(wordConditions, " AND ")}
    ORDER BY p."lastName" ASC, p."firstName" ASC
    LIMIT ${MAX_SEARCH_RESULTS}
  `);

  return rows.map((p) => {
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
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Flattens a roster into RFC-4180 CSV: one row per member, fixed columns plus
 * a dynamic union of every source's member-level metadata columns (blank when
 * a given member's source doesn't declare that key). Prefixed with a UTF-8
 * BOM so Excel renders non-ASCII (Swedish) characters correctly.
 */
export function rosterToCsv(roster: RosterResponse): string {
  const metadataColumns = Array.from(
    new Set(roster.sources.flatMap((s) => s.memberMetadataColumns)),
  ).sort();

  const headers = [
    "source",
    "group",
    "subGroup",
    "firstName",
    "lastName",
    "status",
    "confirmedCheckedInAt",
    "preliminaryCheckedInAt",
    "hasImportErrors",
    ...metadataColumns,
  ];

  const rows: string[][] = [headers];

  for (const source of roster.sources) {
    for (const group of source.groups) {
      for (const member of group.members) {
        rows.push([
          source.name,
          group.kind === "group" || group.kind === "subGroup" ? group.name : "",
          member.subGroupName ?? "",
          member.firstName,
          member.lastName,
          member.status,
          member.confirmedCheckedInAt ?? "",
          member.preliminaryCheckedInAt ?? "",
          String(member.hasImportErrors),
          ...metadataColumns.map((key) =>
            key in member.metadata ? String(member.metadata[key]) : "",
          ),
        ]);
      }
    }
  }

  const body = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  return `﻿${body}`;
}

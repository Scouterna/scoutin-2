import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const participantFindMany = vi.fn();
const groupFindMany = vi.fn();
const queryRaw = vi.fn();

vi.mock("../../app/prisma.ts", () => ({
  prisma: {
    participant: { findMany: participantFindMany },
    participantGroup: { findMany: groupFindMany },
    $queryRaw: queryRaw,
  },
}));

vi.mock("../../config/config.ts", () => ({
  default: {
    DATASOURCE_HASHING_SECRET: "test-secret",
    DATASOURCE_HASHING_SALT: "test-salt",
    NODE_ENV: "test",
  },
}));

// A hierarchical source ("groups"), a fully-flat source ("staff"), and a flat
// source with subGroups ("stormote6") - exercises every grouping mode a real
// dataSourceConfig.yml can produce, without depending on env-var substitution.
const testDataSourceConfig = {
  dataSources: {
    groups: {
      name: { sv: "Ledare i din kår", en: "Leader in your scout group" },
      subGroups: { leader: { name: { sv: "Ledare", en: "Leader" } } },
      enrichWith: {
        village: "test:reportsGroupTag",
        diet: "test:reportsParticipantTag",
      },
    },
    staff: {
      name: { sv: "Funktionär", en: "Staff" },
    },
    stormote6: {
      name: { sv: "Deltagare", en: "Participant" },
      subGroups: { a: { name: { sv: "Grupp A", en: "Group A" } } },
    },
  },
};

vi.mock("../../config/dataSourceConfigLoader.ts", () => ({
  loadDataSourceConfig: () => testDataSourceConfig,
}));

const logStub: {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  child: () => typeof logStub;
} = {
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: () => logStub,
};
vi.mock("../../core/logging/logger.ts", () => ({ logger: logStub }));

const {
  buildRoster,
  buildRosterSummary,
  listParticipants,
  pickLocalizedName,
  rosterToCsv,
  rosterToXlsx,
} = await import("./reports.service.ts");
const { enricherRegistry } = await import("../workflows/steps.ts");

const now = new Date("2026-07-10T10:00:00.000Z");

enricherRegistry.register({
  name: "test:reportsGroupTag",
  target: "group",
  enrich: () => null,
});
enricherRegistry.register({
  name: "test:reportsParticipantTag",
  target: "participant",
  enrich: () => null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pickLocalizedName", () => {
  const map = { sv: "Svenska", en: "English" };

  it("picks the requested locale", () => {
    expect(pickLocalizedName(map, "en", "fallback")).toBe("English");
  });

  it("falls back to sv when the locale is missing", () => {
    expect(pickLocalizedName(map, "de", "fallback")).toBe("Svenska");
  });

  it("falls back to any available value when sv is also missing", () => {
    expect(pickLocalizedName({ en: "English" }, "de", "fallback")).toBe(
      "English",
    );
  });

  it("falls back to the raw key when no map is given", () => {
    expect(pickLocalizedName(undefined, "sv", "fallback")).toBe("fallback");
  });
});

describe("buildRoster", () => {
  beforeEach(() => {
    groupFindMany.mockResolvedValue([
      {
        id: "g1",
        dataSource: "groups",
        name: "Kår 1",
        metadata: { village: "By 5" },
        importErrors: null,
      },
      {
        id: "g2",
        dataSource: "groups",
        name: "Kår 2",
        metadata: null,
        importErrors: { "test:reportsGroupTag": "failed" },
      },
    ]);

    participantFindMany.mockResolvedValue([
      // "groups" (hierarchical): one participant per status bucket in g1,
      // plus one ungrouped participant.
      {
        id: "p-confirmed",
        dataSource: "groups",
        firstName: "Confirmed",
        lastName: "Person",
        subGroup: null,
        participantGroupId: "g1",
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: now,
        metadata: { village: "should-not-appear-on-member", diet: "vegan" },
        importErrors: null,
        deletedAt: null,
      },
      {
        id: "p-preliminary",
        dataSource: "groups",
        firstName: "Preliminary",
        lastName: "Person",
        subGroup: null,
        participantGroupId: "g1",
        preliminaryCheckedInAt: now,
        confirmedCheckedInAt: null,
        metadata: null,
        importErrors: null,
        deletedAt: null,
      },
      {
        id: "p-missing",
        dataSource: "groups",
        firstName: "Missing",
        lastName: "Person",
        subGroup: null,
        participantGroupId: "g1",
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: null,
        metadata: null,
        importErrors: null,
        deletedAt: null,
      },
      {
        id: "p-error",
        dataSource: "groups",
        firstName: "Errored",
        lastName: "Person",
        subGroup: null,
        participantGroupId: "g1",
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: null,
        metadata: null,
        importErrors: { provider: "bad row" },
        deletedAt: null,
      },
      {
        id: "p-cancelled",
        dataSource: "groups",
        firstName: "Cancelled",
        lastName: "Person",
        subGroup: null,
        participantGroupId: "g1",
        // Confirmed *and* later cancelled - cancelled must win.
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: now,
        metadata: null,
        importErrors: null,
        deletedAt: now,
      },
      {
        id: "p-ungrouped",
        dataSource: "groups",
        firstName: "Ungrouped",
        lastName: "Person",
        subGroup: null,
        participantGroupId: null,
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: null,
        metadata: null,
        importErrors: null,
        deletedAt: null,
      },
      // "staff" (fully flat, no subGroups).
      {
        id: "p-staff",
        dataSource: "staff",
        firstName: "Staff",
        lastName: "Person",
        subGroup: null,
        participantGroupId: null,
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: now,
        metadata: null,
        importErrors: null,
        deletedAt: null,
      },
      // "stormote6" (flat with subGroups): one in subGroup "a", one ungrouped.
      {
        id: "p-sub-a",
        dataSource: "stormote6",
        firstName: "SubA",
        lastName: "Person",
        subGroup: "a",
        participantGroupId: null,
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: now,
        metadata: null,
        importErrors: null,
        deletedAt: null,
      },
      {
        id: "p-sub-none",
        dataSource: "stormote6",
        firstName: "SubNone",
        lastName: "Person",
        subGroup: null,
        participantGroupId: null,
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: null,
        metadata: null,
        importErrors: null,
        deletedAt: null,
      },
      // A dataSource no longer present in config - must still surface, not be
      // silently dropped.
      {
        id: "p-orphan",
        dataSource: "old_event",
        firstName: "Orphan",
        lastName: "Person",
        subGroup: null,
        participantGroupId: null,
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: null,
        metadata: null,
        importErrors: null,
        deletedAt: null,
      },
    ]);
  });

  function findSource(
    sources: Awaited<ReturnType<typeof buildRoster>>["sources"],
    key: string,
  ) {
    const source = sources.find((s) => s.key === key);
    if (!source) throw new Error(`Source "${key}" not found in roster`);
    return source;
  }

  it("classifies every status bucket, with cancelled winning over a prior confirmation", async () => {
    const roster = await buildRoster({ locale: "sv" });
    const groups = findSource(roster.sources, "groups");
    const g1 = groups.groups.find((g) => g.id === "g1");
    if (!g1) throw new Error("g1 not found");

    const statusById = Object.fromEntries(
      g1.members.map((m) => [m.id, m.status]),
    );
    expect(statusById).toEqual({
      "p-confirmed": "confirmed",
      "p-preliminary": "preliminaryOnly",
      "p-missing": "missing",
      "p-error": "importError",
      "p-cancelled": "cancelled",
    });
    expect(g1.counts).toEqual({
      confirmed: 1,
      preliminaryOnly: 1,
      missing: 1,
      importError: 1,
      cancelled: 1,
      total: 5,
    });
  });

  it("renders a hierarchical source as a group tree, with an 'ungrouped' node for null participantGroupId", async () => {
    const roster = await buildRoster({ locale: "sv" });
    const groups = findSource(roster.sources, "groups");

    expect(groups.hierarchical).toBe(true);
    expect(groups.groups.map((g) => g.id)).toEqual(["g1", "g2", null]);

    const ungrouped = groups.groups.find((g) => g.id === null);
    expect(ungrouped?.kind).toBe("ungrouped");
    expect(ungrouped?.members.map((m) => m.id)).toEqual(["p-ungrouped"]);

    // Rolled up across every group node in the source.
    expect(groups.counts.total).toBe(6);
    expect(groups.counts.missing).toBe(2); // p-missing + p-ungrouped
  });

  it("flags a group's own import errors independently of its members", async () => {
    const roster = await buildRoster({ locale: "sv" });
    const groups = findSource(roster.sources, "groups");
    const g2 = groups.groups.find((g) => g.id === "g2");

    expect(g2?.hasImportErrors).toBe(true);
    expect(g2?.importErrors).toEqual({ "test:reportsGroupTag": "failed" });
    expect(g2?.members).toEqual([]);
  });

  it("splits enrichWith into member- vs group-level metadata by enricher target", async () => {
    const roster = await buildRoster({ locale: "sv" });
    const groups = findSource(roster.sources, "groups");

    expect(groups.memberMetadataColumns).toEqual(["diet"]);
    expect(groups.groupMetadataColumns).toEqual(["village"]);

    const g1 = groups.groups.find((g) => g.id === "g1");
    expect(g1?.groupMetadata).toEqual({ village: "By 5" });

    const confirmed = g1?.members.find((m) => m.id === "p-confirmed");
    // Only the member-level key ("diet") should reach the member row - the
    // group-level key ("village") must not leak in even though it's present
    // on the raw participant.metadata blob.
    expect(confirmed?.metadata).toEqual({ diet: "vegan" });
  });

  it("renders a fully flat source (no subGroups) as a single node named after the source", async () => {
    const roster = await buildRoster({ locale: "sv" });
    const staff = findSource(roster.sources, "staff");

    expect(staff.hierarchical).toBe(false);
    expect(staff.groups).toHaveLength(1);
    expect(staff.groups[0]?.name).toBe("Funktionär");
    expect(staff.groups[0]?.members.map((m) => m.id)).toEqual(["p-staff"]);
  });

  it("buckets a flat source with subGroups by subGroup, with a fallback node for null subGroup", async () => {
    const roster = await buildRoster({ locale: "sv" });
    const stormote6 = findSource(roster.sources, "stormote6");

    const subA = stormote6.groups.find((g) => g.id === "a");
    expect(subA?.kind).toBe("subGroup");
    expect(subA?.name).toBe("Grupp A");
    expect(subA?.members.map((m) => m.id)).toEqual(["p-sub-a"]);

    const ungrouped = stormote6.groups.find((g) => g.id === null);
    expect(ungrouped?.name).toBe("Utan undergrupp");
    expect(ungrouped?.members.map((m) => m.id)).toEqual(["p-sub-none"]);
  });

  it("resolves subGroup display names from config, honoring the requested locale", async () => {
    const roster = await buildRoster({ locale: "en" });
    const stormote6 = findSource(roster.sources, "stormote6");
    const subA = stormote6.groups.find((g) => g.id === "a");

    expect(subA?.name).toBe("Group A");
    const member = subA?.members.find((m) => m.id === "p-sub-a");
    expect(member?.subGroupName).toBe("Group A");
  });

  it("surfaces a dataSource no longer present in config as a synthetic source", async () => {
    const roster = await buildRoster({ locale: "sv" });
    const orphan = findSource(roster.sources, "old_event");

    expect(orphan.name).toBe("old_event");
    expect(orphan.groups[0]?.members.map((m) => m.id)).toEqual(["p-orphan"]);
  });

  it("scopes the query and result to a single source when sourceKey is given", async () => {
    await buildRoster({ locale: "sv", sourceKey: "staff" });

    expect(groupFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dataSource: { in: ["staff"] } },
      }),
    );
    expect(participantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dataSource: { in: ["staff"] } },
      }),
    );
  });
});

describe("rosterToCsv", () => {
  const baseRoster = (
    sources: Awaited<ReturnType<typeof buildRoster>>["sources"],
  ) => ({
    generatedAt: "2026-07-10T10:00:00.000Z",
    locale: "sv",
    sources,
  });

  it("emits a UTF-8 BOM and one row per member with fixed + dynamic metadata columns", () => {
    const csv = rosterToCsv(
      baseRoster([
        {
          key: "groups",
          name: "Ledare i din kår",
          hierarchical: true,
          memberMetadataColumns: ["diet"],
          groupMetadataColumns: ["village"],
          counts: {
            confirmed: 1,
            preliminaryOnly: 0,
            missing: 0,
            importError: 0,
            cancelled: 0,
            total: 1,
          },
          groups: [
            {
              id: "g1",
              name: "Kår 1",
              kind: "group",
              counts: {
                confirmed: 1,
                preliminaryOnly: 0,
                missing: 0,
                importError: 0,
                cancelled: 0,
                total: 1,
              },
              hasImportErrors: false,
              importErrors: null,
              groupMetadata: { village: "By 5" },
              members: [
                {
                  id: "p1",
                  memberNumber: "12345",
                  firstName: "Anna",
                  lastName: "Andersson",
                  subGroup: null,
                  subGroupName: null,
                  status: "confirmed",
                  confirmedCheckedInAt: "2026-07-10T10:00:00.000Z",
                  preliminaryCheckedInAt: null,
                  hasImportErrors: false,
                  importErrors: null,
                  metadata: { diet: "vegan" },
                },
              ],
            },
          ],
        },
      ]),
    );

    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "source,group,subGroup,memberNumber,firstName,lastName,status,confirmedCheckedInAt,preliminaryCheckedInAt,hasImportErrors,diet",
    );
    expect(lines[1]).toBe(
      "Ledare i din kår,Kår 1,,12345,Anna,Andersson,confirmed,2026-07-10T10:00:00.000Z,,false,vegan",
    );
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = rosterToCsv(
      baseRoster([
        {
          key: "groups",
          name: 'Kår, med "citat"',
          hierarchical: false,
          memberMetadataColumns: [],
          groupMetadataColumns: [],
          counts: {
            confirmed: 0,
            preliminaryOnly: 0,
            missing: 1,
            importError: 0,
            cancelled: 0,
            total: 1,
          },
          groups: [
            {
              id: null,
              name: 'Kår, med "citat"',
              kind: "ungrouped",
              counts: {
                confirmed: 0,
                preliminaryOnly: 0,
                missing: 1,
                importError: 0,
                cancelled: 0,
                total: 1,
              },
              hasImportErrors: false,
              importErrors: null,
              groupMetadata: {},
              members: [
                {
                  id: "p1",
                  memberNumber: "999",
                  firstName: "Multi\nline",
                  lastName: "Person",
                  subGroup: null,
                  subGroupName: null,
                  status: "missing",
                  confirmedCheckedInAt: null,
                  preliminaryCheckedInAt: null,
                  hasImportErrors: false,
                  importErrors: null,
                  metadata: {},
                },
              ],
            },
          ],
        },
      ]),
    );

    const lines = csv.slice(1).split("\r\n");
    // "ungrouped" kind is not "group"/"subGroup", so the group column is
    // intentionally blank for a flat source's single node.
    expect(lines[1]).toBe(
      '"Kår, med ""citat""",,,999,"Multi\nline",Person,missing,,,false',
    );
  });

  // A minimal single-member roster whose member carries the given metadata.
  // Used to exercise metadata flattening independent of grouping modes.
  const rosterWithMetadata = (
    metadataColumns: string[],
    metadata: Record<string, unknown>,
  ) =>
    baseRoster([
      {
        key: "groups",
        name: "Ledare i din kår",
        hierarchical: true,
        memberMetadataColumns: metadataColumns,
        groupMetadataColumns: [],
        counts: {
          confirmed: 1,
          preliminaryOnly: 0,
          missing: 0,
          importError: 0,
          cancelled: 0,
          total: 1,
        },
        groups: [
          {
            id: "g1",
            name: "Kår 1",
            kind: "group",
            counts: {
              confirmed: 1,
              preliminaryOnly: 0,
              missing: 0,
              importError: 0,
              cancelled: 0,
              total: 1,
            },
            hasImportErrors: false,
            importErrors: null,
            groupMetadata: {},
            members: [
              {
                id: "p1",
                memberNumber: "12345",
                firstName: "Anna",
                lastName: "Andersson",
                subGroup: null,
                subGroupName: null,
                status: "confirmed",
                confirmedCheckedInAt: null,
                preliminaryCheckedInAt: null,
                hasImportErrors: false,
                importErrors: null,
                metadata,
              },
            ],
          },
        ],
      },
    ]);

  it("expands an object metadata value into one column per leaf key", () => {
    const csv = rosterToCsv(
      rosterWithMetadata(["safeFromHarm"], {
        safeFromHarm: {
          completed: true,
          completedAt: "2026-01-05",
          source: "scoutnet",
        },
      }),
    );

    expect(csv).not.toContain("[object Object]");
    const lines = csv.slice(1).split("\r\n");
    // Leaf columns are sorted; the single object key expands to three columns.
    expect(lines[0]).toBe(
      "source,group,subGroup,memberNumber,firstName,lastName,status,confirmedCheckedInAt,preliminaryCheckedInAt,hasImportErrors,safeFromHarm.completed,safeFromHarm.completedAt,safeFromHarm.source",
    );
    expect(lines[1]).toBe(
      "Ledare i din kår,Kår 1,,12345,Anna,Andersson,confirmed,,,false,true,2026-01-05,scoutnet",
    );
  });

  it("joins an array metadata value into a single cell", () => {
    const csv = rosterToCsv(
      rosterWithMetadata(["days"], { days: ["Lördag", "Söndag"] }),
    );

    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "source,group,subGroup,memberNumber,firstName,lastName,status,confirmedCheckedInAt,preliminaryCheckedInAt,hasImportErrors,days",
    );
    expect(lines[1]).toBe(
      "Ledare i din kår,Kår 1,,12345,Anna,Andersson,confirmed,,,false,Lördag; Söndag",
    );
  });
});

describe("rosterToXlsx", () => {
  const baseRoster = (
    sources: Awaited<ReturnType<typeof buildRoster>>["sources"],
  ) => ({
    generatedAt: "2026-07-10T10:00:00.000Z",
    locale: "sv",
    sources,
  });

  it("produces a workbook whose header + rows match the flattened metadata", async () => {
    const buffer = await rosterToXlsx(
      baseRoster([
        {
          key: "groups",
          name: "Ledare i din kår",
          hierarchical: true,
          memberMetadataColumns: ["safeFromHarm"],
          groupMetadataColumns: [],
          counts: {
            confirmed: 1,
            preliminaryOnly: 0,
            missing: 0,
            importError: 0,
            cancelled: 0,
            total: 1,
          },
          groups: [
            {
              id: "g1",
              name: "Kår 1",
              kind: "group",
              counts: {
                confirmed: 1,
                preliminaryOnly: 0,
                missing: 0,
                importError: 0,
                cancelled: 0,
                total: 1,
              },
              hasImportErrors: false,
              importErrors: null,
              groupMetadata: {},
              members: [
                {
                  id: "p1",
                  memberNumber: "12345",
                  firstName: "Anna",
                  lastName: "Andersson",
                  subGroup: null,
                  subGroupName: null,
                  status: "confirmed",
                  confirmedCheckedInAt: null,
                  preliminaryCheckedInAt: null,
                  hasImportErrors: false,
                  importErrors: null,
                  metadata: {
                    safeFromHarm: { completed: true, source: "scoutnet" },
                  },
                },
              ],
            },
          ],
        },
      ]),
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Roster");
    if (!sheet) throw new Error("expected a Roster worksheet");

    // Header row includes the two expanded leaf columns (sorted).
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(header).toContain("safeFromHarm.completed");
    expect(header).toContain("safeFromHarm.source");

    const dataRow = (sheet.getRow(2).values as unknown[]).slice(1);
    expect(dataRow).toContain("Anna");
    // Object leaves are serialized as strings, never "[object Object]".
    expect(dataRow).toContain("true");
    expect(dataRow).toContain("scoutnet");
    expect(dataRow.some((v) => String(v).includes("[object Object]"))).toBe(
      false,
    );
  });
});

describe("buildRosterSummary", () => {
  it("aggregates counts per source without ever querying groups", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        dataSource: "groups",
        confirmedCheckedInAt: now,
        preliminaryCheckedInAt: null,
        importErrors: null,
        deletedAt: null,
      },
      {
        dataSource: "groups",
        confirmedCheckedInAt: null,
        preliminaryCheckedInAt: null,
        importErrors: null,
        deletedAt: null,
      },
      {
        dataSource: "staff",
        confirmedCheckedInAt: null,
        preliminaryCheckedInAt: null,
        importErrors: null,
        deletedAt: null,
      },
    ]);

    const summary = await buildRosterSummary({ locale: "sv" });

    expect(groupFindMany).not.toHaveBeenCalled();

    const groups = summary.sources.find((s) => s.key === "groups");
    expect(groups?.name).toBe("Ledare i din kår");
    expect(groups?.counts).toEqual({
      confirmed: 1,
      preliminaryOnly: 0,
      missing: 1,
      importError: 0,
      cancelled: 0,
      total: 2,
    });

    const staff = summary.sources.find((s) => s.key === "staff");
    expect(staff?.counts.total).toBe(1);

    // A configured source with no participants yet still appears, at zero.
    const stormote6 = summary.sources.find((s) => s.key === "stormote6");
    expect(stormote6?.counts.total).toBe(0);
  });

  it("selects only the minimal scalar fields needed for classification", async () => {
    participantFindMany.mockResolvedValueOnce([]);

    await buildRosterSummary({ locale: "sv" });

    const [args] = participantFindMany.mock.calls[0] ?? [];
    expect(args.select).toEqual({
      dataSource: true,
      confirmedCheckedInAt: true,
      preliminaryCheckedInAt: true,
      importErrors: true,
      deletedAt: true,
    });
  });

  it("surfaces a dataSource no longer present in config as a synthetic source", async () => {
    participantFindMany.mockResolvedValueOnce([
      {
        dataSource: "old_event",
        confirmedCheckedInAt: null,
        preliminaryCheckedInAt: null,
        importErrors: null,
        deletedAt: null,
      },
    ]);

    const summary = await buildRosterSummary({ locale: "sv" });
    const orphan = summary.sources.find((s) => s.key === "old_event");

    expect(orphan?.name).toBe("old_event");
    expect(orphan?.counts.total).toBe(1);
  });
});

describe("listParticipants", () => {
  // Two queries fire per call (rows + count) via Promise.all; the rows query is
  // always first. Default both to empty so tests that only care about the rows
  // query don't have to stub the count, and queue row payloads with
  // mockResolvedValueOnce (consumed by the first call).
  beforeEach(() => {
    queryRaw.mockResolvedValue([]);
  });

  it("browses without a query, paging the whole set", async () => {
    await listParticipants({});

    const [fragment] = queryRaw.mock.calls[0] ?? [];
    // No search words -> no ILIKE predicates, just the data-source scope.
    expect(fragment.text).not.toMatch(/ILIKE/);
    expect(fragment.text).toMatch(/LIMIT/);
    expect(fragment.text).toMatch(/OFFSET/);
    // Default page size and offset.
    expect(fragment.values).toContain(100);
    expect(fragment.values).toContain(0);
  });

  it("derives total and per-status counts from the status breakdown query", async () => {
    queryRaw.mockResolvedValueOnce([]); // rows page
    queryRaw.mockResolvedValueOnce([
      { status: "confirmed", count: 10n },
      { status: "missing", count: 5n },
    ]); // breakdown

    const result = await listParticipants({});

    expect(result.statusCounts.confirmed).toBe(10);
    expect(result.statusCounts.missing).toBe(5);
    // A bucket absent from the breakdown rows is zero, not missing.
    expect(result.statusCounts.cancelled).toBe(0);
    // No status filter -> total is every bucket summed.
    expect(result.total).toBe(15);

    // The second call is the breakdown: grouped by the status CASE, no LIMIT.
    const breakdownCall = queryRaw.mock.calls[1]?.[0];
    expect(breakdownCall).toBeDefined();
    expect(breakdownCall.text).toMatch(/GROUP BY/);
    expect(breakdownCall.text).not.toMatch(/LIMIT/);
  });

  it("counts only the visible buckets toward total under a status filter", async () => {
    queryRaw.mockResolvedValueOnce([]); // rows page
    queryRaw.mockResolvedValueOnce([
      { status: "confirmed", count: 10n },
      { status: "missing", count: 5n },
      { status: "cancelled", count: 2n },
    ]); // breakdown, always the full unfiltered set

    const result = await listParticipants({
      statuses: ["confirmed", "missing"],
    });

    // Pills still show the full breakdown, including hidden buckets...
    expect(result.statusCounts.cancelled).toBe(2);
    // ...but total reflects only the visible buckets.
    expect(result.total).toBe(15);
  });

  it("matches per whitespace-separated word against both firstName and lastName", async () => {
    await listParticipants({ query: "anders sagnell" });

    const [fragment] = queryRaw.mock.calls[0] ?? [];
    // Two words -> two (firstName OR lastName) groups, each contributing two
    // ILIKE comparisons, four total.
    expect(fragment.text.match(/ILIKE/g)).toHaveLength(4);
    expect(fragment.text).not.toMatch(/unaccent/);
    expect(fragment.values).toContain("%anders%");
    expect(fragment.values).toContain("%sagnell%");
  });

  it("windows the query with LIMIT/OFFSET and clamps the page size", async () => {
    await listParticipants({ limit: 5000, offset: 40 });

    const [fragment] = queryRaw.mock.calls[0] ?? [];
    expect(fragment.text).toMatch(/LIMIT/);
    expect(fragment.text).toMatch(/OFFSET/);
    // Requested 5000 rows but the page size is capped at MAX_PAGE_SIZE (200).
    expect(fragment.values).toContain(200);
    expect(fragment.values).toContain(40);
  });

  it("filters by status with a CASE predicate when a subset of buckets is visible", async () => {
    await listParticipants({ statuses: ["confirmed", "missing"] });

    const [fragment] = queryRaw.mock.calls[0] ?? [];
    expect(fragment.text).toMatch(/CASE/);
    expect(fragment.values).toContain("confirmed");
    expect(fragment.values).toContain("missing");
  });

  it("omits the status predicate when every bucket is visible", async () => {
    await listParticipants({
      statuses: [
        "confirmed",
        "preliminaryOnly",
        "missing",
        "importError",
        "cancelled",
      ],
    });

    const [fragment] = queryRaw.mock.calls[0] ?? [];
    expect(fragment.text).not.toMatch(/CASE/);
  });

  it("skips the rows query but still counts when no status is visible", async () => {
    queryRaw.mockResolvedValueOnce([{ status: "confirmed", count: 3n }]); // breakdown only

    const result = await listParticipants({ statuses: [] });

    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    // The pills keep their counts even with everything hidden.
    expect(result.statusCounts.confirmed).toBe(3);
    // Exactly one query ran: the breakdown. The rows query was skipped to
    // avoid an invalid `IN ()`.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]?.[0].text).toMatch(/GROUP BY/);
  });

  it("scopes the query to configured data sources", async () => {
    await listParticipants({ query: "anna" });

    const [fragment] = queryRaw.mock.calls[0] ?? [];
    expect(fragment.values).toEqual(
      expect.arrayContaining(["groups", "staff", "stormote6"]),
    );
  });

  it("maps a match to its source name, group name, subGroup name, and metadata", async () => {
    queryRaw.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "groups",
        firstName: "Anna",
        lastName: "Andersson",
        subGroup: "leader",
        participantGroupId: "g1",
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: now,
        metadata: { diet: "vegan", village: "hidden-from-search-too" },
        importErrors: null,
        deletedAt: null,
        groupName: "Kår 1",
      },
    ]);

    const { results } = await listParticipants({ query: "anna", locale: "sv" });
    const row = results[0];
    if (!row) throw new Error("expected a search result");

    expect(row.sourceName).toBe("Ledare i din kår");
    expect(row.groupName).toBe("Kår 1");
    expect(row.subGroupName).toBe("Ledare");
    expect(row.status).toBe("confirmed");
    // Same member-vs-group metadata split as buildRoster - "village" is a
    // group-level enrichWith key and must not leak into a member row here
    // either, even though it's present on the raw metadata blob.
    expect(row.metadata).toEqual({ diet: "vegan" });
  });

  it("resolves a match with no group as a null groupName", async () => {
    queryRaw.mockResolvedValueOnce([
      {
        id: "p1",
        dataSource: "staff",
        firstName: "Erik",
        lastName: "Eriksson",
        subGroup: null,
        participantGroupId: null,
        preliminaryCheckedInAt: null,
        confirmedCheckedInAt: null,
        metadata: null,
        importErrors: null,
        deletedAt: null,
        groupName: null,
      },
    ]);

    const { results } = await listParticipants({ query: "erik", locale: "sv" });
    const row = results[0];
    if (!row) throw new Error("expected a search result");

    expect(row.groupName).toBeNull();
    expect(row.sourceName).toBe("Funktionär");
    expect(row.status).toBe("missing");
  });
});

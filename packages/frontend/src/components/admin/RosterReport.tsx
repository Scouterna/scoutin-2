import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/api/api";

type StatusBucket =
  | "confirmed"
  | "preliminaryOnly"
  | "missing"
  | "importError"
  | "cancelled";

type StatusCounts = Record<StatusBucket, number> & { total: number };

// Search results: a member plus the source/group context needed to place it,
// since a search spans every source at once. Resolved server-side now (see
// searchRoster in reports.service.ts) - the roster is never shipped to the
// browser in full just to filter it in JS, which didn't scale past a few
// thousand participants.
type SearchResultRow = {
  id: string;
  firstName: string;
  lastName: string;
  subGroupName: string | null;
  status: StatusBucket;
  confirmedCheckedInAt: string | null;
  preliminaryCheckedInAt: string | null;
  importErrors: unknown;
  sourceName: string;
  groupName: string | null;
};

type SourceSummary = {
  key: string;
  name: string;
  counts: StatusCounts;
};

type RosterSummaryResponse = {
  generatedAt: string;
  locale: string;
  sources: SourceSummary[];
};

const STATUS_LABELS: Record<StatusBucket, string> = {
  confirmed: "Incheckad",
  preliminaryOnly: "Preliminär",
  missing: "Saknas",
  importError: "Importfel",
  cancelled: "Avanmäld",
};

const STATUS_COLORS: Record<
  StatusBucket,
  "success" | "default" | "warning" | "error"
> = {
  confirmed: "success",
  preliminaryOnly: "default",
  missing: "warning",
  importError: "error",
  cancelled: "default",
};

const STATUS_ORDER: StatusBucket[] = [
  "confirmed",
  "preliminaryOnly",
  "missing",
  "importError",
  "cancelled",
];

// Must match MIN_SEARCH_QUERY_LENGTH in reports.service.ts - avoids firing a
// request for a query the backend would reject anyway.
const MIN_SEARCH_LENGTH = 2;
// Must match MAX_SEARCH_RESULTS in reports.service.ts - used only to decide
// whether to show the "may be more" hint, the backend already caps the rows.
const SEARCH_RESULT_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 300;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

function hasEntries(value: unknown): value is Record<string, unknown> {
  return (
    value != null && typeof value === "object" && Object.keys(value).length > 0
  );
}

function StatusBucketChip({ status }: { status: StatusBucket }) {
  return (
    <Chip
      size="small"
      label={STATUS_LABELS[status]}
      color={STATUS_COLORS[status]}
      variant={status === "preliminaryOnly" ? "outlined" : "filled"}
    />
  );
}

function CountsSummary({ counts }: { counts: StatusCounts }) {
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
      {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
        <Chip
          key={status}
          size="small"
          label={`${STATUS_LABELS[status]}: ${counts[status]}`}
          color={STATUS_COLORS[status]}
          variant={status === "preliminaryOnly" ? "outlined" : "filled"}
        />
      ))}
      <Chip size="small" label={`Totalt: ${counts.total}`} variant="outlined" />
    </Box>
  );
}

function ImportErrorsTooltip({ importErrors }: { importErrors: unknown }) {
  if (!hasEntries(importErrors)) return null;
  const reasons = Object.entries(importErrors)
    .map(([source, reason]) => `${source}: ${String(reason)}`)
    .join("\n");
  return (
    <Tooltip title={reasons} sx={{ whiteSpace: "pre-line" }}>
      <WarningAmberIcon color="warning" fontSize="small" />
    </Tooltip>
  );
}

function SourceTile({ source }: { source: SourceSummary }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        {source.name}
      </Typography>
      <CountsSummary counts={source.counts} />
    </Paper>
  );
}

function checkedInLabel(row: SearchResultRow): string {
  if (row.confirmedCheckedInAt) {
    return new Date(row.confirmedCheckedInAt).toLocaleString();
  }
  if (row.preliminaryCheckedInAt) {
    return `(prel) ${new Date(row.preliminaryCheckedInAt).toLocaleString()}`;
  }
  return "—";
}

function SearchResults({
  rows,
  hiddenStatuses,
}: {
  rows: SearchResultRow[];
  hiddenStatuses: Set<StatusBucket>;
}) {
  const visible = rows.filter((row) => !hiddenStatuses.has(row.status));

  if (visible.length === 0) {
    return <Typography color="text.secondary">Inga träffar.</Typography>;
  }

  return (
    <Box>
      {rows.length >= SEARCH_RESULT_LIMIT && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          Visar de {SEARCH_RESULT_LIMIT} första träffarna — sök mer specifikt
          för att se fler.
        </Typography>
      )}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Namn</TableCell>
              <TableCell>Källa</TableCell>
              <TableCell>Grupp</TableCell>
              <TableCell>Undergrupp</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Incheckad</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.firstName} {row.lastName}
                </TableCell>
                <TableCell>{row.sourceName}</TableCell>
                <TableCell>{row.groupName ?? "—"}</TableCell>
                <TableCell>{row.subGroupName ?? "—"}</TableCell>
                <TableCell>
                  <StatusBucketChip status={row.status} />
                </TableCell>
                <TableCell>{checkedInLabel(row)}</TableCell>
                <TableCell>
                  <ImportErrorsTooltip importErrors={row.importErrors} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function buildCsvUrl(locale: string): string {
  return api.admin.reports["roster.csv"].$url({ query: { locale } }).toString();
}

export function RosterReport() {
  const locale = "sv";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const query = debouncedSearch.trim();
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<StatusBucket>>(
    () => new Set(),
  );

  const {
    data: summary,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
  } = useQuery({
    queryKey: ["admin", "reports", "roster", locale],
    queryFn: async () => {
      const res = await api.admin.reports.roster.$get({ query: { locale } });
      if (!res.ok) throw new Error("Failed to load roster summary");
      return (await res.json()) as RosterSummaryResponse;
    },
    refetchInterval: 8000,
  });

  const {
    data: searchData,
    isFetching: isSearching,
    isError: isSearchError,
  } = useQuery({
    queryKey: ["admin", "reports", "search", query, locale],
    queryFn: async () => {
      const res = await api.admin.reports.search.$get({
        query: { q: query, locale },
      });
      if (!res.ok) throw new Error("Failed to search roster");
      return (await res.json()) as { results: SearchResultRow[] };
    },
    enabled: query.length >= MIN_SEARCH_LENGTH,
  });

  const toggleStatus = (status: StatusBucket) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  if (isSummaryLoading) return <Typography>Laddar…</Typography>;
  if (isSummaryError || !summary) {
    return <Alert severity="error">Kunde inte hämta rapporten.</Alert>;
  }

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          mb: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="h5" sx={{ flex: 1 }}>
          Rapporter
        </Typography>
        <Button
          variant="outlined"
          component="a"
          href={buildCsvUrl(locale)}
          download
        >
          Exportera CSV
        </Button>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 2 }}
      >
        Senast uppdaterad: {new Date(summary.generatedAt).toLocaleTimeString()}
      </Typography>

      {summary.sources.length === 0 ? (
        <Typography color="text.secondary">
          Inga datakällor konfigurerade.
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 2,
            mb: 4,
          }}
        >
          {summary.sources.map((source) => (
            <SourceTile key={source.key} source={source} />
          ))}
        </Box>
      )}

      <Typography variant="h6" gutterBottom>
        Sök person
      </Typography>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <TextField
          size="small"
          label="Sök namn"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {STATUS_ORDER.map((status) => (
          <Chip
            key={status}
            size="small"
            label={STATUS_LABELS[status]}
            color={STATUS_COLORS[status]}
            variant={hiddenStatuses.has(status) ? "outlined" : "filled"}
            onClick={() => toggleStatus(status)}
          />
        ))}
      </Box>

      {query.length < MIN_SEARCH_LENGTH ? (
        <Typography color="text.secondary">
          Skriv minst {MIN_SEARCH_LENGTH} tecken för att söka.
        </Typography>
      ) : isSearchError ? (
        <Alert severity="error">Kunde inte söka.</Alert>
      ) : isSearching && !searchData ? (
        <Typography color="text.secondary">Söker…</Typography>
      ) : (
        <SearchResults
          rows={searchData?.results ?? []}
          hiddenStatuses={hiddenStatuses}
        />
      )}
    </Box>
  );
}

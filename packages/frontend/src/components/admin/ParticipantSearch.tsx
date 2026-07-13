import UndoIcon from "@mui/icons-material/Undo";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
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
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/api";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  type StatusBucket,
  StatusBucketChip,
} from "./participantStatus";

// A member plus the source/group context needed to place it, since the list
// spans every source at once. Resolved server-side (see listParticipants in
// reports.service.ts) - the roster is never shipped to the browser in full,
// which didn't scale past a few thousand participants. This page pages through
// it via infinite scroll instead.
type ParticipantRow = {
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

type ParticipantListResponse = {
  results: ParticipantRow[];
  total: number;
  statusCounts: Record<StatusBucket, number>;
};

// Must match DEFAULT_PAGE_SIZE in reports.service.ts. Each scroll to the bottom
// fetches the next page of this size.
const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;
// Matches SessionTable.tsx - an estimated row height good enough for the
// virtualizer to size the scroll area before rows are measured.
const ROW_ESTIMATE_PX = 53;

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

function checkedInLabel(row: ParticipantRow): string {
  if (row.confirmedCheckedInAt) {
    return new Date(row.confirmedCheckedInAt).toLocaleString();
  }
  if (row.preliminaryCheckedInAt) {
    return `(prel) ${new Date(row.preliminaryCheckedInAt).toLocaleString()}`;
  }
  return "—";
}

function buildCsvUrl(locale: string): string {
  return api.admin.reports["roster.csv"].$url({ query: { locale } }).toString();
}

// Per-row action that reverses a check-in: nulls the participant's check-in
// timestamps and removes their step progress server-side (see undoCheckin in
// checkin.service.ts). Only rendered for participants who are actually checked
// in. Invalidating the ["admin","reports"] prefix refreshes both this list and
// the Rapporter dashboard, which share that key prefix.
function UndoCheckinAction({ row }: { row: ParticipantRow }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const undo = useMutation({
    mutationFn: async () => {
      const res = await api.admin.participants[":id"]["undo-checkin"].$post({
        param: { id: row.id },
      });
      if (!res.ok) throw new Error("Failed to undo check-in");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      setOpen(false);
    },
  });

  if (!row.confirmedCheckedInAt && !row.preliminaryCheckedInAt) return null;

  return (
    <>
      <Tooltip title="Ångra incheckning">
        <IconButton
          size="small"
          aria-label="Ångra incheckning"
          onClick={() => setOpen(true)}
        >
          <UndoIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => {
          if (!undo.isPending) setOpen(false);
        }}
      >
        <DialogTitle>Ångra incheckning</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Vill du ångra incheckningen för {row.firstName} {row.lastName}?
            Deltagaren markeras som ej incheckad och alla slutförda steg tas
            bort. Detta går inte att ångra.
          </DialogContentText>
          {undo.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Kunde inte ångra incheckningen.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={undo.isPending}>
            Avbryt
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => undo.mutate()}
            disabled={undo.isPending}
            startIcon={
              undo.isPending ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <UndoIcon />
              )
            }
          >
            Ångra incheckning
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

const COLUMN_COUNT = 8;

export function ParticipantSearch() {
  const locale = "sv";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const query = debouncedSearch.trim();
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<StatusBucket>>(
    () => new Set(),
  );

  // The status filter is applied server-side so paging stays correct: we send
  // the *visible* buckets. When none are hidden we omit the param entirely
  // (the backend then skips the predicate); when all are hidden we send an
  // empty string and the backend returns nothing.
  const visibleStatuses = STATUS_ORDER.filter((s) => !hiddenStatuses.has(s));
  const statusParam =
    visibleStatuses.length === STATUS_ORDER.length
      ? undefined
      : visibleStatuses.join(",");

  const {
    data,
    isError,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin", "reports", "list", query, locale, statusParam ?? "*"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await api.admin.reports.search.$get({
        query: {
          locale,
          offset: String(pageParam),
          limit: String(PAGE_SIZE),
          ...(query ? { q: query } : {}),
          ...(statusParam !== undefined ? { status: statusParam } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load participants");
      return (await res.json()) as ParticipantListResponse;
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.results.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const rows = useMemo(
    () => data?.pages.flatMap((page) => page.results) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;
  // Full per-bucket breakdown for the current search (independent of which
  // buckets are hidden), shown on the status pills.
  const statusCounts = data?.pages[0]?.statusCounts;

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 10,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Load the next page as the last row scrolls into view.
  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last) return;
    if (last.index >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [
    virtualRows,
    rows.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0);

  const isInitialLoading = isFetching && rows.length === 0 && !isError;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="h5" sx={{ flex: 1 }}>
          Deltagare
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
        {STATUS_ORDER.map((status) => {
          const hidden = hiddenStatuses.has(status);
          return (
            <Chip
              key={status}
              size="small"
              label={
                statusCounts
                  ? `${STATUS_LABELS[status]} (${statusCounts[status].toLocaleString(locale)})`
                  : STATUS_LABELS[status]
              }
              color={STATUS_COLORS[status]}
              variant={hidden ? "outlined" : "filled"}
              onClick={() => toggleStatus(status)}
              // Filled-vs-outlined alone is nearly invisible for the grey
              // ("default") buckets like Preliminär/Avanmäld, so a hidden pill
              // is also dimmed and struck through - an on/off signal that reads
              // regardless of the chip's colour.
              sx={
                hidden
                  ? {
                      opacity: 0.5,
                      "& .MuiChip-label": { textDecoration: "line-through" },
                    }
                  : undefined
              }
            />
          );
        })}
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 1 }}
      >
        {isInitialLoading
          ? "Läser in…"
          : `${total.toLocaleString(locale)} deltagare${
              rows.length < total ? ` (visar ${rows.length})` : ""
            }`}
      </Typography>

      {isError ? (
        <Alert severity="error">Kunde inte läsa in deltagare.</Alert>
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          ref={scrollRef}
          sx={{ maxHeight: "calc(100vh - 240px)", overflow: "auto" }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Namn</TableCell>
                <TableCell>Källa</TableCell>
                <TableCell>Grupp</TableCell>
                <TableCell>Undergrupp</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Incheckad</TableCell>
                <TableCell />
                {/* Reserved for per-participant admin actions (e.g. undo check-in). */}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && !isInitialLoading && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT}>
                    <Typography color="text.secondary">
                      Inga träffar.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {paddingTop > 0 && (
                <TableRow>
                  <TableCell
                    colSpan={COLUMN_COUNT}
                    sx={{ height: paddingTop, p: 0, border: 0 }}
                  />
                </TableRow>
              )}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                return (
                  <TableRow
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                  >
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
                    <TableCell align="right">
                      <UndoCheckinAction row={row} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {paddingBottom > 0 && (
                <TableRow>
                  <TableCell
                    colSpan={COLUMN_COUNT}
                    sx={{ height: paddingBottom, p: 0, border: 0 }}
                  />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

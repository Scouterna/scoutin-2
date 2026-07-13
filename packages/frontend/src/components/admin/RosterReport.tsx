import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import { type Theme, useTheme } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";
import {
  STATUS_LABELS,
  STATUS_ORDER,
  type StatusBucket,
  type StatusCounts,
} from "./participantStatus";

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

// Concrete CSS colors for the stacked meter segments, pulled from the MUI theme
// so light/dark both work. Kept aligned with STATUS_COLORS (the chip variants in
// participantStatus.tsx): confirmed=success, missing=warning, importError=error.
// The two "default" states get distinct greys so adjacent segments stay legible.
function statusColor(status: StatusBucket, theme: Theme): string {
  switch (status) {
    case "confirmed":
      return theme.palette.success.main;
    case "preliminaryOnly":
      return theme.palette.grey[theme.palette.mode === "dark" ? 500 : 400];
    case "missing":
      return theme.palette.warning.main;
    case "importError":
      return theme.palette.error.main;
    case "cancelled":
      return theme.palette.grey[theme.palette.mode === "dark" ? 700 : 600];
  }
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function aggregateCounts(sources: SourceSummary[]): StatusCounts {
  const acc: StatusCounts = {
    confirmed: 0,
    preliminaryOnly: 0,
    missing: 0,
    importError: 0,
    cancelled: 0,
    total: 0,
  };
  for (const source of sources) {
    for (const status of STATUS_ORDER) acc[status] += source.counts[status];
    acc.total += source.counts.total;
  }
  return acc;
}

// Horizontal stacked bar: one segment per non-empty status, widths proportional
// to their share. A 2px flex gap reveals the track between segments (the
// surface-gap spec), and the rounded container clips the outer ends.
function StackedMeter({
  counts,
  height = 14,
}: {
  counts: StatusCounts;
  height?: number;
}) {
  const theme = useTheme();
  const track =
    theme.palette.mode === "dark"
      ? theme.palette.grey[800]
      : theme.palette.grey[200];

  return (
    <Box
      sx={{
        display: "flex",
        gap: "2px",
        height,
        borderRadius: 999,
        overflow: "hidden",
        bgcolor: track,
      }}
    >
      {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
        <Tooltip
          key={status}
          title={`${STATUS_LABELS[status]}: ${counts[status]} (${pct(
            counts[status],
            counts.total,
          )}%)`}
        >
          <Box
            sx={{
              flexGrow: counts[status],
              flexBasis: 0,
              minWidth: 2,
              bgcolor: statusColor(status, theme),
              transition: "flex-grow 0.5s ease",
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

function MeterLegend({ counts }: { counts: StatusCounts }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
      {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
        <Box
          key={status}
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "3px",
              flexShrink: 0,
              bgcolor: statusColor(status, theme),
            }}
          />
          <Typography variant="body2" color="text.secondary">
            {STATUS_LABELS[status]}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {counts[status]}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderTop: accent ? `3px solid ${accent}` : undefined,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1 }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="body2" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

function SourceCard({ source }: { source: SourceSummary }) {
  const { counts } = source;
  const checkedInPct = pct(counts.confirmed, counts.total);
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 1,
          mb: 1.5,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {source.name}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {checkedInPct}%
        </Typography>
      </Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ display: "block", mb: 1 }}
      >
        {counts.confirmed} av {counts.total} incheckade
      </Typography>
      <StackedMeter counts={counts} />
      <Box sx={{ mt: 1.5 }}>
        <MeterLegend counts={counts} />
      </Box>
    </Paper>
  );
}

export function RosterReport() {
  const locale = "sv";
  const theme = useTheme();

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

  if (isSummaryLoading) return <Typography>Laddar…</Typography>;
  if (isSummaryError || !summary) {
    return <Alert severity="error">Kunde inte hämta rapporten.</Alert>;
  }

  const totals = aggregateCounts(summary.sources);
  const checkedInPct = pct(totals.confirmed, totals.total);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Rapporter
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 3 }}
      >
        Senast uppdaterad: {new Date(summary.generatedAt).toLocaleTimeString()}
      </Typography>

      {totals.importError > 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 3 }}>
          {totals.importError} deltagare kunde inte importeras korrekt.
        </Alert>
      )}

      {/* Hero: overall check-in progress across every source. */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: 1.5,
            flexWrap: "wrap",
            mb: 2,
          }}
        >
          <Typography variant="h2" sx={{ fontWeight: 700, lineHeight: 1 }}>
            {checkedInPct}%
          </Typography>
          <Typography variant="h6" color="text.secondary">
            incheckade · {totals.confirmed} av {totals.total}
          </Typography>
        </Box>
        <StackedMeter counts={totals} height={28} />
        <Box sx={{ mt: 2 }}>
          <MeterLegend counts={totals} />
        </Box>
      </Paper>

      {/* Headline numbers. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 2,
          mb: 4,
        }}
      >
        <StatTile
          label="Incheckade"
          value={totals.confirmed}
          sub={`${checkedInPct}% av totalen`}
          accent={theme.palette.success.main}
        />
        <StatTile
          label="Preliminära"
          value={totals.preliminaryOnly}
          accent={statusColor("preliminaryOnly", theme)}
        />
        <StatTile
          label="Saknas"
          value={totals.missing}
          accent={theme.palette.warning.main}
        />
        {totals.importError > 0 && (
          <StatTile
            label="Importfel"
            value={totals.importError}
            accent={theme.palette.error.main}
          />
        )}
        <StatTile label="Totalt" value={totals.total} />
      </Box>

      <Typography variant="h6" sx={{ mb: 2 }}>
        Per datakälla
      </Typography>
      {summary.sources.length === 0 ? (
        <Typography color="text.secondary">
          Inga datakällor konfigurerade.
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 2,
          }}
        >
          {summary.sources.map((source) => (
            <SourceCard key={source.key} source={source} />
          ))}
        </Box>
      )}
    </Box>
  );
}

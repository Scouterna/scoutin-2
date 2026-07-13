import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
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

export function RosterReport() {
  const locale = "sv";

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

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Rapporter
      </Typography>
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
          }}
        >
          {summary.sources.map((source) => (
            <SourceTile key={source.key} source={source} />
          ))}
        </Box>
      )}
    </Box>
  );
}

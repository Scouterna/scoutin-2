import { PlayArrow as PlayArrowIcon } from "@mui/icons-material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { api } from "@/api/api";
import { queryClient } from "@/lib/queryClient";
import { assertAdmin } from "@/lib/user-context";

export const Route = createFileRoute("/admin/jobs")({
  beforeLoad: ({ context }) => assertAdmin(context),
  component: JobsPage,
});

const jobsQueryKey = ["admin", "jobs"];

// Human-friendly Swedish labels for the known jobs; falls back to the raw id.
const JOB_LABELS: Record<string, string> = {
  "data-import": "Dataimport",
  "checkin-writeback": "Incheckning → Scoutnet",
};

function jobLabel(name: string): string {
  return JOB_LABELS[name] ?? name;
}

function formatInterval(ms: number): string {
  if (ms <= 0) return "Endast manuell";
  if (ms % 60000 === 0) return `Var ${ms / 60000} min`;
  if (ms % 1000 === 0) return `Var ${ms / 1000} s`;
  return `Var ${ms} ms`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = "Något gick fel";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep the fallback
  }
  throw new Error(message);
}

function JobsPage() {
  const jobsQuery = useQuery({
    queryKey: jobsQueryKey,
    queryFn: async () => {
      const res = await api.admin.jobs.$get();
      await assertOk(res as Response);
      return await res.json();
    },
    // Poll so a running job (and its outcome) is reflected live.
    refetchInterval: 3000,
  });

  const runMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.admin.jobs[":name"].run.$post({ param: { name } });
      await assertOk(res as Response);
    },
    onSuccess: (_data, name) => {
      toast.success(`Startade ${jobLabel(name)}`);
      queryClient.invalidateQueries({ queryKey: jobsQueryKey });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Kunde inte starta jobbet",
      );
    },
  });

  const jobs = jobsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <Typography variant="h5">Jobb</Typography>
      <Typography variant="body2" color="text.secondary">
        Schemalagda bakgrundsjobb. Kör ett jobb direkt med "Kör nu" – en manuell
        dataimport hämtar alltid färsk data även om ett schemalagt jobb redan
        pågår.
      </Typography>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Jobb</TableCell>
              <TableCell>Schema</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Senaste körning</TableCell>
              <TableCell align="right">Åtgärd</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    {jobsQuery.isLoading
                      ? "Laddar…"
                      : "Inga jobb registrerade."}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {jobs.map((job) => {
              const pending =
                runMutation.isPending && runMutation.variables === job.name;
              return (
                <TableRow key={job.name}>
                  <TableCell>
                    <Typography variant="body2">
                      {jobLabel(job.name)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.name}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatInterval(job.intervalMs)}</TableCell>
                  <TableCell>
                    <JobStatusChip running={job.running} queued={job.queued} />
                  </TableCell>
                  <TableCell>
                    <LastRun lastRun={job.lastRun} />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={job.running || pending}
                      onClick={() => runMutation.mutate(job.name)}
                      startIcon={
                        pending ? (
                          <CircularProgress size={14} color="inherit" />
                        ) : (
                          <PlayArrowIcon />
                        )
                      }
                    >
                      Kör nu
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function JobStatusChip({
  running,
  queued,
}: {
  running: boolean;
  queued: boolean;
}) {
  if (running) {
    return (
      <Chip
        size="small"
        color="info"
        label={queued ? "Kör (ny körning köad)" : "Kör"}
      />
    );
  }
  if (queued) {
    return <Chip size="small" color="info" label="Köad" />;
  }
  return <Chip size="small" variant="outlined" label="Vilande" />;
}

function LastRun({
  lastRun,
}: {
  lastRun: {
    finishedAt: number;
    durationMs: number;
    ok: boolean;
    error?: string;
  } | null;
}) {
  if (!lastRun) {
    return (
      <Typography variant="body2" color="text.secondary">
        Aldrig körd
      </Typography>
    );
  }

  const when = new Date(lastRun.finishedAt).toLocaleString("sv-SE");
  const outcome = lastRun.ok ? (
    <Chip size="small" color="success" variant="outlined" label="Lyckades" />
  ) : (
    <Tooltip title={lastRun.error ?? "Okänt fel"}>
      <Chip
        size="small"
        color="error"
        variant="outlined"
        label="Misslyckades"
      />
    </Tooltip>
  );

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {outcome}
      <Typography variant="body2" color="text.secondary">
        {when} · {formatDuration(lastRun.durationMs)}
      </Typography>
    </Box>
  );
}

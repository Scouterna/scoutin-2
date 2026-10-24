import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/api";
import { JobEventsDrawer } from "./JobEventsDrawer";
import { JobStateChip, jobStateLabel } from "./JobStateChip";
import { TestPrintDialog } from "./TestPrintDialog";

const STATES = [
  "queued",
  "leased",
  "sending",
  "printed",
  "unknown",
  "failed",
  "canceled",
] as const;

type JobAction =
  | { kind: "cancel"; id: string }
  | { kind: "printed" | "dismissed"; id: string };

const ACTION_TEXT: Record<
  JobAction["kind"],
  { title: string; body: string; button: string; done: string }
> = {
  cancel: {
    title: "Avbryt jobb",
    body: "Jobbet tas bort från kön och kommer inte att skrivas ut.",
    button: "Avbryt jobb",
    done: "Jobbet avbröts",
  },
  printed: {
    title: "Markera som utskriven",
    body: "Badgen kom ut. Jobbet registreras som utskrivet.",
    button: "Markera som utskriven",
    done: "Jobbet markerades som utskrivet",
  },
  dismissed: {
    title: "Avfärda jobb",
    body: "Badgen kom inte ut, och ingen behöver få veta mer om det. Jobbet avfärdas och skrivs inte ut igen.",
    button: "Avfärda",
    done: "Jobbet avfärdades",
  },
};

async function errorMessage(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // keep the fallback
  }
  return fallback;
}

export function JobsTab() {
  const queryClient = useQueryClient();
  const [state, setState] = useState("");
  const [poolId, setPoolId] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [action, setAction] = useState<JobAction | null>(null);
  const [testPrint, setTestPrint] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["admin", "printing", "jobs", "list", state, poolId, printerId],
    queryFn: async () => {
      const res = await api.admin.printing.jobs.$get({
        query: {
          ...(state && { state: state as (typeof STATES)[number] }),
          ...(poolId && { poolId }),
          ...(printerId && { printerId }),
        },
      });
      if (!res.ok) throw new Error("Kunde inte ladda jobb");
      return (await res.json()).jobs;
    },
    refetchInterval: 5000,
  });

  const poolsQuery = useQuery({
    queryKey: ["admin", "printing", "pools"],
    queryFn: async () => {
      const res = await api.admin.printing.pools.$get();
      if (!res.ok) throw new Error("Kunde inte ladda skrivarpoolerna");
      return (await res.json()).pools;
    },
    refetchInterval: 5000,
  });

  const printersQuery = useQuery({
    queryKey: ["admin", "printing", "printers"],
    queryFn: async () => {
      const res = await api.admin.printing.printers.$get();
      if (!res.ok) throw new Error("Kunde inte ladda skrivarna");
      return (await res.json()).printers;
    },
    refetchInterval: 5000,
  });

  const pools = poolsQuery.data ?? [];
  const printers = (printersQuery.data ?? []).map((p) => ({
    id: p.id,
    name: p.name ?? p.serial,
  }));
  const poolName = (id: string | null) =>
    id
      ? (pools.find((p) => p.id === id)?.name ?? "Borttagen skrivarpool")
      : null;
  const printerName = (id: string | null) =>
    id ? (printers.find((p) => p.id === id)?.name ?? "Okänd skrivare") : null;

  const actionMutation = useMutation({
    mutationFn: async (a: JobAction) => {
      const res =
        a.kind === "cancel"
          ? await api.admin.printing.jobs[":id"].cancel.$post({
              param: { id: a.id },
            })
          : await api.admin.printing.jobs[":id"].resolve.$post({
              param: { id: a.id },
              json: { resolution: a.kind },
            });
      if (!res.ok)
        throw new Error(await errorMessage(res, "Åtgärden misslyckades"));
    },
    onSuccess: (_data, a) => {
      setMessage(ACTION_TEXT[a.kind].done);
      setAction(null);
      queryClient.invalidateQueries({
        queryKey: ["admin", "printing", "jobs"],
      });
    },
  });

  const jobs = jobsQuery.data ?? [];

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 2,
          alignItems: "center",
          mb: 2,
        }}
      >
        <TextField
          select
          size="small"
          label="Status"
          value={state}
          onChange={(e) => setState(e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">Alla</MenuItem>
          {STATES.map((s) => (
            <MenuItem key={s} value={s}>
              {jobStateLabel(s)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Skrivarpool"
          value={poolId}
          onChange={(e) => setPoolId(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Alla</MenuItem>
          {pools.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Skrivare"
          value={printerId}
          onChange={(e) => setPrinterId(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Alla</MenuItem>
          {printers.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={() => setTestPrint(true)}>
          Testutskrift
        </Button>
      </Box>

      {jobsQuery.isLoading ? (
        <CircularProgress size={24} />
      ) : jobsQuery.isError ? (
        <Alert severity="error">Kunde inte ladda jobb.</Alert>
      ) : jobs.length === 0 ? (
        <Typography color="text.secondary">Inga jobb.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Skapad</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Mall</TableCell>
              <TableCell>Skrivarpool / skrivare</TableCell>
              <TableCell>Källa</TableCell>
              <TableCell>Felorsak</TableCell>
              <TableCell align="right">Åtgärder</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => (
              <TableRow
                key={job.id}
                hover
                onClick={() => setOpenJobId(job.id)}
                sx={{
                  cursor: "pointer",
                  ...(job.state === "unknown" && {
                    bgcolor: "warning.light",
                    "&:hover": { bgcolor: "warning.light" },
                  }),
                }}
              >
                <TableCell>
                  {new Date(job.createdAt).toLocaleString("sv-SE")}
                </TableCell>
                <TableCell>
                  <JobStateChip state={job.state} />
                </TableCell>
                <TableCell>{job.template}</TableCell>
                <TableCell>
                  {[
                    poolName(job.poolId),
                    printerName(job.printerId ?? job.targetPrinterId),
                  ]
                    .filter(Boolean)
                    .join(" / ") || "–"}
                </TableCell>
                <TableCell>{job.source}</TableCell>
                <TableCell>{job.failureReason ?? ""}</TableCell>
                <TableCell
                  align="right"
                  sx={{ whiteSpace: "nowrap" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {job.state === "queued" && (
                    <Button
                      size="small"
                      color="error"
                      onClick={() => setAction({ kind: "cancel", id: job.id })}
                    >
                      Avbryt
                    </Button>
                  )}
                  {job.state === "unknown" && (
                    <>
                      <Button
                        size="small"
                        onClick={() =>
                          setAction({ kind: "printed", id: job.id })
                        }
                      >
                        Markera som utskriven
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          setAction({ kind: "dismissed", id: job.id })
                        }
                      >
                        Avfärda
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <JobEventsDrawer jobId={openJobId} onClose={() => setOpenJobId(null)} />

      {action && (
        <Dialog
          open
          onClose={() => !actionMutation.isPending && setAction(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{ACTION_TEXT[action.kind].title}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {ACTION_TEXT[action.kind].body}
            </DialogContentText>
            {actionMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {actionMutation.error.message}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setAction(null)}
              disabled={actionMutation.isPending}
            >
              Tillbaka
            </Button>
            <Button
              variant="contained"
              color={action.kind === "cancel" ? "error" : "primary"}
              onClick={() => actionMutation.mutate(action)}
              disabled={actionMutation.isPending}
            >
              {ACTION_TEXT[action.kind].button}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {testPrint && (
        <TestPrintDialog
          pools={pools}
          printers={printers}
          onClose={() => setTestPrint(false)}
          onDone={setMessage}
        />
      )}

      <Snackbar
        open={message !== null}
        autoHideDuration={4000}
        onClose={() => setMessage(null)}
        message={message}
      />
    </Box>
  );
}

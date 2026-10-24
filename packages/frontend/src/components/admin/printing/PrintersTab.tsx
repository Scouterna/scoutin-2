import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { poolsQueryKey, poolsQueryOptions } from "./PoolsQuery";
import { apiErrorMessage } from "./PrinterApiError";
import { PrinterLastSeen } from "./PrinterLastSeen";
import { PrinterStateChip } from "./PrinterStateChip";

type Printer = InferResponseType<
  typeof api.admin.printing.printers.$get
>["printers"][number];

type ActionKind = "calibrate" | "cancelBuffer";
type PendingAction = { printer: Printer; kind: ActionKind };

const printersQueryKey = ["admin", "printing", "printers"];

const actionCopy: Record<
  ActionKind,
  { title: string; body: string; confirm: string; done: string }
> = {
  calibrate: {
    title: "Kalibrera etiketter?",
    body: "Kalibreringen matar fram etiketter genom skrivaren, så tomma badge-etiketter går åt. Kör den bara med etiketter i skrivaren och inga andra jobb köade på skrivaren.",
    confirm: "Kalibrera",
    done: "Kalibreringen är klar",
  },
  cancelBuffer: {
    title: "Rensa bufferten?",
    body: "Rensa bufferten tar bort allt som skrivaren redan har tagit emot men inte skrivit ut. De badgerna kommer inte ut.",
    confirm: "Rensa bufferten",
    done: "Bufferten är rensad",
  },
};

/** The printer's name, saved on blur or Enter. Empty falls back to the serial. */
function PrinterNameField({
  printer,
  onSave,
}: {
  printer: Printer;
  onSave: (name: string | null) => void;
}) {
  const [value, setValue] = useState(printer.name ?? "");
  const commit = () => {
    const next = value.trim();
    if (next === (printer.name ?? "")) return;
    onSave(next || null);
  };
  return (
    <TextField
      variant="standard"
      size="small"
      value={value}
      placeholder={printer.serial}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      slotProps={{ htmlInput: { "aria-label": "Skrivarnamn" } }}
    />
  );
}

export function PrintersTab() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const printersQuery = useQuery({
    queryKey: printersQueryKey,
    queryFn: async () => {
      const res = await api.admin.printing.printers.$get();
      if (!res.ok) throw new Error("Kunde inte ladda skrivarna");
      return (await res.json()).printers;
    },
    refetchInterval: 5000,
  });
  const poolsQuery = useQuery(poolsQueryOptions);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: printersQueryKey });
    queryClient.invalidateQueries({ queryKey: poolsQueryKey });
  };

  const patchMutation = useMutation({
    mutationFn: async (input: {
      id: string;
      body: { name?: string | null; poolId?: string | null };
    }) => {
      const res = await api.admin.printing.printers[":id"].$patch({
        param: { id: input.id },
        json: input.body,
      });
      if (!res.ok) {
        throw new Error(
          await apiErrorMessage(res, "Kunde inte spara skrivaren"),
        );
      }
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  const actionMutation = useMutation({
    mutationFn: async (input: PendingAction) => {
      const res = await api.admin.printing.printers[":id"].actions.$post({
        param: { id: input.printer.id },
        json: { kind: input.kind },
      });
      if (!res.ok) {
        throw new Error(
          await apiErrorMessage(res, "Skrivarens åtgärd misslyckades"),
        );
      }
      return res.json();
    },
    onSuccess: (result, input) => {
      setPending(null);
      if (!result.ok) {
        toast.error(result.error ?? "Skrivarens åtgärd misslyckades");
        return;
      }
      toast.success(actionCopy[input.kind].done);
    },
    onError: (e) => {
      setPending(null);
      toast.error(e.message);
    },
  });

  const pools = poolsQuery.data ?? [];
  const printers = printersQuery.data ?? [];

  if (printersQuery.isLoading) return <div>Laddar…</div>;
  if (printersQuery.isError) {
    return <Typography color="error">Kunde inte ladda skrivarna.</Typography>;
  }

  return (
    <Box>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Namn</TableCell>
              <TableCell>Serienummer</TableCell>
              <TableCell>Modell</TableCell>
              <TableCell>Relä</TableCell>
              <TableCell>Skrivarpool</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Senast sedd</TableCell>
              <TableCell align="right">Åtgärder</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {printers.map((printer) => {
              const offline =
                printer.state === "offline" || !printer.relay?.connected;
              const busy =
                actionMutation.isPending &&
                actionMutation.variables?.printer.id === printer.id;
              return (
                <TableRow key={printer.id}>
                  <TableCell>
                    <PrinterNameField
                      key={`${printer.id}:${printer.name ?? ""}`}
                      printer={printer}
                      onSave={(name) =>
                        patchMutation.mutate({
                          id: printer.id,
                          body: { name },
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>{printer.serial}</TableCell>
                  <TableCell>{printer.model ?? "—"}</TableCell>
                  <TableCell>{printer.relay?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      variant="standard"
                      value={printer.pool?.id ?? "none"}
                      disabled={!poolsQuery.data}
                      onChange={(e) =>
                        patchMutation.mutate({
                          id: printer.id,
                          body: {
                            poolId:
                              e.target.value === "none" ? null : e.target.value,
                          },
                        })
                      }
                    >
                      <MenuItem value="none">Ingen</MenuItem>
                      {pools.map((pool) => (
                        <MenuItem key={pool.id} value={pool.id}>
                          {pool.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <PrinterStateChip
                        state={printer.state}
                        detail={printer.stateDetail}
                      />
                      {printer.waiting && (
                        <Typography variant="caption" color="text.secondary">
                          väntar på jobb
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <PrinterLastSeen at={printer.lastSeenAt} />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Button
                      size="small"
                      disabled={offline || busy}
                      onClick={() => setPending({ printer, kind: "calibrate" })}
                    >
                      Kalibrera
                    </Button>
                    {/* The apply-profile action needs the profile's settings,
                        which the admin API doesn't serve yet, so it's off. */}
                    <Tooltip title="Profilinställningar är inte tillgängliga i admin än">
                      <span>
                        <Button size="small" disabled>
                          Tillämpa profil
                        </Button>
                      </span>
                    </Tooltip>
                    <Button
                      size="small"
                      disabled={offline || busy}
                      onClick={() =>
                        setPending({ printer, kind: "cancelBuffer" })
                      }
                    >
                      Rensa bufferten
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        maxWidth="xs"
        fullWidth
      >
        {pending && (
          <>
            <DialogTitle>{actionCopy[pending.kind].title}</DialogTitle>
            <DialogContent>
              <DialogContentText>
                {actionCopy[pending.kind].body}
              </DialogContentText>
              <DialogContentText sx={{ mt: 2 }}>
                Skrivare:{" "}
                <strong>
                  {pending.printer.name ?? pending.printer.serial}
                </strong>
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)}>Avbryt</Button>
              <Button
                variant="contained"
                disabled={actionMutation.isPending}
                onClick={() => actionMutation.mutate(pending)}
              >
                {actionCopy[pending.kind].confirm}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

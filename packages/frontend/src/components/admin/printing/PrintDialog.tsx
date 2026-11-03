import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { poolsQueryOptions } from "./PoolsQuery";
import { apiErrorMessage } from "./PrinterApiError";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const printersQueryOptions = {
  queryKey: ["admin", "printing", "printers"],
  queryFn: async () => {
    const res = await api.admin.printing.printers.$get();
    if (!res.ok) throw new Error("Kunde inte ladda skrivarna");
    return (await res.json()).printers;
  },
};

export type PrintTarget = {
  key: string;
  kind: "pool" | "printer";
  id: string;
  name: string;
};

/** Pools and printers a job can go to, as one list. */
export function usePrintTargets() {
  const printersQuery = useQuery(printersQueryOptions);
  const poolsQuery = useQuery(poolsQueryOptions);
  const pools = poolsQuery.data ?? [];
  const printers = printersQuery.data ?? [];
  const targets: PrintTarget[] = [
    ...pools.map((p) => ({
      key: `pool:${p.id}`,
      kind: "pool" as const,
      id: p.id,
      name: p.name,
    })),
    ...printers.map((p) => ({
      key: `printer:${p.id}`,
      kind: "printer" as const,
      id: p.id,
      name: p.name ?? p.serial,
    })),
  ];
  return { pools, printers, targets };
}

/** Target and copies inputs. */
export function PrintTargetFields({
  pools,
  printers,
  targetKey,
  onTargetKey,
  copies,
  onCopies,
}: {
  pools: { id: string; name: string }[];
  printers: { id: string; name: string | null; serial: string }[];
  targetKey: string;
  onTargetKey: (key: string) => void;
  copies: number;
  onCopies: (copies: number) => void;
}) {
  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Skriv ut på"
        value={targetKey}
        onChange={(e) => onTargetKey(e.target.value)}
        fullWidth
      >
        <ListSubheader>Skrivarpooler</ListSubheader>
        {pools.map((p) => (
          <MenuItem key={p.id} value={`pool:${p.id}`}>
            {p.name}
          </MenuItem>
        ))}
        <ListSubheader>Skrivare</ListSubheader>
        {printers.map((p) => (
          <MenuItem key={p.id} value={`printer:${p.id}`}>
            {p.name ?? p.serial}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Antal kopior"
        type="number"
        value={copies}
        onChange={(e) =>
          onCopies(clamp(Math.trunc(+e.target.value) || 1, 1, 10))
        }
        slotProps={{ htmlInput: { min: 1, max: 10 } }}
        fullWidth
      />
    </Stack>
  );
}

/**
 * The explicit confirmation before a template job is queued. `children` (the
 * target inputs, in the studio) show above the question; without a target
 * the confirm button stays disabled.
 */
export function PrintConfirmDialog({
  templateName,
  values,
  target,
  copies,
  onClose,
  children,
}: {
  templateName: string;
  values: unknown;
  target: PrintTarget | undefined;
  copies: number;
  onClose: () => void;
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("Mål saknas");
      const res = await api.admin.printing.jobs.template.$post({
        json: {
          template: templateName,
          values,
          copies,
          ...(target.kind === "pool"
            ? { poolId: target.id }
            : { printerId: target.id }),
        },
      });
      if (!res.ok) {
        throw new Error(
          await apiErrorMessage(res, "Kunde inte köa utskriften"),
        );
      }
      return await res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "printing", "jobs"],
      });
      const n = result.jobs.length;
      toast.success(n === 1 ? "1 jobb köades" : `${n} jobb köades`);
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={() => !mutation.isPending && onClose()}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Skriv ut</DialogTitle>
      <DialogContent>
        {children && <Stack sx={{ pt: 1, pb: 2 }}>{children}</Stack>}
        {target && (
          <DialogContentText>
            Skriv ut {copies} {copies === 1 ? "kopia" : "kopior"} av{" "}
            {templateName} på {target.name}?
          </DialogContentText>
        )}
        {mutation.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {mutation.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Avbryt
        </Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !target}
        >
          Skriv ut
        </Button>
      </DialogActions>
    </Dialog>
  );
}

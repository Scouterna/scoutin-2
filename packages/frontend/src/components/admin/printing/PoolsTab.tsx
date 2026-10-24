import Add from "@mui/icons-material/Add";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
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
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { type Pool, poolsQueryKey, poolsQueryOptions } from "./PoolsQuery";
import { apiErrorMessage } from "./PrinterApiError";

const STILL_HAS_JOBS =
  "Skrivarpoolen har fortfarande jobb köade eller under utskrift. Avbryt dem eller vänta först";

type PoolFormProps = {
  /** The pool to edit, or null to create one. */
  pool: Pool | null;
  onClose: () => void;
};

function PoolFormDialog({ pool, onClose }: PoolFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(pool?.name ?? "");
  const [profile, setProfile] = useState(pool?.profile ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), profile: profile.trim() || null };
      if (pool) {
        const res = await api.admin.printing.pools[":id"].$patch({
          param: { id: pool.id },
          json: body,
        });
        if (!res.ok) {
          throw new Error(
            await apiErrorMessage(res, "Kunde inte spara skrivarpoolen"),
          );
        }
      } else {
        const res = await api.admin.printing.pools.$post({ json: body });
        if (!res.ok) {
          throw new Error(
            await apiErrorMessage(res, "Kunde inte skapa skrivarpoolen"),
          );
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: poolsQueryKey });
      onClose();
    },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {pool ? "Redigera skrivarpool" : "Ny skrivarpool"}
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Namn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
        />
        <TextField
          fullWidth
          label="Profil"
          helperText="Namn på profilen med skrivarinställningar. Valfritt."
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        />
        {mutation.isError && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {mutation.error.message}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || mutation.isPending}
        >
          Spara
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeletePoolDialog({
  pool,
  onClose,
}: {
  pool: Pool;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.printing.pools[":id"].$delete({
        param: { id: pool.id },
      });
      if (res.status === 409) throw new Error(STILL_HAS_JOBS);
      if (!res.ok) {
        throw new Error(
          await apiErrorMessage(res, "Kunde inte ta bort skrivarpoolen"),
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: poolsQueryKey });
      // Printers and kiosks in the pool become unassigned.
      queryClient.invalidateQueries({
        queryKey: ["admin", "printing", "printers"],
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "kiosks"] });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Ta bort skrivarpool</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Ta bort <strong>{pool.name}</strong>? Dess skrivare och kiosker blir
          utan skrivarpool.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          variant="contained"
          color="error"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Ta bort
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function PoolsTab() {
  const [editing, setEditing] = useState<Pool | "new" | null>(null);
  const [deleting, setDeleting] = useState<Pool | null>(null);

  const poolsQuery = useQuery({
    ...poolsQueryOptions,
    refetchInterval: 5000,
  });

  if (poolsQuery.isLoading) return <div>Laddar…</div>;
  if (poolsQuery.isError) {
    return (
      <Typography color="error">Kunde inte ladda skrivarpoolerna.</Typography>
    );
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setEditing("new")}
        >
          Ny skrivarpool
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Namn</TableCell>
              <TableCell>Profil</TableCell>
              <TableCell align="right">Skrivare</TableCell>
              <TableCell align="right">Köade</TableCell>
              <TableCell align="right">Fungerande skrivare</TableCell>
              <TableCell align="right">Åtgärder</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {poolsQuery.data?.map((pool) => {
              const stalled = pool.queued > 0 && pool.healthyPrinters === 0;
              return (
                <TableRow key={pool.id}>
                  <TableCell>
                    {pool.name}
                    {stalled && (
                      <Chip
                        label="Fastnat"
                        color="warning"
                        size="small"
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>{pool.profile ?? "—"}</TableCell>
                  <TableCell align="right">{pool.printers.length}</TableCell>
                  <TableCell align="right">{pool.queued}</TableCell>
                  <TableCell align="right">{pool.healthyPrinters}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <IconButton
                      size="small"
                      title="Redigera"
                      onClick={() => setEditing(pool)}
                    >
                      <EditOutlined fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      title="Ta bort"
                      color="error"
                      onClick={() => setDeleting(pool)}
                    >
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {editing && (
        <PoolFormDialog
          pool={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeletePoolDialog pool={deleting} onClose={() => setDeleting(null)} />
      )}
    </Box>
  );
}

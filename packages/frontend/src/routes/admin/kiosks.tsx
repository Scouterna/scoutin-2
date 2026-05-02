import Add from "@mui/icons-material/Add";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/api/api";
import { AddKioskDialog } from "../../components/admin/AddKioskDialog";

export const Route = createFileRoute("/admin/kiosks")({
  component: KiosksPage,
});

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(date: string): string {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const cutoffs: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2592000, "week"],
    [Infinity, "month"],
  ];
  for (const [limit, unit] of cutoffs) {
    if (Math.abs(seconds) < limit) {
      const divisors: Record<string, number> = {
        second: 1,
        minute: 60,
        hour: 3600,
        day: 86400,
        week: 604800,
        month: 2592000,
      };
      return rtf.format(Math.round(seconds / divisors[unit]), unit);
    }
  }
  return rtf.format(Math.round(seconds / 2592000), "month");
}

type Kiosk = {
  id: string;
  name: string;
  lastSeenAt: string | null;
  createdAt: string;
};

function RenameDialog({
  kiosk,
  onClose,
}: {
  kiosk: Kiosk;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(kiosk.name);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.kiosks[":id"].$patch({
        param: { id: kiosk.id },
        json: { name },
      });
      if (!res.ok) throw new Error("Failed to rename");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "kiosks"] });
      onClose();
    },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename kiosk</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) mutation.mutate();
          }}
          sx={{ mt: 1 }}
        />
        {mutation.isError && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            Failed to rename. Please try again.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || mutation.isPending}
          variant="contained"
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeleteDialog({
  kiosk,
  onClose,
}: {
  kiosk: Kiosk;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.kiosks[":id"].$delete({
        param: { id: kiosk.id },
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "kiosks"] });
      onClose();
    },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete kiosk</DialogTitle>
      <DialogContent>
        <Typography>
          Delete <strong>{kiosk.name}</strong>? This will immediately revoke its
          access and cannot be undone.
        </Typography>
        {mutation.isError && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            Failed to delete. Please try again.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          variant="contained"
          color="error"
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function KiosksPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<Kiosk | null>(null);
  const [deleting, setDeleting] = useState<Kiosk | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "kiosks"],
    queryFn: async () => {
      const res = await api.admin.kiosks.$get();
      return res.json();
    },
  });

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h5">Kiosks</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setAddOpen(true)}
        >
          Add kiosk
        </Button>
      </Box>

      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Last seen</TableCell>
              <TableCell>Added</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.kiosks.map((kiosk) => (
              <TableRow key={kiosk.id}>
                <TableCell>{kiosk.name}</TableCell>
                <TableCell>
                  {kiosk.lastSeenAt ? timeAgo(kiosk.lastSeenAt) : "Never"}
                </TableCell>
                <TableCell>
                  {new Date(kiosk.createdAt).toLocaleString()}
                </TableCell>
                <TableCell
                  sx={{
                    whiteSpace: "nowrap",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 0.5,
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={() => setRenaming(kiosk as Kiosk)}
                  >
                    <EditOutlined fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setDeleting(kiosk as Kiosk)}
                  >
                    <DeleteOutlined fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AddKioskDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {renaming && (
        <RenameDialog kiosk={renaming} onClose={() => setRenaming(null)} />
      )}
      {deleting && (
        <DeleteDialog kiosk={deleting} onClose={() => setDeleting(null)} />
      )}
    </Box>
  );
}

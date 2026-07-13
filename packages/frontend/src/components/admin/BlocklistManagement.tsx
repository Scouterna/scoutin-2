import {
  Add as AddIcon,
  Delete as DeleteOutlineIcon,
} from "@mui/icons-material";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/api/api";

// Server never ships the blocklist contents to the browser; the admin works by
// selecting a participant or typing raw identifiers, and stored values are
// anonymized (hashed, un-joinable to participants). Note this does not make
// membership unprobeable: the total count is exposed here, and the kiosk itself
// reveals whether a given identifier is blocked. The response bodies are
// constant only to avoid piling on an extra, redundant signal.

type SearchResult = {
  id: string;
  firstName: string;
  lastName: string;
  subGroupName: string | null;
  sourceName: string;
  groupName: string | null;
};

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={pending ? undefined : onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{description}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={pending}>
          Avbryt
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={pending}
          startIcon={pending ? <CircularProgress size={16} /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

function BlockCount() {
  const { data } = useQuery({
    queryKey: ["admin", "blocklist", "count"],
    queryFn: async () => {
      const res = await api.admin.blocklist.count.$get();
      if (!res.ok) throw new Error("Kunde inte hämta antal");
      return (await res.json()) as { count: number };
    },
  });

  return (
    <Typography variant="body2" color="text.secondary">
      Antal blockeringar: {data?.count ?? "…"}
    </Typography>
  );
}

function BlockParticipantSection() {
  const queryClient = useQueryClient();
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebouncedValue(rawQuery.trim(), 300);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState(false);

  const search = useQuery({
    queryKey: ["admin", "blocklist", "participant-search", query],
    enabled: query.length > 0,
    queryFn: async () => {
      const res = await api.admin.reports.search.$get({
        query: { q: query, limit: "20" },
      });
      if (!res.ok) throw new Error("Sökningen misslyckades");
      const body = (await res.json()) as { results: SearchResult[] };
      return body.results;
    },
  });

  const block = useMutation({
    mutationFn: async (participantId: string) => {
      const res = await api.admin.blocklist.$post({
        json: { participantId },
      });
      if (!res.ok) throw new Error("Kunde inte skapa blockering");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "blocklist"] });
      setSelected(null);
      setRawQuery("");
      setConfirmOpen(false);
      setDone(true);
    },
  });

  return (
    <Paper
      component="form"
      sx={{ p: 3 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (selected) setConfirmOpen(true);
      }}
    >
      <Typography variant="h6" gutterBottom>
        Blockera deltagare
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Sök upp en deltagare och blockera dem. Alla deras identifierare
        (medlemsnummer, personnummer) blockeras.
      </Typography>

      <TextField
        fullWidth
        label="Sök deltagare"
        value={rawQuery}
        onChange={(e) => {
          setRawQuery(e.target.value);
          setDone(false);
        }}
        placeholder="Namn, medlemsnummer eller personnummer"
      />

      {search.isFetching && (
        <Box sx={{ display: "flex", justifyContent: "center", my: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {search.data && search.data.length > 0 && (
        <List dense sx={{ maxHeight: 260, overflow: "auto" }}>
          {search.data.map((r) => (
            <ListItemButton
              key={r.id}
              selected={selected?.id === r.id}
              onClick={() => setSelected(r)}
            >
              <ListItemText
                primary={`${r.firstName} ${r.lastName}`}
                secondary={[r.sourceName, r.groupName, r.subGroupName]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </ListItemButton>
          ))}
        </List>
      )}

      {block.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {(block.error as Error).message}
        </Alert>
      )}

      {done && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Blockeringen är skapad.
        </Alert>
      )}

      <Box sx={{ mt: 2 }}>
        <Button
          type="submit"
          variant="contained"
          color="error"
          disabled={!selected || block.isPending}
        >
          {selected
            ? `Blockera ${selected.firstName} ${selected.lastName}`
            : "Välj en deltagare"}
        </Button>
      </Box>

      <ConfirmDialog
        open={confirmOpen && selected != null}
        title="Bekräfta blockering"
        confirmLabel="Blockera"
        pending={block.isPending}
        description={
          selected
            ? `Blockera ${selected.firstName} ${selected.lastName}? Alla deras identifierare (medlemsnummer, personnummer) blockeras och de stoppas vid incheckning.`
            : ""
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => selected && block.mutate(selected.id)}
      />
    </Paper>
  );
}

function BlockByIdentifierSection() {
  const queryClient = useQueryClient();
  const [identifiers, setIdentifiers] = useState<string[]>([""]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState(false);

  const setAt = (index: number, value: string) => {
    setIdentifiers((prev) => prev.map((v, i) => (i === index ? value : v)));
    setDone(false);
  };
  const addField = () => setIdentifiers((prev) => [...prev, ""]);
  const removeAt = (index: number) =>
    setIdentifiers((prev) => prev.filter((_, i) => i !== index));

  const block = useMutation({
    mutationFn: async (values: string[]) => {
      const res = await api.admin.blocklist.$post({
        json: { identifiers: values },
      });
      if (!res.ok) throw new Error("Kunde inte skapa blockering");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "blocklist"] });
      setIdentifiers([""]);
      setConfirmOpen(false);
      setDone(true);
    },
  });

  const trimmed = identifiers.map((v) => v.trim()).filter(Boolean);

  return (
    <Paper
      component="form"
      sx={{ p: 3 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length > 0) setConfirmOpen(true);
      }}
    >
      <Typography variant="h6" gutterBottom>
        Blockera via identifierare
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        För personer som inte finns bland deltagarna. Ange medlemsnummer
        och/eller personnummer. Endast de identifierare du anger blockeras.
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {identifiers.map((value, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Box key={index} sx={{ display: "flex", gap: 1 }}>
            <TextField
              fullWidth
              size="small"
              label={`Identifierare ${index + 1}`}
              value={value}
              onChange={(e) => setAt(index, e.target.value)}
            />
            <IconButton
              aria-label="Ta bort"
              disabled={identifiers.length === 1}
              onClick={() => removeAt(index)}
            >
              <DeleteOutlineIcon />
            </IconButton>
          </Box>
        ))}
      </Box>

      <Button
        type="button"
        startIcon={<AddIcon />}
        onClick={addField}
        sx={{ mt: 1 }}
      >
        Lägg till identifierare
      </Button>

      {block.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {(block.error as Error).message}
        </Alert>
      )}

      {done && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Blockeringen är skapad.
        </Alert>
      )}

      <Box sx={{ mt: 2 }}>
        <Button
          type="submit"
          variant="contained"
          color="error"
          disabled={trimmed.length === 0 || block.isPending}
        >
          Blockera
        </Button>
      </Box>

      <ConfirmDialog
        open={confirmOpen && trimmed.length > 0}
        title="Bekräfta blockering"
        confirmLabel="Blockera"
        pending={block.isPending}
        description={`Blockera ${trimmed.length} identifierare? De angivna identifierarna blockeras och stoppas vid incheckning.`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => block.mutate(trimmed)}
      />
    </Paper>
  );
}

function RemoveBlockSection() {
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState(false);

  const remove = useMutation({
    mutationFn: async (value: string) => {
      const res = await api.admin.blocklist.remove.$post({
        json: { identifier: value },
      });
      if (!res.ok) throw new Error("Något gick fel");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "blocklist"] });
      setIdentifier("");
      setConfirmOpen(false);
      setDone(true);
    },
  });

  const trimmed = identifier.trim();

  return (
    <Paper
      component="form"
      sx={{ p: 3 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length > 0) setConfirmOpen(true);
      }}
    >
      <Typography variant="h6" gutterBottom>
        Ta bort blockering
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ange en identifierare för personen. Alla deras blockerade identifierare
        tas bort.
      </Typography>

      <TextField
        fullWidth
        label="Identifierare"
        value={identifier}
        onChange={(e) => {
          setIdentifier(e.target.value);
          setDone(false);
        }}
        placeholder="Medlemsnummer eller personnummer"
      />

      {remove.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {(remove.error as Error).message}
        </Alert>
      )}

      {done && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Om identifieraren fanns i listan är den nu borttagen.
        </Alert>
      )}

      <Box sx={{ mt: 2 }}>
        <Button
          type="submit"
          variant="outlined"
          disabled={trimmed.length === 0 || remove.isPending}
        >
          Ta bort
        </Button>
      </Box>

      <ConfirmDialog
        open={confirmOpen && trimmed.length > 0}
        title="Bekräfta borttagning"
        confirmLabel="Ta bort"
        pending={remove.isPending}
        description="Ta bort blockeringen för denna identifierare? Alla personens blockerade identifierare tas bort och de släpps in vid incheckning."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate(trimmed)}
      />
    </Paper>
  );
}

export function BlocklistManagement() {
  return (
    <Box sx={{ maxWidth: 720 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          mb: 1,
        }}
      >
        <Typography variant="h4">Blockering</Typography>
        <BlockCount />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Blockerade personer stoppas direkt vid incheckning, innan flödet
        startar. Listan är anonym och kan inte visas.
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <BlockParticipantSection />
        <BlockByIdentifierSection />
        <Divider />
        <RemoveBlockSection />
      </Box>
    </Box>
  );
}

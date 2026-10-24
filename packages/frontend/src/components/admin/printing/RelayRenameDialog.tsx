import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { assertRelayOk, type Relay, relaysQueryKey } from "./RelayApi";

type Props = {
  relay: Relay;
  onClose: () => void;
};

export function RelayRenameDialog({ relay, onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(relay.name);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.printing.relays[":id"].$patch({
        param: { id: relay.id },
        json: { name: name.trim() },
      });
      await assertRelayOk(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: relaysQueryKey });
      toast.success("Reläets namn ändrades");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Byt namn på relä</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Namn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) mutation.mutate();
          }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || mutation.isPending}
          variant="contained"
        >
          Spara
        </Button>
      </DialogActions>
    </Dialog>
  );
}

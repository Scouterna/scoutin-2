import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/api";

type Props = { open: boolean; onClose: () => void };

export function AddKioskDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.kiosks.$post({ json: {} });
      if (!res.ok) throw new Error("Failed to generate code");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "kiosks"] });
    },
  });

  function handleClose() {
    mutation.reset();
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add kiosk</DialogTitle>
      <DialogContent>
        {mutation.data ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter this code on the kiosk. It expires in 15 minutes.
            </Typography>
            <Typography
              variant="h3"
              sx={{
                py: 2,
                px: 1,
                bgcolor: "grey.100",
                borderRadius: 1,
                fontFamily: "monospace",
                textAlign: "center",
                letterSpacing: "0.2em",
              }}
            >
              {mutation.data.code}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Generate a one-time activation code for a new kiosk. The person
            setting up the kiosk will enter their own name for it during
            activation.
          </Typography>
        )}
        {mutation.isError && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            Failed to generate code. Please try again.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {mutation.data ? (
          <Button onClick={handleClose}>Done</Button>
        ) : (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              variant="contained"
            >
              Generate code
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

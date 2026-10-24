import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import type { ReactNode } from "react";

type Props = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  confirmColor?: "primary" | "error";
  onConfirm: () => void;
  onClose: () => void;
};

/** Confirm step for relay actions. The caller runs the action on confirm. */
export function RelayConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmColor = "primary",
  onConfirm,
  onClose,
}: Props) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{body}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button onClick={onConfirm} variant="contained" color={confirmColor}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useState } from "react";
import { adminPrintPoolIdAtom } from "@/store/adminPrintPool";
import { poolsQueryOptions } from "./PoolsQuery";

type Props = { onChanged: () => void };

export function PrintPoolControl({ onChanged }: Props) {
  const [storedId, setStoredId] = useAtom(adminPrintPoolIdAtom);
  const poolsQuery = useQuery(poolsQueryOptions);
  const pools = poolsQuery.data ?? [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("none");

  const current = pools.find((pool) => pool.id === storedId);
  const currentValue = current ? current.id : "none";

  function handleOpen() {
    setDraft(currentValue);
    setOpen(true);
  }

  function handleConfirm() {
    setStoredId(draft === "none" ? null : draft);
    setOpen(false);
    onChanged();
  }

  return (
    <>
      {poolsQuery.data &&
        (current ? (
          <Chip
            label={`Skrivarpool: ${current.name}`}
            icon={<PrintOutlinedIcon />}
            variant="outlined"
            size="small"
            onClick={handleOpen}
          />
        ) : (
          <Chip
            label="Välj skrivarpool"
            icon={<PrintOutlinedIcon />}
            color="warning"
            size="small"
            onClick={handleOpen}
          />
        ))}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Välj skrivarpool</DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1, mb: 2 }}
          >
            Sessionen startas om när du byter skrivarpool.
          </Typography>
          <FormControl size="small">
            <InputLabel id="print-pool-control-label">Skrivarpool</InputLabel>
            <Select
              labelId="print-pool-control-label"
              label="Skrivarpool"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            >
              <MenuItem value="none">Ingen</MenuItem>
              {pools.map((pool) => (
                <MenuItem key={pool.id} value={pool.id}>
                  {pool.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Avbryt</Button>
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={draft === currentValue}
          >
            Välj och starta om
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

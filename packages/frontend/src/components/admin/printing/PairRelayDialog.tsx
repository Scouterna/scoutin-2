import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { ColorSwatch } from "./ColorSwatch";
import {
  clearAll,
  clearLast,
  colorForKey,
  completeCode,
  describeCode,
  emptyPicker,
  PAIRING_COLOR_NAMES,
  PAIRING_PALETTE,
  type PickerState,
  pickColor,
  selectSlot,
} from "./PairingColors";
import {
  assertRelayOk,
  type PairingColor,
  type PairingFound,
  relaysQueryKey,
} from "./RelayApi";

const NO_MATCH = "Inget relä visar de färgerna";

// Keys typed while a text field has focus are text, not shortcuts.
const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

type Props = {
  onClose: () => void;
};

/** Pick the four colors on a relay's LEDs, then find and pair it. */
export function PairRelayDialog({ onClose }: Props) {
  const queryClient = useQueryClient();
  const [picker, setPicker] = useState<PickerState>(emptyPicker);
  const [found, setFound] = useState<PairingFound | null>(null);
  const [name, setName] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const code = completeCode(picker.slots);

  // Any change to the code makes the last lookup stale.
  const changePicker = useCallback(
    (update: (s: PickerState) => PickerState) => {
      setPicker(update);
      setFound(null);
      setLookupError(null);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        changePicker(clearLast);
        return;
      }
      const color = colorForKey(e.key);
      if (color) {
        e.preventDefault();
        changePicker((s) => pickColor(s, color));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changePicker]);

  const lookup = useMutation({
    mutationFn: async (colors: PairingColor[]) => {
      const res = await api.admin.printing.pairing.lookup.$post({
        json: { colors },
      });
      if (res.status === 404) throw new Error(NO_MATCH);
      await assertRelayOk(res);
      return res.json();
    },
    onSuccess: (data) => {
      setLookupError(null);
      setFound(data);
      setName(data.hostname ?? "");
    },
    onError: (e) => {
      setFound(null);
      setLookupError(e.message);
    },
  });

  const pair = useMutation({
    mutationFn: async (colors: PairingColor[]) => {
      const res = await api.admin.printing.pairing.$post({
        json: { colors, name: name.trim() },
      });
      await assertRelayOk(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: relaysQueryKey });
      toast.success("Reläet kopplades");
      onClose();
    },
    onError: (e) => setLookupError(e.message),
  });

  let body: ReactNode;
  if (found) {
    body = (
      <Box>
        <Typography variant="body2" color="text.secondary">
          Värd: {found.hostname ?? "okänd"}
          {found.ip ? ` (${found.ip})` : ""}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Rapporterade skrivare: {found.printers.length}
        </Typography>
        {found.printers.length > 0 && (
          <List dense disablePadding sx={{ mb: 2 }}>
            {found.printers.map((printer) => (
              <ListItem key={printer.serial} disableGutters>
                <ListItemText
                  primary={printer.product ?? printer.serial}
                  secondary={[
                    printer.serial,
                    printer.port ? `port ${printer.port}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </ListItem>
            ))}
          </List>
        )}
        <TextField
          fullWidth
          label="Namn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          helperText="Visas i admin. Standard är värdnamnet."
        />
      </Box>
    );
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Koppla relä</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Ange de fyra färgerna på reläets lampor, från vänster till höger. Välj
          en lampa för att ändra den och välj sedan en färg. Tangenterna 1–5
          väljer färg i ordningen Röd, Grön, Gul, Vit, Rosa.
        </Typography>

        <Box
          sx={{
            display: "flex",
            justifyContent: "space-around",
            gap: 1,
            mb: 2,
          }}
        >
          {picker.slots.map((color, index) => {
            const active = picker.active === index;
            return (
              <ButtonBase
                // Positions matter, not colors: the same color can repeat.
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length code
                key={`led-${index}`}
                onClick={() => setPicker((s) => selectSlot(s, index))}
                aria-label={`Lampa ${index + 1}, ${
                  color ? PAIRING_COLOR_NAMES[color].toLowerCase() : "tom"
                }`}
                aria-pressed={active}
                sx={{
                  flexDirection: "column",
                  gap: 0.5,
                  p: 0.5,
                  borderRadius: 2,
                  border: 2,
                  borderColor: active ? "primary.main" : "transparent",
                }}
              >
                <ColorSwatch color={color} size={48}>
                  {color ? null : index + 1}
                </ColorSwatch>
                <Typography variant="caption" component="span">
                  LED {index + 1}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: 1,
          }}
        >
          <Typography variant="body1" aria-live="polite">
            {describeCode(picker.slots)}
          </Typography>
          <Button
            size="small"
            onClick={() => changePicker(clearAll)}
            disabled={picker.slots.every((c) => c === null)}
          >
            Rensa
          </Button>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: 1,
            mb: 2,
          }}
        >
          {PAIRING_PALETTE.map((color, index) => (
            <ButtonBase
              key={color}
              onClick={() => changePicker((s) => pickColor(s, color))}
              sx={{
                flexDirection: "column",
                gap: 0.5,
                py: 1.5,
                px: 0.5,
                borderRadius: 2,
                border: 1,
                borderColor: "divider",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Typography variant="caption" color="text.secondary" aria-hidden>
                {index + 1}
              </Typography>
              <ColorSwatch color={color} size={40} />
              <Typography variant="body2" component="span">
                {PAIRING_COLOR_NAMES[color]}
              </Typography>
            </ButtonBase>
          ))}
        </Box>

        {lookupError && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>
            {lookupError}
          </Typography>
        )}
        {body}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        {found ? (
          <Button
            onClick={() => {
              if (code) pair.mutate(code);
            }}
            disabled={!code || !name.trim() || pair.isPending}
            variant="contained"
          >
            Koppla
          </Button>
        ) : (
          <Button
            onClick={() => {
              if (code) lookup.mutate(code);
            }}
            disabled={!code || lookup.isPending}
            variant="contained"
          >
            Hitta relä
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";

type ChipColor = "default" | "success" | "info" | "warning" | "error";

const stateLabels: Record<string, string> = {
  ready: "Redo",
  printing: "Skriver ut",
  media_out: "Slut på etiketter",
  head_open: "Skrivhuvudet är öppet",
  paused: "Pausad",
  inhibited: "Spärrad",
  error: "Fel",
  unresponsive: "Svarar inte",
  offline: "Offline",
  connecting: "Ansluter",
};

const stateColors: Record<string, ChipColor> = {
  ready: "success",
  printing: "info",
  media_out: "warning",
  head_open: "warning",
  paused: "warning",
  inhibited: "warning",
  error: "error",
  unresponsive: "error",
  offline: "default",
  connecting: "default",
};

type Props = { state: string; detail: string | null };

export function PrinterStateChip({ state, detail }: Props) {
  const chip = (
    <Chip
      size="small"
      label={stateLabels[state] ?? state.replaceAll("_", " ")}
      color={stateColors[state] ?? "default"}
      variant={state === "offline" ? "outlined" : "filled"}
    />
  );
  if (!detail) return chip;
  return <Tooltip title={detail}>{chip}</Tooltip>;
}

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { printerStateLabels as stateLabels } from "./printerStateLabels";

type ChipColor = "default" | "success" | "info" | "warning" | "error";

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

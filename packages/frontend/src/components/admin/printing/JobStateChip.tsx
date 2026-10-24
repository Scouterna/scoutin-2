import Chip from "@mui/material/Chip";

type ChipColor = "default" | "info" | "success" | "warning" | "error";

const STATE_LABELS: Record<string, string> = {
  queued: "Köad",
  leased: "Tilldelad",
  sending: "Skickas",
  printed: "Utskriven",
  unknown: "Osäker",
  failed: "Misslyckades",
  canceled: "Avbruten",
};

/** The Swedish name of a job state; unknown states are shown as they are. */
export function jobStateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

const STATE_COLORS: Record<string, ChipColor> = {
  queued: "default",
  leased: "info",
  sending: "info",
  printed: "success",
  unknown: "warning",
  failed: "error",
  canceled: "default",
};

export function JobStateChip({ state }: { state: string }) {
  return (
    <Chip
      size="small"
      label={jobStateLabel(state)}
      color={STATE_COLORS[state] ?? "default"}
      variant={state === "canceled" ? "outlined" : "filled"}
    />
  );
}

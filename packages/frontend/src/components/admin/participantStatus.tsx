import Chip from "@mui/material/Chip";

export type StatusBucket =
  | "confirmed"
  | "preliminaryOnly"
  | "missing"
  | "importError"
  | "cancelled";

export type StatusCounts = Record<StatusBucket, number> & { total: number };

export const STATUS_LABELS: Record<StatusBucket, string> = {
  confirmed: "Incheckad",
  preliminaryOnly: "Preliminär",
  missing: "Saknas",
  importError: "Importfel",
  cancelled: "Avanmäld",
};

export const STATUS_COLORS: Record<
  StatusBucket,
  "success" | "default" | "warning" | "error"
> = {
  confirmed: "success",
  preliminaryOnly: "default",
  missing: "warning",
  importError: "error",
  cancelled: "default",
};

export const STATUS_ORDER: StatusBucket[] = [
  "confirmed",
  "preliminaryOnly",
  "missing",
  "importError",
  "cancelled",
];

export function StatusBucketChip({ status }: { status: StatusBucket }) {
  return (
    <Chip
      size="small"
      label={STATUS_LABELS[status]}
      color={STATUS_COLORS[status]}
      variant={status === "preliminaryOnly" ? "outlined" : "filled"}
    />
  );
}

import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

const rtf = new Intl.RelativeTimeFormat("sv", { numeric: "auto" });

// Largest first: the first unit whose size fits the gap is used.
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

function relativeTime(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(seconds, "second");
}

type Props = { at: string | null };

export function PrinterLastSeen({ at }: Props) {
  if (!at) return <Typography variant="body2">Aldrig</Typography>;
  const date = new Date(at);
  return (
    <Tooltip title={date.toLocaleString("sv-SE")}>
      <span>{relativeTime(date)}</span>
    </Tooltip>
  );
}

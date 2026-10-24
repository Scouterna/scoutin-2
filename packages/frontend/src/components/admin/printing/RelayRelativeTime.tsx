import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

const rtf = new Intl.RelativeTimeFormat("sv", { numeric: "auto" });

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

function formatRelative(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(seconds, "second");
}

type Props = { date: string | null };

/** "5 minutes ago", with the exact time in a tooltip. */
export function RelayRelativeTime({ date }: Props) {
  if (!date) return <Typography variant="body2">Aldrig</Typography>;
  const exact = new Date(date);
  return (
    <Tooltip title={exact.toLocaleString("sv-SE")}>
      <Typography variant="body2" component="span">
        {formatRelative(exact)}
      </Typography>
    </Tooltip>
  );
}

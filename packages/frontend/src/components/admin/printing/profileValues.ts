/**
 * Whether two printer setting values match, compared the way the relay does:
 * trimmed, numerically when both are numbers (so "15" equals "15.0"),
 * otherwise case-insensitively.
 */
export function sameSettingValue(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x !== "" && y !== "") {
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) return nx === ny;
  }
  return x.toLowerCase() === y.toLowerCase();
}

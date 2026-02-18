/**
 * Normalizes Swedish personal identity number (personnummer).
 * - Checks if the input looks like a valid personal identity number. If not, returns null.
 * - Removes non-digit characters (e.g., hyphens, spaces)
 * - If the number has 10 digits, checks if the date is more than 100 years ago.
 *   If so, prepends the current century to make it 12 digits. Otherwise,
 *   prepends the previous century.
 */
const normalizePersonalIdentityNumber = (ssno: string) => {
  ssno = ssno.replace(/\s+/g, "");

  const pinRegex =
    /^(?<year>(?:\d{2})?\d{2})(?<month>\d{2})(?<day>\d{2})-?(?<lastfour>\d{4})$/;
  const match = ssno.match(pinRegex);
  if (!match || !match.groups) {
    return null;
  }

  const { year, month, day } = match.groups;
  if (!year || !month || !day) {
    return null;
  }

  const yearNumber = Number.parseInt(year, 10);

  let yearPadding = "";
  if (year.length === 2) {
    const currentYearLastTwo = new Date().getFullYear() % 100;
    const currentYearFirstTwo = Math.floor(new Date().getFullYear() / 100);

    // Check if the date is more than 100 years ago
    if (yearNumber > currentYearLastTwo) {
      yearPadding = (currentYearFirstTwo - 1).toString();
    } else {
      yearPadding = currentYearFirstTwo.toString();
    }
  }

  return `${yearPadding}${year}${month}${day}-${match.groups.lastfour}`;
};

export const normalizeQuery = (query: string) => {
  const trimmedQuery = query.trim();

  // Try to normalize as personal identity number
  const normalizedPin = normalizePersonalIdentityNumber(trimmedQuery);
  if (normalizedPin) {
    return normalizedPin;
  }

  // Otherwise, return the trimmed query
  return trimmedQuery;
};

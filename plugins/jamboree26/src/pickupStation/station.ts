// Which badge pickup station a participant should go to. Returns the exact
// sign text, or null, which means "go to the check-in desk".

const DELEGATE_STATIONS: { max: number; station: string }[] = [
  { max: 249, station: "Ombud 1-249" },
  { max: 500, station: "Ombud 250-500" },
  { max: 800, station: "Ombud 501-800" },
];

// Form answers can be arrays, so accept a single-element array too.
function parseDelegateNumber(value: unknown): number | null {
  const single = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value;
  if (typeof single !== "number" && typeof single !== "string") return null;
  const text = String(single).trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function delegateStation(value: unknown): string | null {
  const n = parseDelegateNumber(value);
  if (n === null || n < 1) return null;
  return DELEGATE_STATIONS.find((s) => n <= s.max)?.station ?? null;
}

// Assumes the Swedish alphabet (A-Z followed by Å, Ä, Ö). Letters from
// other alphabets are folded onto their closest Swedish equivalent.
function lastNameStation(lastName: unknown): string | null {
  if (typeof lastName !== "string") return null;
  const first = Array.from(lastName.trim())[0];
  if (!first) return null;

  let letter = first.toLocaleUpperCase("sv");
  if (letter === "Ø") letter = "Ö";
  else if (letter === "Æ") letter = "Ä";
  else if (letter === "Ü") letter = "Y";
  else if (letter !== "Å" && letter !== "Ä" && letter !== "Ö") {
    letter = letter.normalize("NFD").replace(/\p{M}/gu, "");
  }

  if (!/^[A-ZÅÄÖ]$/.test(letter)) return null;
  if (letter >= "A" && letter <= "F") return "Övriga Efternamn A-F";
  if (letter >= "G" && letter <= "K") return "Övriga Efternamn G-K";
  if (letter >= "L" && letter <= "R") return "Övriga Efternamn L-R";
  return "Övriga Efternamn S-Ö";
}

export function pickupStation(input: {
  participantType: unknown;
  lastName: unknown;
  delegateNumber: unknown;
}): string | null {
  if (input.participantType === "dayVisitor") return "Dagsdeltagare";
  if (input.participantType === "delegate") {
    return delegateStation(input.delegateNumber);
  }
  return lastNameStation(input.lastName);
}

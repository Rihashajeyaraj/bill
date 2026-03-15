function pad2(value) {
  return String(Math.trunc(Math.abs(Number(value) || 0))).padStart(2, "0");
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function isValidDateParts(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

export function parseDateInputToIso(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidDateParts(year, month, day)) return "";
    return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
  }

  const dmyMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!dmyMatch) return "";
  const day = Number(dmyMatch[1]);
  const month = Number(dmyMatch[2]);
  const year = Number(dmyMatch[3]);
  if (!isValidDateParts(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

export function formatIsoDateToDisplay(value, fallback = "") {
  const iso = parseDateInputToIso(value);
  if (!iso) return fallback;
  const [, year, month, day] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  return `${day}/${month}/${year}`;
}

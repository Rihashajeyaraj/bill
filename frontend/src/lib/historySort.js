function parseFlexibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;

  const normalized = raw.replace(/\./g, "-").replace(/\//g, "-");
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;

  const normalizedParsed = Date.parse(normalized);
  if (Number.isFinite(normalizedParsed)) return normalizedParsed;

  const dateOnlyMatch = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dateOnlyMatch) {
    const [, dayText, monthText, yearText] = dateOnlyMatch;
    const day = Number(dayText);
    const month = Number(monthText);
    let year = Number(yearText);
    if (yearText.length === 2) year += year >= 70 ? 1900 : 2000;
    const utcValue = Date.UTC(year, month - 1, day);
    return Number.isFinite(utcValue) ? utcValue : Number.NaN;
  }

  return Number.NaN;
}

export function compareHistoryDatesDesc(leftValue, rightValue) {
  const leftTime = parseFlexibleDate(leftValue);
  const rightTime = parseFlexibleDate(rightValue);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if (Number.isFinite(leftTime)) return -1;
  if (Number.isFinite(rightTime)) return 1;
  return 0;
}

export function sortHistoryRowsByDate(rows, getDateValue, getTieBreaker) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const byDate = compareHistoryDatesDesc(getDateValue(left), getDateValue(right));
    if (byDate !== 0) return byDate;

    const leftCreatedAt = left?.created_at || left?.createdAt || left?.updated_at || left?.updatedAt;
    const rightCreatedAt = right?.created_at || right?.createdAt || right?.updated_at || right?.updatedAt;
    const byCreatedAt = compareHistoryDatesDesc(leftCreatedAt, rightCreatedAt);
    if (byCreatedAt !== 0) return byCreatedAt;

    const leftTieBreaker = String(getTieBreaker?.(left) || "");
    const rightTieBreaker = String(getTieBreaker?.(right) || "");
    if (leftTieBreaker || rightTieBreaker) {
      return rightTieBreaker.localeCompare(leftTieBreaker, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    }

    return 0;
  });
}

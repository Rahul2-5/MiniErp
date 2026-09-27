// The API sends money as strings ("5310") because Decimal is exact; show it with 2 decimals.
export function money(value) {
  return Number(value).toFixed(2);
}

// The API sends dates as "2026-10-01T00:00:00.000Z"; show only the date part.
export function dateOnly(isoText) {
  return isoText ? isoText.slice(0, 10) : '';
}

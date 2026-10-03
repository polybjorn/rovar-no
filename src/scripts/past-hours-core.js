// Which hours rows are past, split from scripts/past-hours.js so node --test
// can cover it without a DOM. Dates are ISO strings, so they compare as text.

// A row is past once its last day is over: on that day itself it still holds.
// `allPast` is false for a list with no dated rows, so it never claims that
// a list of prices is waiting for next season.
export function pastState(untils, today) {
  const past = untils.map((until) => until < today);
  return { past, allPast: past.length > 0 && past.every(Boolean) };
}

// The verdict half of season:check, kept apart so test/season-check.test.mjs
// can cover it without a clock.
//
// A season that has ended is normal: the page strikes its rows through and
// says so (src/scripts/past-hours.js), and that is right until the places
// publish next year's hours. What is not normal is a new summer approaching
// with last year's dates still in src/data/season.js. So a date is stale once
// its year is behind today's and REMIND_FROM has passed, which gives a few
// months to ask the places for their hours before the season starts.

export const REMIND_FROM = '03-01';

// lastDays: { key: 'YYYY-MM-DD' }, as seasonLastDay gives them. today: ISO
// date in Oslo. Returns one row per key, in date order.
export function seasonStatus(lastDays, today) {
  const year = today.slice(0, 4);
  const reminding = today >= `${year}-${REMIND_FROM}`;
  return Object.entries(lastDays)
    .map(([key, lastDay]) => {
      let state = 'current';
      if (lastDay < today) state = 'over';
      if (lastDay.slice(0, 4) < year && reminding) state = 'stale';
      return { key, lastDay, state };
    })
    .sort((a, b) => a.lastDay.localeCompare(b.lastDay) || a.key.localeCompare(b.key));
}

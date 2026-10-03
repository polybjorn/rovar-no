import { season } from '../data/season.js';
import { localeInfo } from './locales.js';

// Fixed anchor date so formatting never depends on the build machine's clock
// or on DST. Times are printed as written, in the locale's own convention.
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m));
};

const cache = {};

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// The last day each dated placeholder covers, as ISO: {{end}} -> '2026-08-16',
// {{autumn}} -> '2026-09-30'. A list row that names one is out of date once
// that day is past (remark-content, scripts/past-hours.js).
export const seasonLastDay = Object.fromEntries(
  Object.entries(season).flatMap(([key, value]) => {
    if (isDate(value)) return [[key, value]];
    if (Array.isArray(value) && value.length === 2 && value.every(isDate)) return [[key, value[1]]];
    return [];
  })
);

// The last day the seasonal dates in a piece of text cover, as ISO, or
// undefined when it names none: "kl. {{sjohusAutumn}} _{{autumn}}_" -> the
// last day of {{autumn}}.
export function lastDayIn(text) {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .map(([, key]) => seasonLastDay[key])
    .filter(Boolean)
    .sort()
    .at(-1);
}

// Placeholder values for one language: {{end}}, {{sjohusSummer}} and friends,
// as used in the content markdown.
export function seasonStrings(code) {
  if (cache[code]) return cache[code];

  const intl = localeInfo(code).intl;
  const date = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const time = new Intl.DateTimeFormat(intl, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  const list = new Intl.ListFormat(intl, { style: 'long', type: 'conjunction' });
  // Norwegian writes the clock with a period; ICU has moved to a colon.
  const sep = localeInfo(code).timeSep;
  const clock = (t) => (sep ? time.format(t).replace(':', sep) : time.format(t));

  const out = { year: String(season.year) };
  out.end = date.format(new Date(`${season.end}T00:00:00Z`));
  out.ribDepartures = list.format(season.ribDepartures.map((t) => clock(at(t))));

  // Joined with the language's own template rather than Intl's formatRange:
  // German ranges read "von 11:00 bis 16:00 Uhr", and formatRange would append
  // a second "Uhr" of its own.
  const range = localeInfo(code).range ?? '{a} – {b}';
  for (const [key, value] of Object.entries(season)) {
    if (key in out) continue;
    // A date also gives its year, {{endYear}}, for a season that is not
    // the page's own {{year}}.
    if (isDate(value)) {
      out[key] = date.format(new Date(`${value}T00:00:00Z`));
      out[`${key}Year`] = value.slice(0, 4);
      continue;
    }
    if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
      out[key] = clock(at(value));
      continue;
    }
    if (!Array.isArray(value) || value.length !== 2) continue;
    // A pair of dates is a date range, and gives the year it ends in.
    if (value.every(isDate)) {
      const [a, b] = value.map((d) => date.format(new Date(`${d}T00:00:00Z`)));
      out[key] = range.replace('{a}', a).replace('{b}', b);
      out[`${key}Year`] = value[1].slice(0, 4);
      continue;
    }
    // A clock range never breaks across lines: "12:30 bis" on one line and
    // "20:00" on the next reads as two facts.
    out[key] = range
      .replace('{a}', clock(at(value[0])))
      .replace('{b}', clock(at(value[1])))
      .replaceAll(' ', '\u00a0');
  }

  cache[code] = out;
  return out;
}

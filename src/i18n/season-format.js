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

// The first day each date-range placeholder covers: {{autumn}} -> '2026-08-17'.
// A single date such as {{end}} has none, since "til {{end}}" says when a
// row stops and not when it starts.
export const seasonFirstDay = Object.fromEntries(
  Object.entries(season).flatMap(([key, value]) =>
    Array.isArray(value) && value.length === 2 && value.every(isDate) ? [[key, value[0]]] : []
  )
);

const isClock = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

// Placeholders that are opening hours, a pair of clock times: {{sjohusSummer}}
// -> ['11:00', '16:00']. {{ribDepartures}} is a pair too, but of departures,
// and is formatted as a list below, so it is not one.
export const seasonClockRanges = Object.fromEntries(
  Object.entries(season).filter(
    ([key, value]) => key !== 'ribDepartures' && Array.isArray(value) && value.length === 2 && value.every(isClock)
  )
);

// The first day, by the same rule as lastDayIn, or undefined when no
// placeholder in the text gives one.
export function firstDayIn(text) {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .map(([, key]) => seasonFirstDay[key])
    .filter(Boolean)
    .sort()
    .at(0);
}

// The opening hours a piece of text names first, as ['HH:MM', 'HH:MM'], or
// undefined. A restaurant row names its kitchen hours second.
export function hoursIn(text) {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map(([, key]) => seasonClockRanges[key]).find(Boolean);
}

// One clock time as the language writes it: '13:30' -> '13.30' in Norwegian.
export function formatClock(code, hhmm) {
  const time = new Intl.DateTimeFormat(localeInfo(code).intl, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  const sep = localeInfo(code).timeSep;
  const out = time.format(at(hhmm));
  return sep ? out.replace(':', sep) : out;
}

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
  const list = new Intl.ListFormat(intl, { style: 'long', type: 'conjunction' });
  // Norwegian writes the clock with a period; ICU has moved to a colon.
  const clock = (hhmm) => formatClock(code, hhmm);

  const out = { year: String(season.year) };
  out.end = date.format(new Date(`${season.end}T00:00:00Z`));
  out.ribDepartures = list.format(season.ribDepartures.map(clock));

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
    if (isClock(value)) {
      out[key] = clock(value);
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
      .replace('{a}', clock(value[0]))
      .replace('{b}', clock(value[1]))
      .replaceAll(' ', '\u00a0');
  }

  cache[code] = out;
  return out;
}

import { season } from '../data/season.js';
import { localeInfo } from './locales.js';

// Fixed anchor date so formatting never depends on the build machine's clock
// or on DST. Times are printed as written, in the locale's own convention.
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m));
};

const cache = {};

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
    if (key in out || !Array.isArray(value) || value.length !== 2) continue;
    out[key] = range.replace('{a}', clock(at(value[0]))).replace('{b}', clock(at(value[1])));
  }

  cache[code] = out;
  return out;
}

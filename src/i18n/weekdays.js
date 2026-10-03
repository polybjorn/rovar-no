import { localeInfo } from './locales.js';

// The weekdays an hours row's label names, as numbers with Sunday 0, or
// undefined when the label is not one this can read:
//
//   "Søndag og torsdag:"     -> [0, 4]
//   "Thursday to Saturday:"  -> [4, 5, 6]
//   "Samstags und sonntags:" -> [0, 6]
//   "Täglich:"               -> [0, 1, 2, 3, 4, 5, 6]
//
// The days live only in the label, in the language's own words, so this is
// what lets the page say whether a place is open now (scripts/past-hours.js).
// remark-content fails the build on an hours row it cannot read, so a
// reworded label is caught there rather than shown as a wrong status.
export function daysIn(label, code) {
  const words = localeInfo(code).days;
  if (!words) return undefined;
  const text = label.trim().replace(/:$/, '').trim().toLocaleLowerCase();
  if (text === words.every) return [0, 1, 2, 3, 4, 5, 6];

  // 2000-01-02 was a Sunday.
  const fmt = new Intl.DateTimeFormat(localeInfo(code).intl, { weekday: 'long', timeZone: 'UTC' });
  const names = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    fmt.format(new Date(Date.UTC(2000, 0, 2 + i))).toLocaleLowerCase()
  );
  // "Sundays", "sonntags": the plural or adverb is the name plus an s.
  const day = (word) => {
    const i = names.indexOf(word);
    return i >= 0 ? i : names.indexOf(word.replace(/s$/, ''));
  };

  const through = text.split(` ${words.through} `);
  if (through.length === 2) {
    const [a, b] = through.map(day);
    if (a < 0 || b < 0) return undefined;
    const out = [];
    for (let i = a; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === b) break;
    }
    return out.sort((x, y) => x - y);
  }

  const parts = text.split(new RegExp(`, | ${words.and} `)).map(day);
  if (parts.some((i) => i < 0)) return undefined;
  return [...new Set(parts)].sort((x, y) => x - y);
}

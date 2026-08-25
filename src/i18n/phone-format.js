import { facts } from '../data/facts.js';
import { defaultLocale } from './locales.js';

// Every number on the site is Norwegian.
const countryCode = '+47';

const cache = {};

// Phone numbers for one language, keyed exactly as in facts.js, so a content
// file or UI string writes {{havhotellPhone}} and gets the right form without
// knowing which language it is in.
//
// Norwegian readers are here; everyone else is dialling from abroad, so every
// language but the root one gets the country code. The old rovar.no did the
// same by hand: "52715800" in Norwegian, "+47 527 15 800" on its English and
// German pages. Grouping is kept as written in facts.js, which is the local
// convention (2-2-2-2 for landlines, 3-2-3 for mobiles), and stays readable
// behind a country code.
export function phoneStrings(code) {
  if (cache[code]) return cache[code];

  const local = code === defaultLocale;
  const out = {};
  for (const [key, value] of Object.entries(facts)) {
    if (!key.endsWith('Phone')) continue;
    out[key] = local ? value : `${countryCode} ${value}`;
  }

  cache[code] = out;
  return out;
}

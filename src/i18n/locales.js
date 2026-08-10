// Single source of truth for languages. Adding a language = one entry here,
// one UI catalog (src/i18n/ui/<code>.json) and one content folder
// (src/content/pages/<code>/). Nothing else in the codebase enumerates
// languages: nav, hreflang, og:locale, the sitemap and the switcher all derive
// from this list.
//
//   code    URL prefix and `lang` attribute
//   endonym language name in its own language, shown in the switcher
//   intl    BCP 47 tag for Intl (dates, times, lists)
//   og      Open Graph locale
//   dir     writing direction, 'rtl' for Arabic/Hebrew/Farsi
//   root    true for the language served without a URL prefix (only one)
//   range   optional template for a time range, default '{a} – {b}'
//   timeSep optional clock separator, overriding the one Intl picks

export const locales = [
  { code: 'no', endonym: 'Norsk',   intl: 'nb-NO', og: 'nb_NO', dir: 'ltr', root: true, timeSep: '.' },
  { code: 'en', endonym: 'English', intl: 'en-GB', og: 'en_GB', dir: 'ltr' },
  { code: 'de', endonym: 'Deutsch', intl: 'de-DE', og: 'de_DE', dir: 'ltr', range: '{a} bis {b}' },
];

export const defaultLocale = locales.find((l) => l.root)?.code ?? locales[0].code;

// Untranslated strings and pages fall back along this chain before giving up.
export const fallbackChain = ['en', defaultLocale];

export const localeCodes = locales.map((l) => l.code);

export const localeByCode = Object.fromEntries(locales.map((l) => [l.code, l]));

export function localeInfo(code) {
  return localeByCode[code] ?? localeByCode[defaultLocale];
}

// Locale itself first, then the fallback chain, without duplicates.
export function lookupOrder(code) {
  return [...new Set([code, ...fallbackChain])].filter((c) => c in localeByCode);
}

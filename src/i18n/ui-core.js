// UI string resolution: merge a language's catalog over the fallback chain,
// key by key, then fill {{placeholders}}. Takes the catalogs as an argument
// rather than globbing them, so it runs under node (test/ui.test.mjs).
// ui.js does the glob and passes the real catalogs in.

import { lookupOrder, defaultLocale } from './locales.js';

export function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base?.[k] ?? {}, v) : v;
  }
  return out;
}

// {{placeholders}} work in UI strings too, same as in content files. An
// unknown key is left as written rather than blanked, so it shows up.
export function fill(node, facts = {}) {
  if (typeof node === 'string')
    return node.replace(/\{\{(\w+)\}\}/g, (whole, key) => facts[key] ?? whole);
  if (Array.isArray(node)) return node.map((v) => fill(v, facts));
  if (node && typeof node === 'object')
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v, facts)]));
  return node;
}

// Keys starting with _ are catalog metadata, not strings: they carry no
// translation and must never reach the markup or the string counts.
const stripMeta = (catalog) =>
  Object.fromEntries(Object.entries(catalog).filter(([k]) => !k.startsWith('_')));

// Strings for a language, with any key it is missing filled in from the
// fallback chain. A half-translated catalog renders, it does not crash.
export function resolveCatalog(catalogs, code, facts = {}) {
  return fill(
    stripMeta(
      lookupOrder(code)
        .reverse()
        .reduce((acc, c) => merge(acc, catalogs[c]), catalogs[defaultLocale])
    ),
    facts
  );
}

// Whether a language's own UI catalog is still a machine-translated draft.
// Its own only: the flag says who wrote these strings, so it must not be
// inherited down the fallback chain the way missing strings are.
export function catalogIsDraft(catalogs, code) {
  return catalogs[code]?._meta?.machineTranslated === true;
}

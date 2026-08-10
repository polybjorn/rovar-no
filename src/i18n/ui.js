import { lookupOrder, defaultLocale } from './locales.js';
import { facts } from '../data/facts.js';

const catalogs = {};
for (const [path, data] of Object.entries(
  import.meta.glob('./ui/*.json', { eager: true, import: 'default' })
)) {
  catalogs[path.match(/([^/]+)\.json$/)[1]] = data;
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base?.[k] ?? {}, v) : v;
  }
  return out;
}

// {{placeholders}} work in UI strings too, same as in content files.
function fill(node) {
  if (typeof node === 'string')
    return node.replace(/\{\{(\w+)\}\}/g, (whole, key) => facts[key] ?? whole);
  if (Array.isArray(node)) return node.map(fill);
  if (node && typeof node === 'object')
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v)]));
  return node;
}

const cache = {};

// UI strings for a language, with any key it is missing filled in from the
// fallback chain. A half-translated catalog renders, it does not crash.
export function ui(code) {
  if (!cache[code]) {
    cache[code] = fill(
      lookupOrder(code)
        .reverse()
        .reduce((acc, c) => merge(acc, catalogs[c]), catalogs[defaultLocale])
    );
  }
  return cache[code];
}

export function hasCatalog(code) {
  return code in catalogs;
}

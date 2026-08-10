// Vite-specific wiring for the UI catalogs: the glob. The merge, the fallback
// chain and the placeholder filling are in ui-core.js, covered by
// test/ui.test.mjs.

import { facts } from '../data/facts.js';
import { resolveCatalog } from './ui-core.js';

const catalogs = {};
for (const [path, data] of Object.entries(
  import.meta.glob('./ui/*.json', { eager: true, import: 'default' })
)) {
  catalogs[path.match(/([^/]+)\.json$/)[1]] = data;
}

const cache = {};

export function ui(code) {
  if (!cache[code]) cache[code] = resolveCatalog(catalogs, code, facts);
  return cache[code];
}

export function hasCatalog(code) {
  return code in catalogs;
}

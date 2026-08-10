// Vite-specific wiring for the route helpers: the content glob and BASE_URL.
// All the logic is in routes-core.js, which is covered by test/routes.test.mjs.

import { locales } from './locales.js';
import { pages } from './pages.js';
import * as core from './routes-core.js';

export { pages };

export const pageKeys = pages.map((p) => p.key);

const pageByKey = Object.fromEntries(pages.map((p) => [p.key, p]));

// BASE_URL is "/" at rovar.no and "/rovar-no" on the GitHub Pages preview.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

// Which languages have a content file for which page. Lazy glob: only the keys
// are read, the markdown is not loaded here.
const contentFiles = import.meta.glob('../content/pages/*/*.md');
const translated = core.translationsFromPaths(Object.keys(contentFiles));

export function hasPage(key, code) {
  return translated[key]?.has(code) ?? false;
}

export function localesWithPage(key) {
  return locales.filter((l) => hasPage(key, l.code)).map((l) => l.code);
}

export function pathFor(key, code) {
  return core.pathFor(pageByKey, base, key, code);
}

export function resolveRoute(key, code) {
  return core.resolveRoute(pageByKey, base, translated, key, code);
}

export function allRoutes() {
  return core.allRoutes(pages, translated);
}

// Kept for call sites that want the old shape: routes.explore.en
export const routes = Object.fromEntries(
  pages.map((p) => [p.key, Object.fromEntries(locales.map((l) => [l.code, pathFor(p.key, l.code)]))])
);

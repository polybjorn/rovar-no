import { locales, localeInfo, defaultLocale, lookupOrder } from './locales.js';
import { pages } from './pages.js';

export { pages };

export const pageKeys = pages.map((p) => p.key);

const pageByKey = Object.fromEntries(pages.map((p) => [p.key, p]));

// BASE_URL is "/" at rovar.no and "/rovar-no" on the GitHub Pages preview.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

// Which languages have a content file for which page. Lazy glob: only the keys
// are read, the markdown is not loaded here.
const contentFiles = import.meta.glob('../content/pages/*/*.md');

const translated = {};
for (const path of Object.keys(contentFiles)) {
  const [, code, key] = path.match(/\/pages\/([^/]+)\/([^/]+)\.md$/) ?? [];
  if (!code || !key) continue;
  (translated[key] ??= new Set()).add(code);
}

export function hasPage(key, code) {
  return translated[key]?.has(code) ?? false;
}

export function localesWithPage(key) {
  return locales.filter((l) => hasPage(key, l.code)).map((l) => l.code);
}

// URL for a page in a given language, whether or not it is translated yet.
export function pathFor(key, code) {
  const page = pageByKey[key];
  if (!page) throw new Error(`Unknown page key: ${key}`);
  const prefix = localeInfo(code).root ? '' : `${code}/`;
  const slug = page.slugs[code] ?? page.slug;
  return `${base}/${prefix}${slug}${slug ? '/' : ''}`;
}

// URL to link to: the reader's language when it exists, otherwise the first
// language in the fallback chain that has the page. Keeps nav links working
// while a language is still being translated.
export function resolveRoute(key, code) {
  for (const candidate of lookupOrder(code)) {
    if (hasPage(key, candidate)) return { href: pathFor(key, candidate), lang: candidate };
  }
  return { href: pathFor(key, defaultLocale), lang: defaultLocale };
}

// Params for getStaticPaths: every page that actually has content, per language.
export function allRoutes() {
  const out = [];
  for (const { key } of pages) {
    for (const l of locales) {
      if (!hasPage(key, l.code)) continue;
      const prefix = l.root ? '' : `${l.code}/`;
      const slug = pageByKey[key].slugs[l.code] ?? pageByKey[key].slug;
      out.push({ key, locale: l.code, slug: `${prefix}${slug}`.replace(/\/$/, '') });
    }
  }
  return out;
}

// Kept for call sites that want the old shape: routes.explore.en
export const routes = Object.fromEntries(
  pages.map((p) => [p.key, Object.fromEntries(locales.map((l) => [l.code, pathFor(p.key, l.code)]))])
);

// Route logic: which languages have which page, what a page's URL is, and
// where a link goes when the reader's language has not been translated yet.
// Takes the content map and the base path as arguments rather than reading
// import.meta, so it runs under node (test/routes.test.mjs). routes.js does
// the Vite-specific part - the content glob and BASE_URL - and delegates here.

import { locales, localeInfo, defaultLocale, lookupOrder } from './locales.js';

// Content file paths ("../content/pages/en/home.md") to { pageKey: Set(langs) }.
export function translationsFromPaths(paths) {
  const translated = {};
  for (const path of paths) {
    const [, code, key] = path.match(/\/pages\/([^/]+)\/([^/]+)\.md$/) ?? [];
    if (!code || !key) continue;
    (translated[key] ??= new Set()).add(code);
  }
  return translated;
}

export function slugFor(page, code) {
  return page.slugs[code] ?? page.slug;
}

// A page's URL in a given language, whether or not it is translated yet.
export function pathFor(pageByKey, base, key, code) {
  const page = pageByKey[key];
  if (!page) throw new Error(`Unknown page key: ${key}`);
  const prefix = localeInfo(code).root ? '' : `${code}/`;
  const slug = slugFor(page, code);
  return `${base}/${prefix}${slug}${slug ? '/' : ''}`;
}

// The reader's language when it exists, otherwise the first language in the
// fallback chain that has the page. Keeps nav links working while a language
// is still being translated.
export function resolveRoute(pageByKey, base, translated, key, code) {
  for (const candidate of lookupOrder(code)) {
    if (translated[key]?.has(candidate)) {
      return { href: pathFor(pageByKey, base, key, candidate), lang: candidate };
    }
  }
  return { href: pathFor(pageByKey, base, key, defaultLocale), lang: defaultLocale };
}

// getStaticPaths params: every page that actually has content, per language.
// A page with no content file is not built for that language at all.
export function allRoutes(pages, translated) {
  const out = [];
  for (const { key } of pages) {
    for (const l of locales) {
      if (!translated[key]?.has(l.code)) continue;
      const prefix = l.root ? '' : `${l.code}/`;
      const slug = slugFor(pages.find((p) => p.key === key), l.code);
      out.push({ key, locale: l.code, slug: `${prefix}${slug}`.replace(/\/$/, '') });
    }
  }
  return out;
}

// One 404 file serves every language: a static host has no way of knowing
// which one the visitor was after, and a bare wrong URL carries no language at
// all. So the page is written in every language and narrowed here to the one
// its URL names. Without JavaScript the whole page stands, which is the state
// the markup ships in.
import { localeFromPath } from '../i18n/routes.js';
import { localeInfo } from '../i18n/locales.js';

const lang = localeFromPath(location.pathname);
const sections = [...document.querySelectorAll('.nf-lang')];
const shown = sections.find((section) => section.lang === lang);

if (shown) {
  sections.filter((section) => section !== shown).forEach((section) => section.remove());

  // The page heads with the root language, so every other language's section
  // is an h2. Narrowing to one of those would leave the page without an h1.
  const heading = shown.querySelector('h2');
  if (heading) {
    const h1 = document.createElement('h1');
    h1.className = 'page-title';
    h1.textContent = heading.textContent;
    heading.replaceWith(h1);
  }

  const info = localeInfo(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = info.dir ?? 'ltr';
  // Same shape Layout.astro builds, so the tab reads like every other page.
  document.title = `${shown.querySelector('.page-title').textContent} | Røvær`;
}

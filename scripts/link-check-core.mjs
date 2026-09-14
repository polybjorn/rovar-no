// The parts of the link check that do not touch the network, kept separate so
// test/links.test.mjs can cover them: extraction and URL handling are where
// the bugs are, and they are the half that can be tested without depending on
// whether facebook.com is up. Same split as src/i18n/ui-core.js and
// routes-core.js, but it lives under scripts/ rather than src/ because it is
// build tooling and nothing the site ships imports it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Only the five XML entities Astro actually emits in an attribute, plus
// numeric escapes. A full entity table would be a dependency for no gain:
// what matters is that `&amp;` in a query string is one character by the time
// it reaches fetch. The reise.kolumbus.no link in this site is exactly that
// case, and it answers 200 either way, which is what makes it easy to miss.
const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    const key = body.toLowerCase();
    if (key in named) return named[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return whole;
  });

// Anchors only. The site's own <link rel="canonical"> and <meta og:url> are
// absolute URLs in every page, and on dist/404.html the canonical points at
// /404/, which GitHub Pages correctly serves as 404 - so a checker that reads
// every href in the document reports the 404 page as broken on its first run.
// A reader can only follow an <a>, so an <a> is what gets checked.
const anchor = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;

export const linksIn = (html) => {
  const out = [];
  for (const m of html.matchAll(anchor)) {
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    const href = decodeEntities(raw).trim();
    // Relative links are Astro's own routing and the build already fails on a
    // bad one; mailto:, tel: and #fragments have nothing to fetch.
    if (!/^https?:\/\//i.test(href)) continue;
    out.push(href);
  }
  return out;
};

export const htmlFilesIn = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.html')) out.push(path);
    }
  };
  walk(dir);
  return out.sort();
};

// url -> the pages that link to it, so a failure names somewhere to go and fix
// it. One URL is usually in the footer of all 16 pages, so the report shows
// the first few and a count rather than the whole list.
export const collectLinks = (
  dir,
  files = htmlFilesIn(dir),
  read = (p) => readFileSync(p, 'utf8')
) => {
  const found = new Map();
  for (const file of files) {
    const page = file.slice(dir.length).replace(/^\//, '') || 'index.html';
    for (const href of linksIn(read(file))) {
      if (!found.has(href)) found.set(href, []);
      const pages = found.get(href);
      if (!pages.includes(page)) pages.push(page);
    }
  }
  return found;
};

// A status a reader would notice, against one they would never see. 404 and
// 410 are the site saying the page is gone. 403 and 429 are a host refusing a
// script - Facebook and news sites do it by policy, and the link still works
// in a browser. 5xx and timeouts are the other end having a bad minute, which
// a weekly job should report and not fail on.
export const severityOf = (status) => {
  if (status === 404 || status === 410) return 'broken';
  if (status >= 200 && status < 400) return 'ok';
  return 'warn';
};

export const groupByHost = (urls) => {
  const byHost = new Map();
  for (const url of urls) {
    const host = new URL(url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(url);
  }
  return byHost;
};

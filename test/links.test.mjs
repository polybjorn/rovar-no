// node --test. Covers scripts/link-check-core.mjs, the half of the link check
// that does not touch the network. Unlike the other suites this imports from
// scripts/ rather than src/: the checker is build tooling and the site does
// not ship it, but extraction and URL handling are exactly where it can be
// quietly wrong, so they are worth the same treatment as site code.
//
// The cases are the ones the real site produced on 2026-09-14: a canonical
// pointing at /404/, and a query string carrying &amp;.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeEntities,
  linksIn,
  collectLinks,
  severityOf,
  groupByHost,
} from '../scripts/link-check-core.mjs';

test('entities in a query string are one character by the time we fetch', () => {
  assert.equal(
    decodeEntities('https://reise.kolumbus.no/?fromId=A&amp;toId=B'),
    'https://reise.kolumbus.no/?fromId=A&toId=B'
  );
  assert.equal(decodeEntities('a&#38;b'), 'a&b');
  assert.equal(decodeEntities('a&#x26;b'), 'a&b');
  assert.equal(decodeEntities('R&oslash;v&aelig;r'), 'R&oslash;v&aelig;r', 'unknown entities are left alone');
});

test('only anchors are followed, not canonical or og:url', () => {
  // dist/404.html in full miniature: its canonical is a URL that correctly
  // answers 404, and reading it would report a working page as broken.
  const html = `
    <link rel="canonical" href="https://polybjorn.github.io/rovar-no/404/">
    <meta property="og:url" content="https://polybjorn.github.io/rovar-no/404/">
    <a href="https://entur.no/">Entur</a>
  `;
  assert.deepEqual(linksIn(html), ['https://entur.no/']);
});

test('href is read whatever it is quoted with', () => {
  assert.deepEqual(
    linksIn(`<a href="https://a.test/">a</a><a href='https://b.test/'>b</a><a href=https://c.test/>c</a>`),
    ['https://a.test/', 'https://b.test/', 'https://c.test/']
  );
});

test('an anchor with other attributes first is still an anchor', () => {
  assert.deepEqual(
    linksIn(`<a class="x" rel="noopener" target="_blank" href="https://a.test/">a</a>`),
    ['https://a.test/']
  );
  assert.deepEqual(linksIn(`<A HREF="https://b.test/">b</A>`), ['https://b.test/']);
});

test('anything without a host to ask about is skipped', () => {
  const html = `
    <a href="/rovar-no/en/ferry/">internal</a>
    <a href="#top">fragment</a>
    <a href="mailto:post@rovar.no">mail</a>
    <a href="tel:+4700000000">phone</a>
    <a href="">empty</a>
  `;
  assert.deepEqual(linksIn(html), []);
});

test('a link is collected once and remembers every page it is on', () => {
  const files = {
    'dist/index.html': '<a href="https://a.test/">a</a><a href="https://b.test/">b</a>',
    'dist/en/index.html': '<a href="https://a.test/">a</a><a href="https://a.test/">again</a>',
  };
  const found = collectLinks('dist', Object.keys(files), (p) => files[p]);
  assert.deepEqual([...found.keys()].sort(), ['https://a.test/', 'https://b.test/']);
  assert.deepEqual(found.get('https://a.test/'), ['index.html', 'en/index.html']);
  assert.deepEqual(found.get('https://b.test/'), ['index.html'], 'a page is listed once per link');
});

test('gone is a defect, refused is not', () => {
  assert.equal(severityOf(404), 'broken');
  assert.equal(severityOf(410), 'broken');
  assert.equal(severityOf(200), 'ok');
  assert.equal(severityOf(204), 'ok');
  assert.equal(severityOf(301), 'ok', 'redirects are followed before we get here');
  // A host refusing a script says nothing about whether a reader can follow
  // the link, so these are reported and not failed on.
  assert.equal(severityOf(403), 'warn');
  assert.equal(severityOf(429), 'warn');
  assert.equal(severityOf(500), 'warn');
  assert.equal(severityOf(503), 'warn');
});

test('URLs are grouped by host so one host is never hit in parallel', () => {
  const byHost = groupByHost([
    'https://a.test/one',
    'https://a.test/two',
    'https://b.test/',
  ]);
  assert.deepEqual([...byHost.keys()].sort(), ['a.test', 'b.test']);
  assert.equal(byHost.get('a.test').length, 2);
});

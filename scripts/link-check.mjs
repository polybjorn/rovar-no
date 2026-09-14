// npm run links:check             report to the terminal, fail on dead links
// npm run links:check -- --strict also fail on the ones reported as warnings
// npm run links:check -- --dir X  check a directory other than dist/
//
// Reads the built site and follows every external <a href>. Run from
// .forgejo/workflows/link-check.yml on a schedule, not on a pull request: a
// link dying is something this site did not do and cannot fix by blocking a
// merge, so it is worth a weekly report and not worth a red tick on someone
// else's change.
//
// Needs a build first - it reads dist/, not src/, because that is where the
// links a reader can click actually exist: markdown content, UI catalogs in 15
// languages and component markup all end up there and nowhere else.

import { existsSync } from 'node:fs';
import { collectLinks, severityOf, groupByHost } from './link-check-core.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const dir = arg('dir', 'dist');
const strict = process.argv.includes('--strict');

if (!existsSync(dir)) {
  console.error(`${dir}/ is not there. Run \`npm run build\` first.`);
  process.exit(2);
}

const TIMEOUT_MS = 15000;
const ATTEMPTS = 3;
const HOSTS_AT_ONCE = 6;
const PAUSE_MS = 250;

// Identify the checker rather than sending no User-Agent at all. An earlier
// version of this comment also claimed a browser-shaped UA gets served where a
// scripted one is refused; that was untested and does not hold here. stackoverflow.com
// refuses this checker with 403 and answers a current Chrome UA string with 403
// too (#22). So this is the honesty argument only, not an accuracy one: a host
// that turns us away should be able to see who was asking.
const HEADERS = {
  'user-agent':
    'rovar-no-link-check/1.0 (+https://github.com/polybjorn/rovar-no; scheduled link check)',
  accept: '*/*',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HEAD first because it is cheap, GET when HEAD is refused or unimplemented.
// The case is real and measured: news.ycombinator.com answers HEAD 405 and
// GET 200. An earlier version claimed "a surprising number" of sites also
// answer 403 or 404 to HEAD while serving fine to GET - across this site's 14
// links and 8 large sites checked on purpose, that happened zero times (#22),
// so treat it as the 405/501 case and not a common one. A 404 is still only
// believed once GET has said it too, which costs one request on the rare path.
const request = async (url, method) =>
  fetch(url, {
    method,
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

const probe = async (url) => {
  let networkError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      let res = await request(url, 'HEAD');
      if (res.status >= 400) {
        const viaGet = await request(url, 'GET');
        if (viaGet.status < res.status || viaGet.ok) res = viaGet;
      }
      // A 429 or a 5xx on the first look is usually the host, not the link.
      if ((res.status === 429 || res.status >= 500) && attempt < ATTEMPTS) {
        await sleep(attempt * 1000);
        continue;
      }
      return { status: res.status, severity: severityOf(res.status) };
    } catch (err) {
      networkError = err;
      if (attempt < ATTEMPTS) await sleep(attempt * 1000);
    }
  }
  const reason = networkError?.cause?.code ?? networkError?.name ?? 'unknown';
  return { status: null, severity: 'unreachable', reason };
};

const links = collectLinks(dir);
if (links.size === 0) {
  console.error(`No external links found under ${dir}/. That is suspicious, not clean.`);
  process.exit(2);
}

const byHost = groupByHost(links.keys());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(`Checking ${plural(links.size, 'external link')} across ${plural(byHost.size, 'host')} in ${dir}/\n`);

// Hosts in parallel, URLs within a host one at a time. Sixteen simultaneous
// requests to the same server is how a working link check turns itself into
// the reason a host starts answering 429.
const results = new Map();
const queue = [...byHost.entries()];
const worker = async () => {
  for (let entry = queue.shift(); entry; entry = queue.shift()) {
    const [, urls] = entry;
    for (const url of urls) {
      results.set(url, await probe(url));
      await sleep(PAUSE_MS);
    }
  }
};
await Promise.all(Array.from({ length: Math.min(HOSTS_AT_ONCE, queue.length) }, worker));

const of = (severity) => [...results].filter(([, r]) => r.severity === severity);
const broken = of('broken');
const warned = of('warn');
const unreachable = of('unreachable');

// Every single link failing to connect is one broken thing, not thirty. The
// runner's egress beyond the npm registry is not something this repo controls
// or can check from anywhere else, so name it rather than filing the whole
// site as dead.
if (unreachable.length === results.size) {
  console.error('Every request failed at the connection layer, so nothing was actually checked.');
  console.error(`First reason: ${unreachable[0][1].reason}`);
  console.error('This reads as a runner with no outbound network rather than a site full of dead links.');
  process.exit(2);
}

const where = (url) => {
  const pages = links.get(url);
  const shown = pages.slice(0, 3).join(', ');
  return pages.length > 3 ? `${shown} and ${pages.length - 3} more` : shown;
};

const report = (title, rows, detail) => {
  if (!rows.length) return;
  console.log(`${title}:`);
  for (const [url, r] of rows) console.log(`  ${detail(r).padEnd(12)} ${url}\n${' '.repeat(15)}${where(url)}`);
  console.log('');
};

report('Dead', broken, (r) => String(r.status));
report('Could not be reached', unreachable, (r) => r.reason);
report('Answered, but not with a page', warned, (r) => String(r.status));

const ok = results.size - broken.length - warned.length - unreachable.length;
console.log(
  `${ok} ok, ${broken.length} dead, ${warned.length} refused or erroring, ${unreachable.length} unreachable`
);

const soft = warned.length + unreachable.length;
if (broken.length || (strict && soft)) {
  process.exit(1);
}
if (soft) {
  console.log(
    '\nThe non-dead failures are not treated as defects: a host refusing a scripted' +
      ' request, or having a bad minute, says nothing about whether a reader can' +
      ' follow the link. Run with --strict to fail on them too.'
  );
}

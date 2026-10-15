// The retired subscription feeds (#88, #115). Each URL a calendar may still be
// subscribed to serves one closing note pointing at the ferry page, so the
// subscription empties instead of freezing on the departures it last saw.
// Entur is not asked: nothing of its data is published here any more.
import { FEED_TTL_MINUTES, icsCalendar, retiredEvent } from '../scripts/departures-core.js';
import { allRoutes, pathFor } from '../i18n/routes.js';
import { ui } from '../i18n/ui.js';

// The two URLs each language published beside its ferry page: every crossing
// at /rutebaten.ics, one line per day and direction at /rutebaten-summary.ics.
// The suffix is deliberately untranslated - it is a variant marker in a URL,
// not page copy.
const variants = [
  { suffix: '', summary: false },
  { suffix: '-summary', summary: true },
];

export function getStaticPaths() {
  return allRoutes()
    .filter((route) => route.key === 'ferry')
    .flatMap((route) =>
      variants.map((variant) => ({
        params: { feed: `${route.slug}${variant.suffix}` },
        props: { ...route, summary: variant.summary },
      }))
    );
}

const builtAt = new Date();

export async function GET({ props, site }) {
  const lang = props.locale;
  const t = ui(lang).ferry;
  const page = site ? new URL(pathFor('ferry', lang), site).href : undefined;

  const body = icsCalendar([retiredEvent({ strings: t.board, stamp: builtAt, url: page })], {
    name: props.summary ? t.feedSummaryName : t.feedName,
    ttlMinutes: FEED_TTL_MINUTES,
  });

  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}

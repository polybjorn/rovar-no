// The subscription feed: every departure for the next FEED_DAYS, in both
// directions, as one calendar per language. Built as a static file like every
// other page, so the deploy is the refresh - a scheduled run of the Pages
// workflow is what keeps it current.
//
// The assembly is all in departures-core.js (test/departures.test.mjs); this
// file is the network and the wiring, the same split the departure board uses.
import {
  ENTUR_API,
  ENTUR_CLIENT,
  ROVAR_STOP,
  HAUGESUND_STOP,
  FEED_DAYS,
  FEED_TTL_MINUTES,
  query,
  osloMidnight,
  feedEvents,
  icsCalendar,
} from '../scripts/departures-core.js';
import { allRoutes, pathFor } from '../i18n/routes.js';
import { ui } from '../i18n/ui.js';
import { localeInfo } from '../i18n/locales.js';

// One feed per language that has the ferry page, sitting beside that page's own
// URL: /rutebaten.ics, /en/ferry.ics. A new language needs no change here.
export function getStaticPaths() {
  return allRoutes()
    .filter((route) => route.key === 'ferry')
    .map((route) => ({ params: { feed: route.slug }, props: route }));
}

// One stamp for the whole build, so the three languages agree on when the feed
// was made.
const builtAt = new Date();

async function fetchStop(stopId) {
  const res = await fetch(ENTUR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ENTUR_CLIENT },
    body: JSON.stringify({
      query,
      variables: {
        stopId,
        // Roughly a day's departures each way, with room to spare: the cap is
        // a guard against a runaway response, not a limit worth tuning.
        n: FEED_DAYS * 30,
        startTime: osloMidnight(0),
        timeRange: FEED_DAYS * 86400,
      },
    }),
  });
  if (!res.ok) throw new Error(`Entur answered HTTP ${res.status} for ${stopId}`);

  const json = await res.json();
  if (json.errors?.length) throw new Error(`Entur: ${json.errors[0].message}`);

  const calls = json.data?.stopPlace?.estimatedCalls;
  // An empty answer fails the build rather than publishing an empty calendar.
  // A deploy that does not happen leaves the last good feed in place, which is
  // wrong by a day; a feed that publishes empty silently clears the departures
  // out of everyone's calendar.
  if (!calls?.length) throw new Error(`Entur returned no departures for ${stopId}`);
  return calls;
}

// The three languages are three renderings of one fetch.
let departures;

export async function GET({ props, site }) {
  departures ??= Promise.all([fetchStop(ROVAR_STOP), fetchStop(HAUGESUND_STOP)]);
  const [rovar, haugesund] = await departures;

  const lang = props.locale;
  const t = ui(lang).ferry;
  const page = site ? new URL(pathFor('ferry', lang), site).href : undefined;

  const events = feedEvents(
    [
      { calls: rovar, direction: 'to-haugesund' },
      { calls: haugesund, direction: 'to-rovar' },
    ],
    {
      strings: t.board,
      locale: localeInfo(lang).intl,
      stamp: builtAt,
      url: page,
    }
  );

  return new Response(icsCalendar(events, { name: t.feedName, ttlMinutes: FEED_TTL_MINUTES }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
}

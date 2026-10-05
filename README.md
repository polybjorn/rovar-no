# rovar-no

Proposed replacement for [rovar.no](https://rovar.no), the website for Røvær
island outside Haugesund, Norway. The old site is still the live one. This one
is up for review at
[polybjorn.github.io/rovar-no](https://polybjorn.github.io/rovar-no/), built
from `main` by GitHub Pages and set to noindex until launch.

## Pages

| Page | Path | Content |
|---|---|---|
| Home | `/` | Hero image, intro text, card grid, OpenStreetMap link |
| Explore the island | `/opplev-oya-var/` | Hiking, swimming, historical sites, food, places to stay, the aquaculture centre |
| Ferry | `/rutebaten/` | Live departure board from the Entur API, with service notices, past and next departures marked, a link to Kolumbus as a fallback, and picked departures to your calendar |
| Camp school | `/leirskolen/` | Program, practical information, contact |
| Island history | `/rovaers-historie/` | Archaeological finds, the fishing community, the 1899 disaster |

The paths are the Norwegian ones, kept from the old site so existing links
still work. Every other language uses English paths under its own prefix
(`/en/explore/`, `/de/explore/`).

## Languages

<!-- i18n-status:start -->

| Language | Prefix | Progress | Pages | UI strings |
|---|---|---|---|---|
| Norsk | none (root) | `██████████` 100% | 5/5 | 83/83 |
| English | `/en/` | `██████████` 100% | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/en) | [83/83](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/en.json) |
| Deutsch | `/de/` | `▒▒▒▒▒▒▒▒▒▒` machine-translated | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/de) | [83/83](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/de.json) |

`█` reviewed by a speaker, `▒` machine-translated and awaiting review
<!-- i18n-status:end -->

Each count links to the files it counts, so click one to read or fix a
translation. Norwegian is the original wording rather than a translation, so
its counts are plain text.

Adding a language needs no changes to the code or the markup.
`npm run i18n:new -- <code>` sets up the registry entry, the UI catalog and
the content folder, and `npm run i18n:check -- --write` updates the table
above. A page nobody has translated yet is not built for that language and
does not appear in the language menu. Missing UI strings fall back one by one,
so a half-finished language still renders.

## Updating dates and hours

Every date and opening time on the site is in `src/data/season.js`, and
every price, phone number and email in `src/data/facts.js`. Each is written
once and formatted for every language at build time, so a new season is an
edit to those two files and nothing in `src/content`.

`npm run season:check` lists each season date, the places it is printed
under, and whether it is current, over or stale.

Over is normal: the page strikes those rows through and tells the reader to
follow the place online or get in touch. Stale means a date still holds last
year's season from 1 March, when it is time to ask the places for this year's
hours. The weekly link check runs it too, and on the first stale run it
files an issue here, so the reminder arrives without anyone remembering to
look. Where each place publishes its
hours is noted next to its entries in `season.js`.

A date entered for next year (Hiltahuset's, say) is shown as soon as it is
there, so update a place as soon as it publishes rather than all at once.
A new `end` needs its `start` with it: the "til" rows open on that day, and
`npm test` fails on a season after 2026 without one.

`npm run hours:check` reads Nærbutikken's opening hours from narbutikken.no
and fails when they differ from `narbutikkenHours`. The site cannot read them
live (narbutikken.no allows no cross-site fetch), so the weekly link check
runs this and files an issue when they change.

Røvær Havhotell and Hiltahuset state their hours as prose, which no script
can compare with `season.js`. `npm run hours:pages` keeps the text that
states them in `scripts/hours-pages.json`, and the weekly link check files an
issue when a page changes it. Compare the page with `season.js` by hand, then
`npm run hours:pages -- --update` and commit the json. Sjøhus publishes on
Facebook, which cannot be fetched, so only the yearly reminder covers it.

## Tech

[Astro](https://astro.build) builds the site to plain HTML files, the styling
is hand-written CSS, and nothing else is needed to run it. Only two things send
JavaScript to the browser: the departure board, which reads live times from the
[Entur JourneyPlanner API](https://developer.entur.org/), and the language menu
in the nav.

```bash
npm install && npm run dev
```

Node 22.12 or newer, which is what Astro 7 asks for and what `engines` in
`package.json` declares. That is the floor rather than the version the site is
actually built with: `.nvmrc` holds that, currently 24, and both the forge gate
and the Pages deploy read it so the two cannot drift apart. `npm run build`
writes the finished site to `dist/`.

## Calendar

The ferry page has no subscription link, and the board has no controls on its
rows. "Legg avganger i kalenderen" opens a dialog (`src/scripts/calendar-picker.js`)
with its own timetable: once on a date from a two-week strip, or every week on
Hverdager, Lørdag or Søndag (the three timetables the route actually has, with
the weekdays narrowable). The reader ticks departures and downloads one `.ics`
holding only those; weekly picks run to the end of the published timetable,
matched by direction and Oslo clock time, so a day where a boat does not run
is left out. A single departure also gets a Google Calendar link, which on
Android opens the calendar app where a download would only land in the
downloads folder. A calendar holding every crossing of the month was the
reason for all of this.

A departure that has to be booked is flagged in the dialog with the booking
rule, and in the downloaded file it carries an alarm an hour before its
booking deadline. The Google link cannot carry one, and the feeds below never
do, since a feed holds every booking boat and would ring every evening.

The subscription feeds are still built, unlinked, so an existing subscription
keeps working: `/rutebaten.ics` with every departure in both directions, one
per language (`/en/ferry.ics`, `/de/ferry.ics`), and `/rutebaten-summary.ics`
with one all-day line per day and direction. Picks, links and feeds all come
from the same event builder in `src/scripts/departures-core.js`.

The feeds run to the end of Entur's published timetable rather than a fixed
window, and close with an all-day entry naming the date they run out, so a feed
nobody has rebuilt says so instead of just going quiet. They are static files, so
a deploy is what refreshes them, and `deploy.yml` runs daily on a schedule for
that reason alone. If Entur answers with nothing the build fails rather than
publishing an empty calendar, which would clear the departures out of every
subscriber's calendar.

## Tests

`npm test` checks the departure-board logic, the routing, the language
fallbacks and the content files (`node --test`, no test framework). It runs
twice, the second time under `TZ=Pacific/Auckland`: a departure board that
reads the visitor's own clock looks right in Norway and wrong everywhere else.
CI runs the tests before the build.

## License

The code is MIT. The page texts and the photos belong to Røvær øyting and to
the photographers.

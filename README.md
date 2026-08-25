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
| Ferry | `/rutebaten/` | Live departure board from the Entur API, with service notices, past and next departures marked, a link to Kolumbus as a fallback, and calendar export |
| Camp school | `/leirskolen/` | Program, practical information, contact |
| Island history | `/rovaers-historie/` | Archaeological finds, the fishing community, the 1899 disaster |

The paths are the Norwegian ones, kept from the old site so existing links
still work. Every other language uses English paths under its own prefix
(`/en/explore/`, `/de/explore/`).

## Languages

<!-- i18n-status:start -->

| Language | Prefix | Progress | Pages | UI strings |
|---|---|---|---|---|
| Norsk | none (root) | `██████████` 100% | 5/5 | 49/49 |
| English | `/en/` | `██████████` 100% | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/en) | [49/49](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/en.json) |
| Deutsch | `/de/` | `▒▒▒▒▒▒▒▒▒▒` machine-translated | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/de) | [49/49](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/de.json) |

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

## Tech

[Astro](https://astro.build) builds the site to plain HTML files, the styling
is hand-written CSS, and nothing else is needed to run it. Only two things send
JavaScript to the browser: the departure board, which reads live times from the
[Entur JourneyPlanner API](https://developer.entur.org/), and the language menu
in the nav.

```bash
npm install && npm run dev
```

`npm run build` writes the finished site to `dist/`.

## Calendar

Every departure row exports a single event, and `/rutebaten.ics` is a
subscribable feed of the next 30 days in both directions, one per language
(`/en/ferry.ics`, `/de/ferry.ics`). Both are built from the same event builder
in `src/scripts/departures-core.js`.

The feed is a static file, so a deploy is what refreshes it. Running the Pages
workflow on a schedule keeps it current; if Entur answers with nothing the
build fails rather than publishing an empty calendar, which would clear the
departures out of every subscriber's calendar.

## Tests

`npm test` checks the departure-board logic, the routing, the language
fallbacks and the content files (`node --test`, no test framework). It runs
twice, the second time under `TZ=Pacific/Auckland`: a departure board that
reads the visitor's own clock looks right in Norway and wrong everywhere else.
CI runs the tests before the build.

## License

The code is MIT. The page texts and the photos belong to Røvær øyting and to
the photographers.

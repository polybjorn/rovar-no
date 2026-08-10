# rovar-no

Proposed replacement for [rovar.no](https://rovar.no), the website for Røvær island outside Haugesund, Norway.

## Pages

- **Hjem** (`/`) - Hero image, intro text, card grid, OpenStreetMap link
- **Opplev øya vår** (`/opplev-oya-var/`) - Hiking, swimming, historical sites, food, accommodation, Havbrukssenter
- **Rutebåten** (`/rutebaten/`) - Live departure board from Entur API with notices, passed/next styling, Kolumbus backup link
- **Leirskolen** (`/leirskolen/`) - Camp school program, practical info, contact
- **Røværs historie** (`/rovaers-historie/`) - Archaeological finds, fishing community, the 1899 disaster

## Languages

<!-- i18n-status:start -->

| Language | Prefix | Progress | Pages | UI strings |
|---|---|---|---|---|
| Norsk | none (root) | `██████████` 100% | 5/5 | 38/38 |
| English | `/en/` | `██████████` 100% | 5/5 | 38/38 |
| Deutsch | `/de/` | `██████████` 100% | 5/5 | 38/38 |

<!-- i18n-status:end -->

Adding a language is one entry in `src/i18n/locales.js`, one UI catalog
(`src/i18n/ui/<code>.json`) and one content folder
(`src/content/pages/<code>/`). Nav, hreflang, `og:locale`, the sitemap and the
language switcher all derive from that list, so no markup or code changes.
Untranslated pages are simply not built for that language and drop out of the
switcher; missing UI strings fall back per key.

- `npm run i18n:check` - per language: missing pages, missing strings, pages awaiting review
- `npm run i18n:check -- --write` - same, and regenerates the table above
- `npm run i18n:verify` - fails if the table is stale; runs automatically before every build
- `npm run i18n:new -- <code>` - scaffold a new language

## Tech

- [Astro](https://astro.build) (static output, zero JS by default)
- Vanilla CSS with CSS custom properties
- [Entur JourneyPlanner API](https://entur.no/) for live departures

## Tests

`npm test` runs the status-table check and then the suite (`node --test`, no
test framework). It covers the departure-board logic in
`src/scripts/departures-core.js` - Oslo time handling, the Entur fallbacks,
booking detection, the calendar - plus routing and the UI string fallback
(`src/i18n/*-core.js`), the language registry, the seasonal formatter and the
content tree against the page registry.

The suite runs a second time under `TZ=Pacific/Auckland`: a departure board
that reads the visitor's own timezone looks correct in Norway and shows the
wrong times abroad, which no single-timezone run would catch. CI runs `npm
test` before the build.

## Status

Proposal stage. rovar.no still runs the current site. A preview is deployed
at [polybjorn.github.io/rovar-no](https://polybjorn.github.io/rovar-no/)
(noindex until launch, auto-deployed from `main` via GitHub Pages).

## License

The code is MIT licensed (see LICENSE). Page texts and photos belong to
Røvær øyting and the respective photographers and are not covered by the
MIT license.

# Røvær island website

A proposed new website for Røvær, a small island outside Haugesund, Norway.
The current site is [rovar.no](https://rovar.no). This one runs as a preview at
[polybjorn.github.io/rovar-no](https://polybjorn.github.io/rovar-no/).

## How it works

Built with [Astro](https://astro.build) as static HTML and plain CSS.
Scripts cover what static pages can't: the ferry board and its calendar dialog,
whether a place is open right now, the language menu and the 404 page. Every
page still works without them.

The ferry board reads departures straight from the
[Entur JourneyPlanner API](https://developer.entur.org/), so changes and
cancellations show up without a rebuild. Times are always Norwegian time,
wherever the visitor is.

Opening dates and hours are in `src/data/season.js`, and prices and contact
details in `src/data/facts.js`. Each is written once and formatted per language
at build time.

## Languages

<!-- i18n-status:start -->

| Language | Prefix | Progress | Pages | UI strings |
|---|---|---|---|---|
| Norsk | none (root) | `██████████` 100% | 5/5 | 79/79 |
| English | `/en/` | `██████████` 100% | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/en) | [79/79](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/en.json) |
| Deutsch | `/de/` | `▒▒▒▒▒▒▒▒▒▒` machine-translated | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/de) | [79/79](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/de.json) |
<!-- i18n-status:end -->

Each count links to its files. Norwegian is the original, so its counts are not
links, and it keeps the old site's paths so existing links still work. Other
languages use English paths under their prefix, like `/en/explore/`. A machine translation stays marked until a native speaker has reviewed
it. Untranslated pages are left out, and a missing UI string falls back to
English, then Norwegian.

## License

The license covers the code only. The page texts and photos belong to Røvær
øyting and the photographers.

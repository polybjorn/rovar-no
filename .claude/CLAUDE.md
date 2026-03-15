# Røvær website (rovar.no rebuild)

Proposed replacement for rovar.no. Pitch to the island community board (Røvær øyting).

## Pitch

Three arguments for switching:

1. **Full remake** - Modern static site, simpler code, easier to maintain
2. **Live route data** - Entur API replaces broken Kolumbus links
3. **Lower costs** - GitHub Pages (free hosting) vs WordPress hosting

## Stack

- Astro (static output, zero JS except rutebåten page)
- Vanilla CSS, no frameworks
- Entur API for live departure data (client-side JS)

## Pages

- `/` - Homepage with hero, card grid, and OpenStreetMap link
- `/opplev-oya-var/` - Activities, beaches, museum, food, accommodation
- `/rutebaten/` - Live departure board (Entur API, auto-refresh 60s)
- `/leirskolen/` - Camp school info and contact
- `/rovaers-historie/` - Island history from Stone Age to present

## Entur API

- Endpoint: `https://api.entur.io/journey-planner/v3/graphql`
- Header: `ET-Client-Name: polybjorn-rovar-no`
- Røvær hurtigbåtkai: `NSR:StopPlace:25940`
- Haugesund hurtigbåtkai: `NSR:StopPlace:26090`
- Line: 700 (Kolumbus)
- Fetches `estimatedCalls` with stop-by-stop times, duration, via-stops
- Also fetches `notices` and `situations` per serviceJourney (booking info, school-day-only, etc.)
- Notice buttons: icon-only (phone for booking, info circle for situations), no text labels
- Bestillingsrute detection: primary source is `bookingArrangements` in per-stop `estimatedCalls`, secondary is API notices/situations text, fallback soft notice on last departure per direction
- All times use `timeZone: "Europe/Oslo"` to avoid browser timezone issues
- Passed/next departure styling: greyed rows for passed, accent border + bold for next
- Day navigation: arrows to browse departures day-by-day (today + up to 7 days forward), one day per view
- `startTime` parameter set to Oslo midnight of selected day for correct date-scoped queries
- Kolumbus backup link with dynamic date: `reise.kolumbus.no/no/search`, shown as "Se ruter på Kolumbus (linje 700)"

## Known Entur data gaps

- **12:40 Haugesund → Røvær**: `serviceJourney.estimatedCalls` returns empty array, so arrival time, duration, and via-stops are missing. Entur data issue, not our code
- **Last departure booking info**: Entur now provides `bookingArrangements` on per-stop level for most booking routes. Fallback soft notice still appended to the last departure per direction if API data is missing

## Development

- `npm run dev` - dev server on port 4321
- `npm run build` - static output to `dist/`

## Logo

- Source: `~/Vault/Assets/Library/Icons/companies/rovar.png` (cleaned calligraphic logo)
- Website copy: `public/images/rovar-logo.png`
- Nav uses `filter: invert(1)` to show white logo on dark background

## Pitch document

- Folder: `~/Vault/Assets/Brand/Presentation/Rovar-pitch/`
- Source: `Rovar-pitch.html` (with relative image paths)
- Standalone: `Rovar-pitch-standalone.html` (base64 images, single file for sharing)
- Screenshots in `screenshots/` subfolder
- Capture tool: `npx capture-website-cli` at 1280x800, delay 5s for API data
- Disable dev toolbar temporarily via `devToolbar: { enabled: false }` in astro.config.mjs when taking screenshots

## i18n

- Astro built-in i18n routing, `prefixDefaultLocale: false`
- Languages: Norwegian (default, root), English (`/en/`), German (`/de/`)
- English URL slugs shared across all languages (no translated slugs)
- Slug mapping: `opplev-oya-var` → `explore`, `rutebaten` → `ferry`, `leirskolen` → `camp-school`, `rovaers-historie` → `history`
- All 5 pages translated for EN and DE
- Language switcher with flag buttons (client-side JS)
- Shared layouts/components/styles, only page content translated
- UI strings (nav labels, departure page text) in `src/data/translations.js`
- Departure board strings in `src/scripts/departures.js` (STRINGS object, per-language bookingRegex)

## Status

Private repo. Norwegian, English, and German content complete.

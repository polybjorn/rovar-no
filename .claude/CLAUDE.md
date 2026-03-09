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
- Bestillingsrute detection: API notices/situations first, fallback soft notice on last departure per direction
- All times use `timeZone: "Europe/Oslo"` to avoid browser timezone issues
- Passed/next departure styling: greyed rows for passed, accent border + bold for next
- Kolumbus backup link with dynamic date: `reise.kolumbus.no/no/search`

## Development

- `npm run dev` - dev server on port 4321
- `npm run build` - static output to `dist/`

## Status

Private repo. Norwegian content only. No English/German translations yet.

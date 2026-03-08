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

- `/` - Homepage with hero and card grid
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
- Bestillingsrute detection: heuristic (last departure), NOT confirmed with Kolumbus

## Development

- `npm run dev` - dev server on port 4321
- `npm run build` - static output to `dist/`

## Status

Private repo. Norwegian content only. No English/German translations yet.

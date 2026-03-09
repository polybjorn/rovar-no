# rovar-no

Proposed replacement for [rovar.no](https://rovar.no), the website for Røvær island outside Haugesund, Norway.

## Pages

- **Hjem** (`/`) - Hero image, intro text, card grid, OpenStreetMap link
- **Opplev øya vår** (`/opplev-oya-var/`) - Hiking, swimming, historical sites, food, accommodation, Havbrukssenter
- **Rutebåten** (`/rutebaten/`) - Live departure board from Entur API with notices, passed/next styling, Kolumbus backup link
- **Leirskolen** (`/leirskolen/`) - Camp school program, practical info, contact
- **Røværs historie** (`/rovaers-historie/`) - Archaeological finds, fishing community, the 1899 disaster

## Tech

- [Astro](https://astro.build) (static output, zero JS by default)
- Vanilla CSS with CSS custom properties
- [Entur JourneyPlanner API](https://entur.no/) for live departures
- Norwegian content only (no English/German yet)

## Development

```
npm install
npm run dev      # http://localhost:4321
npm run build    # Static output to dist/
```

## Status

Work in progress. Not yet deployed.

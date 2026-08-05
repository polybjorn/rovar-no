# rovar-no

Proposed replacement for [rovar.no](https://rovar.no), the website for Røvær island outside Haugesund, Norway.

## Pages

- **Hjem** (`/`) - Hero image, intro text, card grid, OpenStreetMap link
- **Opplev øya vår** (`/opplev-oya-var/`) - Hiking, swimming, historical sites, food, accommodation, Havbrukssenter
- **Rutebåten** (`/rutebaten/`) - Live departure board from Entur API with notices, passed/next styling, Kolumbus backup link
- **Leirskolen** (`/leirskolen/`) - Camp school program, practical info, contact
- **Røværs historie** (`/rovaers-historie/`) - Archaeological finds, fishing community, the 1899 disaster

All pages are available in Norwegian (root), English (`/en/`) and German (`/de/`).

## Tech

- [Astro](https://astro.build) (static output, zero JS by default)
- Vanilla CSS with CSS custom properties
- [Entur JourneyPlanner API](https://entur.no/) for live departures
- Three languages: Norwegian (default), English (`/en/`), German (`/de/`)

## Development

```
npm install
npm run dev      # http://localhost:4321
npm run build    # Static output to dist/
```

## Status

Proposal stage. Not publicly deployed; rovar.no still runs the current site.

## License

The code is MIT licensed (see LICENSE). Page texts and photos belong to
Røvær øyting and the respective photographers and are not covered by the
MIT license.

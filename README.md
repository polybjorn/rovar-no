# rovar-no

Proposed replacement for [rovar.no](https://rovar.no), the website for Røvær island outside Haugesund, Norway.

## Why replace the current site?

### 1. Simpler, modern codebase

The current site runs WordPress with plugins, themes, and a database. This rebuild is a static site (Astro) with plain HTML, CSS, and a single JavaScript file for live boat departures. No database, no admin panel, no plugin updates.

### 2. Live boat schedule

The current "Rutebåten" page links to Kolumbus, but the links are broken. This rebuild pulls live departure data directly from the Entur API, showing today's departures with arrival times, travel duration, and auto-refresh every 60 seconds.

### 3. Lower hosting costs

| | WordPress (one.com) | Static (GitHub Pages) |
|---|---|---|
| Hosting | ~50-100 kr/month | Free |
| Domain (.no) | ~100 kr/year | ~100 kr/year |
| SSL certificate | Included | Included |
| Annual cost | ~700-1300 kr | ~100 kr |

GitHub Pages is free for public repositories. The only cost is the domain name itself.

## Pages

- **Hjem** - Hero image, intro text, card grid linking to subpages
- **Opplev øya vår** - Hiking, swimming, historical sites, food, accommodation, Havbrukssenter
- **Rutebåten** - Live departure board from Entur API (Røvær-Haugesund, both directions)
- **Leirskolen** - Camp school program, practical info, contact
- **Røværs historie** - Archaeological finds, fishing community, the 1899 disaster

## Tech

- [Astro](https://astro.build) (static output, zero JS by default)
- Vanilla CSS with CSS custom properties
- [Entur JourneyPlanner API](https://developer.entur.org) for live departures
- Norwegian content only (no English/German for now)

## Development

```
npm install
npm run dev      # http://localhost:4321
npm run build    # Static output to dist/
```

## Status

Work in progress. Not yet deployed.

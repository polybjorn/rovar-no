# Røvær Rutebåt

Single-page boat schedule for the Røvær–Haugesund route (Kolumbus line 700).

## Stack

- Single `index.html` — vanilla JS, no build step
- Data from [Entur Journey Planner API](https://developer.entur.org/pages-journeyplanner-journeyplanner/) (GraphQL, no auth required)

## Key IDs

- Røvær hurtigbåtkai: `NSR:StopPlace:25940`
- Haugesund hurtigbåtkai: `NSR:StopPlace:26090`
- Line: 700

## API

- Endpoint: `https://api.entur.io/journey-planner/v3/graphql`
- Header: `ET-Client-Name: polybjorn-rovar-rutebat`
- Uses `estimatedCalls` on each stop place (departure board), filtered by destination text

## Hosting

Not yet deployed. Static file, can go anywhere.

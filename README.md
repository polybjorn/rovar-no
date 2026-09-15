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
| Norsk | none (root) | `██████████` 100% | 5/5 | 54/54 |
| English | `/en/` | `██████████` 100% | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/en) | [54/54](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/en.json) |
| Deutsch | `/de/` | `▒▒▒▒▒▒▒▒▒▒` machine-translated | [5/5](https://github.com/polybjorn/rovar-no/tree/main/src/content/pages/de) | [54/54](https://github.com/polybjorn/rovar-no/tree/main/src/i18n/ui/de.json) |

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

Node 22.12 or newer, which is what Astro 7 asks for and what `engines` in
`package.json` declares. That is the floor rather than the version the site is
actually built with: `.nvmrc` holds that, currently 24, and both the forge gate
and the Pages deploy read it so the two cannot drift apart. `npm run build`
writes the finished site to `dist/`.

## Calendar

`/rutebaten.ics` is a subscribable feed of both directions, one per language
(`/en/ferry.ics`, `/de/ferry.ics`). `/rutebaten-summary.ics` is the same timetable folded into one
all-day line per day and direction, for a calendar that should carry the
timetable without being buried by it. All of them come from the same event
builder in `src/scripts/departures-core.js`.

The feeds run to the end of Entur's published timetable rather than a fixed
window, and close with an all-day entry naming the date they run out, so a feed
nobody has rebuilt says so instead of just going quiet. They are static files, so
a deploy is what refreshes them, and `deploy.yml` runs daily on a schedule for
that reason alone. If Entur answers with nothing the build fails rather than
publishing an empty calendar, which would clear the departures out of every
subscriber's calendar.

## Tests

`npm test` checks the departure-board logic, the routing, the language
fallbacks and the content files (`node --test`, no test framework). It runs
twice, the second time under `TZ=Pacific/Auckland`: a departure board that
reads the visitor's own clock looks right in Norway and wrong everywhere else.
CI runs the tests before the build.

`npm run links:check` follows every external link in `dist/`, so it needs a
build first. A weekly job runs it on the forge rather than on pull requests:
a link dying is not something a change to this repo caused, and not something
blocking a merge would fix. Only links a reader can click are checked, not the
`canonical` and `hreflang` tags, one of which correctly points at a URL that
answers 404. A link that is gone fails the job; a host that refuses a scripted
request is reported and tolerated, since that says nothing about whether the
link works in a browser.

`npm run pins:check` compares three numbers that have to agree: the node the
job is running on, the version `deploy.yml` builds with, and the floor
`package.json` declares. It runs in CI before `npm ci`, so the runner's own
version reaches the log as a measurement rather than as a comment that was true
once. A difference between the first two is reported and tolerated; the job
fails only when the deploy version drops below the floor, which is the point
where the difference can actually break the build.

`npm run merges:check` asks git whether every pull request the forge reports as
merged is reachable from `main`. A daily job runs it. A merge can report success
on every signal and leave `main` without the work, and when that happens nothing
else notices: the pull request says merged, the linked issue closes, and CI goes
green on a commit that is on no branch. Reachability is decided by git rather
than by the forge API, because the API is the thing under suspicion, and the
script refuses to run on a shallow clone instead of guessing, since a truncated
history reports nearly every merge as lost.

`npm run sweep:check` asks whether the branch sweep actually ran. A merged
branch is normally removed by a job on the merge event, and a daily sweep
deletes any `herd/` branch that git says `main` already contains, for the
merges where that event never arrived. The sweep has the same blind spot one
layer up: if its timer stops firing, nothing says so and the branches pile up
in the same silence. The daily audit runs this check too, so the answer comes
from a job that already exists rather than from a second timer that would need
watching in turn. A skipped run does not count as a run, which is what stops
the check passing on merge traffic alone.

A fortnightly job runs `npm update` and opens one rolling pull request when the
lockfile moves, with the version changes and a full build of the result in its
description. It only moves `package-lock.json` inside the ranges `package.json`
already declares, so it never crosses a major.

## License

The code is MIT. The page texts and the photos belong to Røvær øyting and to
the photographers.

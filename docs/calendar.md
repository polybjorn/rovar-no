# Ferry calendar

The ferry page has no subscription link, and the board has no controls on its
rows. "Legg avganger i kalenderen" opens a dialog
(`src/scripts/calendar-picker.js`) with its own timetable: once on a date from
a two-week strip, or every week on Hverdager, Lørdag or Søndag (the three
timetables the route actually has, with the weekdays narrowable). The reader
ticks departures and downloads one `.ics` holding only those; weekly picks run
to the end of the published timetable, matched by direction and Oslo clock
time, so a day where a boat does not run is left out. A single departure also
gets a Google Calendar link, which on Android opens the calendar app where a
download would only land in the downloads folder. A calendar holding every
crossing of the month was the reason for all of this.

A departure that has to be booked is flagged in the dialog with the booking
rule, and in the downloaded file it carries an alarm an hour before its
booking deadline. The Google link cannot carry one, and the feeds below never
do, since a feed holds every booking boat and would ring every evening.

## The retiring feeds

The subscription feeds are still built, unlinked, so a subscription made
before the picker keeps working for now: `/rutebaten.ics` with every departure
in both directions, and `/rutebaten-summary.ics` with one all-day line per day
and direction, each also built per language beside that language's ferry page
(`/en/ferry.ics`, `/de/ferry-summary.ics`). Picks, links and feeds all come
from the same event builder in `src/scripts/departures-core.js`.

The feeds run to the end of Entur's published timetable rather than a fixed
window, and close with an all-day entry naming the date they run out, so a feed
nobody has rebuilt says so instead of just going quiet. They are static files,
so a deploy is what refreshes them, and `.github/workflows/deploy.yml` runs
daily on a schedule for that reason alone. If Entur answers with nothing the
build fails rather than publishing an empty calendar, which would clear the
departures out of every subscriber's calendar.

They retire on `FEED_RETIRE_DATE` in `src/scripts/departures-core.js`,
currently 2027-01-04, just after the year end the timetable is published to.
From that Oslo date a build publishes each feed with a single closing note in
place of the timetable, so a subscribed calendar empties instead of freezing
on the last departures it saw, and Entur is no longer asked at all. The
scheduled deploy keeps running for `FEED_SCHEDULE_GRACE_DAYS` (7) past that
date, so a dropped run still leaves one build that publishes the note, and
then `scripts/feed-schedule-gate.mjs` turns it into a no-op. A push or a
manual run always builds.

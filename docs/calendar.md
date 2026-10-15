# Ferry calendar

The board has no controls on its rows. "Legg avganger i kalenderen" opens a dialog
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
booking deadline. The Google link cannot carry one.

Subscription feeds (`/rutebaten.ics`, `/rutebaten-summary.ics`) ran on the
preview from 2026-08-25 until the dialog replaced them, and were removed in
#115.

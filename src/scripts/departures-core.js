// Pure logic behind the departure board: time handling, Entur's fallback
// chains, booking detection, calendar arithmetic. No DOM, no fetch, no module
// state - everything a caller needs is an argument, so this file is testable
// under node (test/departures.test.mjs) while departures.js keeps the browser
// side.
//
// Nothing here may depend on the visitor's timezone. Every wall-clock value is
// resolved against Europe/Oslo explicitly; the tests run the whole suite a
// second time under a foreign TZ to keep it that way.

export const ENTUR_API = 'https://api.entur.io/journey-planner/v3/graphql';
export const ENTUR_CLIENT = 'polybjorn-rovar-no';
// Entur's own site, credited under the board.
export const ENTUR_SITE = 'https://entur.no/';
export const ROVAR_STOP = 'NSR:StopPlace:25940';
export const HAUGESUND_STOP = 'NSR:StopPlace:26090';
export const MAX_DAY_OFFSET = 7;
// A ceiling on the query window, not a horizon: Entur is asked for more than it
// can have and answers with the whole published timetable, which currently runs
// out about four months ahead (Kolumbus publishes to a year end). Taking all of
// it is what lets the feed survive a deploy that never comes - it stays correct
// until the timetable it was built from ends, rather than for a fixed 30 days.
export const FEED_WINDOW_DAYS = 400;
export const FEED_TTL_MINUTES = 720;

export const query = `query departures($stopId: String!, $n: Int!, $startTime: DateTime!, $timeRange: Int!) {
  stopPlace(id: $stopId) {
    estimatedCalls(numberOfDepartures: $n, timeRange: $timeRange, startTime: $startTime) {
      expectedDepartureTime
      destinationDisplay { frontText }
      serviceJourney {
        id
        line { publicCode }
        notices { text }
        situations { summary { value } }
        passingTimes {
          departure { time }
          arrival { time }
        }
        estimatedCalls {
          quay { stopPlace { name } }
          expectedDepartureTime
          bookingArrangements { latestBookingTime minimumBookingPeriod bookingMethods }
        }
      }
    }
  }
}`;

// --- time -------------------------------------------------------------------

export function toOsloDate(dt) {
  return dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' });
}

// "+01:00" or "+02:00", whichever Oslo was on that date.
export function osloOffset(dateStr) {
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
  const osloHour = parseInt(
    utcMidnight.toLocaleTimeString('en-US', {
      timeZone: 'Europe/Oslo',
      hour: 'numeric',
      hour12: false,
    })
  );
  return `+${String(osloHour).padStart(2, '0')}:00`;
}

export function dateAtOffset(offset, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d;
}

// startTime for the query: Oslo midnight of the selected day, never the
// browser's own midnight.
export function osloMidnight(offset, now = new Date()) {
  const dateStr = toOsloDate(dateAtOffset(offset, now));
  return `${dateStr}T00:00:00${osloOffset(dateStr)}`;
}

// Minutes since Oslo midnight, for comparing a departure against "now".
export function osloMinutes(dt) {
  const part = (unit) =>
    parseInt(dt.toLocaleTimeString('en-US', { [unit]: 'numeric', hour12: false, timeZone: 'Europe/Oslo' }));
  return part('hour') * 60 + part('minute');
}

// --- route data -------------------------------------------------------------

// Without a targetDate this is the direction filter alone, which is what the
// feed wants: one query covers a month, and the day it belongs to is worked
// out per call afterwards.
export function filterRoute(calls, direction, targetDate) {
  return calls.filter((c) => {
    const dest = c.destinationDisplay.frontText.toLowerCase();
    const dirMatch =
      direction === 'to-haugesund' ? dest.includes('haugesund') : dest.includes('røvær');
    if (!dirMatch) return false;
    return !targetDate || toOsloDate(new Date(c.expectedDepartureTime)) === targetDate;
  });
}

export function parseViaFromFrontText(frontText) {
  const m = frontText.match(/\bvia\s+(.+)/i);
  if (!m) return [];
  return m[1].split(/[-,]/).map((s) => s.trim()).filter(Boolean);
}

// Fallback for the departures where serviceJourney.estimatedCalls comes back
// empty (every future date, and 12:40 Haugesund -> Røvær even today).
export function getArrivalFromPassingTimes(call) {
  const pt = call.serviceJourney.passingTimes;
  if (!pt || pt.length < 2) return { arrivalTime: null, duration: null };
  const depTime = pt[0].departure.time;
  const arrTime = pt[pt.length - 1].arrival?.time || pt[pt.length - 1].departure.time;
  const depDate = toOsloDate(new Date(call.expectedDepartureTime));
  // passingTimes are wall-clock Oslo times; anchor them to the Oslo UTC offset
  // so they don't get parsed in the visitor's local timezone.
  const tz = osloOffset(depDate);
  const dep = new Date(`${depDate}T${depTime}${tz}`);
  const arr = new Date(`${depDate}T${arrTime}${tz}`);
  const duration = Math.round((arr - dep) / 60000);
  return { arrivalTime: arr, duration: duration > 0 ? duration : null };
}

// Ask about a departure three days out and the stop list comes back describing
// today's run of the same journey: the clock times are the ones that matter and
// are right, the dates are today's. A board that prints HH:MM cannot see the
// difference, but an exported event dated from that list ends before it starts.
// So only the spans between those stops are read off them, and every moment
// handed back is measured from the departure the caller actually asked about.
export function getRouteInfo(call) {
  const stops = call.serviceJourney.estimatedCalls;
  const departure = new Date(call.expectedDepartureTime);

  if (!stops || stops.length < 2) {
    const via = parseViaFromFrontText(call.destinationDisplay?.frontText || '');
    const { arrivalTime, duration } = getArrivalFromPassingTimes(call);
    return { arrivalTime, duration, via, hasBooking: false, bookingDeadline: null };
  }

  const first = new Date(stops[0].expectedDepartureTime);
  const last = new Date(stops[stops.length - 1].expectedDepartureTime);
  const duration = Math.round((last - first) / 60000);
  const via = stops.slice(1, -1).map((s) => s.quay.stopPlace.name.replace(' hurtigbåtkai', ''));
  const hasBooking = stops[0].bookingArrangements?.bookingMethods?.length > 0;

  return {
    arrivalTime: new Date(departure.getTime() + duration * 60000),
    duration,
    via,
    hasBooking,
    bookingDeadline: bookingDeadline(stops[0].bookingArrangements, departure),
  };
}

// Entur gives the booking deadline two ways and Kolumbus uses the second one:
// latestBookingTime is a wall-clock time and is usually null, while
// minimumBookingPeriod is an ISO 8601 duration counted back from departure
// ("PT40M" on the 21:05 boat, so 20:25 - the same deadline kolumbus.no shows).
export function bookingDeadline(arrangements, departure) {
  if (!arrangements || !departure) return null;

  const period = parseDuration(arrangements.minimumBookingPeriod);
  if (period) return new Date(departure.getTime() - period * 60000);

  const clock = /^(\d{1,2}):(\d{2})/.exec(arrangements.latestBookingTime || '');
  if (!clock) return null;
  // A wall-clock deadline is Oslo time on the departure's own Oslo day, and
  // never after the departure itself. Reading it in the browser's timezone
  // would put it hours off for a visitor abroad.
  const day = toOsloDate(departure);
  const hhmm = `${clock[1].padStart(2, '0')}:${clock[2]}`;
  const at = new Date(`${day}T${hhmm}:00${osloOffset(day)}`);
  return at > departure ? null : at;
}

// ISO 8601 duration to minutes. Entur only ever sends hours and minutes here,
// so days and up are not worth carrying.
function parseDuration(value) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value || '');
  if (!m || (!m[1] && !m[2])) return 0;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

// --- notices ----------------------------------------------------------------

// Entur's notices come back in Norwegian whatever language the page is in, so
// the words to look for are Norwegian and live here rather than in the UI
// catalogs: a translator has nothing useful to say about them, and words typed
// into a catalog would land in a RegExp unescaped.
const bookingTerms = ['bestill', 'forh[åa]ndsbestilling'];

const escapeRe = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function bookingPattern(extraWords = []) {
  return new RegExp([...bookingTerms, ...extraWords.map(escapeRe)].join('|'), 'i');
}

export function situationTexts(serviceJourney) {
  return (serviceJourney.situations || [])
    .map((s) => s.summary?.map((v) => v.value).join(' ') || '')
    .filter(Boolean);
}

// Bestillingsrute detection, in priority order: bookingArrangements from the
// API, then notice/situation text, then the last departure of the direction
// (booking data is unavailable ahead of today, and the last boat is the one
// that usually needs booking).
//
// The board says "this one needs booking" exactly once per row, with the phone
// marker, and the legend under the board explains the marker and gives the
// site and the number. So a booking notice from the API is dropped rather than
// shown: it is the marker again as a sentence, and the deadline row already
// carries the one thing the marker cannot say, which is by when.
export function noticeState({ call, hasBooking, isLast, bookingRe }) {
  const notices = call.serviceJourney.notices || [];
  const texts = [...notices.map((n) => n.text), ...situationTexts(call.serviceJourney)];

  return {
    isBooking: hasBooking || Boolean(isLast) || texts.some((t) => bookingRe.test(t)),
    infoTexts: texts.filter((t) => !bookingRe.test(t)),
  };
}

// A booking deadline is a moment on the same timeline as the departures, so it
// takes its own row in clock order rather than hanging off the boat it belongs
// to - the deadline for the last boat of the day falls hours before it, and
// reading down the column is how you see it coming. Departures come in sorted;
// each deadline is spliced in at its own time, ahead of a departure it ties
// with.
export function timeline(departures) {
  const rows = [];
  departures.forEach((dep, index) => {
    if (dep.deadlineMinutes != null)
      rows.push({ type: 'deadline', minutes: dep.deadlineMinutes, forIndex: index });
    rows.push({ type: 'departure', minutes: dep.minutes, index });
  });
  return rows.sort(
    (a, b) => a.minutes - b.minutes || (a.type === b.type ? 0 : a.type === 'deadline' ? -1 : 1),
  );
}

// --- presentation -----------------------------------------------------------

// The duration is built from the units, then dropped into the language's own
// sentence: "om {{time}}" puts it after, another language can put it first.
export function formatCountdown(mins, s = {}) {
  if (mins <= 0) return s.now;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const time =
    mins < 60
      ? `${mins} ${s.minUnit}`
      : m
        ? `${h} ${s.hourUnit} ${m} ${s.minUnit}`
        : `${h} ${s.hourUnit}`;
  return (s.relative ?? '{{time}}').replace('{{time}}', time);
}

// Colour is redundant with the wording, never the only signal.
export function urgencyClass(mins) {
  return mins <= 10 ? ' is-imminent' : mins <= 30 ? ' is-soon' : '';
}

// Without a date this is the plain route link, which is what the page is built
// with; the script fills the selected day in as the reader moves between days.
export function kolumbusUrl(dateStr) {
  const route = `https://reise.kolumbus.no/no/search?fromId=${ROVAR_STOP}&toId=${HAUGESUND_STOP}`;
  return dateStr ? `${route}&dateTime=${dateStr}T05:00:00.000Z` : route;
}

// --- calendar ---------------------------------------------------------------

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function monthIndex(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return y * 12 + (m - 1);
}

// Whole days from today to dateStr. Compared at midday so a DST change cannot
// shift the count.
export function offsetOf(dateStr, now = new Date()) {
  const day = 86400000;
  return Math.round(
    (new Date(`${dateStr}T12:00:00Z`) - new Date(`${toOsloDate(now)}T12:00:00Z`)) / day
  );
}

// 2024-01-01 was a Monday, so walking a week from it gives Monday-first names.
export function weekdayNames(locale) {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, {
      weekday: 'short',
      timeZone: 'UTC',
    })
  );
}

// The month grid: leading blanks, then every day with its state. The caller
// turns this into markup.
export function monthDays(view, { selected, now = new Date(), maxOffset = MAX_DAY_OFFSET } = {}) {
  const [year, month] = view.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay() is 0=Sunday; shift so Monday is column 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const days = [];
  for (let day = 1; day <= count; day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const offset = offsetOf(date, now);
    days.push({
      day,
      date,
      offset,
      usable: offset >= 0 && offset <= maxOffset,
      isSelected: date === selected,
      isToday: offset === 0,
    });
  }
  return { lead, days, label: first };
}

export function monthNav(view, { now = new Date(), maxOffset = MAX_DAY_OFFSET } = {}) {
  const current = monthIndex(`${view}-01`);
  const last = toOsloDate(dateAtOffset(maxOffset, now));
  return {
    canPrev: current > monthIndex(toOsloDate(now)),
    canNext: current < monthIndex(last),
  };
}

export function shiftMonth(view, step) {
  const [y, m] = view.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + step, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

// --- calendar export --------------------------------------------------------

// The two ends of the route. Entur only names them on the per-stop calls,
// which are empty on every future date, so the names an event is built from
// come from here rather than from the response.
export const ROVAR_NAME = 'Røvær';
export const HAUGESUND_NAME = 'Haugesund';
export const ICS_PRODID = '-//rovar.no//Rutebaten//NO';
export const ICS_DOMAIN = 'rovar.no';

// Wall-clock Oslo time, the same clock the board prints.
export function osloClock(dt, locale = 'no') {
  return dt.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Oslo',
  });
}

// UTC, always: a UTC stamp needs no VTIMEZONE block and leaves no wall-clock
// value for a calendar app to resolve against the wrong zone. The offset in
// Entur's own timestamps has already done the work.
export function icsTime(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/[;,]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, '\\n');
}

const octets = (ch) => {
  const c = ch.codePointAt(0);
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
};

// RFC 5545 folds at 75 octets, not 75 characters, and every accented letter in
// "Røvær" is two. Folding by string length would let a line run over the limit
// and could cut a multi-byte character in half; this walks codepoints and
// counts their bytes, and never splits one.
export function foldLine(line, limit = 75) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = octets(ch);
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 1; // the space a continuation line starts with counts too
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.map((part, i) => (i ? ` ${part}` : part)).join('\r\n');
}

// A UID has to name the same journey on the same day every time the feed is
// built, or a subscriber collects a duplicate instead of an update whenever a
// departure moves. serviceJourney.id is that name; without it (older cached
// data) the clock time stands in, which is stable until the very departure
// that moves, and then reads as a new event.
export function journeyKey(call, direction) {
  const date = toOsloDate(new Date(call.expectedDepartureTime));
  const id = call.serviceJourney?.id;
  const name = id || `${date}-${osloMinutes(new Date(call.expectedDepartureTime))}`;
  return `${name}-${date}-${direction}`.replace(/[^A-Za-z0-9._-]/g, '-');
}

// One departure as a plain event object. Every display string comes from the
// caller's UI catalog, so this stays the language-agnostic half; the tokens it
// fills are the same {{token}} shape the rest of the site uses.
export function fillTokens(template, tokens) {
  return Object.entries(tokens).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template
  );
}

export function departureEvent(call, opts = {}) {
  const {
    direction = 'to-haugesund',
    stamp = new Date(),
    strings = {},
    isLast = false,
    bookingRe = bookingPattern(),
    locale = 'no',
    url,
    reminders = [],
  } = opts;

  const start = new Date(call.expectedDepartureTime);
  const { arrivalTime, duration, via, hasBooking, bookingDeadline } = getRouteInfo(call);
  const { isBooking, infoTexts } = noticeState({ call, hasBooking, isLast, bookingRe });

  const toHaugesund = direction === 'to-haugesund';
  const from = toHaugesund ? ROVAR_NAME : HAUGESUND_NAME;
  const to = toHaugesund ? HAUGESUND_NAME : ROVAR_NAME;
  const fill = fillTokens;

  const description = [
    via.length && strings.icsVia ? fill(strings.icsVia, { stops: via.join(', ') }) : '',
    isBooking && bookingDeadline && strings.icsBooking
      ? fill(strings.icsBooking, { deadline: osloClock(bookingDeadline, locale) })
      : isBooking
        ? strings.icsBookingNoDeadline || ''
        : '',
    ...infoTexts,
  ].filter(Boolean);

  return {
    uid: `${journeyKey(call, direction)}@${ICS_DOMAIN}`,
    stamp,
    start,
    end: arrivalTime,
    duration,
    direction,
    from,
    to,
    isBooking,
    summary: fill(strings.icsSummary ?? '{{from}}-{{to}}', { from, to }),
    location: fill(strings.icsLocation ?? '{{from}}', { from, to }),
    description: description.join('\n'),
    url,
    reminders,
  };
}

export function icsEvent(event) {
  const lines = ['BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${icsTime(event.stamp)}`];

  if (event.allDay) {
    // A DATE end is exclusive, so a single day ends on the next one.
    lines.push(
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextOsloDay(event.date))}`
    );
  } else {
    lines.push(`DTSTART:${icsTime(event.start)}`);
    // No arrival time known means an event with no end rather than a guessed
    // one: Entur leaves the stop list empty often enough that a made-up
    // crossing time would be the common case, not the exception.
    if (event.end) lines.push(`DTEND:${icsTime(event.end)}`);
  }

  lines.push(`SUMMARY:${icsEscape(event.summary)}`);
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  // A timetable is something to read, not somewhere you have to be. Marked
  // transparent it shows in the calendar without claiming the day as busy,
  // which an all-day event would otherwise do to every free/busy lookup.
  if (event.transparent) lines.push('TRANSP:TRANSPARENT');
  for (const mins of event.reminders || []) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(event.summary)}`,
      `TRIGGER:-PT${mins}M`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

// CRLF throughout and a trailing one, per RFC 5545 - some clients reject a
// file that ends without it.
export function icsCalendar(events, { prodid = ICS_PRODID, name, ttlMinutes, method } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodid}`, 'CALSCALE:GREGORIAN'];
  if (method) lines.push(`METHOD:${method}`);
  if (name) lines.push(`NAME:${icsEscape(name)}`, `X-WR-CALNAME:${icsEscape(name)}`);
  // How often a subscriber should re-read the feed. NAME/REFRESH-INTERVAL are
  // the standard properties and the X- ones are what Apple and Outlook
  // actually read, so both go in.
  if (ttlMinutes) {
    const ttl = `PT${ttlMinutes}M`;
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${ttl}`, `X-PUBLISHED-TTL:${ttl}`);
  }
  for (const event of events) lines.push(...icsEvent(event));
  lines.push('END:VCALENDAR');
  return `${lines.map((line) => foldLine(line)).join('\r\n')}\r\n`;
}

// Calls split into Oslo days, each day's own calls in clock order. The feed
// needs the split because "the last boat of the day" is what marks a
// bestillingsrute when Entur has no booking data yet, and a month of calls
// arrives as one flat list.
export function groupByOsloDate(calls) {
  const days = new Map();
  for (const call of calls) {
    const date = toOsloDate(new Date(call.expectedDepartureTime));
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(call);
  }
  return [...days.entries()]
    .map(([date, dayCalls]) => ({
      date,
      calls: [...dayCalls].sort(
        (a, b) => new Date(a.expectedDepartureTime) - new Date(b.expectedDepartureTime)
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Both directions of a month, as one sorted event list. Keyed by UID on the
// way through: a stop's query answers with departures the other stop's query
// also saw, and two events with the same UID are the same boat, not two.
export function feedEvents(batches, opts = {}) {
  const byUid = new Map();
  for (const { calls, direction } of batches) {
    for (const day of groupByOsloDate(filterRoute(calls, direction))) {
      day.calls.forEach((call, i) => {
        const event = departureEvent(call, {
          ...opts,
          direction,
          isLast: i === day.calls.length - 1,
        });
        byUid.set(event.uid, event);
      });
    }
  }
  return [...byUid.values()].sort((a, b) => a.start - b.start);
}

// --- summary feed -----------------------------------------------------------

export const compactDate = (dateStr) => dateStr.replace(/-/g, '');

// Midday, so a DST change cannot tip the arithmetic into the wrong day.
export function nextOsloDay(dateStr) {
  const day = new Date(`${dateStr}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

// The detailed events folded into one all-day entry per day and direction. A
// timetable is reference material, and eighteen timed blocks a day bury a
// calendar it was only meant to sit beside; one line per direction says the
// same thing from the all-day row, where it costs nothing.
export function summaryEvents(events, opts = {}) {
  const { strings = {}, locale = 'no', stamp = new Date(), url } = opts;

  const days = new Map();
  for (const event of events) {
    const key = `${toOsloDate(event.start)}|${event.direction}`;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(event);
  }

  return [...days.entries()]
    .map(([key, group]) => {
      const [date, direction] = key.split('|');
      const sorted = [...group].sort((a, b) => a.start - b.start);
      const clock = (dt) => osloClock(dt, locale);
      return {
        uid: `summary-${date}-${direction}@${ICS_DOMAIN}`,
        stamp,
        allDay: true,
        date,
        direction,
        transparent: true,
        summary: fillTokens(strings.icsDay ?? '{{from}}-{{to}}: {{times}}', {
          from: sorted[0].from,
          to: sorted[0].to,
          times: sorted.map((e) => clock(e.start)).join(', '),
        }),
        description: sorted
          .map((e) => (e.end ? `${clock(e.start)}-${clock(e.end)}` : clock(e.start)))
          .join('\n'),
        url,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction));
}

// The feed states its own expiry. Without this a subscriber whose calendar has
// simply stopped being rebuilt sees no ferry at all past some date and reads it
// as the boat having stopped, with nothing on screen to suggest otherwise. One
// all-day marker on the last covered day says which it is and where to look.
// The UID is fixed, so each build moves this one entry rather than leaving the
// old date behind in anyone's calendar.
export function expiryEvent(events, opts = {}) {
  if (!events.length) return null;
  const { strings = {}, stamp = new Date(), url } = opts;
  const last = events.reduce((a, b) => (a.start > b.start ? a : b));
  const date = toOsloDate(last.start);

  return {
    uid: `timetable-end@${ICS_DOMAIN}`,
    stamp,
    allDay: true,
    date,
    transparent: true,
    summary: strings.icsTimetableEnd ?? 'Timetable ends',
    description: fillTokens(strings.icsTimetableEndBody ?? '', { date }),
    url,
  };
}

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
export const ROVAR_STOP = 'NSR:StopPlace:25940';
export const HAUGESUND_STOP = 'NSR:StopPlace:26090';
export const MAX_DAY_OFFSET = 7;

export const query = `query departures($stopId: String!, $n: Int!, $startTime: DateTime!) {
  stopPlace(id: $stopId) {
    estimatedCalls(numberOfDepartures: $n, timeRange: 86400, startTime: $startTime) {
      expectedDepartureTime
      destinationDisplay { frontText }
      serviceJourney {
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
          bookingArrangements { latestBookingTime bookingMethods }
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

export function filterRoute(calls, direction, targetDate) {
  return calls.filter((c) => {
    const dest = c.destinationDisplay.frontText.toLowerCase();
    const dirMatch =
      direction === 'to-haugesund' ? dest.includes('haugesund') : dest.includes('røvær');
    return dirMatch && toOsloDate(new Date(c.expectedDepartureTime)) === targetDate;
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

export function getRouteInfo(call) {
  const stops = call.serviceJourney.estimatedCalls;
  if (!stops || stops.length < 2) {
    const via = parseViaFromFrontText(call.destinationDisplay?.frontText || '');
    const { arrivalTime, duration } = getArrivalFromPassingTimes(call);
    return { arrivalTime, duration, via, hasBooking: false };
  }

  const first = new Date(stops[0].expectedDepartureTime);
  const last = new Date(stops[stops.length - 1].expectedDepartureTime);
  const duration = Math.round((last - first) / 60000);
  const via = stops.slice(1, -1).map((s) => s.quay.stopPlace.name.replace(' hurtigbåtkai', ''));
  const hasBooking = stops[0].bookingArrangements?.bookingMethods?.length > 0;

  return { arrivalTime: last, duration, via, hasBooking };
}

// --- notices ----------------------------------------------------------------

// Entur's own notices are Norwegian whatever the reader's language, so
// "bestill" always counts; each language adds its own words.
export function bookingPattern(bookingWords = []) {
  return new RegExp(['bestill', ...bookingWords].join('|'), 'i');
}

export function situationTexts(serviceJourney) {
  return (serviceJourney.situations || [])
    .map((s) => s.summary?.map((v) => v.value).join(' ') || '')
    .filter(Boolean);
}

// Bestillingsrute detection, in priority order: bookingArrangements from the
// API, then notice/situation text, then a soft notice on the last departure of
// the direction (booking data is unavailable ahead of today).
export function noticeState({ call, hasBooking, isLast, strings = {}, bookingRe }) {
  const notices = call.serviceJourney.notices || [];
  const texts = [...notices.map((n) => n.text), ...situationTexts(call.serviceJourney)];

  if (isLast && !hasBooking && !texts.some((t) => bookingRe.test(t))) texts.push(strings.lastNotice);
  if (hasBooking && !texts.some((t) => bookingRe.test(t))) texts.push(strings.bookingNotice);

  return {
    allTexts: texts,
    isBooking: hasBooking || texts.some((t) => bookingRe.test(t)),
    infoTexts: texts.filter((t) => !bookingRe.test(t)),
  };
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

export function kolumbusUrl(dateStr) {
  return (
    'https://reise.kolumbus.no/no/search' +
    `?fromId=${ROVAR_STOP}&toId=${HAUGESUND_STOP}&dateTime=${dateStr}T05:00:00.000Z`
  );
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

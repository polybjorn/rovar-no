// Which hours rows are past, split from scripts/past-hours.js so node --test
// can cover it without a DOM. Dates are ISO strings, so they compare as text.

// A row is past once its last day is over: on that day itself it still holds.
// `allPast` is false for a list with no dated rows, so it never claims that
// a list of prices is waiting for next season.
export function pastState(untils, today) {
  const past = untils.map((until) => until < today);
  return { past, allPast: past.length > 0 && past.every(Boolean) };
}

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// ISO date arithmetic in UTC, so no local clock or DST change moves a day.
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

// Whether a list of hours rows is open at a moment in Oslo, and if not, when
// it next opens. Rows are { days, from, until, open, close }: weekdays with
// Sunday 0, an optional first and last day, and 'HH:MM' hours. A row with no
// last day holds all year, and closing at '24:00' is midnight. `now` is
// minutes since Oslo midnight on `today`.
//
//   { state: 'open', row }                 open now, until row.close
//   { state: 'opens', row, date, inDays }  closed, opens on date at row.open
//   null                                   no opening left in these rows
//
// A row without a first day holds from today: "Hver dag ... til 16. august"
// says so itself, so the status claims no more than the card does.
export function hoursStatus(rows, today, now) {
  const applies = (row, date) =>
    (!row.from || row.from <= date) && (!row.until || date <= row.until) && row.days.includes(weekdayOf(date));

  const openNow = rows.filter(
    (row) => applies(row, today) && minutes(row.open) <= now && now < minutes(row.close)
  );
  if (openNow.length) {
    const row = openNow.reduce((a, b) => (minutes(b.close) > minutes(a.close) ? b : a));
    return { state: 'open', row };
  }

  // A week ahead finds the next opening of a row that holds all year.
  const last = rows.every((row) => row.until) ? rows.map((row) => row.until).sort().at(-1) : addDays(today, 7);
  for (let inDays = 0, date = today; last && date <= last; inDays += 1, date = addDays(today, inDays)) {
    const later = rows.filter((row) => applies(row, date) && (inDays > 0 || minutes(row.open) > now));
    if (later.length) {
      const row = later.reduce((a, b) => (minutes(b.open) < minutes(a.open) ? b : a));
      return { state: 'opens', row, date, inDays };
    }
  }
  return null;
}

// When the next departure from a list of departure rows leaves, as
// hoursStatus's 'opens' with the row's time in row.open, or null when none is
// left. Rows are { days, from, until, times, texts }, texts being the times
// as the page prints them. Each time is a moment, not a range, so a boat is
// never "open"; one leaving this minute is gone.
export function nextDeparture(rows, today, now) {
  const slots = rows.flatMap(({ times, texts = [], ...row }) =>
    times.map((time, i) => ({ ...row, open: time, close: time, openText: texts[i] }))
  );
  return hoursStatus(slots, today, now);
}

// Whether a status from hoursStatus or nextDeparture says nothing the card
// does not: closed, opening more than a week out on the first day of its
// row's season, where the row prints that day and its time. "Stengt nå.
// Åpner søndag 20. juni kl. 13.30." under "Søndag og torsdag: kl. 13.30 -
// 15.30, 20. juni - 29. august" only repeats it. Within the week the status
// still says "this Sunday", and a "til 16. august" row does not print its
// first day (row.fromShown false), so both keep theirs.
export function repeatsRow(status) {
  return status?.state === 'opens' && status.inDays >= 7 && Boolean(status.row.fromShown)
    && status.date === status.row.from;
}

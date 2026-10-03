import { toOsloDate, osloMinutes } from './departures-core.js';
import { pastState, hoursStatus, nextDeparture } from './past-hours-core.js';

// Strikes through the hours rows whose dates are over (data-until, set from
// the season data by remark-content), and once every dated row in a list is
// over, says so under it. Done in the browser so a page built in July is
// still right in October without a rebuild.
//
// While the season lasts it says instead whether the place is open now, or
// when it next opens, from the rows' days and hours (data-days and friends).
// Checked again every minute, so a page left open turns at closing time.
// A list of departures says instead when the next one leaves.
const note = document.body.dataset.pastNote;
const strings = JSON.parse(document.body.dataset.hoursStatus ?? '{}');
const intl = document.body.dataset.intl;

const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');

// "torsdag" within the week, "søndag 20. juni" beyond it, as the language
// writes them.
function dayName(date, inDays) {
  const options = inDays < 7 ? { weekday: 'long' } : { weekday: 'long', day: 'numeric', month: 'long' };
  return new Intl.DateTimeFormat(intl, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

// With one hours row its closing time is printed just above, so "open now"
// says no more; with several it says which one holds today.
function statusText(status, rowCount) {
  if (!status) return null;
  const { row, inDays } = status;
  if (status.state === 'open') {
    return rowCount === 1 ? strings.openNowPlain : fill(strings.openNow, { time: row.closeText });
  }
  if (inDays === 0) return fill(strings.opensToday, { time: row.openText });
  if (inDays === 1) return fill(strings.opensTomorrow, { time: row.openText });
  return fill(strings.opensOn, { time: row.openText, day: dayName(status.date, inDays) });
}

function departureText(status) {
  if (!status) return null;
  const { row, inDays } = status;
  if (inDays === 0) return fill(strings.departsToday, { time: row.openText });
  if (inDays === 1) return fill(strings.departsTomorrow, { time: row.openText });
  return fill(strings.departsOn, { time: row.openText, day: dayName(status.date, inDays) });
}

function update() {
  const now = new Date();
  const today = toOsloDate(now);
  const minutes = osloMinutes(now);

  for (const list of document.querySelectorAll('.fact-list')) {
    const rows = [...list.querySelectorAll(':scope > li[data-until]')];
    const { past, allPast } = pastState(rows.map((row) => row.dataset.until), today);
    rows.forEach((row, i) => row.classList.toggle('past', past[i]));

    const old = list.nextElementSibling;
    if (old?.matches('.fact-past-note, .fact-status')) old.remove();

    const p = document.createElement('p');
    if (allPast) {
      if (!note) continue;
      p.className = 'fact-past-note';
      p.textContent = note;
    } else {
      const hours = [...list.querySelectorAll(':scope > li[data-open]')]
        .map(({ dataset: d }) => ({
          days: d.days.split(',').map(Number),
          from: d.from,
          until: d.until,
          open: d.open,
          close: d.close,
          openText: d.openText,
          closeText: d.closeText,
        }));
      const departures = [...list.querySelectorAll(':scope > li[data-departures]')]
        .map(({ dataset: d }) => ({
          days: d.days.split(',').map(Number),
          from: d.from,
          until: d.until,
          times: d.departures.split(','),
          texts: d.departureTexts.split(','),
        }));
      let status = null;
      let text = null;
      if (hours.length) {
        status = hoursStatus(hours, today, minutes);
        text = statusText(status, hours.length);
      } else if (departures.length) {
        status = nextDeparture(departures, today, minutes);
        text = departureText(status);
      }
      if (!text) continue;
      p.className = 'fact-status';
      p.dataset.state = status.state;
      p.textContent = text;
    }
    list.after(p);
  }
}

update();
setInterval(update, 60 * 1000);

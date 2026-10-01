// The calendar picker: a dialog of its own beside the departure board, so the
// board stays a timetable with no controls on its rows. The reader chooses
// specific dates or every week, which day, and ticks departures in either
// direction; the file holds only those. Everything a file says is built in
// departures-core.js; this end is the dialog and the download.
import {
  ENTUR_API,
  ENTUR_CLIENT,
  ROVAR_STOP,
  HAUGESUND_STOP,
  FEED_WINDOW_DAYS,
  WEEKDAYS,
  query,
  osloMidnight,
  osloMinutes,
  osloClock,
  osloWeekday,
  toOsloDate,
  dateAtOffset,
  dayKind,
  bookingPattern,
  feedEvents,
  collectEvents,
  nextDateOfKind,
  icsCalendar,
  googleCalendarUrl,
} from './departures-core.js';

const page = document.querySelector('.dep-page');
const S = JSON.parse(page?.dataset.strings || '{}');
const dialog = document.getElementById('cal-dialog');
const byId = (id) => document.getElementById(id);

// How far ahead the date strip reaches for a one-off pick. The timetable
// itself runs much further; a strip of two weeks is what fits a phone.
const DATE_STRIP_DAYS = 14;

const state = {
  freq: 'once',
  date: toOsloDate(new Date()),
  kind: 'weekday',
  weekdays: new Set(WEEKDAYS),
};

// Picks by key: a one-off pick is its event's UID, a weekly pick its kind of
// day, direction and clock time - the same boat every week, whichever week's
// row it was ticked on.
const picks = new Map();

// The whole published timetable, fetched when the dialog first opens: about
// a megabyte per stop before compression, worth it only when asked for.
let timetable = null;
let loading = null;
let failed = false;

const icon = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M4 12h14M12 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"/></svg>',
};

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML.replace(/"/g, '&quot;');
}

const fmt = (dt) => osloClock(dt, S.locale);
const fill = (template, tokens) =>
  Object.entries(tokens).reduce((text, [k, v]) => text.replaceAll(`{{${k}}}`, v), template ?? '');
const dateOf = (event) => toOsloDate(event.start);
const weekdayOf = (date) => osloWeekday(`${date}T12:00:00Z`);
const today = () => toOsloDate(new Date());
const weeklyKey = (event) =>
  `weekly ${dayKind(weekdayOf(dateOf(event)))} ${event.direction} ${osloMinutes(event.start)}`;
const keyOf = (event) => (state.freq === 'weekly' ? weeklyKey(event) : event.uid);

async function fetchStop(stopId) {
  const res = await fetch(ENTUR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ENTUR_CLIENT },
    body: JSON.stringify({
      query,
      variables: { stopId, n: FEED_WINDOW_DAYS * 20, startTime: osloMidnight(0), timeRange: FEED_WINDOW_DAYS * 86400 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data.stopPlace.estimatedCalls;
}

function load() {
  loading ??= Promise.all([fetchStop(ROVAR_STOP), fetchStop(HAUGESUND_STOP)])
    .then(([rovar, haugesund]) => {
      timetable = feedEvents(
        [
          { calls: rovar, direction: 'to-haugesund' },
          { calls: haugesund, direction: 'to-rovar' },
        ],
        {
          strings: S,
          locale: S.locale,
          bookingRe: bookingPattern(),
          url: `${location.origin}${location.pathname}`,
        }
      );
      // Late in the evening today has nothing left to pick; start tomorrow.
      const now = new Date();
      if (state.date === today() && !timetable.some((e) => dateOf(e) === state.date && e.start > now)) {
        state.date = toOsloDate(dateAtOffset(1));
      }
    })
    .catch(() => {
      failed = true;
      loading = null;
    })
    .finally(render);
  return loading;
}

// The day whose departures the dialog lists: the chosen date for a one-off
// pick, or the next real day of the chosen kind for a weekly one.
function shownDate() {
  if (state.freq === 'once') return state.date;
  return timetable ? nextDateOfKind(timetable, state.kind, today()) : null;
}

function shownRows() {
  const date = shownDate();
  if (!timetable || !date) return [];
  return timetable.filter((e) => dateOf(e) === date);
}

function result() {
  if (!timetable) return [];
  const values = [...picks.values()];
  return collectEvents(
    values.filter((p) => p.freq === 'once').map((p) => p.event),
    values.filter((p) => p.freq === 'weekly').map((p) => p.event),
    timetable,
    today(),
    [...state.weekdays]
  );
}

// --- rendering ---------------------------------------------------------------

function setPressed(container, attr, isOn) {
  container?.querySelectorAll(`[data-${attr}]`).forEach((b) =>
    b.setAttribute('aria-pressed', String(isOn(b.dataset[attr])))
  );
}

function reveal(el, open) {
  if (!el) return;
  el.classList.toggle('is-open', open);
  el.inert = !open;
}

function renderDates() {
  const strip = byId('cal-dates');
  if (!strip) return;
  const picked = new Set([...picks.values()].filter((p) => p.freq === 'once').map((p) => dateOf(p.event)));
  const days = Array.from({ length: DATE_STRIP_DAYS }, (_, i) => toOsloDate(dateAtOffset(i)));
  strip.innerHTML = days
    .map((date) => {
      const d = new Date(`${date}T12:00:00Z`);
      const wd = d.toLocaleDateString(S.locale, { weekday: 'short', timeZone: 'UTC' });
      const weekend = dayKind(weekdayOf(date)) !== 'weekday';
      const cls = [weekend && 'is-weekend', picked.has(date) && 'has-pick'].filter(Boolean).join(' ');
      return `<button type="button" data-date="${date}" class="${cls}" aria-pressed="${date === state.date}">
        <span class="cal-date-wd">${esc(wd)}</span><span class="cal-date-d">${d.getUTCDate()}</span>
      </button>`;
    })
    .join('');
  strip.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderTimes() {
  const lists = [...(byId('cal-times')?.querySelectorAll('[data-list]') ?? [])];
  if (!lists.length) return;
  const note = (text) => `<li class="cal-times-note">${esc(text)}</li>`;
  const rows = shownRows();
  const now = new Date();
  for (const list of lists) {
    if (!timetable) {
      list.innerHTML = note(failed ? S.error : S.pickLoading);
      continue;
    }
    const mine = rows.filter((e) => e.direction === list.dataset.list);
    list.innerHTML = mine.length ? mine.map((e) => row(e, now)).join('') : note(S.empty);
  }
  requestAnimationFrame(measureVia);
}

// A via list wider than its row gets the distance and time to pan to its end,
// at an even reading pace whatever its length.
function measureVia() {
  byId('cal-times')?.querySelectorAll('.cal-via').forEach((box) => {
    const over = box.firstElementChild.scrollWidth - box.clientWidth;
    box.classList.toggle('is-long', over > 0);
    box.style.setProperty('--pan', `${-over}px`);
    box.style.setProperty('--pan-time', `${(1.5 + over / 30).toFixed(1)}s`);
  });
}

function row(e, now) {
  // A boat that has sailed cannot be taken once, but a weekly pick only
  // borrows the row for its clock time, so there it stays pickable.
  const gone = state.freq === 'once' && e.start <= now;
  const on = picks.has(keyOf(e));
  const via = e.via?.length
    ? `<span class="cal-via"><span class="cal-via-text">via ${esc(e.via.join(', '))}</span></span>`
    : '';
  return `<li><button type="button" class="cal-time" data-uid="${esc(e.uid)}" aria-pressed="${on}"${gone ? ' disabled' : ''}>
    <span class="cal-check" aria-hidden="true"></span>
    <span class="cal-dep">${esc(fmt(e.start))}</span>
    ${e.end ? `${icon.arrow}<span class="cal-arr">${esc(fmt(e.end))}</span>` : ''}
    ${via}
    ${e.isBooking ? `<span class="cal-booking" role="img" aria-label="${esc(S.bookLabel)}">${icon.phone}</span>` : ''}
  </button></li>`;
}

function chipWhen(pick) {
  const { event } = pick;
  if (pick.freq === 'once') {
    return event.start.toLocaleDateString(S.locale, {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Oslo',
    });
  }
  const kind = dayKind(weekdayOf(dateOf(event)));
  if (kind !== 'weekday') {
    return fill(S.pickEvery, {
      day: event.start.toLocaleDateString(S.locale, { weekday: 'long', timeZone: 'Europe/Oslo' }),
    });
  }
  if (state.weekdays.size === WEEKDAYS.length) return S.pickEveryWeekday;
  return [...state.weekdays]
    .sort()
    .map((i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(S.locale, { weekday: 'short', timeZone: 'UTC' }))
    .join(', ');
}

function renderFooter() {
  const chosen = byId('cal-chosen');
  const values = [...picks.entries()].sort(([, a], [, b]) => a.event.start - b.event.start);
  if (chosen) {
    chosen.hidden = !values.length;
    chosen.innerHTML = values
      .map(([key, pick]) => {
        const when = chipWhen(pick);
        const label = `${when} ${fmt(pick.event.start)} ${pick.event.from}-${pick.event.to}`;
        return `<li>
          <span class="cal-chip-when">${esc(when)}</span>
          <span class="cal-chip-time">${esc(fmt(pick.event.start))}</span>
          <span class="cal-chip-to">${icon.arrow}${esc(pick.event.to)}</span>
          <button type="button" data-key="${esc(key)}" aria-label="${esc(`${S.pickRemove} ${label}`)}">${icon.close}</button>
        </li>`;
      })
      .join('');
  }

  const events = result();
  const summary = byId('cal-summary');
  if (summary) {
    const weekly = values.some(([, p]) => p.freq === 'weekly');
    const last = events.at(-1);
    // Nothing picked needs no sentence: the greyed button already says it.
    summary.hidden = !values.length;
    summary.textContent = !values.length
      ? ''
      : fill(weekly ? S.pickSummaryUntil : events.length === 1 ? S.pickSummaryOne : S.pickSummary, {
          count: events.length,
          date: last
            ? last.start.toLocaleDateString(S.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })
            : '',
        });
  }
  const save = byId('cal-save');
  if (save) save.disabled = !events.length;
  const google = byId('cal-google');
  if (google) {
    // A link carries one event, so anything more goes by download only.
    google.hidden = events.length !== 1;
    if (events.length === 1) google.href = googleCalendarUrl(events[0]);
  }
}

// The shared cell of the two pick panels takes the shown one's height; the
// CSS animates the change. Without animate, as when the dialog opens, it jumps.
function sizeWhen(animate = true) {
  const cell = dialog?.querySelector('.cal-when');
  const shown = byId(state.freq === 'once' ? 'cal-when-once' : 'cal-when-weekly');
  if (!cell || !shown || !dialog.open) return;
  if (!animate) cell.style.transition = 'none';
  cell.style.height = `${shown.offsetHeight}px`;
  if (!animate) {
    cell.offsetHeight; // commit the height before the transition comes back
    cell.style.transition = '';
  }
}

function render() {
  setPressed(byId('cal-freq'), 'freq', (v) => v === state.freq);
  setPressed(byId('cal-kind'), 'kind', (v) => v === state.kind);
  setPressed(byId('cal-weekdays'), 'day', (v) => state.weekdays.has(Number(v)));
  // The sliding white pill under a segmented control follows its choice.
  for (const [id, attr, value] of [
    ['cal-freq', 'freq', state.freq],
    ['cal-kind', 'kind', state.kind],
  ]) {
    const seg = byId(id);
    const buttons = [...(seg?.querySelectorAll(`[data-${attr}]`) ?? [])];
    seg?.style.setProperty('--seg', String(buttons.findIndex((b) => b.dataset[attr] === value)));
  }
  reveal(byId('cal-when-once'), state.freq === 'once');
  reveal(byId('cal-when-weekly'), state.freq === 'weekly');
  reveal(byId('cal-weekdays-wrap'), state.freq === 'weekly' && state.kind === 'weekday');
  sizeWhen();
  renderDates();
  renderTimes();
  renderFooter();
}

// --- download ----------------------------------------------------------------

function download(events) {
  const ics = icsCalendar(events, { method: 'PUBLISH' });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = events.length === 1
    ? `rutebaten-${dateOf(events[0])}-${fmt(events[0].start).replace(':', '')}.ics`
    : 'rutebaten.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later rather than at once: Safari reads the blob after the click
  // returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- wiring ------------------------------------------------------------------

function open() {
  if (!dialog) return;
  render();
  dialog.showModal();
  sizeWhen(false);
  document.documentElement.classList.add('cal-open');
  load();
}

// The dialog is held open until its closing animation ends; see the CSS.
function close() {
  if (!dialog?.open || dialog.classList.contains('is-closing')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    dialog.close();
    return;
  }
  dialog.classList.add('is-closing');
  const done = () => {
    clearTimeout(fallback);
    dialog.removeEventListener('animationend', onEnd);
    dialog.classList.remove('is-closing');
    dialog.close();
  };
  const onEnd = (e) => { if (e.target === dialog) done(); };
  // In case no animation runs at all, such as in a background tab.
  const fallback = setTimeout(done, 400);
  dialog.addEventListener('animationend', onEnd);
}

function finish() {
  picks.clear();
  close();
}

dialog?.addEventListener('close', () => document.documentElement.classList.remove('cal-open'));
// Escape goes through the same animation as the close button.
dialog?.addEventListener('cancel', (e) => {
  e.preventDefault();
  close();
});
// A tap on the backdrop closes, as it does on every phone sheet; the dialog
// box itself fills the element, so only the backdrop reports the dialog.
dialog?.addEventListener('click', (e) => {
  if (e.target === dialog) close();
});

// A scrollbar shows while its part moves and fades a moment after; see .cal-scroll.
dialog?.querySelectorAll('.cal-scroll').forEach((el) => {
  let timer;
  el.addEventListener('scroll', () => {
    el.classList.add('is-scrolling');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('is-scrolling'), 800);
  }, { passive: true });
});

addEventListener('resize', () => {
  if (!dialog?.open) return;
  measureVia();
  sizeWhen(false);
});

byId('cal-open')?.addEventListener('click', open);
byId('cal-close')?.addEventListener('click', close);

const onPick = (id, attr, apply) =>
  byId(id)?.addEventListener('click', (e) => {
    const button = e.target.closest(`[data-${attr}]`);
    if (!button || button.disabled) return;
    apply(button.dataset[attr]);
    render();
  });

onPick('cal-freq', 'freq', (v) => { state.freq = v; });
onPick('cal-kind', 'kind', (v) => { state.kind = v; });
onPick('cal-dates', 'date', (v) => { state.date = v; });
onPick('cal-weekdays', 'day', (v) => {
  const day = Number(v);
  if (state.weekdays.has(day)) state.weekdays.delete(day);
  else state.weekdays.add(day);
});
onPick('cal-times', 'uid', (uid) => {
  const event = shownRows().find((e) => e.uid === uid);
  if (!event) return;
  const key = keyOf(event);
  if (picks.has(key)) picks.delete(key);
  else picks.set(key, { freq: state.freq, event });
});
onPick('cal-chosen', 'key', (key) => { picks.delete(key); });

byId('cal-save')?.addEventListener('click', () => {
  const events = result();
  if (!events.length) return;
  download(events);
  finish();
});
byId('cal-google')?.addEventListener('click', () => {
  // The link has already been followed by the time this runs.
  setTimeout(finish);
});

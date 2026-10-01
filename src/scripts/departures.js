// Browser side of the departure board: fetch, markup, events. The logic it
// runs on - time handling, Entur's fallbacks, booking detection, calendar
// arithmetic - lives in departures-core.js, which has no DOM and is covered by
// test/departures.test.mjs.
//
// All display strings come from the page: the departure board renders them
// into data-strings from the language's UI catalog (src/i18n/ui/<lang>.json),
// so only the active language ships to the browser.
import {
  ENTUR_API,
  ENTUR_CLIENT,
  ROVAR_STOP,
  HAUGESUND_STOP,
  MAX_DAY_OFFSET,
  query,
  toOsloDate,
  dateAtOffset,
  osloMidnight,
  osloMinutes,
  osloClock,
  filterRoute,
  getRouteInfo,
  bookingPattern,
  noticeState,
  timeline,
  formatCountdown,
  urgencyClass,
  kolumbusUrl,
  departureEvent,
  icsCalendar,
  googleCalendarUrl,
  feedEvents,
  weeklyEvents,
  dayKind,
  osloWeekday,
  WEEKDAYS,
  FEED_WINDOW_DAYS,
  monthDays,
  monthNav,
  offsetOf,
  shiftMonth,
  weekdayNames,
} from './departures-core.js';

const depPage = document.querySelector('.dep-page');
const LANG = depPage?.dataset.lang || 'no';
const S = JSON.parse(depPage?.dataset.strings || '{}');

const BOOKING_RE = bookingPattern();

let dayOffset = 0;

async function fetchDepartures(stopId, startTime) {
  const res = await fetch(ENTUR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": ENTUR_CLIENT
    },
    body: JSON.stringify({ query, variables: { stopId, n: 20, startTime, timeRange: 86400 } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data.stopPlace.estimatedCalls;
}

function fmt(dt) {
  return osloClock(dt, S.locale);
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function selectedDate() {
  return toOsloDate(dateAtOffset(dayOffset));
}

// Last markup rendered per direction, keyed by row, so a 60s refresh can tell
// a row that changed from one that is simply being redrawn. Cleared whenever
// the board is wiped (empty day, error), so the next list counts as new.
const prevRows = new Map();

// --- pick mode ---------------------------------------------------------------
// No control on the rows and no feed of every crossing: the reader turns pick
// mode on, taps the departures they mean to take, across as many days as they
// like, and takes only those to their calendar. Picks are keyed by event UID,
// so they survive the day changing and the 60s refresh redrawing the rows.
let picking = false;
const picks = new Map();
// The event behind every departure row drawn so far, by UID.
const rowEvents = new Map();
// Repeating weekly needs the whole published timetable, which the board never
// loads, so it is fetched when the switch is first turned on: about a megabyte
// per stop, worth it only when asked for.
let weekly = false;
// Which weekdays a weekday pick repeats on. All five unless narrowed.
const weekdayChoice = new Set(WEEKDAYS);
let timetable = null;
let timetableEvents = null;
let timetableFailed = false;

const closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>';
const smallArrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M4 12h14M12 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function fetchTimetable(stopId) {
  const res = await fetch(ENTUR_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ET-Client-Name": ENTUR_CLIENT },
    body: JSON.stringify({
      query,
      variables: { stopId, n: FEED_WINDOW_DAYS * 20, startTime: osloMidnight(0), timeRange: FEED_WINDOW_DAYS * 86400 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data.stopPlace.estimatedCalls;
}

function loadTimetable() {
  timetable ??= Promise.all([fetchTimetable(ROVAR_STOP), fetchTimetable(HAUGESUND_STOP)])
    .then(([rovar, haugesund]) => {
      timetableEvents = feedEvents(
        [
          { calls: rovar, direction: "to-haugesund" },
          { calls: haugesund, direction: "to-rovar" },
        ],
        { strings: S, locale: S.locale, bookingRe: BOOKING_RE, url: `${location.origin}${location.pathname}` }
      );
    })
    .catch(() => {
      timetableFailed = true;
      timetable = null;
    })
    .finally(() => syncPicks());
  return timetable;
}

const sortedPicks = () => [...picks.values()].sort((a, b) => a.start - b.start);

// What the download would hold right now, or null while the timetable a
// weekly repeat needs is still on its way.
function pickedEvents() {
  if (!weekly) return sortedPicks();
  if (!timetableEvents) return null;
  return weeklyEvents(sortedPicks(), timetableEvents, toOsloDate(new Date()), [...weekdayChoice]);
}

const fill = (template, tokens) =>
  Object.entries(tokens).reduce((text, [k, v]) => text.replaceAll(`{{${k}}}`, v), template ?? '');

// One pick as the sheet lists it: when, what time, where to.
const weekdayOf = (date) => osloWeekday(`${date}T12:00:00Z`);
const shownKind = () => dayKind(weekdayOf(selectedDate()));
const shortDay = (i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(S.locale, { weekday: "short", timeZone: "UTC" });

function weeklyWhen(event) {
  if (dayKind(weekdayOf(toOsloDate(event.start))) !== 'weekday') {
    return fill(S.pickEvery, { day: event.start.toLocaleDateString(S.locale, { weekday: "long", timeZone: "Europe/Oslo" }) });
  }
  return weekdayChoice.size === WEEKDAYS.length
    ? S.pickEveryWeekday
    : [...weekdayChoice].sort().map(shortDay).join(", ");
}

function pickItem(event) {
  const when = weekly
    ? weeklyWhen(event)
    : event.start.toLocaleDateString(S.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Oslo" });
  const label = `${when} ${fmt(event.start)} ${event.from}-${event.to}`;
  return `<li>
    <span class="dep-pick-when">${esc(when)}</span>
    <span class="dep-pick-time">${esc(fmt(event.start))}</span>
    <span class="dep-pick-to">${smallArrow}${esc(event.to)}</span>
    <button type="button" data-uid="${esc(event.uid)}" aria-label="${esc(`${S.pickRemove ?? ''} ${label}`.trim())}">${closeIcon}</button>
  </li>`;
}

// A part of the sheet that slides open and shut. Inert while shut, so its
// buttons are out of the tab order and the accessibility tree.
function reveal(el, open) {
  if (!el) return;
  el.classList.toggle('is-open', open);
  el.inert = !open;
}

function syncPicks(root = document) {
  root.querySelectorAll('.dep-list li[data-uid]').forEach(li => {
    const pickable = picking && !li.classList.contains('passed');
    li.classList.toggle('is-picked', pickable && picks.has(li.dataset.uid));
    if (pickable) {
      li.setAttribute('role', 'checkbox');
      li.setAttribute('aria-checked', String(picks.has(li.dataset.uid)));
      li.tabIndex = 0;
    } else {
      li.removeAttribute('role');
      li.removeAttribute('aria-checked');
      li.removeAttribute('tabindex');
    }
  });
  if (root !== document) return;

  depPage?.classList.toggle('is-picking', picking);
  const byId = (id) => document.getElementById(id);
  const start = byId('dep-pick-start');
  const bar = byId('dep-pick-bar');
  if (start) start.hidden = picking;
  if (bar) bar.hidden = !picking;

  const count = byId('dep-pick-count');
  if (count) {
    count.hidden = !picks.size;
    count.textContent = String(picks.size);
  }
  const hint = byId('dep-pick-hint');
  if (hint) hint.hidden = picks.size > 0;
  const list = byId('dep-pick-list');
  if (list) {
    list.hidden = !picks.size;
    list.innerHTML = sortedPicks().map(pickItem).join('');
  }
  const toggle = byId('dep-pick-weekly');
  if (toggle) toggle.checked = weekly;
  if (hint) hint.textContent = weekly ? S.pickHintWeekly : S.pickHint;
  reveal(byId('dep-pick-kinds'), weekly);
  const kind = shownKind();
  const segs = [...document.querySelectorAll('#dep-pick-seg button')];
  segs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  byId('dep-pick-seg')?.style.setProperty('--seg', String(segs.findIndex(b => b.dataset.kind === kind)));
  reveal(byId('dep-pick-days-wrap'), kind === 'weekday');
  document.querySelectorAll('#dep-pick-days button').forEach(b =>
    b.setAttribute('aria-pressed', String(weekdayChoice.has(Number(b.dataset.day))))
  );

  const events = picks.size ? pickedEvents() : [];
  const note = byId('dep-pick-note');
  if (note) {
    const last = events?.at(-1);
    note.textContent = !weekly || !picks.size ? ''
      : timetableFailed ? S.error
      : !events ? S.pickLoading
      : fill(S.pickWeeklyNote, {
          count: events.length,
          date: last.start.toLocaleDateString(S.locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Oslo" }),
        });
    note.hidden = !note.textContent;
  }
  const save = byId('dep-pick-save');
  if (save) save.disabled = !events?.length;
  const google = byId('dep-pick-google');
  if (google) {
    // A link carries one event, so a repeat goes by download only.
    const single = events?.length === 1 ? events[0] : null;
    google.hidden = !single;
    if (single) google.href = googleCalendarUrl(single);
  }
}

function setPicking(on) {
  picking = on;
  if (on) {
    // The circles grow in once, on entering; a refresh redraws without them
    // animating again.
    depPage?.classList.add('pick-enter');
    setTimeout(() => depPage?.classList.remove('pick-enter'), 400);
  } else {
    picks.clear();
    weekly = false;
    WEEKDAYS.forEach(d => weekdayChoice.add(d));
  }
  syncPicks();
}

function togglePick(uid) {
  if (picks.has(uid)) picks.delete(uid);
  else if (rowEvents.has(uid)) picks.set(uid, rowEvents.get(uid));
  syncPicks();
}

function setWeekly(on) {
  weekly = on;
  if (weekly && !timetableEvents) {
    timetableFailed = false;
    loadTimetable();
  }
  syncPicks();
}

// Move the board to the next day of a kind. Today counts only while it still
// has a boat to pick; otherwise the same weekday a week on, which the board
// reaches (MAX_DAY_OFFSET is 7).
async function showKind(kind) {
  if (shownKind() === kind) return;
  for (let offset = 0; offset <= MAX_DAY_OFFSET; offset++) {
    if (dayKind(weekdayOf(toOsloDate(dateAtOffset(offset)))) !== kind) continue;
    dayOffset = offset;
    await loadAll(true);
    if (offset === 0 && !document.querySelector(".dep-list li[data-uid]:not(.passed)")) {
      dayOffset = 7;
      await loadAll(true);
    }
    return;
  }
}

// Everything the file says is built in departures-core.js; this end only
// names the file and hands it to the browser.
function downloadPicks() {
  const events = pickedEvents();
  if (!events?.length) return;
  const ics = icsCalendar(events, { method: 'PUBLISH' });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = events.length === 1
    ? `rutebaten-${toOsloDate(events[0].start)}-${fmt(events[0].start).replace(':', '')}.ics`
    : 'rutebaten.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later rather than at once: Safari reads the blob after the click
  // returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setNoticeOpen(detail, isOpen) {
  detail.classList.toggle('open', isOpen);
  detail.closest('li').querySelectorAll('.dep-notice').forEach(b =>
    b.setAttribute('aria-expanded', String(isOpen))
  );
}

function render(containerId, calls, fresh, direction) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!calls.length) {
    prevRows.delete(containerId);
    container.innerHTML = `<div class="dep-empty">${esc(S.empty)}</div>`;
    return;
  }

  const nowMinutes = osloMinutes(new Date());
  let nextFound = false;

  const phoneIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"/></svg>';
  const infoIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
  const clockIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2" stroke-linecap="round"/></svg>';
  // Drawn rather than the U+2192 character: Barlow has no arrow glyph, so a
  // text arrow falls back to a system font and sits off the line on Android.
  const arrowIcon = '<svg class="dep-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M4 12h14M12 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const rows = calls.map((c, i) => {
    const dt = new Date(c.expectedDepartureTime);
    const time = fmt(dt);
    const { arrivalTime, duration, via, hasBooking, bookingDeadline } = getRouteInfo(c);
    const { isBooking, infoTexts } = noticeState({
      call: c,
      hasBooking,
      isLast: i === calls.length - 1,
      bookingRe: BOOKING_RE,
    });
    const event = departureEvent(c, {
      direction,
      strings: S,
      locale: S.locale,
      isLast: i === calls.length - 1,
      bookingRe: BOOKING_RE,
      url: `${location.origin}${location.pathname}`,
    });
    rowEvents.set(event.uid, event);
    // A refresh that moved a picked departure moves the pick with it.
    if (picks.has(event.uid)) picks.set(event.uid, event);

    const depMinutes = osloMinutes(dt);
    const passed = dayOffset === 0 && depMinutes < nowMinutes;
    let cls = passed ? "passed" : "";
    let isNext = false;
    if (dayOffset === 0 && !passed && !nextFound) {
      cls = "next";
      isNext = true;
      nextFound = true;
    }

    const arrHtml = arrivalTime ? `${arrowIcon}<span class="dep-arr">${esc(fmt(arrivalTime))}</span>` : '';
    const viaHtml = via.length ? `<span class="dep-via">via ${esc(via.join(', '))}</span>` : '';
    const durationHtml = duration ? `<span class="dep-duration">${duration} min</span>` : '';

    // The phone is a marker, not a control: the legend under the board explains
    // it once and the deadline row gives the time, so there is nothing left for
    // it to open. Only real notices from Entur get an expandable button.
    let noticeHtml = '';
    const noticeId = `notice-${containerId}-${i}`;
    if (isBooking) {
      noticeHtml = `<span class="dep-notice dep-booking-mark" role="img" aria-label="${esc(S.bookLabel)}">${phoneIcon}</span>`;
    }
    if (infoTexts.length) {
      noticeHtml += `<button class="dep-notice dep-info-notice" aria-expanded="false" aria-controls="${noticeId}" aria-label="${esc(S.infoLabel)}">${infoIcon}</button>`;
    }
    const detailHtml = infoTexts.length ? `<div class="dep-detail" id="${noticeId}"><div class="dep-detail-inner">${esc(infoTexts.join(' '))}</div></div>` : '';

    // Only the next departure carries a countdown, in the row's right-hand
    // column so a long via list can never stretch the line.
    // Urgency is colour on top of the wording, never colour alone: the text
    // says the same thing for anyone who cannot see the difference.
    const mins = depMinutes - nowMinutes;
    const countdownHtml = isNext
      ? `<p class="dep-countdown${urgencyClass(mins)}">${esc(formatCountdown(mins, S))}</p>`
      : '';

    // html and base are the same row with and without the countdown, so a
    // refresh can tell a countdown tick (base equal, html not) from a change
    // to the rest of the row and fade only what moved.
    // The pick state is not in the markup, so picking a row never reads as a
    // change to it; syncPicks lays it on after every render.
    const rowHtml = (countdown) => `<li class="${cls}" data-uid="${esc(event.uid)}">
      <div class="dep-row">
        <div class="dep-route">
          <span class="dep-time">${esc(time)}</span>${arrHtml}${viaHtml}
        </div>
        <div class="dep-info">
          ${noticeHtml}${durationHtml}${countdown}
        </div>
      </div>
      ${detailHtml}
    </li>`;

    return {
      minutes: depMinutes,
      // Only a departure that is actually a bestillingsrute gets a deadline row.
      deadlineMinutes: isBooking && bookingDeadline ? osloMinutes(bookingDeadline) : null,
      deadlineText: bookingDeadline ? fmt(bookingDeadline) : '',
      time,
      html: rowHtml(countdownHtml),
      base: rowHtml(''),
    };
  });

  // A deadline row is greyed once it is past, exactly like a departure that has
  // already sailed: same timeline, same way of showing a moment has gone.
  const items = timeline(rows).map((row) => {
    if (row.type === 'departure') {
      const dep = rows[row.index];
      return { key: `dep-${dep.time}`, html: dep.html, base: dep.base };
    }
    const dep = rows[row.forIndex];
    const gone = dayOffset === 0 && row.minutes < nowMinutes;
    const label = (S.bookingDeadlineRow ?? '{{time}}').replace('{{time}}', dep.time);
    const html = `<li class="dep-deadline-row${gone ? ' passed' : ''}">
      <span class="dep-deadline-time">${esc(dep.deadlineText)}</span>
      ${clockIcon}<span class="dep-deadline-label">${esc(label)}</span>
    </li>`;
    // No countdown here, so any change is a row change.
    return { key: `dl-${dep.time}`, html, base: html };
  });

  // What a row looks like, without the UID: the same boat time on another day
  // has another UID but the same look, and should not be redrawn.
  const look = (html) => html.replace(/ data-uid="[^"]*"/, '');
  const uidOf = (html) => html.match(/ data-uid="([^"]*)"/)?.[1];
  const previous = prevRows.get(containerId);
  const list = container.querySelector('.dep-list');
  prevRows.set(containerId, items.map(i => ({ html: i.html, base: i.base })));

  if (!list || !previous) {
    // Nothing to build on (first load, or after an empty day or an error):
    // one short fade of the whole list.
    container.innerHTML = `<ul class="dep-list is-fresh">${items.map(i => i.html).join('')}</ul>`;
  } else {
    // Row by row against what is on screen, for a refresh and a day change
    // alike. A row that looks the same stays exactly as it is, so the times
    // that do not change between days never blink; a countdown that ticked
    // has only its own element swapped; a row that differs is replaced, with a
    // short fade only when the day changed.
    const lis = [...list.children];
    const build = (html) => {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      const li = t.content.firstElementChild;
      if (fresh) li.classList.add('is-new');
      return li;
    };
    items.forEach((item, i) => {
      const prev = previous[i];
      const li = lis[i];
      if (!li || !prev) {
        list.appendChild(build(item.html));
        return;
      }
      if (prev.html === item.html) return;
      const uid = uidOf(item.html);
      if (look(prev.html) === look(item.html)) {
        if (uid) li.dataset.uid = uid;
        return;
      }
      if (look(prev.base) === look(item.base)) {
        const now = build(item.html).querySelector('.dep-countdown');
        const tick = li.querySelector('.dep-countdown');
        if (tick && now) tick.replaceWith(now);
        else if (now) li.querySelector('.dep-info')?.appendChild(now);
        else tick?.remove();
        if (uid) li.dataset.uid = uid;
        return;
      }
      // An open notice stays open across the swap.
      const next = build(item.html);
      if (li.querySelector('.dep-detail.open') && next.querySelector('.dep-detail')) {
        setNoticeOpen(next.querySelector('.dep-detail'), true);
      }
      li.replaceWith(next);
    });
    lis.slice(items.length).forEach(li => li.remove());
  }
  syncPicks(container);
}

function setDate() {
  const el = document.getElementById("dep-date");
  if (!el) return;
  const d = dateAtOffset(dayOffset);
  const opts = { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Oslo" };
  const f = d.toLocaleDateString(S.locale, opts);
  el.textContent = f.charAt(0).toUpperCase() + f.slice(1);

  const prev = document.getElementById("dep-prev");
  const next = document.getElementById("dep-next");
  if (prev) prev.disabled = dayOffset <= 0;
  if (next) next.disabled = dayOffset >= MAX_DAY_OFFSET;

  if (!document.getElementById("dep-cal-pop")?.hidden) renderCalendar();

  const kolumbus = document.getElementById("kolumbus-link");
  if (kolumbus) kolumbus.href = kolumbusUrl(toOsloDate(d));
}

// A weekday has more boats than a weekend day, so a day change can grow or
// shrink a column by several rows. Measured before the change and animated
// to the new height after it, the column and everything under it glide
// instead of jumping.
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

function measure(ids) {
  const before = ids.map(id => document.getElementById(id)?.offsetHeight ?? 0);
  return () => ids.forEach((id, i) => {
    const el = document.getElementById(id);
    const after = el?.offsetHeight ?? 0;
    if (!el || !before[i] || before[i] === after || reduceMotion?.matches || !el.animate) return;
    el.style.overflow = "hidden";
    el.animate([{ height: `${before[i]}px` }, { height: `${after}px` }], { duration: 250, easing: "ease" })
      .finished.finally(() => { el.style.overflow = ""; });
  });
}

let lastLoad = 0;

// fresh: a new board (first load, day change) animates in. A background
// refresh passes false and only the rows that changed move.
async function loadAll(fresh = false) {
  setDate();
  ["from-rovar", "from-haugesund"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.querySelector(".dep-list")) {
      el.innerHTML = `<div class="dep-loading">${esc(S.loading)}</div>`;
    }
  });

  const startTime = osloMidnight(dayOffset);
  const targetDate = selectedDate();
  try {
    const [rovar, haugesund] = await Promise.all([
      fetchDepartures(ROVAR_STOP, startTime),
      fetchDepartures(HAUGESUND_STOP, startTime)
    ]);
    const glide = measure(["from-rovar", "from-haugesund"]);
    render("from-rovar", filterRoute(rovar, "to-haugesund", targetDate), fresh, "to-haugesund");
    render("from-haugesund", filterRoute(haugesund, "to-rovar", targetDate), fresh, "to-rovar");
    glide();
    // The sheet follows the board: the kind of day shown, and with it the
    // weekday row, change with the day.
    if (picking) syncPicks();
    lastLoad = Date.now();
  } catch (err) {
    ["from-rovar", "from-haugesund"].forEach(id => {
      prevRows.delete(id);
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="dep-error">${esc(S.error)}</div>`;
    });
  }
}

document.getElementById("dep-prev")?.addEventListener("click", () => {
  if (dayOffset > 0) { dayOffset--; loadAll(true); }
});
document.getElementById("dep-next")?.addEventListener("click", () => {
  if (dayOffset < MAX_DAY_OFFSET) { dayOffset++; loadAll(true); }
});

// Hand-rolled month grid rather than <input type="date">: the native picker
// takes its first-day-of-week from the browser's locale, so it starts weeks on
// Sunday for many visitors. This one is always Monday-first.

let calView = null;

function renderCalendar() {
  const pop = document.getElementById("dep-cal-pop");
  if (!pop) return;
  if (!calView) calView = selectedDate().slice(0, 7);

  const { lead, days, label } = monthDays(calView, { selected: selectedDate() });
  const { canPrev, canNext } = monthNav(calView);
  const monthLabel = label.toLocaleDateString(S.locale, {
    month: "long", year: "numeric", timeZone: "UTC"
  });

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="dep-cal-pad"></span>');
  for (const d of days) {
    const cls = ["dep-cal-day"];
    if (d.isSelected) cls.push("is-selected");
    if (d.isToday) cls.push("is-today");
    cells.push(
      `<button type="button" class="${cls.join(" ")}" data-date="${d.date}"${d.usable ? "" : " disabled"}${d.isSelected ? ' aria-current="date"' : ""}>${d.day}</button>`
    );
  }

  pop.innerHTML = `
    <div class="dep-cal-head">
      <button type="button" class="dep-cal-nav" data-step="-1" aria-label="${esc(S.prevMonth)}"${canPrev ? "" : " disabled"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span class="dep-cal-month">${esc(monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1))}</span>
      <button type="button" class="dep-cal-nav" data-step="1" aria-label="${esc(S.nextMonth)}"${canNext ? "" : " disabled"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>
    <div class="dep-cal-grid" role="grid">
      ${weekdayNames(S.locale).map(w => `<span class="dep-cal-wd">${esc(w)}</span>`).join("")}
      ${cells.join("")}
    </div>`;
}

function openCal() {
  const pop = document.getElementById("dep-cal-pop");
  if (!pop) return;
  calView = selectedDate().slice(0, 7);
  renderCalendar();
  pop.hidden = false;
  document.getElementById("dep-cal")?.setAttribute("aria-expanded", "true");
  pop.querySelector(".is-selected")?.focus();
}

function closeCal(refocus) {
  const pop = document.getElementById("dep-cal-pop");
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  const btn = document.getElementById("dep-cal");
  btn?.setAttribute("aria-expanded", "false");
  if (refocus) btn?.focus();
}

document.getElementById("dep-cal")?.addEventListener("click", () => {
  const pop = document.getElementById("dep-cal-pop");
  if (pop?.hidden) openCal(); else closeCal(false);
});

document.getElementById("dep-cal-pop")?.addEventListener("click", (e) => {
  const nav = e.target.closest(".dep-cal-nav");
  if (nav) {
    calView = shiftMonth(calView, Number(nav.dataset.step));
    renderCalendar();
    return;
  }
  const day = e.target.closest(".dep-cal-day");
  if (day && !day.disabled) {
    dayOffset = Math.min(MAX_DAY_OFFSET, Math.max(0, offsetOf(day.dataset.date)));
    closeCal(true);
    loadAll(true);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCal(true);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".dep-cal-wrap")) closeCal(false);
});

document.getElementById("dep-pick-start")?.addEventListener("click", () => {
  setPicking(true);
  // Late in the day every boat has sailed and nothing on the board can be
  // picked, which reads as a broken button. Start on the next day instead.
  const pickable = document.querySelector(".dep-list li[data-uid]:not(.passed)");
  if (!pickable && dayOffset < MAX_DAY_OFFSET) { dayOffset++; loadAll(true); }
  document.getElementById("dep-pick-bar")?.focus();
});
document.getElementById("dep-pick-weekly")?.addEventListener("change", (e) => setWeekly(e.target.checked));
document.getElementById("dep-pick-seg")?.addEventListener("click", (e) => {
  const seg = e.target.closest("button[data-kind]");
  if (seg) showKind(seg.dataset.kind);
});
document.getElementById("dep-pick-days")?.addEventListener("click", (e) => {
  const chip = e.target.closest("button[data-day]");
  if (!chip) return;
  const day = Number(chip.dataset.day);
  if (weekdayChoice.has(day)) weekdayChoice.delete(day);
  else weekdayChoice.add(day);
  syncPicks();
});
document.getElementById("dep-pick-list")?.addEventListener("click", (e) => {
  const remove = e.target.closest("button[data-uid]");
  if (remove) togglePick(remove.dataset.uid);
});
document.getElementById("dep-pick-cancel")?.addEventListener("click", () => {
  setPicking(false);
  document.getElementById("dep-pick-start")?.focus();
});
document.getElementById("dep-pick-save")?.addEventListener("click", () => {
  downloadPicks();
  setPicking(false);
});
document.getElementById("dep-pick-google")?.addEventListener("click", () => {
  // The link has already been followed by the time this runs; the pick is done.
  setTimeout(() => setPicking(false));
});

// One listener for both columns, since the rows are redrawn every minute. The
// info button keeps its own job, opening the notice, even while picking.
const columns = document.querySelector(".dep-columns");
columns?.addEventListener("click", (e) => {
  // The info button keeps its own job, opening the notice, even while picking.
  const notice = e.target.closest(".dep-info-notice");
  if (notice) {
    const detail = notice.closest("li").querySelector(".dep-detail");
    if (detail) setNoticeOpen(detail, !detail.classList.contains("open"));
    return;
  }
  if (!picking || e.target.closest(".dep-notice")) return;
  const li = e.target.closest("li[data-uid]");
  if (li && !li.classList.contains("passed")) togglePick(li.dataset.uid);
});
columns?.addEventListener("keydown", (e) => {
  if (!picking || (e.key !== " " && e.key !== "Enter")) return;
  const li = e.target.closest("li[data-uid][role=checkbox]");
  if (!li || e.target !== li) return;
  e.preventDefault();
  togglePick(li.dataset.uid);
});

const REFRESH_MS = 60000;

loadAll(true);
setInterval(() => {
  if (!document.hidden) loadAll();
}, REFRESH_MS);

// Coming back to a backgrounded tab, refresh at once rather than showing a
// countdown that can be up to a minute stale - but only once the rows are
// older than a refresh cycle, so a quick tab switch does not redraw the board.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastLoad >= REFRESH_MS) loadAll();
});

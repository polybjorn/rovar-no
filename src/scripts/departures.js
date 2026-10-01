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
  repeatEvents,
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
// Weekdays to repeat the picks on, Monday 0. Repeating needs the whole
// published timetable, which the board never loads, so it is fetched on the
// first weekday chosen: about a megabyte per stop, worth it only when asked.
const weekdays = new Set();
let timetable = null;
let timetableEvents = null;
let timetableFailed = false;

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

// What the download would hold right now, or null while the timetable a
// repeat needs is still on its way.
function pickedEvents() {
  const chosen = [...picks.values()];
  if (!weekdays.size) return chosen.sort((a, b) => a.start - b.start);
  if (!timetableEvents) return null;
  return repeatEvents(chosen, timetableEvents, [...weekdays], toOsloDate(new Date()));
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

  depPage?.classList.toggle('is-picking', picking);
  const start = document.getElementById('dep-pick-start');
  const bar = document.getElementById('dep-pick-bar');
  if (start) start.hidden = picking;
  if (bar) bar.hidden = !picking;

  document.querySelectorAll('.dep-pick-day').forEach(chip => {
    chip.setAttribute('aria-pressed', String(weekdays.has(Number(chip.dataset.day))));
  });

  const events = picks.size ? pickedEvents() : [];
  const count = document.getElementById('dep-pick-count');
  if (count) {
    const fill = (template, n) => (template ?? '{{count}}').replace('{{count}}', n);
    count.textContent = !picks.size ? ''
      : !weekdays.size ? fill(S.pickCount, picks.size)
      : events ? fill(S.pickTotal, events.length)
      : timetableFailed ? S.error
      : S.pickLoading;
  }
  const save = document.getElementById('dep-pick-save');
  if (save) save.disabled = !events?.length;
  const google = document.getElementById('dep-pick-google');
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
    // The rings grow in once, on entering; a refresh redraws without them
    // animating again.
    depPage?.classList.add('pick-enter');
    setTimeout(() => depPage?.classList.remove('pick-enter'), 400);
  } else {
    picks.clear();
    weekdays.clear();
  }
  syncPicks();
}

function togglePick(li) {
  const uid = li.dataset.uid;
  if (picks.has(uid)) picks.delete(uid);
  else if (rowEvents.has(uid)) picks.set(uid, rowEvents.get(uid));
  syncPicks();
}

function toggleWeekday(day) {
  if (weekdays.has(day)) weekdays.delete(day);
  else weekdays.add(day);
  if (weekdays.size && !timetableEvents) {
    timetableFailed = false;
    loadTimetable();
  }
  syncPicks();
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

  const openIds = new Set(
    [...container.querySelectorAll('.dep-detail.open')].map(el => el.id)
  );
  const previous = prevRows.get(containerId);
  container.innerHTML = `<ul class="dep-list">${items.map(i => i.html).join('')}</ul>`;

  const list = container.querySelector('.dep-list');
  if (fresh || !previous) {
    list.classList.add('is-fresh');
  } else {
    const lis = list.children;
    items.forEach((item, i) => {
      const prev = previous.get(item.key);
      if (!prev || prev.base !== item.base) {
        lis[i].classList.add('is-changed');
      } else if (prev.html !== item.html) {
        // Only the countdown ticked: fade that element, leave the row still.
        lis[i].querySelector('.dep-countdown')?.classList.add('is-tick');
      }
    });
  }
  prevRows.set(containerId, new Map(items.map(i => [i.key, { html: i.html, base: i.base }])));

  const setOpen = (detail, isOpen) => {
    detail.classList.toggle('open', isOpen);
    detail.closest('li').querySelectorAll('.dep-notice').forEach(b =>
      b.setAttribute('aria-expanded', String(isOpen))
    );
  };
  openIds.forEach(id => {
    const detail = document.getElementById(id);
    if (detail) setOpen(detail, true);
  });
  container.querySelectorAll('.dep-notice').forEach(btn => {
    btn.addEventListener('click', () => {
      const detail = btn.closest('li').querySelector('.dep-detail');
      if (!detail) return;
      setOpen(detail, !detail.classList.contains('open'));
    });
  });
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
    render("from-rovar", filterRoute(rovar, "to-haugesund", targetDate), fresh, "to-haugesund");
    render("from-haugesund", filterRoute(haugesund, "to-rovar", targetDate), fresh, "to-rovar");
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
document.getElementById("dep-pick-days")?.addEventListener("click", (e) => {
  const chip = e.target.closest(".dep-pick-day");
  if (chip) toggleWeekday(Number(chip.dataset.day));
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
  if (!picking || e.target.closest(".dep-notice")) return;
  const li = e.target.closest("li[data-uid]");
  if (li && !li.classList.contains("passed")) togglePick(li);
});
columns?.addEventListener("keydown", (e) => {
  if (!picking || (e.key !== " " && e.key !== "Enter")) return;
  const li = e.target.closest("li[data-uid][role=checkbox]");
  if (!li || e.target !== li) return;
  e.preventDefault();
  togglePick(li);
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

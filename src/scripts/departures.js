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
  filterRoute,
  getRouteInfo,
  bookingPattern,
  noticeState,
  timeline,
  formatCountdown,
  urgencyClass,
  kolumbusUrl,
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
    body: JSON.stringify({ query, variables: { stopId, n: 20, startTime } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data.stopPlace.estimatedCalls;
}

function fmt(dt) {
  return dt.toLocaleTimeString(S.locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" });
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function selectedDate() {
  return toOsloDate(dateAtOffset(dayOffset));
}

function render(containerId, calls) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!calls.length) {
    container.innerHTML = `<div class="dep-empty">${esc(S.empty)}</div>`;
    return;
  }

  const nowMinutes = osloMinutes(new Date());
  let nextFound = false;

  const phoneIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"/></svg>';
  const infoIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
  const clockIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2" stroke-linecap="round"/></svg>';

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
    const depMinutes = osloMinutes(dt);
    const passed = dayOffset === 0 && depMinutes < nowMinutes;
    let cls = passed ? "passed" : "";
    let isNext = false;
    if (dayOffset === 0 && !passed && !nextFound) {
      cls = "next";
      isNext = true;
      nextFound = true;
    }

    const arrHtml = arrivalTime ? `<span class="dep-arrow">\u2192</span><span class="dep-arr">${esc(fmt(arrivalTime))}</span>` : '';
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

    return {
      minutes: depMinutes,
      // Only a departure that is actually a bestillingsrute gets a deadline row.
      deadlineMinutes: isBooking && bookingDeadline ? osloMinutes(bookingDeadline) : null,
      deadlineText: bookingDeadline ? fmt(bookingDeadline) : '',
      time,
      html: `<li class="${cls}">
      <div class="dep-row">
        <div class="dep-route">
          <span class="dep-time">${esc(time)}</span>${arrHtml}${viaHtml}
        </div>
        <div class="dep-info">
          ${noticeHtml}${durationHtml}${countdownHtml}
        </div>
      </div>
      ${detailHtml}
    </li>`,
    };
  });

  // A deadline row is greyed once it is past, exactly like a departure that has
  // already sailed: same timeline, same way of showing a moment has gone.
  const items = timeline(rows)
    .map((row) => {
      if (row.type === 'departure') return rows[row.index].html;
      const dep = rows[row.forIndex];
      const gone = dayOffset === 0 && row.minutes < nowMinutes;
      const label = (S.bookingDeadlineRow ?? '{{time}}').replace('{{time}}', dep.time);
      return `<li class="dep-deadline-row${gone ? ' passed' : ''}">
      <span class="dep-deadline-time">${esc(dep.deadlineText)}</span>
      ${clockIcon}<span class="dep-deadline-label">${esc(label)}</span>
    </li>`;
    })
    .join('');

  const openIds = new Set(
    [...container.querySelectorAll('.dep-detail.open')].map(el => el.id)
  );
  container.innerHTML = `<ul class="dep-list">${items}</ul>`;
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

async function loadAll() {
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
    render("from-rovar", filterRoute(rovar, "to-haugesund", targetDate));
    render("from-haugesund", filterRoute(haugesund, "to-rovar", targetDate));
    lastLoad = Date.now();
  } catch (err) {
    ["from-rovar", "from-haugesund"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="dep-error">${esc(S.error)}</div>`;
    });
  }
}

document.getElementById("dep-prev")?.addEventListener("click", () => {
  if (dayOffset > 0) { dayOffset--; loadAll(); }
});
document.getElementById("dep-next")?.addEventListener("click", () => {
  if (dayOffset < MAX_DAY_OFFSET) { dayOffset++; loadAll(); }
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
    loadAll();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCal(true);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".dep-cal-wrap")) closeCal(false);
});

const REFRESH_MS = 60000;

loadAll();
setInterval(() => {
  if (!document.hidden) loadAll();
}, REFRESH_MS);

// Coming back to a backgrounded tab, refresh at once rather than showing a
// countdown that can be up to a minute stale - but only once the rows are
// older than a refresh cycle, so a quick tab switch does not redraw the board.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastLoad >= REFRESH_MS) loadAll();
});

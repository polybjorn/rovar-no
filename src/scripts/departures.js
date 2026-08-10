// All display strings come from the page: the departure board renders them
// into data-strings from the language's UI catalog (src/i18n/ui/<lang>.json),
// so only the active language ships to the browser.
const depPage = document.querySelector('.dep-page');
const LANG = depPage?.dataset.lang || 'no';
const S = JSON.parse(depPage?.dataset.strings || '{}');

// Entur's own notices are Norwegian whatever the reader's language, so
// "bestill" always counts; each language adds its own words.
const BOOKING_RE = new RegExp(['bestill', ...(S.bookingWords || [])].join('|'), 'i');

const ENTUR_API = "https://api.entur.io/journey-planner/v3/graphql";
const ROVAR_STOP = "NSR:StopPlace:25940";
const HAUGESUND_STOP = "NSR:StopPlace:26090";
let dayOffset = 0;
const MAX_DAY_OFFSET = 7;

const query = `query departures($stopId: String!, $n: Int!, $startTime: DateTime!) {
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

function osloOffset(dateStr) {
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
  const osloHour = parseInt(utcMidnight.toLocaleTimeString("en-US", {
    timeZone: "Europe/Oslo", hour: "numeric", hour12: false
  }));
  return `+${String(osloHour).padStart(2, "0")}:00`;
}

function getOsloMidnight(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const dateStr = toOsloDate(d);
  return `${dateStr}T00:00:00${osloOffset(dateStr)}`;
}

async function fetchDepartures(stopId, startTime) {
  const res = await fetch(ENTUR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": "polybjorn-rovar-no"
    },
    body: JSON.stringify({ query, variables: { stopId, n: 20, startTime } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data.stopPlace.estimatedCalls;
}

function toOsloDate(dt) {
  return dt.toLocaleDateString("en-CA", { timeZone: "Europe/Oslo" });
}

function filterRoute(calls, direction) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const targetDate = toOsloDate(d);
  return calls.filter(c => {
    const dest = c.destinationDisplay.frontText.toLowerCase();
    const dirMatch = direction === "to-haugesund"
      ? dest.includes("haugesund")
      : dest.includes("røvær");
    return dirMatch && toOsloDate(new Date(c.expectedDepartureTime)) === targetDate;
  });
}

function fmt(dt) {
  return dt.toLocaleTimeString(S.locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" });
}

function fmtCountdown(mins) {
  if (mins <= 0) return S.now;
  if (mins < 60) return `${S.inPre} ${mins} ${S.minUnit}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m
    ? `${S.inPre} ${h} ${S.hourUnit} ${m} ${S.minUnit}`
    : `${S.inPre} ${h} ${S.hourUnit}`;
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function parseViaFromFrontText(frontText) {
  const m = frontText.match(/\bvia\s+(.+)/i);
  if (!m) return [];
  return m[1].split(/[-,]/).map(s => s.trim()).filter(Boolean);
}

function getArrivalFromPassingTimes(call) {
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

function getRouteInfo(call) {
  const stops = call.serviceJourney.estimatedCalls;
  if (!stops || stops.length < 2) {
    const via = parseViaFromFrontText(call.destinationDisplay?.frontText || '');
    const { arrivalTime, duration } = getArrivalFromPassingTimes(call);
    return { arrivalTime, duration, via, hasBooking: false };
  }

  const first = new Date(stops[0].expectedDepartureTime);
  const last = new Date(stops[stops.length - 1].expectedDepartureTime);
  const duration = Math.round((last - first) / 60000);
  const via = stops.slice(1, -1).map(s =>
    s.quay.stopPlace.name.replace(' hurtigbåtkai', '')
  );
  const hasBooking = stops[0].bookingArrangements?.bookingMethods?.length > 0;

  return { arrivalTime: last, duration, via, hasBooking };
}

function render(containerId, calls) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!calls.length) {
    container.innerHTML = `<div class="dep-empty">${esc(S.empty)}</div>`;
    return;
  }

  const now = new Date();
  const nowOsloH = parseInt(now.toLocaleTimeString("en-US", { hour: "numeric", hour12: false, timeZone: "Europe/Oslo" }));
  const nowOsloM = parseInt(now.toLocaleTimeString("en-US", { minute: "numeric", hour12: false, timeZone: "Europe/Oslo" }));
  const nowMinutes = nowOsloH * 60 + nowOsloM;
  let nextFound = false;

  const phoneIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"/></svg>';
  const infoIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

  const items = calls.map((c, i) => {
    const dt = new Date(c.expectedDepartureTime);
    const time = fmt(dt);
    const { arrivalTime, duration, via, hasBooking } = getRouteInfo(c);
    const notices = c.serviceJourney.notices || [];
    const situations = (c.serviceJourney.situations || []).map(s => s.summary?.map(v => v.value).join(' ') || '').filter(Boolean);
    const isLast = i === calls.length - 1;
    const allTexts = [...notices.map(n => n.text), ...situations];
    if (isLast && !hasBooking && !allTexts.some(t => BOOKING_RE.test(t))) {
      allTexts.push(S.lastNotice);
    }
    if (hasBooking && !allTexts.some(t => BOOKING_RE.test(t))) {
      allTexts.push(S.bookingNotice);
    }
    const isBooking = hasBooking || allTexts.some(t => BOOKING_RE.test(t));
    const infoTexts = allTexts.filter(t => !BOOKING_RE.test(t));
    const depH = parseInt(dt.toLocaleTimeString("en-US", { hour: "numeric", hour12: false, timeZone: "Europe/Oslo" }));
    const depM = parseInt(dt.toLocaleTimeString("en-US", { minute: "numeric", hour12: false, timeZone: "Europe/Oslo" }));
    const depMinutes = depH * 60 + depM;
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

    let noticeHtml = '';
    const noticeId = `notice-${containerId}-${i}`;
    if (isBooking) {
      noticeHtml = `<button class="dep-notice dep-booking-notice" aria-expanded="false" aria-controls="${noticeId}" aria-label="${esc(S.bookLabel)}">${phoneIcon}</button>`;
    }
    if (infoTexts.length) {
      noticeHtml += `<button class="dep-notice dep-info-notice" aria-expanded="false" aria-controls="${noticeId}" aria-label="${esc(S.infoLabel)}">${infoIcon}</button>`;
    }
    const detailHtml = allTexts.length ? `<div class="dep-detail" id="${noticeId}"><div class="dep-detail-inner">${esc(allTexts.join(' '))}</div></div>` : '';
    // Only the next departure carries a countdown, in the row's right-hand
    // column so a long via list can never stretch the line.
    // Urgency is colour on top of the wording, never colour alone: the text
    // says the same thing for anyone who cannot see the difference.
    const mins = depMinutes - nowMinutes;
    const urgency = mins <= 10 ? ' is-imminent' : mins <= 30 ? ' is-soon' : '';
    const countdownHtml = isNext
      ? `<p class="dep-countdown${urgency}">${esc(fmtCountdown(mins))}</p>`
      : '';

    return `<li class="${cls}">
      <div class="dep-row">
        <div class="dep-route">
          <span class="dep-time">${esc(time)}</span>${arrHtml}${viaHtml}
        </div>
        <div class="dep-info">
          ${noticeHtml}${durationHtml}${countdownHtml}
        </div>
      </div>
      ${detailHtml}
    </li>`;
  }).join("");

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
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const opts = { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Oslo" };
  const f = d.toLocaleDateString(S.locale, opts);
  el.textContent = f.charAt(0).toUpperCase() + f.slice(1);

  const prev = document.getElementById("dep-prev");
  const next = document.getElementById("dep-next");
  if (prev) prev.disabled = dayOffset <= 0;
  if (next) next.disabled = dayOffset >= 7;

  if (!document.getElementById("dep-cal-pop")?.hidden) renderCalendar();

  const kolumbus = document.getElementById("kolumbus-link");
  if (kolumbus) {
    const date = toOsloDate(d);
    kolumbus.href = `https://reise.kolumbus.no/no/search?fromId=NSR:StopPlace:25940&toId=NSR:StopPlace:26090&dateTime=${date}T05:00:00.000Z`;
  }
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

  const startTime = getOsloMidnight(dayOffset);
  try {
    const [rovar, haugesund] = await Promise.all([
      fetchDepartures(ROVAR_STOP, startTime),
      fetchDepartures(HAUGESUND_STOP, startTime)
    ]);
    render("from-rovar", filterRoute(rovar, "to-haugesund"));
    render("from-haugesund", filterRoute(haugesund, "to-rovar"));
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

function pad(n) {
  return String(n).padStart(2, "0");
}

function offsetOf(dateStr) {
  // Compare at midday so a DST change can't shift the day count.
  const day = 86400000;
  return Math.round(
    (new Date(`${dateStr}T12:00:00Z`) - new Date(`${toOsloDate(new Date())}T12:00:00Z`)) / day
  );
}

function monthIndex(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return y * 12 + (m - 1);
}

function selectedDate() {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return toOsloDate(d);
}

function lastSelectable() {
  const d = new Date();
  d.setDate(d.getDate() + MAX_DAY_OFFSET);
  return toOsloDate(d);
}

function weekdayNames() {
  // 2024-01-01 was a Monday, so walking a week from it gives Monday-first names.
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(S.locale, {
      weekday: "short", timeZone: "UTC"
    })
  );
}

function renderCalendar() {
  const pop = document.getElementById("dep-cal-pop");
  if (!pop) return;
  if (!calView) calView = selectedDate().slice(0, 7);

  const [year, month] = calView.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const label = first.toLocaleDateString(S.locale, {
    month: "long", year: "numeric", timeZone: "UTC"
  });
  // getUTCDay() is 0=Sunday; shift so Monday is column 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const view = monthIndex(`${calView}-01`);
  const canPrev = view > monthIndex(toOsloDate(new Date()));
  const canNext = view < monthIndex(lastSelectable());
  const selected = selectedDate();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="dep-cal-pad"></span>');
  for (let day = 1; day <= days; day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const off = offsetOf(dateStr);
    const usable = off >= 0 && off <= MAX_DAY_OFFSET;
    const cls = ["dep-cal-day"];
    if (dateStr === selected) cls.push("is-selected");
    if (off === 0) cls.push("is-today");
    cells.push(
      `<button type="button" class="${cls.join(" ")}" data-date="${dateStr}"${usable ? "" : " disabled"}${dateStr === selected ? ' aria-current="date"' : ""}>${day}</button>`
    );
  }

  pop.innerHTML = `
    <div class="dep-cal-head">
      <button type="button" class="dep-cal-nav" data-step="-1" aria-label="${esc(S.prevMonth)}"${canPrev ? "" : " disabled"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span class="dep-cal-month">${esc(label.charAt(0).toUpperCase() + label.slice(1))}</span>
      <button type="button" class="dep-cal-nav" data-step="1" aria-label="${esc(S.nextMonth)}"${canNext ? "" : " disabled"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>
    <div class="dep-cal-grid" role="grid">
      ${weekdayNames().map(w => `<span class="dep-cal-wd">${esc(w)}</span>`).join("")}
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
    const [y, m] = calView.split("-").map(Number);
    const shifted = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.step), 1));
    calView = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
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

const ENTUR_API = "https://api.entur.io/journey-planner/v3/graphql";
const ROVAR_STOP = "NSR:StopPlace:25940";
const HAUGESUND_STOP = "NSR:StopPlace:26090";

const query = `query departures($stopId: String!, $n: Int!) {
  stopPlace(id: $stopId) {
    estimatedCalls(numberOfDepartures: $n, timeRange: 86400) {
      expectedDepartureTime
      destinationDisplay { frontText }
      serviceJourney {
        line { publicCode }
        notices { text }
        estimatedCalls {
          quay { stopPlace { name } }
          expectedDepartureTime
        }
      }
    }
  }
}`;

async function fetchDepartures(stopId) {
  const res = await fetch(ENTUR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": "polybjorn-rovar-no"
    },
    body: JSON.stringify({ query, variables: { stopId, n: 20 } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data.stopPlace.estimatedCalls;
}

function filterRoute(calls, direction) {
  return calls.filter(c => {
    const dest = c.destinationDisplay.frontText.toLowerCase();
    return direction === "to-haugesund"
      ? dest.includes("haugesund")
      : dest.includes("røvær");
  });
}

function fmt(dt) {
  return dt.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

function getRouteInfo(call) {
  const stops = call.serviceJourney.estimatedCalls;
  if (!stops || stops.length < 2) return { arrivalTime: null, duration: null, via: [] };

  const first = new Date(stops[0].expectedDepartureTime);
  const last = new Date(stops[stops.length - 1].expectedDepartureTime);
  const duration = Math.round((last - first) / 60000);
  const via = stops.slice(1, -1).map(s =>
    s.quay.stopPlace.name.replace(' hurtigbåtkai', '')
  );

  return { arrivalTime: last, duration, via };
}

function render(containerId, calls) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!calls.length) {
    container.innerHTML = '<div class="dep-empty">Ingen avganger i dag</div>';
    return;
  }

  const now = new Date();
  let nextFound = false;

  const phoneIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"/></svg>';
  const infoIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

  const items = calls.map((c, i) => {
    const dt = new Date(c.expectedDepartureTime);
    const time = fmt(dt);
    const { arrivalTime, duration, via } = getRouteInfo(c);
    const notices = c.serviceJourney.notices || [];
    // TODO: Verify with Kolumbus/route owners which departures are bestillingsruter.
    // Currently assuming last departure in each direction. Entur API does not expose this.
    const isLast = i === calls.length - 1;
    const isBooking = isLast || notices.some(n => /bestill/i.test(n.text));
    const passed = dt < now;
    let cls = passed ? "passed" : "";
    if (!passed && !nextFound) {
      cls = "next";
      nextFound = true;
    }

    const arrHtml = arrivalTime ? `<span class="dep-arrow">→</span><span class="dep-arr">${fmt(arrivalTime)}</span>` : '';
    const viaHtml = via.length ? `<span class="dep-via">via ${via.join(', ')}</span>` : '';
    const durationHtml = duration ? `<span class="dep-duration">${duration} min</span>` : '';

    let noticeHtml = '';
    if (isBooking) {
      noticeHtml = `<span class="dep-notice dep-booking-notice" title="Må bestilles på forhånd">${phoneIcon} Bestill</span>`;
    } else if (notices.length) {
      noticeHtml = `<span class="dep-notice dep-info-notice" title="${notices.map(n => n.text).join(', ')}">${infoIcon} Info</span>`;
    }

    return `<li class="${cls}">
      <div class="dep-route">
        <span class="dep-time">${time}</span>${arrHtml}${viaHtml}
      </div>
      <div class="dep-info">
        ${noticeHtml}${durationHtml}
      </div>
    </li>`;
  }).join("");

  container.innerHTML = `<ul class="dep-list">${items}</ul>`;
}

function setDate() {
  const el = document.getElementById("dep-date");
  if (!el) return;
  const opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  const f = new Date().toLocaleDateString("nb-NO", opts);
  el.textContent = f.charAt(0).toUpperCase() + f.slice(1);
}

async function loadAll() {
  setDate();
  ["from-rovar", "from-haugesund"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.querySelector(".dep-list")) {
      el.innerHTML = '<div class="dep-loading">Henter avganger...</div>';
    }
  });

  try {
    const [rovar, haugesund] = await Promise.all([
      fetchDepartures(ROVAR_STOP),
      fetchDepartures(HAUGESUND_STOP)
    ]);
    render("from-rovar", filterRoute(rovar, "to-haugesund"));
    render("from-haugesund", filterRoute(haugesund, "to-rovar"));
  } catch (err) {
    ["from-rovar", "from-haugesund"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="dep-error">Kunne ikke hente rutedata</div>`;
    });
  }
}

loadAll();
setInterval(loadAll, 60000);

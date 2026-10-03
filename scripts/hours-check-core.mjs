// The verdict half of hours:check, kept apart so test/hours-check.test.mjs can
// cover it without the network.
//
// narbutikken.no publishes each shop's hours as schema.org data in the page
// (a <script type="application/ld+json"> with openingHoursSpecification).
// This reads those and compares them with the one row the site prints,
// season.narbutikkenHours, every day of the week.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 'HH:MM:SS' -> 'HH:MM'. A closing time of midnight is 00:00 to schema.org
// and 24:00 here.
const hhmm = (t, closing) => {
  const out = String(t).slice(0, 5);
  return closing && out === '00:00' ? '24:00' : out;
};

// { Monday: ['05:45', '24:00'], ... } from the page's HTML, or null when the
// page carries no opening hours this can read: a redesign, not a change of
// hours, and worth knowing about all the same.
export function storeHours(html) {
  for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      continue;
    }
    const specs = data?.openingHoursSpecification;
    if (!Array.isArray(specs)) continue;
    const out = {};
    for (const spec of specs) {
      for (const day of [spec.dayOfWeek].flat()) {
        const name = String(day).replace(/^https?:\/\/schema\.org\//, '');
        if (DAYS.includes(name)) out[name] = [hhmm(spec.opens, false), hhmm(spec.closes, true)];
      }
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

// The days whose published hours differ from ours, a day missing from theirs
// counted as closed: [{ day, theirs, ours }].
export function hoursDrift(theirs, ours) {
  return DAYS.filter((day) => theirs[day]?.join('-') !== ours.join('-')).map((day) => ({
    day,
    theirs: theirs[day] ?? null,
    ours,
  }));
}

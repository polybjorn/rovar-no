// Rebuilds the front-page map: stitches Kartverket topo tiles over a fixed
// box into src/assets/kart-rovar.png, and asks Entur for the paths line 700
// sails, projected onto that image, into src/data/map-routes.json.
//
//   node scripts/build-map.mjs
//
// Run it again when Kolumbus changes the route. The image and the routes share
// one projection, so regenerate both together rather than either alone.
import fs from 'node:fs';
import sharp from 'sharp';
import { ENTUR_API, ENTUR_CLIENT, ROVAR_STOP } from '../src/scripts/departures-core.js';

const ZOOM = 13;
// West, south, east, north: Røvær to Haugesund, and south far enough for the
// Feøy and Kveitevik calls.
const BOX = [5.05, 59.368, 5.3, 59.455];
const TILE = 256;
// Entur has one path per stop sequence, and for the direct sailing it leaves
// Røvær through the southern channel. The boat often uses the northern one
// instead, which no open source records, so it is drawn here by hand from the
// map: up the channel from the quay, out past the northern skerries, and east
// until it meets Entur's path in the middle of Røværsfjorden.
const NORTH_APPROACH = [
  [59.43944, 5.0916],
  [59.44124, 5.09196],
  [59.44298, 5.09251],
  [59.44473, 5.09422],
  [59.44647, 5.09731],
  [59.44752, 5.10281],
  [59.44621, 5.11517],
  [59.44316, 5.1289],
  [59.43705, 5.14606],
  [59.43006, 5.17353],
];
const TILE_URL = (z, x, y) =>
  `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/${z}/${y}/${x}.png`;

const IMAGE = new URL('../src/assets/kart-rovar.png', import.meta.url);
const ROUTES = new URL('../src/data/map-routes.json', import.meta.url);

// Web Mercator, in pixels at ZOOM.
const scale = TILE * 2 ** ZOOM;
const px = (lon) => ((lon + 180) / 360) * scale;
const py = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scale;
};

const left = Math.round(px(BOX[0]));
const top = Math.round(py(BOX[3]));
const width = Math.round(px(BOX[2])) - left;
const height = Math.round(py(BOX[1])) - top;

async function buildImage() {
  const tiles = [];
  for (let ty = Math.floor(top / TILE); ty * TILE < top + height; ty++) {
    for (let tx = Math.floor(left / TILE); tx * TILE < left + width; tx++) {
      const res = await fetch(TILE_URL(ZOOM, tx, ty));
      if (!res.ok) throw new Error(`tile ${tx},${ty}: HTTP ${res.status}`);
      tiles.push({
        input: Buffer.from(await res.arrayBuffer()),
        left: tx * TILE - left,
        top: ty * TILE - top,
      });
    }
  }
  // Tiles overhang the box on every side; composite onto a larger canvas and
  // crop, since sharp refuses an overlay that starts at a negative offset.
  const pad = TILE;
  await sharp({
    create: { width: width + 2 * pad, height: height + 2 * pad, channels: 3, background: '#ffffff' },
  })
    .composite(tiles.map((t) => ({ ...t, left: t.left + pad, top: t.top + pad })))
    .png()
    .toBuffer()
    .then((buf) =>
      sharp(buf).extract({ left: pad, top: pad, width, height }).png({ palette: true }).toFile(IMAGE.pathname),
    );
}

// Google's encoded polyline, which is what Entur's pointsOnLink carries.
function decode(s) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (const k of [0, 1]) {
      let r = 0, shift = 0, b;
      do {
        b = s.charCodeAt(i++) - 63;
        r |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k) lon += d;
      else lat += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

const round = (n) => Math.round(n * 10) / 10;
const at = (lat, lon) => [round(px(lon) - left), round(py(lat) - top)];

// The point on a polyline closest to p, so the hand-drawn approach ends on
// Entur's path rather than a few pixels beside it.
function nearestOn(line, [px0, py0]) {
  let best = line[0];
  let bestD = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px0 - x0) * dx + (py0 - y0) * dy) / (dx * dx + dy * dy || 1)));
    const q = [x0 + t * dx, y0 + t * dy];
    const d = Math.hypot(q[0] - px0, q[1] - py0);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best.map(round);
}

async function buildRoutes() {
  const query = `{ stopPlace(id: "${ROVAR_STOP}") { estimatedCalls(numberOfDepartures: 300, timeRange: 1209600) {
    serviceJourney { journeyPattern { pointsOnLink { points } quays { name latitude longitude } } } } } }`;
  const res = await fetch(ENTUR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ENTUR_CLIENT },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  // The stop sequence most sailings follow is the main line. The loop past
  // Feøy and Kveitevik is drawn too, dotted, as the alternative it is. The
  // Vibrandsøy-only call is left out: its path is the main line's with a
  // short detour in Smedasundet, too close to tell apart at this scale. The
  // run prints how often each sequence sails.
  const counts = new Map();
  for (const call of json.data.stopPlace.estimatedCalls) {
    const p = call.serviceJourney.journeyPattern;
    if (!p.pointsOnLink?.points) continue;
    const key = p.quays.map((q) => q.name).join(' > ');
    const seen = counts.get(key) ?? { pattern: p, n: 0 };
    seen.n++;
    counts.set(key, seen);
  }
  if (!counts.size) throw new Error('Entur returned no journey patterns');
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const { pattern } = ranked[0][1];

  const path = (p) => decode(p.pointsOnLink.points).map(([la, lo]) => at(la, lo));
  const south = path(pattern);
  const north = NORTH_APPROACH.map(([la, lo]) => at(la, lo));
  north[north.length - 1] = nearestOn(south, north.at(-1));
  const loop = ranked.find(([key]) => key.includes('Feøy'));
  if (!loop) throw new Error('no sailing calls at Feøy in the next two weeks');

  const data = {
    width,
    height,
    box: BOX,
    zoom: ZOOM,
    sailings: Object.fromEntries(ranked.map(([k, v]) => [k.replace(/ hurtigbåtkai/g, ''), v.n])),
    routes: [south, north],
    alternatives: [path(loop[1].pattern)],
    stops: Object.fromEntries(
      [pattern.quays[0], pattern.quays.at(-1)].map((q) => [q.name.replace(/ hurtigbåtkai$/, ''), at(q.latitude, q.longitude)]),
    ),
  };
  fs.writeFileSync(ROUTES, JSON.stringify(data, null, 1) + '\n');
  return data;
}

await buildImage();
const data = await buildRoutes();
console.log(`${width}x${height} image; sailings over two weeks:`, data.sailings);

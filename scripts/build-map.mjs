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
// West, south, east, north: Røvær to Haugesund with sea round both.
const BOX = [5.05, 59.405, 5.3, 59.458];
const TILE = 256;
// Where the two end labels sit: out in open water, clear of the land they
// name, with a leader line back to the quay.
const LABELS = {
  Røvær: [59.427, 5.072],
  Haugesund: [59.4335, 5.236],
};
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
// A route starts where everything within this many image pixels of it is
// sea, so it begins at Røvær's harbour mouth instead of running up a channel
// narrower than the line and painting over the island either side.
const OPEN_WATER = 10;
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

// Kartverket's topo sea is a pale blue with blue well above red; land, roads
// and labels all fail that.
async function waterTest() {
  const { data, info } = await sharp(IMAGE.pathname).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const isWater = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return true;
    const i = (y * info.width + x) * 3;
    return data[i + 2] >= 240 && data[i + 2] - data[i] >= 15;
  };
  return ([x, y]) => {
    for (let dy = -OPEN_WATER; dy <= OPEN_WATER; dy++) {
      for (let dx = -OPEN_WATER; dx <= OPEN_WATER; dx++) {
        if (dx * dx + dy * dy > OPEN_WATER * OPEN_WATER) continue;
        if (!isWater(Math.round(x + dx), Math.round(y + dy))) return false;
      }
    }
    return true;
  };
}

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

// Drop the start of the path up to the first point in open water, stepping a
// pixel at a time so the cut lands where the water opens rather than at the
// next vertex Entur happened to give. Only the Røvær end: the approach to
// Haugesund runs close to land all the way, and cutting it there leaves the
// line well short of the town.
function trimToOpenWater(points, open) {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k < n; k++) {
      const p = [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n];
      if (open(p)) return [[round(p[0]), round(p[1])], ...points.slice(i)];
    }
  }
  return points;
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

  // Draw only the stop sequence most sailings follow. The calls at
  // Vibrandsøy, Feøy and Kveitevik are rare (the run prints the counts), and
  // drawn alongside they read as a bus route that stops everywhere.
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

  const open = await waterTest();
  const south = trimToOpenWater(decode(pattern.pointsOnLink.points).map(([la, lo]) => at(la, lo)), open);
  const north = trimToOpenWater(NORTH_APPROACH.map(([la, lo]) => at(la, lo)), open);
  north[north.length - 1] = nearestOn(south, north.at(-1));

  const data = {
    width,
    height,
    box: BOX,
    zoom: ZOOM,
    sailings: Object.fromEntries(ranked.map(([k, v]) => [k.replace(/ hurtigbåtkai/g, ''), v.n])),
    routes: [south, north],
    stops: Object.fromEntries(
      [pattern.quays[0], pattern.quays.at(-1)].map((q) => [q.name.replace(/ hurtigbåtkai$/, ''), at(q.latitude, q.longitude)]),
    ),
    labels: Object.fromEntries(Object.entries(LABELS).map(([name, [la, lo]]) => [name, at(la, lo)])),
  };
  fs.writeFileSync(ROUTES, JSON.stringify(data, null, 1) + '\n');
  return data;
}

await buildImage();
const data = await buildRoutes();
console.log(`${width}x${height} image; sailings over two weeks:`, data.sailings);

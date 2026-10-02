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
// West, south, east, north. Wide enough for the Feøy and Kveitevik stops.
const BOX = [5.05, 59.366, 5.3, 59.458];
const TILE = 256;
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

async function buildRoutes() {
  const query = `{ stopPlace(id: "${ROVAR_STOP}") { estimatedCalls(numberOfDepartures: 100, timeRange: 1209600) {
    serviceJourney { journeyPattern { pointsOnLink { points } quays { name latitude longitude } } } } } }`;
  const res = await fetch(ENTUR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ENTUR_CLIENT },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  // One entry per distinct stop sequence; the same sailing appears under
  // several journey pattern ids.
  const routes = new Map();
  const stops = new Map();
  for (const call of json.data.stopPlace.estimatedCalls) {
    const p = call.serviceJourney.journeyPattern;
    const names = p.quays.map((q) => q.name.replace(/ hurtigbåtkai$/, ''));
    const key = names.join(' > ');
    if (routes.has(key) || !p.pointsOnLink?.points) continue;
    routes.set(key, {
      stops: names,
      points: decode(p.pointsOnLink.points).map(([la, lo]) => at(la, lo)),
    });
    p.quays.forEach((q, i) => stops.set(names[i], at(q.latitude, q.longitude)));
  }
  if (!routes.size) throw new Error('Entur returned no journey patterns');

  const data = {
    width,
    height,
    box: BOX,
    zoom: ZOOM,
    routes: [...routes.values()].sort((a, b) => a.stops.length - b.stops.length),
    stops: Object.fromEntries(stops),
  };
  fs.writeFileSync(ROUTES, JSON.stringify(data, null, 1) + '\n');
  return data;
}

await buildImage();
const data = await buildRoutes();
console.log(`${width}x${height} image, routes:`);
for (const r of data.routes) console.log(`  ${r.stops.join(' > ')} (${r.points.length} points)`);

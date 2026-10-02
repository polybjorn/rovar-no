// Rebuilds the front-page map: stitches Kartverket topo tiles over a fixed
// box into src/assets/kart-rovar.png, and writes the boat's lines, projected
// onto that image, into src/data/map-routes.json. Røvær to Haugesund follows
// Kystverket's fairway for the route; the Feøy and Kveitevik sailings follow
// the paths Entur publishes for them.
//
//   node scripts/build-map.mjs
//
// Run it again when Kolumbus changes the route. The image and the routes share
// one projection, so regenerate both together rather than either alone.
import fs from 'node:fs';
import sharp from 'sharp';
import { ENTUR_API, ENTUR_CLIENT, HAUGESUND_STOP } from '../src/scripts/departures-core.js';

const ZOOM = 13;
// West, south, east, north: Røvær to Haugesund, and south far enough for the
// Feøy and Kveitevik calls.
const BOX = [5.05, 59.368, 5.3, 59.455];
const TILE = 256;
// Kystverket's secondary fairway (biled) for this route. Entur has only one
// path per stop sequence, and for Røvær it runs out through the southern
// channel and hooks east; the fairway also has the northern channel the boat
// often takes, and a gentler southern leg. Open data under NLOD 2.0.
const FAIRWAY = 'Haugesund - Røvær - Feøy';
const FAIRWAY_URL = `https://services.kystverket.no/wfs.ashx?service=WFS&version=1.1.0&request=GetFeature&typeName=layer_552&srsName=EPSG:4326&bbox=${BOX[1]},${BOX[0]},${BOX[3]},${BOX[2]},EPSG:4326`;
// The fairway is one line that doubles back on itself to cover every leg.
// These are its vertex numbers: the Røvær quay at 6, up the northern channel
// to the Haugesund approach at 15, down the southern channel to the junction
// at 2 and east to 0, and from Feøy at 26 north to that junction at 33.
// buildRoutes checks the ends land where they should, so a redrawn fairway
// fails the run rather than the map.
const NORTH_LEG = [6, 15];
const SOUTH_LEG = [6, 0];
const FEOY_LEG = [26, 33];
const JUNCTION = 2;
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

const dist = ([x0, y0], [x1, y1]) => Math.hypot(x1 - x0, y1 - y0);
const nearestIndex = (line, p) => line.reduce((best, q, i) => (dist(q, p) < dist(line[best], p) ? i : best), 0);
const distToLine = (line, p) => Math.min(...line.map((q) => dist(q, p)));

// Chaikin corner cutting: the fairway is straight legs with sharp corners at
// each vertex, which a boat does not sail. Keeps both ends where they are.
function smooth(line, rounds = 3) {
  for (let r = 0; r < rounds; r++) {
    const out = [line[0]];
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, y0] = line[i];
      const [x1, y1] = line[i + 1];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    out.push(line.at(-1));
    line = out;
  }
  return line;
}

const tidy = (line) => line.map(([x, y]) => [round(x), round(y)]);

async function fetchFairway() {
  const gml = await (await fetch(FAIRWAY_URL)).text();
  const member = gml.split('<gml:featureMember>').find((m) => m.includes(`<ms:navn>${FAIRWAY}</ms:navn>`));
  if (!member) throw new Error(`Kystverket has no fairway named ${FAIRWAY}`);
  const nums = member.match(/<gml:posList[^>]*>([^<]*)/)[1].trim().split(/\s+/).map(Number);
  const out = [];
  for (let i = 0; i < nums.length; i += 2) out.push(at(nums[i], nums[i + 1]));
  return out;
}

const slice = (line, [from, to]) =>
  from <= to ? line.slice(from, to + 1) : line.slice(to, from + 1).reverse();

async function buildRoutes() {
  const query = `{ stopPlace(id: "${HAUGESUND_STOP}") { estimatedCalls(numberOfDepartures: 300, timeRange: 1209600) {
    serviceJourney { line { publicCode } journeyPattern { pointsOnLink { points } quays { name latitude longitude } } } } } }`;
  const res = await fetch(ENTUR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ENTUR_CLIENT },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const name = (q) => q.name.replace(/ hurtigbåtkai$/, '');
  const patterns = new Map();
  for (const call of json.data.stopPlace.estimatedCalls) {
    const p = call.serviceJourney.journeyPattern;
    if (call.serviceJourney.line.publicCode !== '700' || !p.pointsOnLink?.points) continue;
    const key = p.quays.map(name).join(' > ');
    const seen = patterns.get(key) ?? { pattern: p, n: 0 };
    seen.n++;
    patterns.set(key, seen);
  }
  const want = (key) => {
    const p = patterns.get(key)?.pattern;
    if (!p) throw new Error(`no "${key}" sailing in the next two weeks`);
    return { quays: p.quays, path: decode(p.pointsOnLink.points).map(([la, lo]) => at(la, lo)) };
  };
  const direct = want('Haugesund > Røvær');
  const feoy = want('Haugesund > Feøy');
  const kveitevik = want('Haugesund > Kveitevik > Feøy');
  const quay = (pattern, stop) => {
    const q = pattern.quays.find((x) => name(x) === stop);
    return at(q.latitude, q.longitude);
  };
  const haugesund = quay(direct, 'Haugesund');
  const rovaer = quay(direct, 'Røvær');
  const feoyQuay = quay(feoy, 'Feøy');

  // Røvær to Haugesund: the fairway legs, smoothed, then Entur's path
  // through Smedasundet to the quay, which the fairway does not go into.
  const fairway = await fetchFairway();
  if (dist(fairway[NORTH_LEG[0]], rovaer) > 15) throw new Error('fairway vertex 6 is no longer at the Røvær quay');
  // Entur's paths here run from Haugesund; turn this one round to match.
  const inbound = [...direct.path].reverse();
  const sound = inbound.slice(nearestIndex(inbound, fairway[NORTH_LEG[1]]));
  const toQuay = (leg) => [rovaer, ...smooth(leg), ...sound.slice(1)];
  const north = toQuay(slice(fairway, NORTH_LEG));
  const south = toQuay([...slice(fairway, SOUTH_LEG), fairway[NORTH_LEG[1]]]);

  // The occasional sailings, dotted: Haugesund to Feøy, Feøy on to Røvær,
  // and the turn into Kveitevik where it leaves the Feøy line.
  // Feøy on to Røvær follows the fairway to its junction with the southern
  // leg and up the channel, so it branches off the solid line where the
  // fairway does rather than where Entur's path happens to wander.
  if (dist(fairway[FEOY_LEG[0]], feoyQuay) > 25) throw new Error('fairway vertex 26 is no longer at the Feøy quay');
  if (dist(fairway[FEOY_LEG[1]], fairway[JUNCTION]) > 2) throw new Error('fairway vertex 33 is no longer the southern junction');
  const afterFeoy = [feoyQuay, ...smooth([...slice(fairway, FEOY_LEG), ...slice(fairway, [JUNCTION, NORTH_LEG[0]])]), rovaer];
  const spur = kveitevik.path.filter((p) => distToLine(feoy.path, p) > 4);

  const data = {
    width,
    height,
    box: BOX,
    zoom: ZOOM,
    sailings: Object.fromEntries([...patterns.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v.n])),
    routes: [north, south].map(tidy),
    alternatives: [feoy.path, afterFeoy, spur].map(tidy),
    stops: { Røvær: rovaer, Haugesund: haugesund },
  };
  fs.writeFileSync(ROUTES, JSON.stringify(data, null, 1) + '\n');
  return data;
}

await buildImage();
const data = await buildRoutes();
console.log(`${width}x${height} image; sailings over two weeks:`, data.sailings);

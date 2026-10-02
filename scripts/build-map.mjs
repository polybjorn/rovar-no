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
// to the Haugesund approach at 15, Feøy at 26, and the leg north from Feøy
// (28 to 32) towards the junction at 33. buildRoutes checks those land where
// they should, so a redrawn fairway fails the run rather than the map.
const NORTH_LEG = [6, 15];
const FEOY_QUAY = 26;
const FEOY_LEG = [28, 32];
const JUNCTION = 33;
// Entur's southern path dips south of Røvær and comes back north-east in a
// sharp hook. Between the channel mouth and this far along its long eastward
// leg, it is replaced by one curve that leaves the channel the way the
// channel points and arrives along the leg.
const CHANNEL_MOUTH = [59.4316, 5.0974];
const SOUTH_REJOIN = 160;
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

// The closest point to p on a polyline, and how far away it is.
function project(line, p) {
  let best = { point: line[0], d: dist(line[0], p) };
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / (dx * dx + dy * dy || 1)));
    const q = [x0 + t * dx, y0 + t * dy];
    const d = dist(q, p);
    if (d < best.d) best = { point: q, d };
  }
  return best;
}

// The part of line that leaves the lines already drawn: from the last point
// still on one to the first point back on one, both snapped onto it so the
// branch starts and ends on the line it shares rather than beside it.
function branch(line, bases, tol) {
  const onto = (p) => bases.map((b) => project(b, p)).reduce((a, b) => (b.d < a.d ? b : a));
  const off = line.map((p) => onto(p).d > tol);
  const first = off.indexOf(true);
  const last = off.lastIndexOf(true);
  if (first < 0) return [];
  // An end that never rejoins base, like a line out to Feøy, stays where it is.
  const head = first > 0 ? [onto(line[first - 1]).point] : [];
  const tail = last < line.length - 1 ? [onto(line[last + 1]).point] : [];
  return [...head, ...line.slice(first, last + 1), ...tail];
}

// Warn about any stretch of a line that runs over land on the map image.
async function landCheck(lines) {
  const { data, info } = await sharp(IMAGE.pathname).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const land = ([x, y]) => {
    const i = (Math.round(y) * info.width + Math.round(x)) * 3;
    return !(data[i + 2] >= 240 && data[i + 2] - data[i] >= 15);
  };
  for (const [name, line] of Object.entries(lines)) {
    let run = 0;
    const hits = [];
    for (let i = 1; i < line.length; i++) {
      const n = Math.ceil(dist(line[i - 1], line[i]));
      for (let k = 0; k < n; k++) {
        const p = [line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * k) / n, line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * k) / n];
        // Quays sit on the shore, so the last few pixels at either end are land.
        const nearEnd = Math.min(dist(p, line[0]), dist(p, line.at(-1))) < 12;
        run = land(p) && !nearEnd ? run + 1 : 0;
        if (run === 4) hits.push(p.map(Math.round).join(','));
      }
    }
    if (hits.length) console.warn(`${name} crosses land near ${hits.join('; ')}`);
  }
}

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
  if (dist(fairway[FEOY_QUAY], feoyQuay) > 25) throw new Error('fairway vertex 26 is no longer at the Feøy quay');

  // Southern: Entur's path for the direct sailing, turned round to run from
  // Røvær, with the hook swapped for a curve.
  const inbound = [...direct.path].reverse();
  const mouth = nearestIndex(inbound, at(...CHANNEL_MOUTH));
  if (dist(inbound[mouth], at(...CHANNEL_MOUTH)) > 5) throw new Error("Entur's southern path no longer passes the channel mouth");
  const leg = inbound.findIndex((p, i) => i > mouth && dist(inbound[i - 1], p) > 200);
  if (leg < 0) throw new Error("Entur's southern path has no long eastward leg");
  const unit = ([x0, y0], [x1, y1]) => [(x1 - x0) / dist([x0, y0], [x1, y1]), (y1 - y0) / dist([x0, y0], [x1, y1])];
  const legDir = unit(inbound[leg - 1], inbound[leg]);
  const p0 = inbound[mouth];
  const p3 = [inbound[leg - 1][0] + legDir[0] * SOUTH_REJOIN, inbound[leg - 1][1] + legDir[1] * SOUTH_REJOIN];
  const outDir = unit(inbound[mouth - 2], p0);
  const reach = dist(p0, p3) / 3;
  const p1 = [p0[0] + outDir[0] * reach, p0[1] + outDir[1] * reach];
  const p2 = [p3[0] - legDir[0] * reach, p3[1] - legDir[1] * reach];
  const curve = Array.from({ length: 24 }, (_, i) => {
    const t = (i + 1) / 24;
    const u = 1 - t;
    return [0, 1].map((k) => u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k]);
  });
  const south = [...inbound.slice(0, mouth + 1), ...curve, ...inbound.slice(leg)];

  // Northern: the fairway up the channel and across, until it comes within a
  // few pixels of the southern line, then the southern line's own points, so
  // the shared approach to Smedasundet is one line rather than two side by
  // side.
  const across = smooth(slice(fairway, NORTH_LEG));
  const joins = across.findIndex((p, i) => i > across.length / 2 && project(south, p).d < 6);
  if (joins < 0) throw new Error('the northern fairway leg never meets the southern line');
  const meet = nearestIndex(south, across[joins]);
  const north = [rovaer, ...across.slice(0, joins), ...south.slice(meet)];

  // The occasional sailings, dotted, each starting where it leaves a line
  // already drawn: Haugesund to Feøy off the solid line in Smedasundet, the
  // turn into Kveitevik off the Feøy line, and Feøy on to Røvær along the
  // fairway from the Feøy line to the southern line.
  const feoyLine = branch(feoy.path, [south], 5);
  const spur = branch(kveitevik.path, [feoyLine, south], 5);
  const fromFeoy = [
    project(feoyLine, fairway[FEOY_LEG[0]]).point,
    ...slice(fairway, FEOY_LEG),
    project(south, fairway[JUNCTION]).point,
  ];
  const afterFeoy = smooth(fromFeoy);

  await landCheck({ north, south, 'Haugesund > Feøy': feoyLine, 'Kveitevik': spur, 'Feøy > Røvær': afterFeoy });

  const data = {
    width,
    height,
    box: BOX,
    zoom: ZOOM,
    sailings: Object.fromEntries([...patterns.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v.n])),
    routes: [north, south].map(tidy),
    alternatives: [feoyLine, afterFeoy, spur].map(tidy),
    stops: { Røvær: rovaer, Haugesund: haugesund },
  };
  fs.writeFileSync(ROUTES, JSON.stringify(data, null, 1) + '\n');
  return data;
}

await buildImage();
const data = await buildRoutes();
console.log(`${width}x${height} image; sailings over two weeks:`, data.sailings);

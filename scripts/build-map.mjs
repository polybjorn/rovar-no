// Rebuilds the front-page map: stitches Kartverket topo tiles over a fixed
// box into src/assets/kart-rovar.png, and writes the boat's lines, projected
// onto that image, into src/data/map-routes.json. The northern line follows
// Kystverket's fairway; the southern line and the Feøy sailings follow the
// ferry routes Kartverket draws dashed on the map itself (N50); the turn into
// Kveitevik and the last stretch through Smedasundet follow Entur's paths.
//
//   node scripts/build-map.mjs
//
// Run it again when Kolumbus changes the route. The image and the routes share
// one projection, so regenerate both together rather than either alone.
import fs from 'node:fs';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { ENTUR_API, ENTUR_CLIENT, HAUGESUND_STOP } from '../src/scripts/departures-core.js';

const ZOOM = 13;
// West, south, east, north: Røvær to Haugesund, and south far enough for the
// Feøy and Kveitevik calls.
const BOX = [5.05, 59.368, 5.3, 59.455];
const TILE = 256;
// Kystverket's secondary fairway (biled) for this route, for the northern
// channel the boat often takes, which neither Entur nor N50 has. Open data
// under NLOD 2.0.
const FAIRWAY = 'Haugesund - Røvær - Feøy';
const FAIRWAY_URL = `https://services.kystverket.no/wfs.ashx?service=WFS&version=1.1.0&request=GetFeature&typeName=layer_552&srsName=EPSG:4326&bbox=${BOX[1]},${BOX[0]},${BOX[3]},${BOX[2]},EPSG:4326`;
// The fairway is one line that doubles back on itself to cover every leg.
// The northern leg runs from vertex 6, at the Røvær quay, to 15, on the
// Haugesund approach. Vertex 0 is where its southern leg ends west of
// Storøya, which is also where N50's eastward passenger link from Røvær
// ends. buildRoutes checks both, so a redrawn fairway fails the run rather
// than the map.
const NORTH_LEG = [6, 15];
const SOUTH_END = 0;
// How far along the shared approach the southern line rejoins it, in image
// pixels past the point nearest where N50 stops.
const REJOIN = 120;
// Kartverket's N50 map data, ordered through Geonorge's download API for the
// two municipalities the routes cross (Haugesund and Karmøy). Its passenger
// ferry links are the dashed lines on the topo map. CC BY 4.0.
const N50 = 'ea192681-d039-42ec-b1bc-f3ce04c189ac';
const N50_AREAS = [
  { code: '1106', type: 'kommune', name: 'Haugesund' },
  { code: '1149', type: 'kommune', name: 'Karmøy' },
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

// How close, in image pixels, a line's loose end must be to a drawn line to
// be joined onto it.
const SNAP = 25;

// The part of line that leaves the lines already drawn: from the last point
// still on one to the first point back on one, both snapped onto it so the
// branch starts and ends on the line it shares rather than beside it.
function branch(line, bases, tol) {
  const onto = (p) => bases.map((b) => project(b, p)).reduce((a, b) => (b.d < a.d ? b : a));
  const off = line.map((p) => onto(p).d > tol);
  const first = off.indexOf(true);
  const last = off.lastIndexOf(true);
  if (first < 0) return [];
  // An end that stops just short of a drawn line is joined onto it; one that
  // never comes near, like a line out to Feøy, stays where it is.
  const join = (i, j) => (i !== j ? [onto(line[i]).point] : onto(line[j]).d < SNAP ? [onto(line[j]).point] : []);
  return [...join(first > 0 ? first - 1 : 0, first), ...line.slice(first, last + 1), ...join(last < line.length - 1 ? last + 1 : last, last)];
}

// Warn about any stretch of a line that runs over land on the map image.
async function landCheck(lines) {
  const { data, info } = await sharp(IMAGE.pathname).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sea = (x, y) => {
    const i = (y * info.width + x) * 3;
    return data[i + 2] >= 240 && data[i + 2] - data[i] >= 15;
  };
  // Sea within 2 pixels counts: the lines run along the map's own dashed
  // ferry lines and through sounds a few pixels wide, neither of which is land.
  const land = ([x, y]) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (sea(Math.round(x) + dx, Math.round(y) + dy)) return false;
    return true;
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

// EUREF89 UTM zone 33 to latitude and longitude, which is what N50 comes in.
function utm33(e, n) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = e - 500000;
  const mu = n / k0 / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const c = ep2 * Math.cos(p) ** 2;
  const t = Math.tan(p) ** 2;
  const nu = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const rho = (a * (1 - e2)) / (1 - e2 * Math.sin(p) ** 2) ** 1.5;
  const d = x / (nu * k0);
  const lat = p - ((nu * Math.tan(p)) / rho) * (d ** 2 / 2 - ((5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * ep2) * d ** 4) / 24
    + ((61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * ep2 - 3 * c ** 2) * d ** 6) / 720);
  const lon = (d - ((1 + 2 * t + c) * d ** 3) / 6 + ((5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * ep2 + 24 * t ** 2) * d ** 5) / 120) / Math.cos(p);
  return [(lat * 180) / Math.PI, 15 + (lon * 180) / Math.PI];
}

// The one member of a zip whose name matches, inflated. Enough of the format
// for Geonorge's downloads, so the script needs no unzip on the PATH.
function unzipOne(buf, match) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    if (match.test(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 8 ? zlib.inflateRawSync(data) : data;
    }
    at += 46 + nameLen + extra + comment;
  }
  throw new Error(`no ${match} in the zip`);
}

// N50's passenger ferry links, as segments in image pixels.
async function fetchFerryLinks() {
  const order = await fetch('https://nedlasting.geonorge.no/api/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: '',
      orderLines: [{ metadataUuid: N50, areas: N50_AREAS, formats: [{ name: 'GML' }], projections: [{ code: '25833' }] }],
    }),
  }).then((r) => r.json());
  const links = [];
  for (const file of order.files) {
    if (file.status !== 'ReadyForDownload') throw new Error(`N50 ${file.areaName} is ${file.status}`);
    const zip = Buffer.from(await (await fetch(file.downloadUrl)).arrayBuffer());
    const gml = unzipOne(zip, /N50Samferdsel_GML\.gml$/).toString('utf8');
    for (const member of gml.split(/<gml:featureMember>|<wfs:member>/).slice(1)) {
      if (!member.includes('<app:typeVeg>passasjerferje<')) continue;
      const nums = member.match(/<gml:posList[^>]*>([^<]*)/)[1].trim().split(/\s+/).map(Number);
      const line = [];
      for (let i = 0; i < nums.length; i += 2) line.push(at(...utm33(nums[i], nums[i + 1])));
      links.push(line);
    }
  }
  return links;
}

// The shortest way through the ferry links from the end nearest a to the end
// nearest b. Links meet at shared end points, which is how N50 joins them.
function ferryPath(links, a, b) {
  const key = ([x, y]) => `${Math.round(x)},${Math.round(y)}`;
  const edges = new Map();
  const add = (from, to, line) => edges.set(from, [...(edges.get(from) ?? []), { to, line }]);
  const length = (line) => line.slice(1).reduce((sum, p, i) => sum + dist(line[i], p), 0);
  for (const line of links) {
    add(key(line[0]), key(line.at(-1)), line);
    add(key(line.at(-1)), key(line[0]), [...line].reverse());
  }
  const ends = links.flatMap((l) => [l[0], l.at(-1)]);
  const near = (p) => key(ends.reduce((best, q) => (dist(q, p) < dist(best, p) ? q : best)));
  const [from, to] = [near(a), near(b)];
  const cost = new Map([[from, 0]]);
  const via = new Map();
  const open = new Set([from]);
  while (open.size) {
    const here = [...open].reduce((best, k) => (cost.get(k) < cost.get(best) ? k : best));
    open.delete(here);
    if (here === to) break;
    for (const { to: next, line } of edges.get(here) ?? []) {
      const c = cost.get(here) + length(line);
      if (c < (cost.get(next) ?? Infinity)) {
        cost.set(next, c);
        via.set(next, { from: here, line });
        open.add(next);
      }
    }
  }
  if (!via.has(to)) throw new Error(`N50 has no ferry link path from ${from} to ${to}`);
  const legs = [];
  for (let k = to; k !== from; k = via.get(k).from) legs.unshift(via.get(k).line);
  // Each leg starts on the point the one before it ended on.
  return legs.flatMap((line, i) => (i ? line.slice(1) : line));
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

  const fairway = await fetchFairway();
  if (dist(fairway[NORTH_LEG[0]], rovaer) > 15) throw new Error('fairway vertex 6 is no longer at the Røvær quay');
  const links = await fetchFerryLinks();

  // The approach both lines share: the fairway's northern leg, smoothed, then
  // Entur's path through Smedasundet to the quay, which the fairway does not
  // go into. Entur's paths here run from Haugesund; turn this one round.
  const inbound = [...direct.path].reverse();
  const across = smooth(slice(fairway, NORTH_LEG));
  const north = [rovaer, ...across, ...inbound.slice(nearestIndex(inbound, across.at(-1)) + 1)];

  // Southern: Entur's path down Røvær's harbour channel, which N50 starts
  // below, then N50's passenger links east to where they stop west of
  // Storøya, then a curve onto the shared approach.
  const ferry = ferryPath(links, rovaer, fairway[SOUTH_END]);
  if (dist(ferry.at(-1), fairway[SOUTH_END]) > 25) throw new Error("N50's eastward link from Røvær no longer ends at fairway vertex 0");
  const end = ferry.at(-1);
  let rejoin = nearestIndex(north, end);
  for (let run = 0; run < REJOIN && rejoin < north.length - 1; rejoin++) run += dist(north[rejoin], north[rejoin + 1]);
  const unit = (a, b) => [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)];
  const out = unit(ferry.at(-2), end);
  const arrive = unit(north[rejoin], north[rejoin + 1]);
  const reach = dist(end, north[rejoin]) / 3;
  const c1 = [end[0] + out[0] * reach, end[1] + out[1] * reach];
  const c2 = [north[rejoin][0] - arrive[0] * reach, north[rejoin][1] - arrive[1] * reach];
  const curve = Array.from({ length: 16 }, (_, i) => {
    const t = (i + 1) / 16;
    const u = 1 - t;
    return [0, 1].map((k) => u ** 3 * end[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t ** 3 * north[rejoin][k]);
  });
  const south = [...inbound.slice(0, nearestIndex(inbound, ferry[0])), ...ferry, ...curve, ...north.slice(rejoin + 1)];

  // The occasional sailings, dotted, each starting where it leaves a line
  // already drawn: Haugesund to Feøy and Røvær to Feøy along N50's links, and
  // the turn into Kveitevik along Entur's path.
  const feoyLine = branch([...ferryPath(links, haugesund, feoyQuay), feoyQuay], [south], 3);
  const afterFeoy = branch([...ferryPath(links, rovaer, feoyQuay), feoyQuay], [south, feoyLine], 3);
  // Entur's Kveitevik path starts where it leaves Entur's own Feøy path, so
  // the two sources' small differences do not show as a second line, joined
  // onto the N50 Feøy line there, and ends where it meets that line again on
  // the way into Feøy.
  const leaves = kveitevik.path.findIndex((p) => project(feoy.path, p).d > 1.5);
  if (leaves < 1) throw new Error("Entur's Kveitevik path no longer starts along the Feøy path");
  const spur = branch([project(feoyLine, kveitevik.path[leaves - 1]).point, ...kveitevik.path.slice(leaves)], [feoyLine], 4);

  await landCheck({ north, south, 'Haugesund > Feøy': feoyLine, Kveitevik: spur, 'Røvær > Feøy': afterFeoy });

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

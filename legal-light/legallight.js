// Legal Light: sunrise, sunset, civil twilight and legal shooting hours for any place and date.
// NOAA solar-position equations (after Meeus): within about a minute of the reference tables
// between the polar circles. No dependencies; works in a browser or in Node.
//
//   import { sunTimes, legalHours, moon } from "./legallight.js";
//   sunTimes(2026, 11, 14, 53.5461, -113.4938)     // Edmonton, UTC Date objects
//   legalHours(2026, 11, 14, 53.5461, -113.4938, { before: 30, after: 30 })
//
// Times are returned as JavaScript Dates (absolute instants). Format them in the hunter's
// time zone with Intl.DateTimeFormat, which handles daylight saving.

const RAD = Math.PI / 180;
const ZENITH = { sun: 90.833, civil: 96 };   // 90.833: refraction + the sun's radius; 96: civil twilight

function solar(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
          + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T)
          + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan(eps * RAD / 2) ** 2;
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
            + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
            - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eot };                       // radians, minutes
}

const jdOf = (ms) => ms / 86400000 + 2440587.5;

// Minutes after 00:00 UTC of the given date when the sun crosses `zenith` (rising: sign -1, setting: +1).
// Returns null if it never does that day (midnight sun / polar night).
function crossing(utcMidnight, lat, lon, zenith, sign) {
  let t = 720 - 4 * lon;                      // first guess: solar noon
  for (let i = 0; i < 3; i++) {
    const { decl, eot } = solar(jdOf(utcMidnight + t * 60000));
    const cosH = Math.cos(zenith * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
    if (cosH > 1 || cosH < -1) return { none: cosH > 1 ? "down" : "up" };
    t = 720 - 4 * lon - eot + sign * 4 * Math.acos(cosH) / RAD;
  }
  return { t };
}

function at(utcMidnight, c) { return c.t === undefined ? null : new Date(utcMidnight + Math.round(c.t * 60000)); }

/** Sun events for a local calendar date (year, month 1-12, day) at lat/lon in degrees (west negative). */
export function sunTimes(year, month, day, lat, lon) {
  const m0 = Date.UTC(year, month - 1, day);
  const rise = crossing(m0, lat, lon, ZENITH.sun, -1), set = crossing(m0, lat, lon, ZENITH.sun, 1);
  const dawn = crossing(m0, lat, lon, ZENITH.civil, -1), dusk = crossing(m0, lat, lon, ZENITH.civil, 1);
  const { eot } = solar(jdOf(m0 + (720 - 4 * lon) * 60000));
  return {
    sunrise: at(m0, rise), sunset: at(m0, set),
    civilDawn: at(m0, dawn), civilDusk: at(m0, dusk),
    noon: new Date(m0 + Math.round((720 - 4 * lon - eot) * 60000)),
    polar: rise.none || null,                 // "up" = midnight sun, "down" = polar night
  };
}

/**
 * Legal shooting hours: `before` minutes before sunrise to `after` minutes after sunset.
 * Most rules are 30/30, but check yours: some areas or species end at sunset (after: 0)
 * or start at sunrise. Returns null times on days the sun doesn't rise or set.
 */
export function legalHours(year, month, day, lat, lon, { before = 30, after = 30 } = {}) {
  const s = sunTimes(year, month, day, lat, lon);
  // Rounded to whole minutes on the safe side: start up, end down. Never a minute early or late.
  const start = s.sunrise && new Date(Math.ceil((s.sunrise.getTime() - before * 60000) / 60000) * 60000);
  const end = s.sunset && new Date(Math.floor((s.sunset.getTime() + after * 60000) / 60000) * 60000);
  return { ...s, start, end, minutes: start && end ? Math.round((end - start) / 60000) : null };
}

/**
 * Moon phase at an instant: age in days since new moon, fraction lit (0-1), and a name.
 * Mean synodic month from a known new moon, so it can be off by up to about half a day.
 */
export function moon(date) {
  const P = 29.530588853, NEW = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((date.getTime() - NEW) / 86400000) % P + P) % P;
  const lit = (1 - Math.cos(2 * Math.PI * age / P)) / 2;
  const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous",
                 "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  return { age, lit, name: names[Math.floor((age / P) * 8 + 0.5) % 8] };
}

/** "HH:MM" (nearest minute) for a Date in an IANA time zone (e.g. "America/Edmonton"); "—" for null.
 *  Legal start and end are already whole minutes, rounded the safe way, so they print unchanged. */
export function hhmm(date, timeZone) {
  if (!date) return "—";
  const t = new Date(Math.floor((date.getTime() + 30000) / 60000) * 60000);   // Intl truncates; round instead
  return new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(t);
}

// ---------------------------------------------------------------------------------------------
// Sun on your stand: where the sun is, and when direct sunlight actually reaches a spot once the
// terrain horizon and the slope of the ground are taken into account.

/** Sun position at an instant: apparent altitude (degrees, refraction included) and azimuth
 *  (degrees clockwise from true north). */
export function sunPosition(date, lat, lon) {
  const ms = date.getTime();
  const { decl, eot } = solar(jdOf(ms));
  const utcMin = ((ms / 60000) % 1440 + 1440) % 1440;
  const ha = ((utcMin + eot + 4 * lon) / 4 - 180) * RAD;            // hour angle
  const phi = lat * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD;
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180) % 360;
  return { altitude: alt + refraction(alt), azimuth: az, trueAltitude: alt };
}

/** Atmospheric refraction in degrees for a true altitude (Sæmundsson's formula; 0.57° at the horizon). */
export function refraction(alt) {
  if (alt < -2) return 0;
  return 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * RAD) / 60;
}

/** Horizon elevation (degrees) at an azimuth, from a profile sampled every 360/n degrees. */
export function horizonAt(profile, az) {
  if (!profile || !profile.length) return 0;
  const n = profile.length, x = (((az % 360) + 360) % 360) / (360 / n), i = Math.floor(x) % n, f = x - Math.floor(x);
  return profile[i] * (1 - f) + profile[(i + 1) % n] * f;
}

/** A horizon profile from "azimuth:elevation" pairs, e.g. "90:8, 135:5, 270:3" (linear between points). */
export function parseHorizon(text, n = 72) {
  const pts = String(text).split(/[,;\s]+/).filter(Boolean).map((p) => p.split(":").map(Number))
    .filter(([a, e]) => Number.isFinite(a) && Number.isFinite(e)).sort((p, q) => p[0] - q[0]);
  if (!pts.length) return null;
  const out = [];
  for (let k = 0; k < n; k++) {
    const az = k * 360 / n;
    let lo = pts[pts.length - 1], hi = pts[0];
    for (let j = 0; j < pts.length; j++) { if (pts[j][0] <= az) lo = pts[j]; if (pts[j][0] >= az) { hi = pts[j]; break; } }
    const span = ((hi[0] - lo[0]) + 360) % 360 || 360, d = ((az - lo[0]) + 360) % 360;
    out.push(pts.length === 1 ? pts[0][1] : lo[1] + (hi[1] - lo[1]) * d / span);
  }
  return out;
}

/**
 * Horizon profile from elevation data. `elev(lat, lon)` returns metres (any source: tiles, a GeoTIFF).
 * For each of `n` azimuths, march outward to `radius` metres and keep the steepest angle up to the
 * terrain, allowing for the Earth's curvature and normal atmospheric refraction (k = 0.13).
 */
export function horizonFromElevation(elev, lat, lon, { n = 72, radius = 10000, step = 30, eyeHeight = 2 } = {}) {
  const R = 6371000, k = 0.13;
  const h0 = elev(lat, lon) + eyeHeight;
  const out = [];
  for (let i = 0; i < n; i++) {
    const az = i * 2 * Math.PI / n;
    let best = -90;
    for (let d = step; d <= radius; d += d < 2000 ? step : step * 2) {
      const dLat = d * Math.cos(az) / R / RAD, dLon = d * Math.sin(az) / (R * Math.cos(lat * RAD)) / RAD;
      const h = elev(lat + dLat, lon + dLon);
      if (!Number.isFinite(h)) continue;
      const drop = (1 - k) * d * d / (2 * R);                   // curvature, less refraction
      const ang = Math.atan2(h - drop - h0, d) / RAD;
      if (ang > best) best = ang;
    }
    out.push(Math.max(best, -2));
  }
  return { profile: out, elevation: h0 - eyeHeight };
}

/** Slope (degrees) and aspect (degrees clockwise from north, the way the slope faces) from elevation data. */
export function slopeAspect(elev, lat, lon, span = 30) {
  const R = 6371000, dLat = span / R / RAD, dLon = span / (R * Math.cos(lat * RAD)) / RAD;
  const dzdx = (elev(lat, lon + dLon) - elev(lat, lon - dLon)) / (2 * span);   // east
  const dzdy = (elev(lat + dLat, lon) - elev(lat - dLat, lon)) / (2 * span);   // north
  const slope = Math.atan(Math.hypot(dzdx, dzdy)) / RAD;
  const aspect = (Math.atan2(-dzdx, -dzdy) / RAD + 360) % 360;                // downhill direction
  return { slope, aspect };
}

/**
 * When direct sun reaches a spot on a local date: the sun's upper edge must clear the terrain
 * horizon, and (if `slope` is given) the sun must be on the face of the ground (incidence > 0).
 * Returns the first and last sunlit minute and the total sunlit minutes; null times if none.
 */
export function directSun(year, month, day, lat, lon, { horizon = null, slope = 0, aspect = 180, stepMin = 1 } = {}) {
  const s = sunTimes(year, month, day, lat, lon);
  const from = (s.civilDawn || s.sunrise || new Date(Date.UTC(year, month - 1, day) - 4 * lon * 60000)).getTime() - 3600000;
  const to = (s.civilDusk || s.sunset || new Date(from + 26 * 3600000)).getTime() + 3600000;
  const sl = slope * RAD, asp = aspect * RAD;
  let first = null, last = null, minutes = 0;
  for (let t = from; t <= to; t += stepMin * 60000) {
    const p = sunPosition(new Date(t), lat, lon);
    const clear = p.altitude + 0.267 > horizonAt(horizon, p.azimuth);   // 0.267°: the sun's radius
    const alt = p.trueAltitude * RAD, az = p.azimuth * RAD;
    const facing = !slope || Math.cos(sl) * Math.sin(alt) + Math.sin(sl) * Math.cos(alt) * Math.cos(az - asp) > 0;
    if (clear && facing) { if (first === null) first = t; last = t; minutes += stepMin; }
  }
  return { first: first && new Date(first), last: last && new Date(last), minutes, sunrise: s.sunrise, sunset: s.sunset };
}

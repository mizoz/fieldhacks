// SlopeShift Analyzer core: a port of 04-slopeshift/tools/slopeshift.py and sun.py for the browser.
// CI checks it gives the same answers as the Python tool (04-slopeshift/tests/js_analyzer.mjs).
// Times are handled as plain "minutes" or UTC milliseconds; no time-zone library is needed beyond Intl.
// © 2026 ZalaStack. All rights reserved.

export const NAMES = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");
export const MORNING = [3, 6, 12], EVENING = [13, 16, 22];
// Lake and sea breezes turn later in the day; learn them with slope 0 (sun on flat land).
export const SITES = { slope: [MORNING, EVENING], shore: [[3, 7, 16], [14, 17, 24]] };
export const WINDOW_MIN = 20, SWITCH_DEG = 90, AGREE_DEG = 45, MIN_STEADY = 0.5;
const RAD = Math.PI / 180, MIN = 60000;
const mod = (a, n) => ((a % n) + n) % n;

// ---------------------------------------------------------------- data
// Rows: { t: minutes since 1970-01-01 00:00 on the logger's clock, day: "YYYY-MM-DD", hour, minute, deg|null, mph }
export function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("time,")) continue;
    const [time, , deg, mph] = line.split(",");
    if (!time || time.startsWith("unset")) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(time.trim());
    if (!m) continue;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / MIN;
    rows.push({ t, day: `${m[1]}-${m[2]}-${m[3]}`, hour: +m[4], minute: +m[5], deg: deg === "" || deg === undefined ? null : parseFloat(deg), mph: parseFloat(mph) || 0 });
  }
  return rows;
}

export function byDay(rows) {
  const days = new Map();
  for (const r of rows) { if (!days.has(r.day)) days.set(r.day, []); days.get(r.day).push(r); }
  return new Map([...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function vmean(degs) {
  if (!degs.length) return [null, 0];
  let x = 0, y = 0;
  for (const d of degs) { x += Math.sin(d * RAD); y += Math.cos(d * RAD); }
  const r = Math.hypot(x, y) / degs.length;
  return r > 1e-6 ? [mod(Math.atan2(x, y) / RAD, 360), r] : [null, 0];
}
export const diff = (a, b) => Math.abs(mod(a - b + 180, 360) - 180);
export const name = (deg) => NAMES[Math.floor((deg + 11.25) / 22.5) % 16];

// One day's switch: [t (logger minutes), baseline deg, new deg] or null.
export function findSwitch(dayRows, baseFrom, baseTo, searchTo, win = WINDOW_MIN) {
  const base = dayRows.filter((r) => r.deg !== null && r.mph > 0 && r.hour >= baseFrom && r.hour < baseTo).map((r) => r.deg);
  const [b, steady] = vmean(base);
  if (b === null || base.length < 30 || steady < MIN_STEADY) return null;
  const later = dayRows.filter((r) => r.deg !== null && r.mph > 0 && r.hour >= baseTo && r.hour < searchTo);
  const windows = [], at = new Map();
  let j = 0;
  for (let i = 0; i < later.length; i++) {
    const t0 = later[i].t, w = [];
    for (let k = i; k < later.length && later[k].t < t0 + win; k++) w.push(later[k].deg);
    if (w.length >= Math.floor(win / 2)) { const d = vmean(w)[0]; windows.push([t0, d]); at.set(t0, d); }
  }
  for (const [t0, d0] of windows) {
    if (d0 === null || diff(d0, b) <= SWITCH_DEG) continue;
    const nxt = [1, 2].map((k) => at.get(t0 + win * k));
    if (nxt.every((n) => n !== undefined && n !== null && diff(n, b) > SWITCH_DEG && diff(n, d0) <= AGREE_DEG)) {
      const settled = later.filter((r) => r.t >= t0 && r.t < t0 + 60).map((r) => r.deg);
      return [t0, b, vmean(settled)[0]];
    }
  }
  return null;
}

export const clock = (t) => { const m = mod(Math.round(t), 1440); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

export function report(rows, site = "slope") {
  const days = byDay(rows), am = new Map(), pm = new Map(), [morning, evening] = SITES[site];
  for (const [d, rs] of days) {
    const a = findSwitch(rs, ...morning); if (a) am.set(d, a);
    const p = findSwitch(rs, ...evening); if (p) pm.set(d, p);
  }
  const summarise = (sw) => {
    if (!sw.size) return null;
    const mins = [...sw.values()].map((s) => mod(s[0], 1440)).sort((x, y) => x - y);
    return { n: sw.size, median: mins[Math.floor(mins.length / 2)], earliest: mins[0], latest: mins[mins.length - 1],
             from: vmean([...sw.values()].map((s) => s[1]))[0], to: vmean([...sw.values()].map((s) => s[2]))[0] };
  };
  return { days, am, pm, morning, evening, amSummary: summarise(am), pmSummary: summarise(pm),
           calm: rows.filter((r) => r.mph === 0).length / Math.max(1, rows.length) };
}

// ---------------------------------------------------------------- sun
// NOAA solar position. Returns [elevation, azimuth] in degrees (azimuth clockwise from north).
export function sunPosition(utcMs, lat, lon, refraction = true) {
  const jd = utcMs / 86400000 + 2440587.5, t = (jd - 2451545) / 36525;
  const l0 = mod(280.46646 + t * (36000.76983 + 0.0003032 * t), 360);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t), e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * RAD;
  const c = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const appLong = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) / RAD;
  const y = Math.tan(eps / 2 * RAD) ** 2, l0r = l0 * RAD;
  const eqt = 4 / RAD * (y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r)
                - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
  const d = new Date(utcMs);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  const ha = mod(minutes + eqt + 4 * lon, 1440) / 4 - 180;
  const latr = lat * RAD, dr = decl * RAD, har = ha * RAD;
  const cosz = Math.sin(latr) * Math.sin(dr) + Math.cos(latr) * Math.cos(dr) * Math.cos(har);
  let elev = 90 - Math.acos(Math.max(-1, Math.min(1, cosz))) / RAD;
  const az = mod(Math.atan2(Math.sin(har), Math.cos(har) * Math.sin(latr) - Math.tan(dr) * Math.cos(latr)) / RAD + 180, 360);
  if (refraction && elev > -0.575) {
    const te = Math.tan(elev * RAD);
    elev += elev > 5 ? (58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5) / 3600
                     : (1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))) / 3600;
  }
  return [elev, az];
}

export const HORIZON_DIP_DEG = 0.833;
export function onSlope(elev, az, slope, aspect) {
  if (elev <= -HORIZON_DIP_DEG) return false;
  const s = [Math.sin(az * RAD) * Math.cos(elev * RAD), Math.cos(az * RAD) * Math.cos(elev * RAD), Math.sin(elev * RAD)];
  const b = slope * RAD, g = aspect * RAD;
  const n = [Math.sin(g) * Math.sin(b), Math.cos(g) * Math.sin(b), Math.cos(b)];
  return s[0] * n[0] + s[1] * n[1] + s[2] * n[2] > -Math.sin(HORIZON_DIP_DEG * RAD);
}

export function parseHorizon(spec) {
  if (!spec) return null;
  const pts = spec.split(",").map((p) => p.split(":").map(Number)).map(([a, e]) => [mod(a, 360), e]).sort((p, q) => p[0] - q[0]);
  if (!pts.length || pts.some(([a, e]) => !isFinite(a) || !isFinite(e))) return null;
  return (az) => {
    az = mod(az, 360);
    const ring = [...pts, [pts[0][0] + 360, pts[0][1]]];
    for (let i = 0; i < ring.length - 1; i++) {
      const [a0, e0] = ring[i], [a1, e1] = ring[i + 1];
      for (const x of [az, az + 360]) if (a0 <= x && x <= a1) return e0 + (e1 - e0) * (x - a0) / (a1 - a0 || 1);
    }
    return pts[0][1];
  };
}

// 2026 changes that older browsers may not have yet (IANA tzdata 2026c–2026e): these zones stop
// falling back on 1 Nov 2026 and keep their summer offset all year. If the browser disagrees after
// that date, trust this table. (Node and current Python already have the new rules.)
const PERMANENT_2026 = { "America/Edmonton": -360, "America/Yellowknife": -360, "America/Inuvik": -360,
                         "America/Vancouver": -420, "America/Winnipeg": -300 };
const CHANGE_UTC = Date.UTC(2026, 10, 1, 9);   // 1 Nov 2026, after the last fall-back would have happened

// UTC offset (minutes) of an IANA zone at a UTC instant.
export function tzOffsetMin(tz, utcMs) {
  const intl = intlOffsetMin(tz, utcMs);
  return tz in PERMANENT_2026 && utcMs >= CHANGE_UTC ? PERMANENT_2026[tz] : intl;
}
export const browserIsBehind = (tz) => tz in PERMANENT_2026 && intlOffsetMin(tz, Date.UTC(2027, 0, 15, 18)) !== PERMANENT_2026[tz];

function intlOffsetMin(tz, utcMs) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000) / MIN;
}

// First/last moment of direct sun on the slope for a local date "YYYY-MM-DD":
// { first, last } as minutes after local midnight (rounded to the nearest minute), plus the UTC offset used.
// UTC offset (minutes) in force at local noon on a date.
export function noonOffsetMin(day, tz) {
  const [Y, M, D] = day.split("-").map(Number);
  const noonUtc = Date.UTC(Y, M - 1, D, 12);
  return tzOffsetMin(tz, noonUtc - tzOffsetMin(tz, noonUtc) * MIN);
}

export function slopeSunTimes(day, stand, horizonFn) {
  const [Y, M, D] = day.split("-").map(Number);
  const off = noonOffsetMin(day, stand.tz);
  const midnightUtc = Date.UTC(Y, M - 1, D) - off * MIN;
  const lit = (sec) => {
    const [el, az] = sunPosition(midnightUtc + sec * 1000, stand.lat, stand.lon, false);
    if (horizonFn && el + HORIZON_DIP_DEG < horizonFn(az)) return false;
    return onSlope(el, az, stand.slope_deg, stand.aspect_deg);
  };
  const edge = (a, b) => { const la = lit(a); while (b - a > 1) { const m = (a + b) / 2; if (lit(m) === la) a = m; else b = m; } return la ? a : b; };
  let first = null, last = null, prev = lit(0);
  for (let k = 1; k <= 1440; k++) {
    const now = lit(k * 60);
    if (now && !prev && first === null) first = edge((k - 1) * 60, k * 60);
    if (prev && !now) last = edge((k - 1) * 60, k * 60);
    prev = now;
  }
  if (first === null && prev) first = 0;
  if (prev && last === null && first !== null) last = 86399;
  const rnd = (s) => (s === null ? null : Math.floor((s + 30) / 60));
  return { first: rnd(first), last: rnd(last), offsetMin: off };
}

// ---------------------------------------------------------------- learn / predict
const pct = (xs, q) => {
  xs = [...xs].sort((a, b) => a - b);
  if (xs.length === 1) return xs[0];
  const k = (xs.length - 1) * q, i = Math.floor(k);
  return xs[i] + (xs[Math.min(i + 1, xs.length - 1)] - xs[i]) * (k - i);
};
const round1 = (x) => Math.round(x * 10) / 10;
const dayAdd = (day, n) => { const [Y, M, D] = day.split("-").map(Number); return new Date(Date.UTC(Y, M - 1, D + n)).toISOString().slice(0, 10); };

// stand: { lat, lon, tz, slope_deg, aspect_deg, horizon, log_utc_offset_h?, site? ("slope" | "shore") }
export function learn(rows, stand) {
  const days = byDay(rows);
  const firstDay = days.keys().next().value;
  let offset = stand.log_utc_offset_h;
  if (offset === undefined || offset === null) offset = noonOffsetMin(firstDay, stand.tz) / 60;
  const st = { ...stand, horizon: stand.horizon || null, log_utc_offset_h: offset };
  if (!st.site || st.site === "slope") delete st.site;
  const [morning, evening] = SITES[st.site || "slope"];
  const hz = parseHorizon(st.horizon);
  const out = { version: 1, stand: st, days: [] };
  const lags = { morning: [], evening: [] }, raw = { morning: [], evening: [] }, dirs = { morning: [[], []], evening: [[], []] };
  for (const [day, rs] of days) {
    const sun = slopeSunTimes(day, st, hz);
    const shift = offset * 60 - sun.offsetMin;          // stand-local minutes -> logger-clock minutes
    const rec = { date: day, first_sun: sun.first === null ? null : clock(sun.first + shift), last_sun: sun.last === null ? null : clock(sun.last + shift) };
    for (const [key, win, anchor] of [["morning", morning, sun.first], ["evening", evening, sun.last]]) {
      const sw = findSwitch(rs, ...win);
      rec[key + "_switch"] = sw ? clock(sw[0]) : null;
      if (sw && anchor !== null) {
        lags[key].push(mod(sw[0], 1440) - (anchor + shift));
        raw[key].push(mod(sw[0], 1440));
        dirs[key][0].push(sw[1]); dirs[key][1].push(sw[2]);
      }
    }
    out.days.push(rec);
  }
  for (const key of ["morning", "evening"]) {
    const L = lags[key];
    if (L.length < 3) { out[key] = null; continue; }
    out[key] = {
      anchor: key === "morning" ? "first_direct_sun" : "last_direct_sun",
      lag_min: { median: round1(pct(L, 0.5)), p10: round1(pct(L, 0.1)), p90: round1(pct(L, 0.9)), n: L.length },
      from_deg: Math.round(vmean(dirs[key][0])[0]), to_deg: Math.round(vmean(dirs[key][1])[0]),
      spread_min: { switch_time: round1(pct(raw[key], 0.9) - pct(raw[key], 0.1)), after_sun_model: round1(pct(L, 0.9) - pct(L, 0.1)) },
    };
  }
  return out;
}

export function predict(model, fromDay, toDay) {
  const st = model.stand, hz = parseHorizon(st.horizon), res = [];
  for (let day = fromDay; day <= toDay; day = dayAdd(day, 1)) {
    const sun = slopeSunTimes(day, st, hz), rec = { date: day };
    for (const [key, anchor] of [["morning", sun.first], ["evening", sun.last]]) {
      const m = model[key];
      if (!m || anchor === null) { rec[key] = null; continue; }
      const at = (mins) => clock(Math.floor(anchor + mins));      // the Python tool truncates seconds
      rec[key] = { sun: clock(anchor), switch: at(m.lag_min.median), earliest: at(m.lag_min.p10), latest: at(m.lag_min.p90),
                   from_deg: m.from_deg, to_deg: m.to_deg };
    }
    res.push(rec);
  }
  return res;
}

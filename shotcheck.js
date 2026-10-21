// HoldPoint "shot check": chance of a vital-zone hit at each range, and the longest range where
// that chance is still above your threshold. Imperial units throughout (inches, yards, mph).
//
// Error sources, each treated as a normal distribution (1 sigma = the "typical error" you enter):
//   you + rifle:  your 5-shot group from a field position. Extreme spread of 5 shots ≈ 3.07 σ.
//   wind call:    a typical wind-reading error in mph × this range's drift per mph   (left/right)
//   range:        a typical ranging error in % of range × how fast the drop changes   (up/down)
// Holding dead on the centre of a round vital zone, the hit chance is the share of impacts that
// land inside it. That share is estimated with a fixed set of random points, so the numbers are
// stable from one keystroke to the next.

const N = 4000;
const SAMPLES = (() => {
  let s = 12345;                                        // small LCG, fixed seed: repeatable results
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
  const out = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) {
    const r = Math.sqrt(-2 * Math.log(rnd())), a = 2 * Math.PI * rnd();
    out[2 * i] = r * Math.cos(a); out[2 * i + 1] = r * Math.sin(a);
  }
  return out;
})();

export function hitChance(sx, sy, radius) {
  if (sx <= 0 && sy <= 0) return 1;
  let n = 0;
  const r2 = radius * radius;
  for (let i = 0; i < N; i++) {
    const x = SAMPLES[2 * i] * sx, y = SAMPLES[2 * i + 1] * sy;
    if (x * x + y * y <= r2) n++;
  }
  return n / N;
}

// rows: solver output (range_yd, drop_in, energy_ftlb), driftPerMph: inches per mph at each row.
// o: { groupMoa, windErrMph, rangeErrPct, vitalIn, conf (0..1), minEnergy }
export function shotCheck(rows, driftPerMph, o) {
  const res = rows.map((r, i) => {
    const prev = rows[Math.max(0, i - 1)], next = rows[Math.min(rows.length - 1, i + 1)];
    const dDrop = next.range_yd !== prev.range_yd ? (next.drop_in - prev.drop_in) / (next.range_yd - prev.range_yd) : 0;
    const shooter = (o.groupMoa * 1.0472 * r.range_yd / 100) / 3.07;
    const wind = Math.abs(driftPerMph[i]) * o.windErrMph;
    const range = Math.abs(dDrop) * r.range_yd * o.rangeErrPct / 100;
    const sx = Math.hypot(shooter, wind), sy = Math.hypot(shooter, range);
    const p = hitChance(sx, sy, o.vitalIn / 2);
    return { p, sx, sy, shooter, wind, range,
             biggest: wind >= range && wind >= shooter ? "wind" : range >= shooter ? "range" : "you + rifle" };
  });
  // Ethical range: the last range before the first one that fails, so a lucky long row can't count.
  let maxYd = 0;
  for (let i = 0; i < rows.length; i++) {
    const ok = res[i].p >= o.conf && (!o.minEnergy || rows[i].energy_ftlb >= o.minEnergy);
    if (!ok) break;
    maxYd = rows[i].range_yd;
  }
  return { rows: res, maxYd };
}

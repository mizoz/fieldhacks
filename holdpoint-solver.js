// HoldPoint solver for the browser: a line-for-line port of
// 01-holdpoint/firmware/holdpoint/solver.cpp. CI checks it against the C++ build
// (01-holdpoint/tests/js_matches_cli.mjs), so the web calculator and the device agree.
import { DRAG } from "./drag-tables.js";

const G_FPS2 = 32.174;
const DRAG_K = 2.08551e-4;   // rho0 * pi / (8 * 144)
const STEP_FT = 3.0;
const MIN_VEL = 300.0;
const MAX_TOF = 6.0;

function lookupCd(t, m) {
  const { mach, cd } = t, n = mach.length;
  if (m <= mach[0]) return cd[0];
  if (m >= mach[n - 1]) return cd[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (mach[mid] > m) hi = mid; else lo = mid;
  }
  return cd[lo] + (cd[hi] - cd[lo]) * (m - mach[lo]) / (mach[hi] - mach[lo]);
}

function air({ temp_f, press_inhg }) {
  const tR = temp_f + 459.67;
  return { density_ratio: (press_inhg / 29.92) * (518.67 / tR), sound_fps: 49.0223 * Math.sqrt(tR) };
}

export class Solver {
  // load: { bc, model: "G1" | "G7", mv_fps, weight_gr, sight_in, zero_yd }
  // zeroAtmo / nowAtmo: { temp_f, press_inhg }  (station pressure)
  setup(load, zeroAtmo, nowAtmo) {
    this.load = load;
    this.table = load.model === "G7" ? DRAG.G7 : DRAG.G1;
    this.now = air(nowAtmo);
    const za = air(zeroAtmo);
    const zr = load.zero_yd * 3;
    let bore = (load.sight_in / 12) / zr;
    for (let i = 0; i < 12; i++) {
      const h = this.#fly(bore, za, 0, [zr], 0, null);
      if (Math.abs(h) < 0.0005) break;
      bore -= h / zr;
    }
    this.bore = bore;
    return this;
  }

  // Ranges first_yd, first_yd + step_yd, ... (n of them). Returns an array of shots;
  // shorter than n if the bullet drops below 300 fps first.
  solveSteps(first_yd, step_yd, n, wind_mph, angle_deg) {
    const targets = Array.from({ length: n }, (_, i) => (first_yd + step_yd * i) * 3);
    const out = [];
    this.#fly(this.bore, this.now, angle_deg * 0.0174533, targets, wind_mph * 1.466667, out);
    return out;
  }

  static holdMOA(s) { return s.range_yd > 0 ? -s.drop_in / (1.0472 * s.range_yd / 100) : 0; }
  static holdMIL(s) { return s.range_yd > 0 ? -s.drop_in / (0.036 * s.range_yd) : 0; }
  static windMOA(s) { return s.range_yd > 0 ? s.wind_in / (1.0472 * s.range_yd / 100) : 0; }
  static windMIL(s) { return s.range_yd > 0 ? s.wind_in / (0.036 * s.range_yd) : 0; }

  #decel(v, a) {
    const cd = lookupCd(this.table, v / a.sound_fps);
    return DRAG_K * a.density_ratio * cd * v * v / this.load.bc;
  }

  // out === null: zeroing mode, returns path height (ft) at targets[0].
  #fly(bore, a, angle, targets, wind_fps, out) {
    const L = this.load;
    const gx = -G_FPS2 * Math.sin(angle), gy = -G_FPS2 * Math.cos(angle);
    let x = 0, y = -L.sight_in / 12, t = 0;
    let vx = L.mv_fps * Math.cos(bore), vy = L.mv_fps * Math.sin(bore);
    let idx = 0;
    while (idx < targets.length) {
      const v = Math.hypot(vx, vy);
      if (v < MIN_VEL || t > MAX_TOF) break;
      const dt = STEP_FT / vx;
      const k = this.#decel(v, a) / v;
      const ax = -k * vx + gx, ay = -k * vy + gy;
      const mvx = vx + ax * dt * 0.5, mvy = vy + ay * dt * 0.5;
      const mv = Math.hypot(mvx, mvy);
      const mk = this.#decel(mv, a) / mv;
      const nx = x + mvx * dt, ny = y + mvy * dt;
      const nvx = vx + (-mk * mvx + gx) * dt, nvy = vy + (-mk * mvy + gy) * dt;
      const nt = t + dt;
      while (idx < targets.length && nx >= targets[idx]) {
        const target = targets[idx];
        const f = (target - x) / (nx - x);
        const py = y + (ny - y) * f;
        if (!out) return py;
        const pv = Math.hypot(vx + (nvx - vx) * f, vy + (nvy - vy) * f);
        const pt = t + (nt - t) * f;
        out.push({
          range_yd: target / 3,
          drop_in: py * 12,
          tof_s: pt,
          vel_fps: pv,
          wind_in: wind_fps * (pt - target / L.mv_fps) * 12,
          energy_ftlb: L.weight_gr * pv * pv / 450436,
        });
        idx++;
      }
      x = nx; y = ny; vx = nvx; vy = nvy; t = nt;
    }
    return out ? 0 : y;
  }
}

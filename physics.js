/* physics.js - extension-time calculator for a 3-stage FTC vertical slide.
   Computes from the recorded slide, drag and motor data in SPEC.md; the equations
   follow SPEC.md sections 2-4 in order. Pure functions, no DOM.
   Loads as a plain <script> (window.Physics) or via require() in node. */
(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./motors.js') : root.Motors);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Physics = api;
})(typeof self !== 'undefined' ? self : this, function (Motors) {
  'use strict';

  var KGCM_TO_NM = 0.0980665;
  var N_DIAMETERS = 33;          // linspace(d_min, d_max, 33) -> 2 mm step at 16..80
  var WINDOW_FACTOR = 1.05;      // +/-5% pulley window
  var V_FLOOR = 6;               // V, supply floor from section 4.2

  // ---------------------------------------------------------------- section 2

  // Fill in the values section 2 derives from the others.
  function deriveParams(raw) {
    var p = {};
    for (var k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) p[k] = raw[k];

    // 3-stage stack: inner rail 1 + outer rail 2 + hw; stage 3 is inner rail only.
    p.m1 = p.m_slide + p.m_hw;
    p.m2 = p.m_slide + p.m_hw;
    p.m3 = p.m_slide * p.f_inner + p.m_hw;
    p.d_tot = p.d1 + p.d2 + p.d3;

    p.eta_c = Math.pow(p.eta_idler, p.n_idler_c) * p.eta_spool;
    p.eta_k = Math.pow(p.eta_idler, p.n_idler_k) * p.eta_spool;

    p.V_oc = p.V_batt - p.I_other * p.R_series;
    return p;
  }

  // ---------------------------------------------------------------- section 3

  // Motor constants derived from the sourced kg-cm stall torque and free speed.
  function deriveMotor(m, p) {
    var T_stall = m.kgcm * KGCM_TO_NM;
    var w_free = m.rpm_free * 2 * Math.PI / 60;
    return {
      name: m.name,
      ratio: m.ratio,
      rpm_free: m.rpm_free,
      kgcm: m.kgcm,
      T_stall: T_stall,                              // N-m at 12 V
      kt: T_stall / (p.I_stall - p.I_free),          // N-m/A
      w_free: w_free,                                // rad/s at 12 V
      J_rot: p.t_m * T_stall / w_free,               // kg-m^2 reflected to output shaft
      peak_W: (w_free * p.V_oc / 12) * (T_stall * p.V_oc / 12) / 4
    };
  }

  function deriveMotors(list, p) {
    return list.map(function (m) { return deriveMotor(m, p); });
  }

  // ---------------------------------------------------------------- section 4.1

  function radius(d_mm, p) { return (d_mm + p.d_string) / 2000; }   // m

  // An external stage costs eta_ext, but only when there actually is one.
  // At G_ext = 1 this returns the rigging efficiency untouched.
  function effEta(p, base) {
    return p.G_ext === 1 ? base : base * p.eta_ext;
  }

  // Cascade: all stages move together at ratios 1:2:3, all drags act at once.
  function cascadeForce(p, payload) {
    var m_tip = p.m3 + p.m_c + payload;
    return {
      m_tip: m_tip,
      F: p.g * (p.m1 + 2 * p.m2 + 3 * m_tip) + p.d_tot - p.F_spring,
      // effective translating mass seen at the drum, ratios squared
      m_eff: p.m1 + 4 * p.m2 + 9 * m_tip
    };
  }

  // Continuous: one string, uniform tension, stages move sequentially top first.
  function continuousPhases(p, payload) {
    var MA = p.m3 + p.m_c + payload;
    var MB = p.m2 + p.m3 + p.m_c + payload;
    var MC = p.m1 + p.m2 + p.m3 + p.m_c + payload;
    return [
      { name: 'A', M: MA, F: p.g * MA + p.d3 - p.F_spring },
      { name: 'B', M: MB, F: p.g * MB + p.d2 - p.F_spring },
      { name: 'C', M: MC, F: p.g * MC + p.d1 - p.F_spring }
    ];
  }

  // ---------------------------------------------------------------- section 4.2

  // Closed form, no iteration. tau is voltage-independent; V sags with the current drawn.
  function operatingPoint(F, r, eta, motor, p) {
    var tau = F * r / (p.G_ext * eta);
    var I = p.n_motors * p.I_free + tau / motor.kt;
    var V = Math.max(V_FLOOR, p.V_oc - I * p.R_series);
    var T_s = p.n_motors * motor.T_stall * V / 12;
    var w_f = motor.w_free * V / 12;
    var u = tau / T_s;
    return { tau: tau, I: I, V: V, T_s: T_s, w_f: w_f, u: u, w_ss: w_f * (1 - u) };
  }

  // ---------------------------------------------------------------- section 4.3

  // Exact solution of J dw/dt = T_s(1 - w/w_f) - tau.
  function angleAt(t, w_ss, w0, tau_c) {
    return w_ss * t + (w0 - w_ss) * tau_c * (1 - Math.exp(-t / tau_c));
  }
  function speedAt(t, w_ss, w0, tau_c) {
    return w_ss + (w0 - w_ss) * Math.exp(-t / tau_c);
  }

  // Solve theta(t) = theta for t by Newton. theta is monotonic in t, so this converges hard.
  function newtonTime(theta, w_ss, w0, tau_c) {
    var t = theta / w_ss + tau_c * (1 - w0 / w_ss);
    if (!(t > 0)) t = theta / Math.max(w_ss, w0, 1e-9);
    for (var i = 0; i < 12; i++) {
      var res = angleAt(t, w_ss, w0, tau_c) - theta;
      if (Math.abs(res) < 1e-12) break;
      var w = speedAt(t, w_ss, w0, tau_c);
      if (!(w > 1e-9)) break;
      t -= res / w;
      if (t < 0) t = 0;
    }
    return t;
  }

  // ---------------------------------------------------------------- section 4.4

  // One phase (or the whole cascade move). Returns null on stall.
  // w_cap <= 0 means uncapped.
  function solvePhase(op, J, theta, w0, w_cap) {
    if (!(op.u < 1)) return null;                      // u >= 1 -> STALL, no lift
    var tau_c = J * op.w_f / op.T_s;
    var w_ss = op.w_ss;

    // Already at the cap coming out of the previous phase: constant-speed run.
    if (w_cap > 0 && w0 >= w_cap) {
      return { t: theta / w_cap, w_end: w_cap, capped: true, tau_c: tau_c };
    }

    if (w_cap > 0 && w_cap < w_ss) {
      var t1 = -tau_c * Math.log((w_cap - w_ss) / (w0 - w_ss));
      var theta1 = angleAt(t1, w_ss, w0, tau_c);
      if (theta1 < theta) {
        return { t: t1 + (theta - theta1) / w_cap, w_end: w_cap, capped: true, tau_c: tau_c };
      }
      // Target angle is reached before the cap is ever hit; use the free solution.
    }

    var t = newtonTime(theta, w_ss, w0, tau_c);
    return { t: t, w_end: speedAt(t, w_ss, w0, tau_c), capped: false, tau_c: tau_c };
  }

  // ---------------------------------------------------------------- one point

  // Extension time for one (motor, pulley diameter, payload, rigging). null = STALL.
  function solve(motor, d_mm, payload, rigging, p) {
    var r = radius(d_mm, p);
    var E = p.travel / 1000;
    var w_cap = 0;

    if (rigging === 'continuous') {
      var eta_k = effEta(p, p.eta_k);
      var phases = continuousPhases(p, payload);
      var theta = (E / p.N) / r * p.G_ext;            // per phase
      if (p.v_cap > 0) w_cap = p.v_cap * p.G_ext / r;
      var t_total = 0, w0 = 0, out = [];
      for (var i = 0; i < phases.length; i++) {
        var ph = phases[i];
        var op = operatingPoint(ph.F, r, eta_k, motor, p);
        // Both the spool inertia and the reflected load are seen through G_ext^2.
        var J = p.n_motors * motor.J_rot + p.J_sp / (p.G_ext * p.G_ext) +
                r * r * ph.M / (p.G_ext * p.G_ext * eta_k);
        var s = solvePhase(op, J, theta, w0, w_cap);
        if (!s) return null;                          // any phase stalls -> no lift
        t_total += s.t;
        w0 = s.w_end;
        out.push({ phase: ph.name, F: ph.F, op: op, t: s.t, w_end: s.w_end, capped: s.capped });
      }
      var last = out[out.length - 1];
      return {
        t: t_total, d: d_mm, r: r, phases: out,
        F_peak: phases[2].F,                          // phase C carries the whole stack
        op: last.op,                                  // worst-case operating point
        u: last.op.u, I: last.op.I, tau: last.op.tau,
        takeup: E,                                    // continuous: total travel
        v_avg: E / t_total,
        v_end: last.w_end * r / p.G_ext,
        capped: out.some(function (o) { return o.capped; })
      };
    }

    // cascade
    var eta_c = effEta(p, p.eta_c);
    var c = cascadeForce(p, payload);
    var op2 = operatingPoint(c.F, r, eta_c, motor, p);
    var J2 = p.n_motors * motor.J_rot + p.J_sp / (p.G_ext * p.G_ext) +
             r * r * c.m_eff / (p.G_ext * p.G_ext * eta_c);
    var theta2 = (E / p.N) / r * p.G_ext;
    if (p.v_cap > 0) w_cap = p.v_cap * p.G_ext / (p.N * r);
    var s2 = solvePhase(op2, J2, theta2, 0, w_cap);
    if (!s2) return null;
    return {
      t: s2.t, d: d_mm, r: r, phases: null,
      F_peak: c.F, op: op2, u: op2.u, I: op2.I, tau: op2.tau,
      takeup: E / p.N,                                // cascade: travel / N
      v_avg: E / s2.t,
      v_end: p.N * s2.w_end * r / p.G_ext,
      capped: s2.capped
    };
  }

  // ---------------------------------------------------------------- section 4.5

  function diameters(p) {
    var out = [], n = N_DIAMETERS;
    for (var i = 0; i < n; i++) out.push(p.d_min + i * (p.d_max - p.d_min) / (n - 1));
    return out;
  }

  // Sweep every diameter for one motor; argmin over the non-stalled points.
  function sweepMotor(motor, payload, rigging, p) {
    var ds = diameters(p);
    var times = [], results = [];
    var best = null, best_i = -1;
    for (var i = 0; i < ds.length; i++) {
      var res = solve(motor, ds[i], payload, rigging, p);
      results.push(res);
      times.push(res ? res.t : null);                 // STALL stays null, never 0
      if (res && (best === null || res.t < best.t)) { best = res; best_i = i; }
    }
    if (!best) {
      return { motor: motor, diameters: ds, times: times, results: results, stalled: true };
    }
    // +/-5% window: every diameter within 1.05x of the best time.
    var lo = null, hi = null;
    for (var j = 0; j < ds.length; j++) {
      if (times[j] !== null && times[j] <= WINDOW_FACTOR * best.t) {
        if (lo === null) lo = ds[j];
        hi = ds[j];
      }
    }
    return {
      motor: motor, diameters: ds, times: times, results: results, stalled: false,
      best_d: ds[best_i], best_t: best.t, best: best,
      window: [lo, hi],
      at_min: ds[best_i] === p.d_min,
      at_max: ds[best_i] === p.d_max
    };
  }

  // Full result for one (rigging, payload): every motor, ranked.
  function analyze(payload, rigging, p, motors) {
    var rows = motors.map(function (m) { return sweepMotor(m, payload, rigging, p); });
    var live = rows.filter(function (r) { return !r.stalled; });
    live.sort(function (a, b) { return a.best_t - b.best_t; });
    live.forEach(function (r, i) { r.rank = i + 1; });
    return { rows: rows, ranked: live, best: live.length ? live[0] : null };
  }

  // ------------------------------------------------- addendum A: pick rigging

  var RIGGINGS = ['cascade', 'continuous'];

  function withParam(p, key, value) {
    var q = {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
    q[key] = value;
    return q;
  }

  // Answer 1 (STOCK): direct drive, both riggings, best wins.
  // G_ext is forced to 1 - external gearing is Answer 2's job.
  function stockAnswer(payload, p, motors) {
    var p1 = withParam(p, 'G_ext', 1);
    var by = {};
    RIGGINGS.forEach(function (rig) { by[rig] = analyze(payload, rig, p1, motors); });

    var live = RIGGINGS.filter(function (rig) { return by[rig].best; });
    live.sort(function (a, b) { return by[a].best.best_t - by[b].best.best_t; });

    var winner = live[0] || null, loser = live[1] || null;
    return {
      params: p1,
      byRigging: by,
      rigging: winner,
      other: loser,
      result: winner ? by[winner] : null,
      best: winner ? by[winner].best : null,
      t: winner ? by[winner].best.best_t : null,
      t_other: loser ? by[loser].best.best_t : null,
      // how much worse the losing rigging is, as a percentage
      margin: (winner && loser)
        ? 100 * (by[loser].best.best_t - by[winner].best.best_t) / by[winner].best.best_t
        : null
    };
  }

  // ------------------------------------------------ addendum B: geared search

  var TIE = 1e-6;   // s; below this two candidates count as the same result

  function gearGrid(p) {
    var out = [], n = Math.round((p.g_max - p.g_min) / p.g_step);
    for (var i = 0; i <= n; i++) {
      // rebuild from the step so 1.0 lands exactly on the grid
      out.push(Math.round((p.g_min + i * p.g_step) * 1e6) / 1e6);
    }
    return out;
  }

  // Ties are common here because pulley diameter and G_ext trade off against each
  // other. Prefer no external stage at all, then a pulley near the middle of the
  // build range.
  function preferred(cand, best) {
    if (!best) return true;
    var dt = cand.t - best.t;
    if (dt < -TIE) return true;
    if (dt > TIE) return false;
    var cg = Math.abs(cand.G_ext - 1), bg = Math.abs(best.G_ext - 1);
    if (cg < bg - 1e-12) return true;
    if (cg > bg + 1e-12) return false;
    return Math.abs(cand.d - 40) < Math.abs(best.d - 40);
  }

  var TEETH = [16, 20, 24, 28, 32, 36, 40, 48, 60, 72, 80, 100, 120];

  // Closest single-stage tooth pair to the wanted ratio. Driven:driver.
  function nearestToothPair(ratio) {
    var best = null;
    for (var i = 0; i < TEETH.length; i++) {
      for (var j = 0; j < TEETH.length; j++) {
        var got = TEETH[i] / TEETH[j];
        var err = Math.abs(got - ratio);
        if (!best || err < best.err - 1e-12 ||
            (Math.abs(err - best.err) <= 1e-12 && TEETH[i] + TEETH[j] < best.sum)) {
          best = { driven: TEETH[i], driver: TEETH[j], ratio: got, err: err,
                   sum: TEETH[i] + TEETH[j] };
        }
      }
    }
    return best;
  }

  // Sweep base motor x external ratio x pulley x rigging. Returns the argmin.
  // Charges whatever eta_ext the caller's params carry.
  function gearedAnswer(payload, p, motors) {
    var grid = gearGrid(p);
    var ds = diameters(p);
    var best = null;

    for (var mi = 0; mi < motors.length; mi++) {
      for (var gi = 0; gi < grid.length; gi++) {
        var pg = withParam(p, 'G_ext', grid[gi]);
        for (var ri = 0; ri < RIGGINGS.length; ri++) {
          for (var di = 0; di < ds.length; di++) {
            var res = solve(motors[mi], ds[di], payload, RIGGINGS[ri], pg);
            if (!res) continue;                  // STALL never enters the argmin
            var cand = { motor: motors[mi], G_ext: grid[gi], d: ds[di],
                         rigging: RIGGINGS[ri], t: res.t, res: res };
            if (preferred(cand, best)) best = cand;
          }
        }
      }
    }
    return { best: best, grid: grid };
  }

  // The ideal output RPM: the total-ratio optimum, found on a level playing field.
  //
  // eta_ext is a step cost - it is charged at every ratio except exactly 1.0. Asking
  // "what ratio is best" while one ratio alone is handed a 5% discount just returns
  // that ratio every time, so the search runs at eta_ext = 1 and the answer is a
  // genuine property of the load: the shaft speed this slide wants to turn at.
  //
  // The recommendation is then priced with the real external-stage loss, so the
  // verdict on whether to build it reflects what you would actually get.
  function idealAnswer(payload, p, motors) {
    var search = gearedAnswer(payload, withParam(p, 'eta_ext', 1), motors);
    var b = search.best;
    if (!b) return null;

    // Re-optimise the pulley at the ideal ratio, now paying the real eta_ext.
    var pReal = withParam(p, 'G_ext', b.G_ext);
    var ds = diameters(p);
    var realT = Infinity, realD = null, realRes = null;
    for (var i = 0; i < ds.length; i++) {
      var r = solve(b.motor, ds[i], payload, b.rigging, pReal);
      if (r && r.t < realT) { realT = r.t; realD = ds[i]; realRes = r; }
    }

    return {
      rpm: b.motor.rpm_free / b.G_ext,     // the headline
      G_ext: b.G_ext,
      motor: b.motor,
      rigging: b.rigging,
      d_ideal: b.d,
      t_ideal: b.t,                        // frictionless external stage
      d: realD,                            // what you would actually cut
      t: isFinite(realT) ? realT : null,   // what you would actually get
      res: realRes,
      teeth: b.G_ext === 1 ? null : nearestToothPair(b.G_ext)
    };
  }

  // Both answers plus the comparison the UI reports.
  function fullAnswer(payload, p, motors) {
    var stock = stockAnswer(payload, p, motors);
    var ideal = idealAnswer(payload, p, motors);

    // How far the stock direct-drive RPM sits from the ideal shaft speed.
    var rpmGap = (stock.best && ideal)
      ? 100 * (stock.best.motor.rpm_free - ideal.rpm) / ideal.rpm : null;

    // Net gain from actually building the external stage, losses included.
    var gain = (stock.t && ideal && ideal.t)
      ? 100 * (stock.t - ideal.t) / stock.t : null;

    return {
      stock: stock,
      ideal: ideal,
      rpmGap: rpmGap,
      gain: gain,
      gearingHelps: gain !== null && gain >= 2
    };
  }

  // ---------------------------------------------------------------- extras

  // Largest pulley that still lifts (u = 1). V sags with load, so iterate the supply.
  // d_stall = 2000*eta*T_s*G/F - d_string
  function stallDiameter(motor, payload, rigging, p) {
    var eta = effEta(p, rigging === 'continuous' ? p.eta_k : p.eta_c);
    var F = rigging === 'continuous'
      ? continuousPhases(p, payload)[2].F              // phase C is the binding one
      : cascadeForce(p, payload).F;
    var V = p.V_oc, d = p.d_min;
    for (var i = 0; i < 60; i++) {
      var T_s = p.n_motors * motor.T_stall * V / 12;
      var d_new = 2000 * eta * T_s * p.G_ext / F - p.d_string;
      var tau = F * radius(d_new, p) / (p.G_ext * eta);
      var I = p.n_motors * p.I_free + tau / motor.kt;
      V = Math.max(V_FLOOR, p.V_oc - I * p.R_series);
      var done = Math.abs(d_new - d) < 1e-9;
      d = d_new;
      if (done) break;
    }
    return d;
  }

  // Section 6, holding at full extension with the motor stalled.
  function holdCheck(motor, payload, rigging, d_mm, p) {
    var F_grav = rigging === 'continuous'
      ? p.g * continuousPhases(p, payload)[2].M
      : p.g * (p.m1 + 2 * p.m2 + 3 * (p.m3 + p.m_c + payload));
    var eta = effEta(p, rigging === 'continuous' ? p.eta_k : p.eta_c);
    var tau_hold = F_grav * radius(d_mm, p) / (p.G_ext * eta);
    var I_hold = p.n_motors * p.I_free + tau_hold / motor.kt;
    var V = Math.max(V_FLOOR, p.V_oc - I_hold * p.R_series);
    var T_s = p.n_motors * motor.T_stall * V / 12;
    return {
      tau_hold: tau_hold, I_hold: I_hold, frac_stall: tau_hold / T_s,
      d_safe_max: 2000 * 0.25 * T_s * p.G_ext * eta / F_grav - p.d_string
    };
  }

  return {
    KGCM_TO_NM: KGCM_TO_NM,
    deriveParams: deriveParams,
    deriveMotor: deriveMotor,
    deriveMotors: deriveMotors,
    radius: radius,
    cascadeForce: cascadeForce,
    continuousPhases: continuousPhases,
    operatingPoint: operatingPoint,
    angleAt: angleAt,
    speedAt: speedAt,
    newtonTime: newtonTime,
    solvePhase: solvePhase,
    solve: solve,
    effEta: effEta,
    diameters: diameters,
    sweepMotor: sweepMotor,
    analyze: analyze,
    RIGGINGS: RIGGINGS,
    withParam: withParam,
    stockAnswer: stockAnswer,
    gearGrid: gearGrid,
    nearestToothPair: nearestToothPair,
    gearedAnswer: gearedAnswer,
    idealAnswer: idealAnswer,
    fullAnswer: fullAnswer,
    stallDiameter: stallDiameter,
    holdCheck: holdCheck
  };
});

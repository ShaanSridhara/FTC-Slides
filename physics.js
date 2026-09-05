/* physics.js - FTC vertical linear slide extension model.
   Pure functions, no DOM. Equations follow SPEC.md sections 2-4 in order.
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
      var phases = continuousPhases(p, payload);
      var theta = (E / p.N) / r * p.G_ext;            // per phase
      if (p.v_cap > 0) w_cap = p.v_cap * p.G_ext / r;
      var t_total = 0, w0 = 0, out = [];
      for (var i = 0; i < phases.length; i++) {
        var ph = phases[i];
        var op = operatingPoint(ph.F, r, p.eta_k, motor, p);
        var J = p.n_motors * motor.J_rot + p.J_sp +
                r * r * ph.M / (p.G_ext * p.G_ext * p.eta_k);
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
    var c = cascadeForce(p, payload);
    var op2 = operatingPoint(c.F, r, p.eta_c, motor, p);
    var J2 = p.n_motors * motor.J_rot + p.J_sp +
             r * r * c.m_eff / (p.G_ext * p.G_ext * p.eta_c);
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

  // ---------------------------------------------------------------- extras

  // Largest pulley that still lifts (u = 1). V sags with load, so iterate the supply.
  // d_stall = 2000*eta*T_s*G/F - d_string
  function stallDiameter(motor, payload, rigging, p) {
    var eta = rigging === 'continuous' ? p.eta_k : p.eta_c;
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
    var eta = rigging === 'continuous' ? p.eta_k : p.eta_c;
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
    diameters: diameters,
    sweepMotor: sweepMotor,
    analyze: analyze,
    stallDiameter: stallDiameter,
    holdCheck: holdCheck
  };
});

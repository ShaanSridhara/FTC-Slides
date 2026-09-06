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

  // Fill in the values section 2 derives from the others. Works for any N.
  function deriveParams(raw) {
    var p = {}, i;
    for (var k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) p[k] = raw[k];

    p.N = Math.max(1, Math.round(p.N));

    // Every stage below the top is an inner rail plus the outer rail of the stage
    // above, so it carries a full slide; the top stage is inner rail only.
    // A lift usually runs two parallel towers, so every stage mass and every
    // sliding interface is multiplied by n_stacks. The carriage and the payload
    // are shared across the towers and are added once, in the force terms.
    var stacks = Math.max(1, Math.round(p.n_stacks || 1));
    p.n_stacks = stacks;
    p.masses = [];
    for (i = 1; i <= p.N; i++) {
      var mi = stacks * ((i < p.N) ? p.m_slide + p.m_hw : p.m_slide * p.f_inner + p.m_hw);
      p.masses.push(mi);
      p['m' + i] = mi;                              // m1..mN, also handy for callers
    }

    // Drag per interface. An explicit d_i wins; otherwise fall back to the default
    // ramp, so raising N does not leave the new interfaces undefined.
    p.drags = [];
    p.d_tot = 0;
    var cal = (isFinite(p.drag_cal) ? p.drag_cal : 1);
    for (i = 1; i <= p.N; i++) {
      var di = p['d' + i];
      if (!isFinite(di)) di = Motors.defaultDrag(i);
      p['d' + i] = di;                    // stays the raw per-tower figure, so that
      var scaled = di * cal * stacks;     // re-deriving a derived params is a no-op
      p.drags.push(scaled);
      p.d_tot += scaled;
    }

    if (!isFinite(p.n_idler_c)) p.n_idler_c = Motors.defaultIdlers(p.N).c;
    if (!isFinite(p.n_idler_k)) p.n_idler_k = Motors.defaultIdlers(p.N).k;

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

  // Sliding drag rises with how fast the interface is actually sliding.
  // v is the relative (cable) speed, which is what each interface sees.
  function dragMult(p, v) { return 1 + p.k_v * (v > 0 ? v : 0); }

  // Cascade: all N stages move together at ratios 1:2:..:N, every drag at once.
  // Stage i moves i times the cable, so it contributes i*m_i to the force and
  // i^2*m_i to the inertia seen at the drum. The top stage carries m_c + payload.
  function cascadeForce(p, payload, vSlide) {
    var sumF = 0, m_eff = 0, m_tip = 0;
    for (var i = 1; i <= p.N; i++) {
      var mi = p.masses[i - 1] + (i === p.N ? p.m_c + payload : 0);
      if (i === p.N) m_tip = mi;
      sumF += i * mi;
      m_eff += i * i * mi;
    }
    return {
      m_tip: m_tip,
      F_grav: p.g * sumF,
      F: p.g * sumF + p.d_tot * dragMult(p, vSlide) - p.F_spring,
      m_eff: m_eff
    };
  }

  // Continuous: one string, uniform tension, so the least-loaded stage moves first.
  // Phase k moves stages N-k+1 .. N against interface N-k+1, and the moving mass
  // accumulates downward as each phase adds the stage beneath the last.
  function phaseName(k) {
    return k <= 26 ? String.fromCharCode(64 + k) : String(k);
  }
  function continuousPhases(p, payload, vSlide) {
    var out = [], M = 0;
    for (var k = 1; k <= p.N; k++) {
      var stage = p.N - k + 1;                       // the stage that joins this phase
      M += p.masses[stage - 1] + (stage === p.N ? p.m_c + payload : 0);
      out.push({
        name: phaseName(k),
        stage: stage,
        M: M,
        F: p.g * M + p.drags[stage - 1] * dragMult(p, vSlide) - p.F_spring
      });
    }
    return out;
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

  // ------------------------------------------------- end-stop deceleration

  // The last d_stop of stage travel is given over to a constant-deceleration
  // ramp aiming to arrive at the end stop at v_stop. The motor can only brake as
  // hard as its regen torque at the entry speed plus the load torque it was
  // already fighting; if that is not enough, the stage arrives faster than the
  // target and the impact speed is reported.
  function decelRamp(motor, p, tau_load, J, theta_stop, w_enter, w_stop) {
    if (!(theta_stop > 0)) return { t: 0, w_end: w_enter, limited: false };
    if (w_enter <= w_stop) {
      // Already slower than the target; coast the last stretch.
      return { t: theta_stop / Math.max(w_enter, 1e-9), w_end: w_enter, limited: false };
    }
    var alpha_req = (w_enter * w_enter - w_stop * w_stop) / (2 * theta_stop);
    var tau_regen = p.n_motors * motor.T_stall * (w_enter / motor.w_free);
    var alpha_max = (tau_regen + tau_load) / J;
    var limited = alpha_max < alpha_req;
    var alpha = limited ? alpha_max : alpha_req;
    if (!(alpha > 0)) return { t: theta_stop / w_enter, w_end: w_enter, limited: true };
    var w_end = limited
      ? Math.sqrt(Math.max(0, w_enter * w_enter - 2 * alpha * theta_stop))
      : w_stop;
    return { t: (w_enter - w_end) / alpha, w_end: w_end, limited: limited, alpha: alpha };
  }

  // ---------------------------------------------------------------- one point

  // Settle the operating point against speed-dependent drag: the sliding speed
  // sets the drag, the drag sets the force, the force sets the speed. Three
  // passes is plenty - it converges monotonically.
  function settle(makeForce, r, eta, motor, p) {
    var v = 0, F = 0, op = null;
    for (var i = 0; i < 3; i++) {
      F = makeForce(v);
      op = operatingPoint(F, r, eta, motor, p);
      if (!(op.u < 1)) break;
      v = op.w_ss * r / p.G_ext;                     // relative (cable) speed
    }
    return { F: F, op: op, v: v };
  }

  // Extension time for one (motor, pulley diameter, payload, rigging). null = STALL.
  // Every move ends with a deceleration ramp into the end stop.
  function solve(motor, d_mm, payload, rigging, p) {
    var r = radius(d_mm, p);
    var E = p.travel / 1000;
    var w_cap = 0;
    var theta_stage = (E / p.N) / r * p.G_ext;                 // per stage / per phase
    var theta_stop = Math.min((p.d_stop / 1000) / r * p.G_ext, theta_stage);
    var theta_run = theta_stage - theta_stop;
    var w_stop = p.v_stop * p.G_ext / r;                       // motor speed at the stop

    if (rigging === 'continuous') {
      var eta_k = effEta(p, p.eta_k);
      if (p.v_cap > 0) w_cap = p.v_cap * p.G_ext / r;
      var t_total = 0, w0 = 0, out = [], stopped = 0;

      for (var i = 0; i < p.N; i++) {
        var idx = i;
        var st = settle(function (v) {
          return continuousPhases(p, payload, v)[idx].F;
        }, r, eta_k, motor, p);
        if (!(st.op.u < 1)) return null;                       // this phase stalls

        var ph = continuousPhases(p, payload, st.v)[idx];
        var J = p.n_motors * motor.J_rot + p.J_sp / (p.G_ext * p.G_ext) +
                r * r * ph.M / (p.G_ext * p.G_ext * eta_k);

        var run = solvePhase(st.op, J, theta_run, w0, w_cap);
        if (!run) return null;
        var stop = decelRamp(motor, p, st.op.tau, J, theta_stop, run.w_end, w_stop);

        t_total += run.t + stop.t;
        w0 = stop.w_end;
        if (stop.limited) stopped++;
        out.push({ phase: ph.name, F: ph.F, op: st.op, t: run.t + stop.t,
                   t_run: run.t, t_stop: stop.t, w_end: stop.w_end,
                   capped: run.capped, hard: stop.limited });
      }

      var last = out[out.length - 1];
      var phasesF = continuousPhases(p, payload, last.op.w_ss * r / p.G_ext);
      return {
        t: t_total, d: d_mm, r: r, phases: out,
        F_peak: phasesF[phasesF.length - 1].F,
        op: last.op, u: last.op.u, I: last.op.I, tau: last.op.tau,
        takeup: E,                                             // continuous: total travel
        v_avg: E / t_total,
        v_end: last.w_end * r / p.G_ext,
        v_impact: last.w_end * r / p.G_ext,                    // relative, at the end stop
        hard_stop: stopped > 0,
        capped: out.some(function (o) { return o.capped; })
      };
    }

    // cascade - one move, all stages together, one end stop
    var eta_c = effEta(p, p.eta_c);
    var sc = settle(function (v) { return cascadeForce(p, payload, v).F; },
                    r, eta_c, motor, p);
    if (!(sc.op.u < 1)) return null;
    var c = cascadeForce(p, payload, sc.v);
    var J2 = p.n_motors * motor.J_rot + p.J_sp / (p.G_ext * p.G_ext) +
             r * r * c.m_eff / (p.G_ext * p.G_ext * eta_c);
    if (p.v_cap > 0) w_cap = p.v_cap * p.G_ext / (p.N * r);
    var run2 = solvePhase(sc.op, J2, theta_run, 0, w_cap);
    if (!run2) return null;
    var stop2 = decelRamp(motor, p, sc.op.tau, J2, theta_stop, run2.w_end, w_stop);

    return {
      t: run2.t + stop2.t, d: d_mm, r: r, phases: null,
      F_peak: c.F, op: sc.op, u: sc.op.u, I: sc.op.I, tau: sc.op.tau,
      takeup: E / p.N,                                         // cascade: travel / N
      v_avg: E / (run2.t + stop2.t),
      v_end: p.N * stop2.w_end * r / p.G_ext,
      v_impact: stop2.w_end * r / p.G_ext,                     // relative, at the end stop
      hard_stop: stop2.limited,
      capped: run2.capped
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

  // ------------------------------------------------ addendum 3: stack search

  // Parameters for one (slide, N, motor count). The drag ramp and idler counts
  // regenerate from N; travel is the extension asked for, not the stack maximum.
  function stackParams(slide, N, n_motors, extension, payload, v_cap, n_stacks) {
    var raw = {}, i;
    for (var k in Motors.DEFAULTS) raw[k] = Motors.DEFAULTS[k];
    for (i = 1; i <= 12; i++) delete raw['d' + i];
    delete raw.n_idler_c;
    delete raw.n_idler_k;
    raw.m_slide = slide.mass;
    raw.N = N;
    raw.n_motors = n_motors;
    if (n_stacks) raw.n_stacks = n_stacks;
    raw.travel = extension;
    raw.payload = payload;
    raw.v_cap = v_cap;
    raw.G_ext = 1;
    return deriveParams(raw);
  }

  // Tie-break: fewer stages, then fewer motors, then no external stage, then a
  // pulley near the middle of the build range.
  function betterStack(c, best) {
    if (!best) return true;
    var dt = c.t - best.t;
    if (dt < -TIE) return true;
    if (dt > TIE) return false;
    if (c.N !== best.N) return c.N < best.N;
    if (c.n_motors !== best.n_motors) return c.n_motors < best.n_motors;
    var cg = Math.abs(c.G_ext - 1), bg = Math.abs(best.G_ext - 1);
    if (Math.abs(cg - bg) > 1e-12) return cg < bg;
    return Math.abs(c.d - 40) < Math.abs(best.d - 40);
  }

  // +/-5% pulley window at a chosen build.
  function windowFor(c, payload) {
    var ds = diameters(c.params), lo = null, hi = null;
    for (var i = 0; i < ds.length; i++) {
      var r = solve(c.motor, ds[i], payload, c.rigging, c.params);
      if (r && r.t <= WINDOW_FACTOR * c.t) { if (lo === null) lo = ds[i]; hi = ds[i]; }
    }
    return [lo, hi];
  }

  function reaches(slide, N, extension) {
    return N * slide.stroke >= extension - 1e-9;
  }

  function annotate(c, extension) {
    c.window = windowFor(c, c.params.payload);
    c.leftover = c.N * c.slide.stroke - extension;
    c.height = c.slide.nominal_mm;
    c.I_motor = c.res.I / c.n_motors;      // the port sees the per-motor current
    return c;
  }

  // Every (slide, N) that reaches the extension, best build for each, plus the
  // outright winner. grid is [1] for the stock search. `nMotors`, if given, pins
  // the search to that many motors instead of searching 1 and 2.
  function searchStacks(extension, payload, v_cap, grid, nMotors, nStacks) {
    var rows = [], best = null, reachable = false;

    Motors.SLIDES.forEach(function (slide) {
      Motors.STAGE_COUNTS.forEach(function (N) {
        if (!reaches(slide, N, extension)) return;
        reachable = true;
        var rowBest = null;

        var counts = nMotors ? [nMotors] : Motors.MOTOR_COUNTS;
        counts.forEach(function (nm) {
          var base = stackParams(slide, N, nm, extension, payload, v_cap, nStacks);
          var ms = deriveMotors(Motors.MOTORS, base);
          var ds = diameters(base);

          for (var gi = 0; gi < grid.length; gi++) {
            var p = grid[gi] === 1 ? base : withParam(base, 'G_ext', grid[gi]);
            for (var mi = 0; mi < ms.length; mi++) {
              for (var ri = 0; ri < RIGGINGS.length; ri++) {
                for (var di = 0; di < ds.length; di++) {
                  var res = solve(ms[mi], ds[di], payload, RIGGINGS[ri], p);
                  if (!res) continue;                 // STALL never enters the argmin
                  var cand = {
                    slide: slide, N: N, n_motors: nm, motor: ms[mi],
                    rigging: RIGGINGS[ri], d: ds[di], G_ext: grid[gi],
                    t: res.t, res: res, params: p
                  };
                  if (betterStack(cand, rowBest)) rowBest = cand;
                  if (betterStack(cand, best)) best = cand;
                }
              }
            }
          }
        });

        if (rowBest) rows.push(annotate(rowBest, extension));
      });
    });

    rows.sort(function (a, b) { return a.t - b.t; });
    if (best) annotate(best, extension);
    return { rows: rows, best: best, reachable: reachable };
  }

  function stockStack(extension, payload, v_cap, nMotors, nStacks) {
    return searchStacks(extension, payload, v_cap, [1], nMotors, nStacks);
  }

  function gearedStack(extension, payload, v_cap, nMotors, nStacks, gridOverride) {
    var grid = gridOverride || gearGrid(deriveParams(Motors.DEFAULTS));
    var out = searchStacks(extension, payload, v_cap, grid, nMotors, nStacks);
    if (out.best) {
      out.rpm_equiv = out.best.motor.rpm_free / out.best.G_ext;
      out.teeth = out.best.G_ext === 1 ? null : nearestToothPair(out.best.G_ext);
    }
    return out;
  }

  // Everything the page needs for one set of inputs.
  function stackAnswer(extension, payload, v_cap, nMotors, nStacks) {
    var stock = stockStack(extension, payload, v_cap, nMotors, nStacks);
    if (!stock.reachable || !stock.best) {
      return { reachable: stock.reachable, stock: stock, geared: null,
               gain: null, gearingHelps: false };
    }
    var geared = gearedStack(extension, payload, v_cap, nMotors, nStacks);
    var gain = geared.best ? 100 * (stock.best.t - geared.best.t) / stock.best.t : null;
    return {
      reachable: true, stock: stock, geared: geared, gain: gain,
      gearingHelps: gain !== null && gain >= 2
    };
  }

  // ---------------------------------------------------------------- extras

  // Largest pulley that still lifts (u = 1). V sags with load, so iterate the supply.
  // d_stall = 2000*eta*T_s*G/F - d_string
  function stallDiameter(motor, payload, rigging, p) {
    var eta = effEta(p, rigging === 'continuous' ? p.eta_k : p.eta_c);
    var phases = continuousPhases(p, payload);
    var F = rigging === 'continuous'
      ? phases[phases.length - 1].F                    // the last phase is the binding one
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
    var phases = continuousPhases(p, payload);
    var F_grav = rigging === 'continuous'
      ? p.g * phases[phases.length - 1].M
      : cascadeForce(p, payload).F_grav;
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
    phaseName: phaseName,
    operatingPoint: operatingPoint,
    angleAt: angleAt,
    speedAt: speedAt,
    newtonTime: newtonTime,
    solvePhase: solvePhase,
    decelRamp: decelRamp,
    dragMult: dragMult,
    settle: settle,
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
    stackParams: stackParams,
    searchStacks: searchStacks,
    stockStack: stockStack,
    gearedStack: gearedStack,
    stackAnswer: stackAnswer,
    windowFor: windowFor,
    reaches: reaches,
    stallDiameter: stallDiameter,
    holdCheck: holdCheck
  };
});

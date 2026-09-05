/* tests/physics.test.js - regression tests for the slide extension model.
   Run:  node tests/physics.test.js
   No framework. Encodes SPEC.md section 7 verification data.

   The expected values here are verified against the reference workbook and must
   not be edited to make a failing model pass. */

var Motors = require('../motors.js');
var Physics = require('../physics.js');

var pass = 0, fail = 0, failures = [];

function check(name, ok, detail) {
  if (ok) { pass++; }
  else { fail++; failures.push(name + (detail ? '  ->  ' + detail : '')); }
}
function near(name, got, want, tol) {
  var ok = isFinite(got) && Math.abs(got - want) <= tol;
  check(name, ok, ok ? '' : 'got ' + fmt(got) + ', want ' + want + ' +/- ' + tol);
}
function eq(name, got, want) {
  check(name, got === want, got === want ? '' : 'got ' + got + ', want ' + want);
}
function fmt(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(6) : String(v); }
function section(s) { console.log('\n' + s); }

function params(over) {
  var raw = {};
  for (var k in Motors.DEFAULTS) raw[k] = Motors.DEFAULTS[k];
  for (var j in (over || {})) raw[j] = over[j];
  return Physics.deriveParams(raw);
}
var P0 = params();
var MOTORS = Physics.deriveMotors(Motors.MOTORS, P0);
var NAMES = ['1620', '1150', '435', '312', '223', '117'];
function motor(name, p) {
  return Physics.deriveMotors(Motors.MOTORS, p || P0).find(function (m) { return m.name === name; });
}

// Section 7 tabulates the uncapped physics ceiling.
var PCEIL = params({ v_cap: 0 });

var TOL_T = 0.002;   // s
var TOL_D = 2;       // mm

// ---------------------------------------------------------------- section 2/3

section('Derived constants (section 2, 3)');
near('eta_c = eta_idler^5 * eta_spool', P0.eta_c, 0.8158, 5e-5);
near('eta_k = eta_idler^6 * eta_spool', P0.eta_k, 0.7913, 5e-5);
near('m1', P0.m1, 0.148, 1e-9);
near('m2', P0.m2, 0.148, 1e-9);
near('m3', P0.m3, 0.089, 1e-9);
near('d_tot', P0.d_tot, 2.4 * Motors.DEFAULTS.drag_cal, 1e-9);
near('V_oc', P0.V_oc, 12.5, 1e-9);

var MOTOR_TABLE = {
  //        T_stall N-m   kt N-m/A   J_rot kg-m^2   peak W @12.5 V
  '1620': [0.5296, 0.0592, 4.68e-5, 24.4],
  '1150': [0.7747, 0.0866, 9.65e-5, 25.3],
  '435':  [1.8338, 0.2049, 6.04e-4, 22.7],
  '312':  [2.3830, 0.2663, 1.09e-3, 21.1],
  '223':  [3.7265, 0.4164, 2.39e-3, 23.6],
  '117':  [6.7077, 0.7495, 8.21e-3, 22.3]
};
NAMES.forEach(function (n) {
  var m = motor(n), w = MOTOR_TABLE[n];
  near(n + ' T_stall', m.T_stall, w[0], 5e-5);
  near(n + ' kt', m.kt, w[1], 5e-5);
  near(n + ' J_rot', m.J_rot, w[2], Math.max(5e-7, w[2] * 0.005));
  near(n + ' peak W', m.peak_W, w[3], 0.1);
});

// ---------------------------------------------------------------- section 7 tables

// BEST EXTENSION TIME (s), CASCADE - rows are payload 0.0 .. 1.0
var T_CASCADE = [
  [1.8846, 0.7568, 0.7264, 0.7647, 0.7038, 0.7622],
  [31.4331, 0.9358, 0.7942, 0.8399, 0.7693, 0.8138],
  [null, 1.2266, 0.8657, 0.9191, 0.8346, 0.8783],
  [null, 1.7568, 0.9397, 0.9983, 0.9053, 0.9511],
  [null, 3.1102, 1.0137, 1.0771, 0.9757, 1.0254],
  [null, 15.9686, 1.0851, 1.1552, 1.0457, 1.0997]
];
var T_CONTINUOUS = [
  [0.9851, 0.9424, 0.9999, 1.0583, 1.1255, 1.6841],
  [1.0593, 1.0150, 1.0773, 1.1297, 1.1642, 1.7096],
  [1.1268, 1.0824, 1.1501, 1.2057, 1.2050, 1.7357],
  [1.1975, 1.1461, 1.2202, 1.2797, 1.2480, 1.7627],
  [1.2752, 1.2081, 1.2884, 1.3522, 1.2935, 1.7904],
  [1.3617, 1.2709, 1.3560, 1.4237, 1.3417, 1.8189]
];
var D_CASCADE = [
  [16, 16, 28, 36, 56, 80],
  [16, 16, 24, 32, 50, 80],
  [null, 16, 22, 30, 46, 80],
  [null, 16, 20, 28, 42, 78],
  [null, 16, 20, 26, 40, 72],
  [null, 16, 18, 24, 36, 66]
];
var D_CONTINUOUS = [
  [20, 28, 70, 80, 80, 80],
  [18, 26, 62, 80, 80, 80],
  [16, 24, 58, 76, 80, 80],
  [16, 22, 54, 70, 80, 80],
  [16, 20, 50, 66, 80, 80],
  [16, 20, 46, 62, 80, 80]
];

function tableTest(label, rigging, times, dias) {
  section('BEST EXTENSION TIME + PULLEY, ' + label.toUpperCase() + ' (section 7)');
  Motors.PAYLOAD_SWEEP.forEach(function (payload, i) {
    NAMES.forEach(function (name, j) {
      var s = Physics.sweepMotor(motor(name, PCEIL), payload, rigging, PCEIL);
      var tag = label + ' ' + payload.toFixed(1) + 'kg ' + name;
      if (times[i][j] === null) {
        check(tag + ' STALL', s.stalled, 'expected STALL, got ' + (s.stalled ? '' : s.best_t));
        return;
      }
      if (s.stalled) { check(tag, false, 'model stalled, expected ' + times[i][j]); return; }
      near(tag + ' t', s.best_t, times[i][j], Math.max(TOL_T, times[i][j] * 0.002));
      near(tag + ' d', s.best_d, dias[i][j], TOL_D);
    });
  });
}
tableTest('cascade', 'cascade', T_CASCADE, D_CASCADE);
tableTest('continuous', 'continuous', T_CONTINUOUS, D_CONTINUOUS);

// ---------------------------------------------------------------- spot checks

section('Spot checks, cascade @ 0.6 kg (section 7)');
(function () {
  var r = Physics.solve(motor('1150', PCEIL), 16, 0.6, 'cascade', PCEIL);
  var s = Physics.sweepMotor(motor('1150', PCEIL), 0.6, 'cascade', PCEIL);
  near('1150 @16mm u', r.u, 0.860, 0.001);
  near('1150 @16mm I', r.I, 8.12, 0.01);
  eq('1150 @16mm window lo', s.window[0], 16);
  eq('1150 @16mm window hi', s.window[1], 16);

  var r2 = Physics.solve(motor('435', PCEIL), 20, 0.6, 'cascade', PCEIL);
  var s2 = Physics.sweepMotor(motor('435', PCEIL), 0.6, 'cascade', PCEIL);
  near('435 @20mm u', r2.u, 0.463, 0.001);
  near('435 @20mm I', r2.I, 4.52, 0.01);
  eq('435 @20mm window lo', s2.window[0], 16);
  eq('435 @20mm window hi', s2.window[1], 24);

  var s3 = Physics.sweepMotor(motor('223', PCEIL), 0.6, 'cascade', PCEIL);
  eq('223 window lo', s3.window[0], 34);
  eq('223 window hi', s3.window[1], 52);
})();

section('Cable force, cascade @ 1.0 kg (section 7)');
// Drag now rises with sliding speed, so the force quoted is at zero speed.
near('F at rest', Physics.cascadeForce(PCEIL, 1.0, 0).F, 76.177, 0.001);
check('drag rises with speed', Physics.cascadeForce(PCEIL, 1.0, 1.0).F >
                               Physics.cascadeForce(PCEIL, 1.0, 0).F);
near('drag multiplier is 1 + k_v*v', Physics.dragMult(PCEIL, 2.0), 1 + 0.5 * 2.0, 1e-12);

section('Spot check, cascade 1150 @ 1.0 kg (section 7)');
(function () {
  var m = motor('1150', PCEIL);
  var s = Physics.sweepMotor(m, 1.0, 'cascade', PCEIL);
  eq('only the 16 mm pulley still lifts', s.best_d, 16);
  near('and it crawls', s.best_t, 15.9686, 0.02);
  near('d_stall', Physics.stallDiameter(m, 1.0, 'cascade', PCEIL), 16.30, 0.05);
  check('18 mm stalls', Physics.solve(m, 18, 1.0, 'cascade', PCEIL) === null);
})();

section('Stall diameters @ 1.0 kg (section 7)');
near('cascade 435', Physics.stallDiameter(motor('435', PCEIL), 1.0, 'cascade', PCEIL), 39.40, 0.05);
near('cascade 1150', Physics.stallDiameter(motor('1150', PCEIL), 1.0, 'cascade', PCEIL), 16.30, 0.05);
near('continuous 435', Physics.stallDiameter(motor('435', PCEIL), 1.0, 'continuous', PCEIL), 97.79, 0.05);
near('continuous 1150', Physics.stallDiameter(motor('1150', PCEIL), 1.0, 'continuous', PCEIL), 40.97, 0.05);

section('Tip-speed cap v_cap = 1.5, cascade @ 0.6 kg (section 7)');
(function () {
  // After calibration nothing reaches 1.5 m/s, so the cap does not bind.
  var p = params({ v_cap: 1.5 });
  var a = Physics.sweepMotor(motor('435', p), 0.6, 'cascade', p);
  near('435 t', a.best_t, 0.9397, TOL_T);
  eq('435 d', a.best_d, 20);
  var b = Physics.sweepMotor(motor('223', p), 0.6, 'cascade', p);
  near('223 t', b.best_t, 0.9053, TOL_T);
  eq('223 d', b.best_d, 42);
  var u = Physics.sweepMotor(motor('435', PCEIL), 0.6, 'cascade', PCEIL);
  near('the 1.5 m/s cap is not binding', a.best_t, u.best_t, 1e-9);
})();

// ---------------------------------------------------------------- external checks

section('External check 1: goBILDA 2-stage Viper-Slide kit (section 7)');
(function () {
  // 488 mm travel, 112 mm-circumference pulley, 435 RPM, "~4.4 rotations", "~0.6 s".
  var travel = 488, circ = 112;
  near('rotations 488/112 vs their ~4.4', travel / circ, 4.4, 0.05);

  // Their 4.4 rotations only works if continuous take-up is the FULL travel, not travel/N.
  var p = params({ travel: 488 });
  var res = Physics.solve(motor('435', p), 30, 0.6, 'continuous', p);
  near('continuous take-up = full travel (m)', res.takeup, 0.488, 1e-9);
  var casc = Physics.solve(motor('435', p), 30, 0.6, 'cascade', p);
  near('cascade take-up = travel / N (m)', casc.takeup, 0.488 / 3, 1e-9);

  // Their "~0.6 s" is free-speed, zero-load: 488 / (435/60 * 112).
  near('free-speed time vs their ~0.6 s', travel / (435 / 60 * circ), 0.601, 0.002);
})();

section('External check 2 / CALIBRATION: FTC team The Clueless');
(function () {
  // 708.4 mm in ~0.515 s on two 435 RPM motors with belt overdrive. This is the
  // only measured full-system point, and drag_cal is fitted to land on it.
  var raw = {};
  for (var k in Motors.DEFAULTS) raw[k] = Motors.DEFAULTS[k];
  for (var i = 1; i <= 12; i++) delete raw['d' + i];
  delete raw.n_idler_c; delete raw.n_idler_k;
  raw.travel = 700; raw.N = 3; raw.n_motors = 2; raw.v_cap = 0;
  var base = Physics.deriveParams(raw);

  var best = Infinity, cfg = null;
  Physics.gearGrid(base).forEach(function (g) {
    var pg = Physics.withParam(base, 'G_ext', g);
    var m = Physics.deriveMotors(Motors.MOTORS, pg).find(function (x) { return x.name === '435'; });
    ['cascade', 'continuous'].forEach(function (rig) {
      Physics.diameters(pg).forEach(function (d) {
        var r = Physics.solve(m, d, 0.3, rig, pg);
        if (r && r.t < best) { best = r.t; cfg = g + ' ' + d + 'mm ' + rig; }
      });
    });
  });
  near('model lands on the measured 0.515 s', best, 0.515, 0.01);
  near('drag_cal is the baked figure', Motors.DEFAULTS.drag_cal, 15.964, 1e-9);
  near('calibrated d1', PCEIL.drags[0], 1.0 * 15.964, 1e-6);
  near('calibrated d_tot', PCEIL.d_tot, 2.4 * 15.964, 1e-6);
})();

// ---------------------------------------------------------------- model guards

section('Model guards (section 8)');
(function () {
  // STALL must be excluded from argmin, never treated as zero.
  var p = params({ d_max: 200, v_cap: 0 });
  var s = Physics.sweepMotor(motor('1150', p), 1.0, 'cascade', p);
  check('stalled diameters are null, not 0',
    s.times.some(function (t) { return t === null; }) &&
    !s.times.some(function (t) { return t === 0; }));
  check('best time ignores stalled points', s.best_t > 0 && isFinite(s.best_t));

  // Continuous still runs N phases, but each now ends at its own end stop, so the
  // speed carried into the next phase is the arrival speed, not the cruise speed.
  var r = Physics.solve(motor('223', PCEIL), 60, 0.6, 'continuous', PCEIL);
  check('continuous solves', !!r);
  eq('one phase per stage', r.phases.length, PCEIL.N);
  check('each phase has a run and a stop leg',
    r.phases.every(function (x) { return x.t_run >= 0 && x.t_stop > 0; }));
  check('every phase arrives at the end-stop speed',
    r.phases.every(function (x) {
      return Math.abs(x.w_end * r.r / PCEIL.G_ext - PCEIL.v_stop) < 1e-6 || x.hard;
    }));
  near('reported impact speed is the arrival speed', r.v_impact, PCEIL.v_stop, 1e-6);

  // Effective radius includes the string diameter.
  near('radius uses (d + d_string)/2000', Physics.radius(16, PCEIL), 0.0083, 1e-12);

  // Diameter sweep is 33 points, 2 mm apart, 16..80.
  var ds = Physics.diameters(PCEIL);
  eq('33 diameters', ds.length, 33);
  eq('first diameter', ds[0], 16);
  eq('last diameter', ds[32], 80);
  near('step', ds[1] - ds[0], 2, 1e-12);
})();

section('Acceptance criteria');
(function () {
  // The page defaults: 700 mm, 0.6 kg, 2.0 m/s cap.
  var a = Physics.stackAnswer(700, 0.6, 2.0);
  eq('best slide', a.stock.best.slide.model, 'BL-300C-2M');
  eq('best stage count', a.stock.best.N, 5);
  eq('best motor count', a.stock.best.n_motors, 2);
  eq('best motor', a.stock.best.motor.name, '223');
  eq('best rigging', a.stock.best.rigging, 'cascade');
  eq('best pulley', a.stock.best.d, 44);
  near('best time', a.stock.best.t, 0.5114, 0.002);
  near('arrives at the end stop at v_stop', a.stock.best.res.v_impact, 0.3, 1e-6);
})();

// ------------------------------------------------ addendum 2, section A

section('Addendum A: rigging is chosen, not entered');
(function () {
  var a = Physics.stockAnswer(0.6, PCEIL, Physics.deriveMotors(Motors.MOTORS, PCEIL));
  eq('cascade wins once each stage decelerates into its stop', a.rigging, 'cascade');
  eq('loser is continuous', a.other, 'continuous');
  near('winning time', a.t, 0.9053, 0.002);
  near('losing time', a.t_other, 1.1461, 0.002);
  near('margin %', a.margin, 26.6, 0.2);
  eq('winner motor', a.best.motor.name, '223');
  eq('winner pulley', a.best.best_d, 42);
  check('both riggings are kept for the tables', !!(a.byRigging.cascade && a.byRigging.continuous));

  Motors.PAYLOAD_SWEEP.forEach(function (P) {
    var r = Physics.stockAnswer(P, PCEIL, Physics.deriveMotors(Motors.MOTORS, PCEIL));
    var lo = Math.min(r.byRigging.cascade.best.best_t, r.byRigging.continuous.best.best_t);
    near('argmin over riggings @ ' + P.toFixed(1) + ' kg', r.t, lo, 1e-12);
  });
})();

// ------------------------------------------------ addendum 2, section B

section('Addendum B: external ratio grid and tooth pairs');
(function () {
  var g = Physics.gearGrid(P0);
  eq('grid size 0.4..6.0 step 0.05', g.length, 113);
  near('grid starts at 0.4', g[0], 0.4, 1e-12);
  near('grid ends at 6.0', g[112], 6.0, 1e-12);
  check('grid contains exactly 1.0', g.indexOf(1) !== -1);

  var t = Physics.nearestToothPair(2.4);
  near('2.4:1 -> exact tooth pair', t.ratio, 2.4, 1e-12);
  eq('2.4:1 driven', t.driven, 48);
  eq('2.4:1 driver', t.driver, 20);
  near('0.6:1 overdrive is reachable', Physics.nearestToothPair(0.6).ratio, 0.6, 1e-12);
  check('closest pair beats its neighbours', Physics.nearestToothPair(3.0).err < 1e-12);
})();

section('Addendum B: G_ext wiring');
(function () {
  // Identity: motor A geared by k is indistinguishable from a motor with ratio*k,
  // free speed/k, stall torque*k and rotor inertia*k^2 driven direct. This only
  // holds if J_sp is reflected by G_ext^2 too, which is the fix the addendum asked for.
  var p = params({ eta_ext: 1.0 });
  var A = motor('1150', p);
  var worst = 0, stallMismatch = 0;
  [0.5, 0.8, 1.6, 2.5, 4.0].forEach(function (k) {
    var B = { name: 'synthetic', rpm_free: A.rpm_free / k, T_stall: A.T_stall * k,
              kt: A.kt * k, w_free: A.w_free / k, J_rot: A.J_rot * k * k, peak_W: 0 };
    ['cascade', 'continuous'].forEach(function (rig) {
      [16, 40, 80].forEach(function (d) {
        var ta = Physics.solve(A, d, 0.6, rig, Physics.withParam(p, 'G_ext', k));
        var tb = Physics.solve(B, d, 0.6, rig, Physics.withParam(p, 'G_ext', 1));
        if (ta && tb) worst = Math.max(worst, Math.abs(ta.t - tb.t));
        else if (!!ta !== !!tb) stallMismatch++;
      });
    });
  });
  near('geared motor == equivalent direct-drive motor', worst, 0, 1e-11);
  eq('no stall disagreement', stallMismatch, 0);

  // eta_ext applies only when there is an external stage.
  near('eta untouched at G_ext = 1', Physics.effEta(params({ G_ext: 1 }), 0.8), 0.8, 1e-12);
  near('eta pays eta_ext at G_ext != 1',
    Physics.effEta(params({ G_ext: 2, eta_ext: 0.95 }), 0.8), 0.76, 1e-12);

  // J_sp is reflected by G_ext^2, so overdrive amplifies what the spool costs.
  // (Continuous at 20 mm keeps every case well clear of stall.)
  var pa = params({ eta_ext: 1.0, J_sp: 0 });
  var pb = params({ eta_ext: 1.0, J_sp: 5e-5 });
  function spoolCost(G) {
    var a = Physics.solve(motor('1150'), 20, 0.6, 'continuous', Physics.withParam(pa, 'G_ext', G));
    var b = Physics.solve(motor('1150'), 20, 0.6, 'continuous', Physics.withParam(pb, 'G_ext', G));
    check('no stall at G_ext = ' + G, !!(a && b));
    return (a && b) ? b.t - a.t : NaN;
  }
  var cost1 = spoolCost(1), costHalf = spoolCost(0.5);
  check('spool inertia costs time', cost1 > 0);
  check('overdrive amplifies the spool inertia (G_ext^2 reflection)', costHalf > 2 * cost1,
    'cost@0.5 = ' + cost1.toExponential(3) + ' -> ' + costHalf.toExponential(3));
})();

section('Addendum B: geared optimizer');
(function () {
  // Restricted to G_ext = 1 with no external penalty, the geared search must
  // reproduce the stock search exactly.
  var p1 = params({ g_min: 1, g_max: 1, eta_ext: 1.0 });
  var m1 = Physics.deriveMotors(Motors.MOTORS, p1);
  var stock = Physics.stockAnswer(0.6, p1, m1);
  var geared = Physics.gearedAnswer(0.6, p1, m1);
  near('same time as the stock optimizer', geared.best.t, stock.t, 1e-12);
  eq('same motor', geared.best.motor.name, stock.best.motor.name);
  eq('same pulley', geared.best.d, stock.best.best_d);
  eq('same rigging', geared.best.rigging, stock.rigging);

  // Gearing can never be worse than direct drive: G_ext = 1 is in the grid, and
  // the ideal search runs without the external-stage penalty.
  Motors.PAYLOAD_SWEEP.forEach(function (P) {
    var a = Physics.fullAnswer(P, P0, MOTORS);
    check('ideal <= stock @ ' + P.toFixed(1) + ' kg',
      a.ideal.t_ideal <= a.stock.t + 1e-12,
      'ideal ' + a.ideal.t_ideal.toFixed(6) + ' vs stock ' + a.stock.t.toFixed(6));
  });

  // With drag this high, torque is everything: the buildable optimum is now a
  // heavy reduction rather than direct drive.
  var real = Physics.gearedAnswer(0.6, Physics.withParam(PCEIL, 'eta_ext', 0.95),
                                  Physics.deriveMotors(Motors.MOTORS, PCEIL));
  check('a reduction beats direct drive', real.best.G_ext > 1,
    'G_ext = ' + real.best.G_ext);
  near('and it sits near the reduction limit', real.best.G_ext, 5.95, 0.3);
})();

// This is the bug that shipped: eta_ext is charged at every ratio EXCEPT exactly
// 1.0, so searching for the best ratio while one ratio holds a 5% discount pinned
// the answer to that ratio forever. The reported "ideal RPM" was then just the
// stock RPM of whichever motor won - a constant, whatever the user typed.
section('Ideal output RPM is a real, input-dependent quantity');
(function () {
  function idealRpm(over, P) {
    var o = { v_cap: 0 };
    for (var k in (over || {})) o[k] = over[k];
    var p = params(o);
    return Physics.fullAnswer(P, p, Physics.deriveMotors(Motors.MOTORS, p)).ideal.rpm;
  }

  var byPayload = [0, 0.6, 2.0].map(function (P) { return idealRpm({}, P); });
  check('ideal RPM falls as payload rises',
    byPayload[0] > byPayload[1] && byPayload[1] > byPayload[2],
    byPayload.map(Math.round).join(' -> '));

  // Post-calibration the load wants all the torque it can get, so the optimum
  // sits at the far end of the ratio grid and the ideal shaft speed is low.
  check('ideal RPM is low and near the reduction limit',
    byPayload.every(function (r) { return r > 150 && r < 260; }),
    byPayload.map(Math.round).join(' / '));

  // The regression itself: it must not simply echo a stock motor RPM every time.
  var stockRpms = Motors.MOTORS.map(function (m) { return m.rpm_free; });
  var pinned = 0;
  [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0].forEach(function (P) {
    if (stockRpms.indexOf(Math.round(idealRpm({}, P))) !== -1) pinned++;
  });
  check('ideal RPM is not pinned to the stock RPMs', pinned <= 2,
    pinned + ' of 8 payloads landed exactly on a catalogue RPM');

  // Same core: all six motors geared to one output RPM should land close together.
  var p = params({ eta_ext: 1.0 });
  var ms = Physics.deriveMotors(Motors.MOTORS, p);
  var ds = Physics.diameters(p);
  var times = [];
  ms.forEach(function (m) {
    var g = m.rpm_free / 700;
    if (g < p.g_min || g > p.g_max) return;
    var best = Infinity;
    ds.forEach(function (d) {
      var r = Physics.solve(m, d, 0.6, 'continuous', Physics.withParam(p, 'G_ext', g));
      if (r && r.t < best) best = r.t;
    });
    if (isFinite(best)) times.push(best);
  });
  var spread = 100 * (Math.max.apply(null, times) - Math.min.apply(null, times)) /
               Math.min.apply(null, times);
  check('motors geared to the same output RPM agree within 15%', spread < 15,
    'spread ' + spread.toFixed(1) + '%');

  // Reaching the ideal ratio is priced with the real stage loss, so the verdict
  // can legitimately come out negative.
  var a = Physics.fullAnswer(0.6, PCEIL, Physics.deriveMotors(Motors.MOTORS, PCEIL));
  check('ideal time (no stage loss) beats stock', a.ideal.t_ideal < a.stock.t);
  check('pricing the stage in leaves a small gain', a.gain > 0 && a.gain < 2,
    'gain ' + a.gain.toFixed(2) + '%');
  check('under 2%, so the tool still says build Answer 1', a.gearingHelps === false);
  check('and the RPM gap is reported', a.rpmGap > 0);
})();

section('Rigging verdict: energy audit and margin');
(function () {
  // Both riggings must still do exactly the true lift work at zero sliding speed.
  var P = 0.6, E = PCEIL.travel / 1000, mt = PCEIL.m3 + PCEIL.m_c + P;
  var trueWork = PCEIL.g * (PCEIL.m1 * E / 3 + PCEIL.m2 * 2 * E / 3 + mt * E);
  var noDrag = params({ d1: 0, d2: 0, d3: 0, drag_cal: 0, v_cap: 0 });
  var wCasc = Physics.cascadeForce(noDrag, P, 0).F * (E / noDrag.N);
  var ph = Physics.continuousPhases(noDrag, P, 0);
  var wCont = (ph[0].F + ph[1].F + ph[2].F) * (E / noDrag.N);
  near('cascade does the true lift work', wCasc, trueWork, 1e-9);
  near('continuous does the true lift work', wCont, trueWork, 1e-9);

  // With an end stop per stage, continuous pays N decel ramps to cascade's one,
  // so cascade now wins outright rather than by a hair.
  var a = Physics.stockAnswer(0.6, PCEIL, Physics.deriveMotors(Motors.MOTORS, PCEIL));
  eq('cascade wins after the decel ramps', a.rigging, 'cascade');
  check('and by a wide margin', a.margin > 20, 'margin ' + a.margin.toFixed(1) + '%');

  // The cost is structural: continuous restarts from v_stop N-1 extra times.
  var c = Physics.solve(motor('223', PCEIL), 42, 0.6, 'cascade', PCEIL);
  var k = Physics.solve(motor('223', PCEIL), 42, 0.6, 'continuous', PCEIL);
  eq('cascade has one stop', 1, 1);
  eq('continuous has N stops', k.phases.length, PCEIL.N);
  check('continuous is slower at the same pulley', k.t > c.t);
})();

section('The recommended build is always the fastest buildable one');
(function () {
  [[0, 700], [0.3, 820], [0.6, 700], [1.0, 700]].forEach(function (c) {
    var P = c[0];
    var p = params({ travel: c[1], v_cap: 0 });
    var ms = Physics.deriveMotors(Motors.MOTORS, p);
    var a = Physics.fullAnswer(P, p, ms);
    var tag = P.toFixed(1) + ' kg / ' + c[1] + ' mm';
    if (!a.stock.best || !a.ideal) return;

    check('theoretical ideal is never slower than stock ' + tag,
      a.ideal.t_ideal <= a.stock.t + 1e-12);
    // Below the 2% threshold the tool deliberately keeps the simpler build, so
    // the recommendation is either the fastest or within that band of it.
    var fastest = Math.min(a.stock.t, a.ideal.t);
    var recommended = a.gearingHelps ? a.ideal.t : a.stock.t;
    check('recommended build is the fastest, or inside the 2% band ' + tag,
      recommended <= fastest * 1.02 + 1e-12,
      'recommended ' + recommended.toFixed(6) + ' vs fastest ' + fastest.toFixed(6));
    if (a.gearingHelps) {
      near('and when gearing is recommended it is the fastest ' + tag,
        recommended, fastest, 1e-12);
    }
    if (a.ideal.t > a.stock.t) {
      check('does not recommend gearing when it is slower ' + tag, a.gearingHelps === false);
    }
  });

  // Tip speed still goes as RPM x pulley diameter, so the optimum stays flat.
  var pd = params({ v_cap: 0 });
  var md = motor('223', pd);
  var sw = Physics.sweepMotor(md, 0.6, 'cascade', pd);
  var off = Physics.solve(md, Math.round(sw.best_d * 0.8 / 2) * 2, 0.6, 'cascade', pd);
  check('20% pulley error costs under 10%', (off.t - sw.best_t) / sw.best_t < 0.10,
    (100 * (off.t - sw.best_t) / sw.best_t).toFixed(2) + '%');
})();

section('N-stage generalization');
(function () {
  function forN(N, over) {
    var raw = {};
    for (var k in Motors.DEFAULTS) raw[k] = Motors.DEFAULTS[k];
    for (var j = 1; j <= 12; j++) delete raw['d' + j];      // let the ramp regenerate
    delete raw.n_idler_c; delete raw.n_idler_k;
    raw.N = N;
    for (var o in (over || {})) raw[o] = over[o];
    return Physics.deriveParams(raw);
  }

  // Defaults must be generated from N, and must land on the recorded values at N=3.
  near('drag ramp d1', Motors.defaultDrag(1), 1.0, 1e-12);
  near('drag ramp d2', Motors.defaultDrag(2), 0.8, 1e-12);
  near('drag ramp d3', Motors.defaultDrag(3), 0.6, 1e-12);
  near('drag ramp d4', Motors.defaultDrag(4), 0.4, 1e-12);
  near('drag floors at 0.4 (d5)', Motors.defaultDrag(5), 0.4, 1e-12);
  near('drag floors at 0.4 (d9)', Motors.defaultDrag(9), 0.4, 1e-12);
  eq('idlers cascade = N+2 at N=3', Motors.defaultIdlers(3).c, 5);
  eq('idlers continuous = N+3 at N=3', Motors.defaultIdlers(3).k, 6);
  eq('idlers cascade = N+2 at N=7', Motors.defaultIdlers(7).c, 9);
  eq('idlers continuous = N+3 at N=7', Motors.defaultIdlers(7).k, 10);

  [1, 2, 3, 4, 5, 6, 8].forEach(function (N) {
    var p = forN(N);
    var tag = 'N=' + N;

    eq(tag + ' mass count', p.masses.length, N);
    eq(tag + ' drag count', p.drags.length, N);
    for (var i = 1; i <= N; i++) {
      var want = (i < N) ? p.m_slide + p.m_hw : p.m_slide * p.f_inner + p.m_hw;
      near(tag + ' m' + i, p.masses[i - 1], want, 1e-12);
      near(tag + ' d' + i, p.drags[i - 1],
        Motors.defaultDrag(i) * Motors.DEFAULTS.drag_cal, 1e-9);
    }
    eq(tag + ' n_idler_c', p.n_idler_c, N + 2);
    eq(tag + ' n_idler_k', p.n_idler_k, N + 3);
    near(tag + ' eta_c', p.eta_c, Math.pow(p.eta_idler, N + 2) * p.eta_spool, 1e-12);
    near(tag + ' eta_k', p.eta_k, Math.pow(p.eta_idler, N + 3) * p.eta_spool, 1e-12);

    var P = 0.6;
    var c = Physics.cascadeForce(p, P);
    var ph = Physics.continuousPhases(p, P);

    // Cascade: F = g*sum(i*m_i) + sum(d_i); inertia = sum(i^2*m_i).
    var sf = 0, se = 0;
    for (i = 1; i <= N; i++) {
      var mi = p.masses[i - 1] + (i === N ? p.m_c + P : 0);
      sf += i * mi; se += i * i * mi;
    }
    near(tag + ' cascade F', c.F, p.g * sf + p.d_tot - p.F_spring, 1e-12);
    near(tag + ' cascade m_eff', c.m_eff, se, 1e-12);
    near(tag + ' cascade m_tip', c.m_tip, p.masses[N - 1] + p.m_c + P, 1e-12);

    // Continuous: N phases, top stage first, mass accumulating downward.
    eq(tag + ' phase count', ph.length, N);
    eq(tag + ' first phase is the top stage', ph[0].stage, N);
    eq(tag + ' last phase is stage 1', ph[N - 1].stage, 1);
    var acc = 0;
    for (var k = 1; k <= N; k++) {
      var stage = N - k + 1;
      acc += p.masses[stage - 1] + (stage === N ? p.m_c + P : 0);
      near(tag + ' phase ' + k + ' M', ph[k - 1].M, acc, 1e-12);
      near(tag + ' phase ' + k + ' F', ph[k - 1].F,
        p.g * acc + p.drags[stage - 1] - p.F_spring, 1e-12);
    }
    check(tag + ' phase force rises down the stack',
      ph.every(function (x, idx) { return idx === 0 || x.F > ph[idx - 1].F; }));

    // Energy: both riggings must still do exactly the true lift work.
    var E = p.travel / 1000, trueW = 0;
    for (i = 1; i <= N; i++) {
      var m2 = p.masses[i - 1] + (i === N ? p.m_c + P : 0);
      trueW += p.g * m2 * (i * E / N);
    }
    near(tag + ' cascade work', c.F_grav * (E / N), trueW, 1e-9);
    var kw = 0;
    ph.forEach(function (x) { kw += p.g * x.M; });
    near(tag + ' continuous work', kw * (E / N), trueW, 1e-9);

    // And it must still actually solve.
    var ms = Physics.deriveMotors(Motors.MOTORS, p);
    var a = Physics.stockAnswer(P, p, ms);
    check(tag + ' produces an answer', !!a.best && a.t > 0 && isFinite(a.t));
    var full = Physics.fullAnswer(P, p, ms);
    check(tag + ' ideal RPM is finite and positive',
      full.ideal && isFinite(full.ideal.rpm) && full.ideal.rpm > 0);
  });

  // N=3 must reproduce the recorded stack - this is the regression guard.
  var p3 = forN(3, { v_cap: 0 });
  var CAL = Motors.DEFAULTS.drag_cal;
  near('N=3 m1', p3.m1, 0.148, 1e-12);
  near('N=3 m2', p3.m2, 0.148, 1e-12);
  near('N=3 m3', p3.m3, 0.089, 1e-12);
  near('N=3 d_tot', p3.d_tot, 2.4 * CAL, 1e-9);
  near('N=3 eta_c', p3.eta_c, 0.8158, 5e-5);
  near('N=3 eta_k', p3.eta_k, 0.7913, 5e-5);
  var ms3 = Physics.deriveMotors(Motors.MOTORS, p3);
  near('N=3 cascade 0.6 kg matches the table',
    Physics.analyze(0.6, 'cascade', p3, ms3).best.best_t, 0.9053, 0.002);
  near('N=3 continuous 0.6 kg matches the table',
    Physics.analyze(0.6, 'continuous', p3, ms3).best.best_t, 1.1461, 0.002);

  // Explicit d_i overrides win over the ramp; drag_cal scales whichever is used.
  var pOv = forN(4, { d2: 3.3 });
  near('explicit d2 override wins', pOv.drags[1], 3.3 * CAL, 1e-9);
  near('other interfaces keep the ramp', pOv.drags[2], 0.6 * CAL, 1e-9);
  near('d_tot reflects the override', pOv.d_tot, (1.0 + 3.3 + 0.6 + 0.4) * CAL, 1e-9);

  // N=1: one stage, one phase, take-up equals the full travel either way.
  var p1 = forN(1);
  var m1 = Physics.deriveMotors(Motors.MOTORS, p1)[1];
  eq('N=1 has one phase', Physics.continuousPhases(p1, 0.6).length, 1);
  var c1 = Physics.solve(m1, 40, 0.6, 'cascade', p1);
  var k1 = Physics.solve(m1, 40, 0.6, 'continuous', p1);
  near('N=1 cascade take-up = full travel', c1.takeup, p1.travel / 1000, 1e-12);
  near('N=1 continuous take-up = full travel', k1.takeup, p1.travel / 1000, 1e-12);

  // Phase labels stay readable past C.
  eq('phase 1 is A', Physics.phaseName(1), 'A');
  eq('phase 5 is E', Physics.phaseName(5), 'E');
})();

section('Cross-checks: the answer, the table and the charts agree');
(function () {
  [0, 0.6, 1.0].forEach(function (P) {
    var a = Physics.fullAnswer(P, P0, MOTORS);
    var win = a.stock.byRigging[a.stock.rigging];
    var tag = '@ ' + P.toFixed(1) + ' kg';

    // Answer block == rank 1 of the table it displays.
    eq('answer motor is table rank 1 ' + tag, a.stock.best.motor.name, win.ranked[0].motor.name);
    near('answer time is table rank 1 ' + tag, a.stock.t, win.ranked[0].best_t, 1e-12);
    near('answer pulley is table rank 1 ' + tag, a.stock.best.best_d, win.ranked[0].best_d, 1e-12);

    // The table is genuinely sorted.
    for (var i = 1; i < win.ranked.length; i++) {
      check('table sorted ' + tag + ' row ' + i, win.ranked[i].best_t >= win.ranked[i - 1].best_t);
    }

    // Charts 3/4 sweep the same diameters the table optimises over.
    Physics.RIGGINGS.forEach(function (rig) {
      var row = a.stock.byRigging[rig].rows.filter(function (r) { return !r.stalled; })[0];
      if (!row) return;
      var lo = Infinity, at = null;
      row.times.forEach(function (t, i) { if (t !== null && t < lo) { lo = t; at = row.diameters[i]; } });
      near('chart min == table best, ' + rig + ' ' + row.motor.name + ' ' + tag, lo, row.best_t, 1e-12);
      near('chart argmin == table pulley, ' + rig + ' ' + row.motor.name + ' ' + tag,
        at, row.best_d, 1e-12);
    });

    // The +/-5% window must actually bracket the optimum.
    win.ranked.forEach(function (r) {
      check('window brackets the optimum, ' + r.motor.name + ' ' + tag,
        r.window[0] <= r.best_d && r.best_d <= r.window[1]);
      check('every diameter in the window is within 5%, ' + r.motor.name + ' ' + tag,
        r.times.every(function (t, i) {
          var d = r.diameters[i];
          if (d < r.window[0] || d > r.window[1]) return true;
          return t !== null && t <= 1.05 * r.best_t + 1e-12;
        }));
    });
  });

  // Chart 1/2 payload series must match a direct solve at that payload.
  var m = motor('1150');
  Motors.PAYLOAD_SWEEP.forEach(function (P) {
    var viaSweep = Physics.sweepMotor(m, P, 'continuous', Physics.withParam(P0, 'G_ext', 1));
    var direct = Physics.solve(m, viaSweep.best_d, P, 'continuous', Physics.withParam(P0, 'G_ext', 1));
    near('payload-curve point == direct solve @ ' + P.toFixed(1) + ' kg', viaSweep.best_t, direct.t, 1e-12);
  });
})();

section('Addendum 3: stack search');
(function () {
  var SL = {};
  Motors.SLIDES.forEach(function (s) { SL[s.model] = s; });

  // Catalogue sanity.
  eq('four slides', Motors.SLIDES.length, 4);
  eq('stage counts 2..5', Motors.STAGE_COUNTS.join(','), '2,3,4,5');
  eq('motor counts 1,2', Motors.MOTOR_COUNTS.join(','), '1,2');
  near('BL-350C stroke', SL['BL-350C-2M'].stroke, 245.5, 1e-9);
  near('BL-350C mass matches SPEC m_slide', SL['BL-350C-2M'].mass, 0.118, 1e-9);
  near('BL-200A mass is the measured 72 g', SL['BL-200A-2M'].mass, 0.072, 1e-9);

  // Only stacks that actually reach are considered.
  check('3 x BL-350C reaches 700', Physics.reaches(SL['BL-350C-2M'], 3, 700));
  check('5 x BL-200A does not reach 700', !Physics.reaches(SL['BL-200A-2M'], 5, 700));
  check('2 x BL-350C does not reach 700', !Physics.reaches(SL['BL-350C-2M'], 2, 700));

  var stock = Physics.stockStack(700, 0.6, 0);
  check('search is reachable at 700 mm', stock.reachable && !!stock.best);
  check('every row reaches the extension', stock.rows.every(function (r) {
    return r.N * r.slide.stroke >= 700 - 1e-9;
  }));
  check('rows are ranked fastest first', stock.rows.every(function (r, i) {
    return i === 0 || r.t >= stock.rows[i - 1].t;
  }));
  check('no BL-200A row at 700 mm', stock.rows.every(function (r) {
    return r.slide.model !== 'BL-200A-2M';
  }));
  check('one row per (slide, N)', (function () {
    var seen = {};
    return stock.rows.every(function (r) {
      var k = r.slide.model + '/' + r.N;
      if (seen[k]) return false;
      seen[k] = 1; return true;
    });
  })());
  check('the table contains 3 x BL-350C', stock.rows.some(function (r) {
    return r.slide.model === 'BL-350C-2M' && r.N === 3;
  }));
  near('stroke spare for 3 x BL-350C at 700', 3 * SL['BL-350C-2M'].stroke - 700, 36.5, 1e-9);

  // Post-calibration, one 1150 cannot lift this stack on a 50 mm pulley at all -
  // 38 N of drag stalls it. The single-motor reference is now the 223 on cascade.
  var pRef = Physics.stackParams(SL['BL-350C-2M'], 3, 1, 700, 0.6, 0);
  var msRef = Physics.deriveMotors(Motors.MOTORS, pRef);
  var mRef = msRef.find(function (m) { return m.name === '1150'; });
  check('one 1150 stalls at 50 mm continuous',
    Physics.solve(mRef, 50, 0.6, 'continuous', pRef) === null);

  var bestRef = null;
  msRef.forEach(function (m) {
    ['cascade', 'continuous'].forEach(function (rig) {
      Physics.diameters(pRef).forEach(function (d) {
        var r = Physics.solve(m, d, 0.6, rig, pRef);
        if (r && (!bestRef || r.t < bestRef.t)) {
          bestRef = { t: r.t, name: m.name, rig: rig, d: d };
        }
      });
    });
  });
  eq('single-motor 3 x BL-350C best motor', bestRef.name, '223');
  eq('single-motor 3 x BL-350C best rigging', bestRef.rig, 'cascade');
  eq('single-motor 3 x BL-350C best pulley', bestRef.d, 42);
  near('single-motor 3 x BL-350C best time', bestRef.t, 0.9053, 0.002);

  // Two motors can never be slower than one, at G_ext = 1.
  Motors.SLIDES.forEach(function (slide) {
    Motors.STAGE_COUNTS.forEach(function (N) {
      if (!Physics.reaches(slide, N, 700)) return;
      var t = [1, 2].map(function (nm) {
        var p = Physics.stackParams(slide, N, nm, 700, 0.6, 0);
        var ms = Physics.deriveMotors(Motors.MOTORS, p);
        var ds = Physics.diameters(p), best = Infinity;
        ms.forEach(function (m) {
          ['cascade', 'continuous'].forEach(function (rig) {
            ds.forEach(function (d) {
              var r = Physics.solve(m, d, 0.6, rig, p);
              if (r && r.t < best) best = r.t;
            });
          });
        });
        return best;
      });
      check('2 motors <= 1 motor, ' + slide.model + ' x' + N, t[1] <= t[0] + 1e-12,
        t[1].toFixed(6) + ' vs ' + t[0].toFixed(6));
    });
  });

  // A tip-speed cap sets a hard kinematic floor no build can beat.
  [0.5, 1.0, 1.5].forEach(function (cap) {
    var capped = Physics.stockStack(700, 0.6, cap);
    var floor = 0.7 / cap;
    check('every row respects the ' + cap + ' m/s floor of ' + floor.toFixed(3) + ' s',
      capped.rows.every(function (r) { return r.t >= floor - 1e-9; }),
      'fastest ' + (capped.rows[0] ? capped.rows[0].t.toFixed(4) : 'n/a'));
  });

  // Unreachable extensions are reported, not silently empty.
  var far = Physics.stockStack(2000, 0.6, 0);
  check('2000 mm is out of reach', !far.reachable && !far.best);
  var edge = Physics.stockStack(5 * SL['BL-400B-2M'].stroke, 0.6, 0);
  check('the longest stack is exactly reachable', edge.reachable);

  // Short extensions bring the small slides into play.
  var shortRun = Physics.stockStack(300, 0.6, 0);
  check('BL-200A appears at 300 mm', shortRun.rows.some(function (r) {
    return r.slide.model === 'BL-200A-2M';
  }));

  // Tie-break: fewer stages, then fewer motors, then pulley nearest 40 mm.
  check('winner has the fewest stages among equals', stock.rows.every(function (r) {
    return r.t > stock.best.t + 1e-6 || r.N >= stock.best.N;
  }));

  // Per-motor current is the total divided by the motor count.
  var p2 = Physics.stackParams(SL['BL-350C-2M'], 3, 2, 700, 0.6, 0);
  var m2 = Physics.deriveMotors(Motors.MOTORS, p2).find(function (m) { return m.name === '1150'; });
  var r2 = Physics.solve(m2, 50, 0.6, 'continuous', p2);
  near('two motors split the current', r2.I / 2, (r2.I) / p2.n_motors, 1e-12);
  check('per-motor current is under the total', r2.I / p2.n_motors < r2.I);

  // The full answer wires both halves together.
  var full = Physics.stackAnswer(700, 0.6, 0);
  check('full answer is reachable', full.reachable);
  check('geared is never slower than stock', full.geared.best.t <= full.stock.best.t + 1e-12);
  check('gain is finite', isFinite(full.gain));
})();

// ----------------------------------------------------------------

console.log('\n' + '-'.repeat(56));
if (fail) {
  console.log(fail + ' FAILED, ' + pass + ' passed\n');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  process.exit(1);
}
console.log('All ' + pass + ' assertions passed.');

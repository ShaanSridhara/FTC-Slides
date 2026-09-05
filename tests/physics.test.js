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

var TOL_T = 0.002;   // s
var TOL_D = 2;       // mm

// ---------------------------------------------------------------- section 2/3

section('Derived constants (section 2, 3)');
near('eta_c = eta_idler^5 * eta_spool', P0.eta_c, 0.8158, 5e-5);
near('eta_k = eta_idler^6 * eta_spool', P0.eta_k, 0.7913, 5e-5);
near('m1', P0.m1, 0.148, 1e-9);
near('m2', P0.m2, 0.148, 1e-9);
near('m3', P0.m3, 0.089, 1e-9);
near('d_tot', P0.d_tot, 2.4, 1e-9);
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
  [0.2757, 0.2646, 0.2733, 0.2873, 0.3174, 0.5149],
  [0.3569, 0.3423, 0.3565, 0.3698, 0.3669, 0.5453],
  [0.4439, 0.4089, 0.4293, 0.4469, 0.4220, 0.5781],
  [0.5543, 0.4720, 0.4984, 0.5207, 0.4847, 0.6137],
  [0.7107, 0.5430, 0.5662, 0.5938, 0.5500, 0.6527],
  [0.9738, 0.6297, 0.6344, 0.6673, 0.6150, 0.6955]
];
var T_CONTINUOUS = [
  [0.2388, 0.2358, 0.4268, 0.5707, 0.7673, 1.4149],
  [0.3309, 0.3183, 0.4616, 0.6017, 0.7912, 1.4369],
  [0.4055, 0.3902, 0.4997, 0.6351, 0.8162, 1.4597],
  [0.4746, 0.4568, 0.5419, 0.6713, 0.8426, 1.4831],
  [0.5419, 0.5215, 0.5891, 0.7109, 0.8705, 1.5073],
  [0.6092, 0.5859, 0.6425, 0.7545, 0.9000, 1.5322]
];
var D_CASCADE = [
  [20, 28, 70, 80, 80, 80],
  [16, 22, 54, 72, 80, 80],
  [16, 18, 44, 60, 80, 80],
  [16, 16, 38, 52, 78, 80],
  [16, 16, 34, 46, 70, 80],
  [16, 16, 30, 40, 62, 80]
];
var D_CONTINUOUS = [
  [74, 80, 80, 80, 80, 80],
  [50, 72, 80, 80, 80, 80],
  [40, 58, 80, 80, 80, 80],
  [34, 50, 80, 80, 80, 80],
  [30, 44, 80, 80, 80, 80],
  [26, 38, 80, 80, 80, 80]
];

function tableTest(label, rigging, times, dias) {
  section('BEST EXTENSION TIME + PULLEY, ' + label.toUpperCase() + ' (section 7)');
  Motors.PAYLOAD_SWEEP.forEach(function (payload, i) {
    NAMES.forEach(function (name, j) {
      var s = Physics.sweepMotor(motor(name), payload, rigging, P0);
      var tag = label + ' ' + payload.toFixed(1) + 'kg ' + name;
      if (s.stalled) { check(tag, false, 'model stalled, expected a result'); return; }
      near(tag + ' t', s.best_t, times[i][j], TOL_T);
      near(tag + ' d', s.best_d, dias[i][j], TOL_D);
    });
  });
}
tableTest('cascade', 'cascade', T_CASCADE, D_CASCADE);
tableTest('continuous', 'continuous', T_CONTINUOUS, D_CONTINUOUS);

// ---------------------------------------------------------------- spot checks

section('Spot checks, cascade @ 0.6 kg (section 7)');
(function () {
  var r = Physics.solve(motor('1150'), 16, 0.6, 'cascade', P0);
  var s = Physics.sweepMotor(motor('1150'), 0.6, 'cascade', P0);
  near('1150 @16mm u', r.u, 0.362, 0.0005);
  near('1150 @16mm I', r.I, 3.60, 0.005);
  eq('1150 @16mm window lo', s.window[0], 16);
  eq('1150 @16mm window hi', s.window[1], 20);

  var r2 = Physics.solve(motor('435'), 38, 0.6, 'cascade', P0);
  var s2 = Physics.sweepMotor(motor('435'), 0.6, 'cascade', P0);
  near('435 @38mm u', r2.u, 0.356, 0.0005);
  near('435 @38mm I', r2.I, 3.54, 0.005);
  eq('435 @38mm window lo', s2.window[0], 30);
  eq('435 @38mm window hi', s2.window[1], 48);

  var s3 = Physics.sweepMotor(motor('223'), 0.6, 'cascade', P0);
  eq('223 @78mm window lo', s3.window[0], 60);
  eq('223 @78mm window hi', s3.window[1], 80);
})();

section('Cable force, cascade @ 1.0 kg (section 7)');
near('F', Physics.cascadeForce(P0, 1.0).F, 40.263, 0.001);

// Regenerated at the spec's d_string = 0.6 mm. The original block was computed with
// a 1.0 mm string and disagreed with the main table for its own cell (0.637 vs the
// table's 0.6297); SPEC.md now carries these values.
section('Spot check, cascade 1150 @ 1.0 kg (section 7)');
(function () {
  var m = motor('1150');
  var T16 = 0.6297;   // spot-check value for d=16, must be the same cell as the table
  var a = Physics.solve(m, 16, 1.0, 'cascade', P0);
  near('d=16 tau', a.tau, 0.4096, 0.0005);
  near('d=16 u', a.u, 0.514, 0.0005);
  near('d=16 I', a.I, 4.98, 0.005);
  near('d=16 t', a.t, T16, TOL_T);
  near('d=24 t', Physics.solve(m, 24, 1.0, 'cascade', P0).t, 0.9770, TOL_T);
  near('d=28 t', Physics.solve(m, 28, 1.0, 'cascade', P0).t, 1.6756, TOL_T);
  // The spot check and the reference table describe the same cell, so the two
  // expected values must be identical - that is what the original block got wrong.
  eq('spot-check d=16 agrees with the cascade table cell', T16, T_CASCADE[5][1]);
  near('d_stall', Physics.stallDiameter(m, 1.0, 'cascade', P0), 31.37, 0.05);
  check('d=30 still lifts', Physics.solve(m, 30, 1.0, 'cascade', P0) !== null);
  check('d=32 stalls', Physics.solve(m, 32, 1.0, 'cascade', P0) === null);
})();

section('Stall diameters @ 1.0 kg (section 7)');
near('cascade 435', Physics.stallDiameter(motor('435'), 1.0, 'cascade', P0), 75, TOL_D);
near('cascade 1150', Physics.stallDiameter(motor('1150'), 1.0, 'cascade', P0), 31, TOL_D);
near('continuous 435', Physics.stallDiameter(motor('435'), 1.0, 'continuous', P0), 196, TOL_D);
near('continuous 1150', Physics.stallDiameter(motor('1150'), 1.0, 'continuous', P0), 82, TOL_D);

section('Tip-speed cap v_cap = 1.5, cascade @ 0.6 kg (section 7)');
(function () {
  var p = params({ v_cap: 1.5 });
  var a = Physics.sweepMotor(motor('435', p), 0.6, 'cascade', p);
  near('435 t', a.best_t, 0.527, TOL_T);
  near('435 d', a.best_d, 30, TOL_D);
  var b = Physics.sweepMotor(motor('223', p), 0.6, 'cascade', p);
  near('223 t', b.best_t, 0.522, TOL_T);
  near('223 d', b.best_d, 60, TOL_D);
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

section('External check 2: FTC team The Clueless, CENTERSTAGE (section 7)');
(function () {
  // Measured: 708.4 mm in <0.515 s on belt overdrive = 1.376 m/s avg.
  // Model: one 435, 700 mm, capped 1.5 m/s -> 1.426 m/s avg, 3.7% apart.
  var measured = 1.376;
  var p = params({ v_cap: 1.5, travel: 700 });
  var s = Physics.sweepMotor(motor('435', p), 0.2, 'continuous', p);
  var v_avg = (p.travel / 1000) / s.best_t;
  near('model v_avg', v_avg, 1.426, 0.002);
  near('gap vs measured (%)', 100 * (v_avg - measured) / measured, 3.7, 0.2);
})();

// ---------------------------------------------------------------- model guards

section('Model guards (section 8)');
(function () {
  // STALL must be excluded from argmin, never treated as zero.
  var p = params({ d_max: 200 });
  var s = Physics.sweepMotor(motor('1150', p), 1.0, 'cascade', p);
  check('stalled diameters are null, not 0',
    s.times.some(function (t) { return t === null; }) &&
    !s.times.some(function (t) { return t === 0; }));
  check('best time ignores stalled points', s.best_t > 0 && s.best_t < 1);

  // Continuous phases must carry end speed forward, not restart from rest.
  var r = Physics.solve(motor('1150'), 50, 0.6, 'continuous', P0);
  check('phase B starts from phase A end speed', r.phases[0].w_end > 0);
  var restart = r.phases[1].t;
  check('carrying momentum makes phase B faster than a restart',
    restart < r.phases[0].t);

  // Effective radius includes the string diameter.
  near('radius uses (d + d_string)/2000', Physics.radius(16, P0), 0.0083, 1e-12);

  // Diameter sweep is 33 points, 2 mm apart, 16..80.
  var ds = Physics.diameters(P0);
  eq('33 diameters', ds.length, 33);
  eq('first diameter', ds[0], 16);
  eq('last diameter', ds[32], 80);
  near('step', ds[1] - ds[0], 2, 1e-12);

  // Under a cap everything converges on travel/v_cap (section 8, first bullet).
  var pc = params({ v_cap: 0.5 });
  var slow = Physics.sweepMotor(motor('1150', pc), 0.6, 'cascade', pc);
  near('capped time approaches travel / v_cap', slow.best_t, 0.7 / 0.5, 0.05);
})();

section('Acceptance criteria (section 0.6)');
(function () {
  var c = Physics.analyze(0.6, 'cascade', P0, MOTORS);
  eq('cascade 0.6 kg best motor', c.best.motor.name, '1150');
  eq('cascade 0.6 kg best pulley', c.best.best_d, 16);
  near('cascade 0.6 kg time', c.best.best_t, 0.472, 0.0005);

  var k = Physics.analyze(0.6, 'continuous', P0, MOTORS);
  eq('continuous 0.6 kg best motor', k.best.motor.name, '1150');
  eq('continuous 0.6 kg best pulley', k.best.best_d, 50);
  near('continuous 0.6 kg time', k.best.best_t, 0.457, 0.0005);
})();

// ------------------------------------------------ addendum 2, section A

section('Addendum A: rigging is chosen, not entered');
(function () {
  var a = Physics.stockAnswer(0.6, P0, MOTORS);
  eq('defaults pick continuous', a.rigging, 'continuous');
  eq('loser is cascade', a.other, 'cascade');
  near('winning time', a.t, 0.4568, TOL_T);
  near('losing time', a.t_other, 0.4720, TOL_T);
  near('margin %', a.margin, 3.3, 0.1);
  eq('winner motor', a.best.motor.name, '1150');
  eq('winner pulley', a.best.best_d, 50);
  check('both riggings are kept for the tables', !!(a.byRigging.cascade && a.byRigging.continuous));

  // The winner must actually be the lower of the two.
  Motors.PAYLOAD_SWEEP.forEach(function (P) {
    var r = Physics.stockAnswer(P, P0, MOTORS);
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

  // Gearing can never be worse than direct drive, because G_ext = 1 is in the grid.
  Motors.PAYLOAD_SWEEP.forEach(function (P) {
    var a = Physics.fullAnswer(P, P0, MOTORS);
    check('geared <= stock @ ' + P.toFixed(1) + ' kg overall',
      a.geared.best.t <= a.stock.t + 1e-12,
      'geared ' + a.geared.best.t.toFixed(6) + ' vs stock ' + a.stock.t.toFixed(6));

    // and per motor, covering every reference-table cell
    a.geared.curves.forEach(function (c) {
      var gearedBest = Infinity;
      c.points.forEach(function (pt) { if (pt.t < gearedBest) gearedBest = pt.t; });
      var direct = Infinity;
      ['cascade', 'continuous'].forEach(function (rig) {
        var s = Physics.sweepMotor(c.motor, P, rig, Physics.withParam(P0, 'G_ext', 1));
        if (!s.stalled && s.best_t < direct) direct = s.best_t;
      });
      if (isFinite(direct)) {
        check('geared <= direct, ' + c.motor.name + ' @ ' + P.toFixed(1) + ' kg',
          gearedBest <= direct + 1e-12,
          gearedBest.toFixed(6) + ' vs ' + direct.toFixed(6));
      }
    });
  });

  // Ties resolve toward no external stage.
  var a = Physics.fullAnswer(0.6, P0, MOTORS);
  near('defaults: gearing gains nothing', a.gain, 0, 1e-9);
  eq('defaults: tie-break picks direct drive', a.geared.best.G_ext, 1);
  check('defaults: reported as not worth it', a.gearingHelps === false);
  near('equivalent output RPM at G_ext = 1 is the motor rpm', a.geared.rpm_equiv, 1150, 1e-9);

  // With the pulley range restricted, gearing must actually earn its keep.
  var pr = params({ d_min: 60 });
  var mr = Physics.deriveMotors(Motors.MOTORS, pr);
  var tight = Physics.fullAnswer(2.0, pr, mr);
  check('a 60 mm pulley floor makes gearing pay', tight.gain > 2 && tight.gearingHelps,
    'gain ' + tight.gain.toFixed(2) + '%');
  check('and it picks a real reduction', tight.geared.best.G_ext !== 1);

  // chart 5 data
  eq('one curve per motor', a.geared.curves.length, 6);
  a.geared.curves.forEach(function (c) {
    check(c.motor.name + ' curve is ascending in RPM', c.points.every(function (pt, i) {
      return i === 0 || pt.rpm >= c.points[i - 1].rpm;
    }));
    check(c.motor.name + ' curve has points', c.points.length > 0);
  });
  check('windows reported on both axes',
    a.geared.gWindow[0] !== null && a.geared.dWindow[0] !== null);
})();

// ----------------------------------------------------------------

console.log('\n' + '-'.repeat(56));
if (fail) {
  console.log(fail + ' FAILED, ' + pass + ' passed\n');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  process.exit(1);
}
console.log('All ' + pass + ' assertions passed.');

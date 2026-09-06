/* motors.js — motor table (spec section 3) and default constants (spec section 2).
   Raw source values only; everything derived lives in physics.js. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Motors = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // goBILDA 5203 Yellow Jacket, shared RS-555 core. T_stall in kg-cm as sourced.
  var MOTORS = [
    { name: '1620', ratio: 3.7,  rpm_free: 1620, kgcm: 5.4  },
    { name: '1150', ratio: 5.2,  rpm_free: 1150, kgcm: 7.9  },
    { name: '435',  ratio: 13.7, rpm_free: 435,  kgcm: 18.7 },
    { name: '312',  ratio: 19.2, rpm_free: 312,  kgcm: 24.3 },
    { name: '223',  ratio: 26.9, rpm_free: 223,  kgcm: 38.0 },
    { name: '117',  ratio: 50.9, rpm_free: 117,  kgcm: 68.4 }
  ];

  // Section 2. Measured values for the BWTLink BL-350C-2M stack; all overridable.
  var DEFAULTS = {
    // --- user inputs (section 1) ---
    travel: 700,          // mm
    rigging: 'cascade',   // cascade | continuous
    payload: 0.6,         // kg
    v_cap: 2.0,           // m/s tip-speed cap; 0 = uncapped physics ceiling

    // --- geometry and masses ---
    N: 3,                 // stages
    m_slide: 0.118,       // kg per slide, incl 2 pulley modules
    f_inner: 0.5,         // fraction of slide mass in the moving inner rail
    m_hw: 0.030,          // kg extra hardware per moving stage
    m_c: 0.050,           // kg carriage / plate
    F_spring: 0,          // N assist at cable, negative fights extension
    g: 9.80665,           // m/s^2

    // --- sliding drag model ---
    k_v: 0.5,             // s/m, drag rises as d_i * (1 + k_v * sliding speed)
    drag_cal: 15.964,     // see CALIBRATION note below

    // --- end-stop deceleration ---
    d_stop: 60,           // mm of stage travel given over to the decel ramp
    v_stop: 0.3,          // m/s target speed at the end stop

    // --- drive ---
    n_motors: 1,
    G_ext: 1,             // external ratio after motor
    d_string: 0.6,        // mm, 150 lb braided Spectra
    eta_idler: 0.97,
    eta_spool: 0.95,      // spool bearing + ext gear
    J_sp: 5e-5,           // kg-m^2 pulley + hub inertia
    t_m: 0.015,           // s motor mechanical time constant
    eta_ext: 0.95,        // per external gearing stage, applied only when G_ext != 1

    // --- external ratio search grid (addendum 2) ---
    g_min: 0.4,           // below 1 = overdrive
    g_max: 6.0,
    g_step: 0.05,

    // --- electrical ---
    V_batt: 12.5,         // V open circuit
    I_other: 0,           // A drivetrain etc, sags supply
    R_series: 0.030,      // ohm
    I_port: 20,           // A Control Hub port limit
    I_stall: 9.2,         // A
    I_free: 0.25,         // A

    // --- build limits ---
    d_min: 16,            // mm
    d_max: 80             // mm
  };

  // CALIBRATION
  // The only measured full-system data point is FTC team The Clueless: 708.4 mm
  // in ~0.515 s on two 435 RPM motors with belt overdrive. Running that config
  // (700 mm, 0.3 kg, 2 motors, 435, G_ext free, 3 stages, uncapped) the model
  // returned 0.3159 s at drag_cal = 1 - 39% too fast. Scaling every d_i by one
  // common factor of 15.964 lands it on 0.5150 s.
  //
  // That factor is large: total drag goes from 2.40 N to 38.31 N. It is doing
  // more than modelling friction - it is absorbing everything between this model
  // and a real robot on a real field, on the strength of one data point. Treat
  // the drag figures as a fitted parameter, not a measurement.

  // Per-interface sliding drag, falling toward the top of the stack but never
  // below 0.4 N. i is 1-based: interface 1 is base-to-stage-1.
  function defaultDrag(i) { return Math.max(0.4, 1.0 - 0.2 * (i - 1)); }

  // Idlers in each force path scale with the number of stages.
  function defaultIdlers(N) { return { c: N + 2, k: N + 3 }; }

  // Fill in the N-dependent defaults so they cannot drift from the formulas above.
  // At N = 3 this reproduces d1/d2/d3 = 1.0/0.8/0.6 and 5/6 idlers exactly.
  for (var i = 1; i <= DEFAULTS.N; i++) DEFAULTS['d' + i] = defaultDrag(i);
  DEFAULTS.n_idler_c = defaultIdlers(DEFAULTS.N).c;
  DEFAULTS.n_idler_k = defaultIdlers(DEFAULTS.N).k;

  // BWTLink slide catalogue. stroke = travel per slide, mass = mass per slide
  // including its 2 slide pulley modules (same convention as m_slide in SPEC.md).
  var SLIDES = [
    { model: 'BL-200A-2M', nominal_in: 8,  nominal_mm: 203.2, stroke: 121,   mass: 0.072 },
    { model: 'BL-300C-2M', nominal_in: 12, nominal_mm: 304.8, stroke: 205,   mass: 0.101 },
    { model: 'BL-350C-2M', nominal_in: 14, nominal_mm: 355.6, stroke: 245.5, mass: 0.118 },
    { model: 'BL-400B-2M', nominal_in: 16, nominal_mm: 406.4, stroke: 283,   mass: 0.130 }
  ];

  // Capped at 4: a 5-stage stack is more rigging, more drag and more slop
  // than the fraction of a second it buys back.
  var STAGE_COUNTS = [2, 3, 4];
  var MOTOR_COUNTS = [1, 2];

  var PAYLOAD_SWEEP = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  return {
    MOTORS: MOTORS, DEFAULTS: DEFAULTS, PAYLOAD_SWEEP: PAYLOAD_SWEEP,
    SLIDES: SLIDES, STAGE_COUNTS: STAGE_COUNTS, MOTOR_COUNTS: MOTOR_COUNTS,
    defaultDrag: defaultDrag, defaultIdlers: defaultIdlers
  };
});

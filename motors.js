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

  // Section 2. Everything here is overridable from the Advanced panel.
  var DEFAULTS = {
    // --- user inputs (section 1) ---
    travel: 700,          // mm
    rigging: 'cascade',   // cascade | continuous
    payload: 0.6,         // kg
    v_cap: 0,             // m/s, 0 = none

    // --- geometry and masses ---
    N: 3,                 // stages
    m_slide: 0.118,       // kg per slide, incl 2 pulley modules
    f_inner: 0.5,         // fraction of slide mass in the moving inner rail (ESTIMATE)
    m_hw: 0.030,          // kg extra hardware per moving stage (ESTIMATE)
    m_c: 0.050,           // kg carriage / plate (ESTIMATE)
    d1: 1.0,              // N sliding drag, interface 1 (base-s1)   (ESTIMATE)
    d2: 0.8,              // N sliding drag, interface 2             (ESTIMATE)
    d3: 0.6,              // N sliding drag, interface 3             (ESTIMATE)
    F_spring: 0,          // N assist at cable, negative fights extension
    g: 9.80665,           // m/s^2

    // --- drive ---
    n_motors: 1,
    G_ext: 1,             // external ratio after motor
    d_string: 0.6,        // mm, 150 lb braided Spectra
    n_idler_c: 5,         // idlers in cascade force path
    n_idler_k: 6,         // idlers in continuous force path
    eta_idler: 0.97,
    eta_spool: 0.95,      // spool bearing + ext gear
    J_sp: 5e-5,           // kg-m^2 pulley + hub inertia
    t_m: 0.015,           // s motor mechanical time constant (ESTIMATE)

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

  var PAYLOAD_SWEEP = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  return { MOTORS: MOTORS, DEFAULTS: DEFAULTS, PAYLOAD_SWEEP: PAYLOAD_SWEEP };
});

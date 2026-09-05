# FTC Vertical Linear Slide Calculator — handoff spec

Purpose: given total travel, rigging (cascade | continuous), payload, and optional tip-speed cap, return the fastest extension time, the best motor, the best pulley diameter, and the pulley tolerance window. Also produce time-vs-payload and time-vs-diameter curves for every motor.

Reference implementation: `3-stage_slide_extension_model.xlsx`, tab `Calculator` (front), tab `Formulas` (equations), tab `Verification` (external data points). Everything below is derived from that workbook and all reference outputs were verified against it.


---

## 0. INSTRUCTIONS FOR CLAUDE CODE — READ THIS FIRST, THEN DO IT

You are building and deploying a static web calculator from this spec. Do the whole job without asking for confirmation unless something below is actually blocked. Work through the steps in order.

### 0.1 Repo
- The target is an existing EMPTY GitHub repo owned by the current user, named "FTC slides" (it may appear as `FTC-slides` or `FTC_slides`). Find it with `gh repo list --limit 200 | grep -i slides`. Do not create a new repo; use that one. If `gh` is not authenticated, stop and tell the user to run `gh auth login`.
- Clone it, work on `main`.

### 0.2 Stack
- Static site, no build step, no framework: `index.html`, `app.js`, `physics.js`, `motors.js`, `style.css`. Chart.js from a CDN for charts. Everything must run from `file://` and from GitHub Pages.
- Put all physics in `physics.js` as pure functions with no DOM access, exactly the equations in sections 2–4 of this document, in that order. Export them so tests can call them.
- `motors.js` holds the six-motor table from section 3 and the constants from section 2.

### 0.3 UI (single page)
- Inputs, all editable, defaults from section 2: travel (mm), rigging (cascade/continuous select), payload (kg), tip-speed cap (m/s, 0 = none). Below that a collapsible "Advanced" panel exposing every constant in section 2 (masses, drags, efficiencies, battery, d_min, d_max, n_motors).
- Answer block: best motor, pulley diameter, ±5% pulley window, extension time, average tip speed, torque used, current, cable take-up, wraps, peak cable tension. Section 4.5 defines all of these.
- Result table for the selected rigging + payload: one row per motor -> best pulley, time, torque used, current, ±5% window, rank. Mark rows pinned at d_min or d_max.
- Four charts, lines only, no markers, numeric x-axes, per section 9: (1) cascade best time vs payload 0–1 kg in 0.2 steps, one line per motor; (2) same for continuous; (3) cascade time vs pulley diameter at the selected payload; (4) same for continuous. Charts 3 and 4 hide any value > 1.6x that chart's minimum so the y-axis stays zoomed. Every chart title states CASCADE or CONTINUOUS.
- Everything recomputes live on any input change. It is cheap: 6 motors x 33 diameters x 6 payloads x 2 riggings.

### 0.4 Tests (must pass before deploy)
- Add `tests/physics.test.js` runnable with `node tests/physics.test.js` (no framework needed). Encode section 7 as assertions: every cell of the four reference tables within ±0.002 s / ±2 mm, plus the spot checks and stall diameters. If a test fails, fix `physics.js`, not the expected values — the expected values are verified.
- Also add the two external checks from section 7 as tests.

### 0.5 Deploy
- Add `.github/workflows/pages.yml` that deploys the repo root to GitHub Pages on push to `main` (actions/upload-pages-artifact + actions/deploy-pages).
- Enable Pages for the repo via `gh api` (source: GitHub Actions). Push. Wait for the workflow to go green, then print the live URL.
- Write a short `README.md`: what it is, the live URL, how to run tests, and a one-paragraph summary of the physics with a pointer to this spec (commit this spec into the repo as `SPEC.md`).

### 0.6 Done means
- Live Pages URL opens and shows the calculator with defaults producing: cascade 0.6 kg -> best motor 1150, pulley 16 mm, 0.472 s; continuous 0.6 kg -> 1150, 50 mm, 0.457 s.
- `node tests/physics.test.js` passes.
- Report the URL and the test output to the user.

Do not add string selection, safety factors, or a BOM. Do not use category axes for charts. Do not treat STALL as zero.

---

## 1. USER INPUTS

| name | default | unit | notes |
|---|---|---|---|
| travel | 700 | mm | total vertical extension |
| rigging | cascade | enum | cascade \| continuous |
| payload | 0.6 | kg | mass sitting on top of stage 3 |
| v_cap | 0 | m/s | tip-speed cap, 0 = none |

Sweep payload over 0, 0.2, 0.4, 0.6, 0.8, 1.0 for the charts.

---

## 2. CONSTANTS / DEFAULTS (all overridable)

Geometry and masses (single stack, BWTLink BL-350C-2M, 3 stages, no claw):

| symbol | value | unit | notes |
|---|---|---|---|
| N | 3 | – | stages |
| m_slide | 0.118 | kg | per slide, incl 2 pulley modules |
| f_inner | 0.5 | – | fraction of slide mass in the moving inner rail (ESTIMATE) |
| m_hw | 0.030 | kg | extra hardware per moving stage (ESTIMATE) |
| m_c | 0.050 | kg | carriage / plate (ESTIMATE) |
| m1 | 0.148 | kg | = m_slide + m_hw  (inner rail 1 + outer rail 2 + hw) |
| m2 | 0.148 | kg | = m_slide + m_hw |
| m3 | 0.089 | kg | = m_slide*f_inner + m_hw |
| d1, d2, d3 | 1.0, 0.8, 0.6 | N | sliding drag at interface 1 (base–s1), 2, 3 (ESTIMATES, unmeasured) |
| d_tot | 2.4 | N | d1+d2+d3 |
| F_spring | 0 | N | assist/elastic at cable, negative = fights extension |
| g | 9.80665 | m/s² | |

Drive:

| symbol | value | unit | notes |
|---|---|---|---|
| n_motors | 1 | – | scales torque, current, rotor inertia |
| G_ext | 1 | – | external ratio after motor |
| d_string | 0.6 | mm | 150 lb braided Spectra |
| n_idler_c | 5 | – | idlers in cascade force path |
| n_idler_k | 6 | – | idlers in continuous force path |
| eta_idler | 0.97 | – | per idler |
| eta_spool | 0.95 | – | spool bearing + ext gear |
| eta_c | 0.8158 | – | = eta_idler^n_idler_c * eta_spool |
| eta_k | 0.7913 | – | = eta_idler^n_idler_k * eta_spool |
| J_sp | 5e-5 | kg·m² | pulley + hub inertia (scales ~d^4) |
| t_m | 0.015 | s | motor mechanical time constant (ESTIMATE) |

Electrical:

| symbol | value | unit |
|---|---|---|
| V_batt | 12.5 | V (open circuit) |
| I_other | 0 | A (drivetrain etc, sags supply) |
| R_series | 0.030 | ohm |
| V_oc | 12.5 | V = V_batt - I_other*R_series (effective supply) |
| I_port | 20 | A (Control Hub port limit) |
| I_stall | 9.2 | A (all listed motors) |
| I_free | 0.25 | A |

Build limits:

| symbol | value | unit |
|---|---|---|
| d_min | 16 | mm smallest buildable pulley |
| d_max | 80 | mm largest buildable pulley |

---

## 3. MOTOR TABLE (goBILDA 5203 Yellow Jacket, same RS-555 core; sourced gobilda.com)

| name | ratio | rpm_free | T_stall (kg·cm) | T_stall (N·m) | kt (N·m/A) | J_rot (kg·m²) | peak W @12.5V |
|---|---|---|---|---|---|---|---|
| 1620 | 3.7 | 1620 | 5.4 | 0.5296 | 0.0592 | 4.68e-5 | 24.4 |
| 1150 | 5.2 | 1150 | 7.9 | 0.7747 | 0.0866 | 9.65e-5 | 25.3 |
| 435 | 13.7 | 435 | 18.7 | 1.8338 | 0.2049 | 6.04e-4 | 22.7 |
| 312 | 19.2 | 312 | 24.3 | 2.3830 | 0.2663 | 1.09e-3 | 21.1 |
| 223 | 26.9 | 223 | 38.0 | 3.7265 | 0.4164 | 2.39e-3 | 23.6 |
| 117 | 50.9 | 117 | 68.4 | 6.7077 | 0.7495 | 8.21e-3 | 22.3 |

Derived:
```
T_stall_Nm = kgcm * 0.0980665
kt         = T_stall_Nm / (I_stall - I_free)
w_free     = rpm_free * 2*pi/60                      # rad/s at 12 V
J_rot      = t_m * T_stall_Nm / w_free               # reflected to output shaft
peak_W     = (w_free * V/12) * (T_stall_Nm * V/12) / 4
```
Others in the lineup (84, 60, 43, 30 RPM) are too slow for a lift; omit.

---

## 4. PHYSICS — run in this order for one (motor, pulley diameter, payload)

Let `r = (d_pulley + d_string) / 2000` (m), `E = travel/1000` (m), `P = payload`.

### 4.1 Cable force

Cascade — all stages move together, ratios 1:2:3, all drags act at once:
```
m_tip = m3 + m_c + P
F     = g*(m1 + 2*m2 + 3*m_tip) + d_tot - F_spring
```
Continuous — one string, uniform tension, stages move SEQUENTIALLY top first (GM0 confirms). Three phases:
```
phase A (stage 3): M_A = m3 + m_c + P            F_A = g*M_A + d3 - F_spring
phase B (stage 2): M_B = m2 + m3 + m_c + P       F_B = g*M_B + d2 - F_spring
phase C (stage 1): M_C = m1 + m2 + m3 + m_c + P  F_C = g*M_C + d1 - F_spring
```
Cable take-up: cascade = E/N total; continuous = E/N per phase, E total.

### 4.2 Motor operating point (closed form, no iteration)
```
tau   = F * r / (G_ext * eta)                 # N·m at motor shaft, voltage-independent
I     = n_motors*I_free + tau / kt
V     = max(6, V_oc - I*R_series)
T_s   = n_motors * T_stall_Nm * V/12
w_f   = w_free * V/12
u     = tau / T_s                              # torque used; u >= 1 -> STALL (no lift)
w_ss  = w_f * (1 - u)                          # steady-state shaft speed
```

### 4.3 Dynamics (exact solution of J dw/dt = T_s(1 - w/w_f) - tau)
```
cascade:     J = n_motors*J_rot + J_sp + r^2*(m1 + 4*m2 + 9*m_tip) / (G_ext^2 * eta_c)
continuous:  J = n_motors*J_rot + J_sp + r^2*M_phase          / (G_ext^2 * eta_k)   (per phase)
tau_c  = J * w_f / T_s                         # time constant
theta  = (E/N) / r * G_ext                     # target shaft angle (per phase for continuous)

w(t)     = w_ss + (w0 - w_ss)*exp(-t/tau_c)
theta(t) = w_ss*t + (w0 - w_ss)*tau_c*(1 - exp(-t/tau_c))
```
`w0 = 0` for cascade and continuous phase A. For phases B and C, `w0 = w(t_end)` of the previous phase (momentum carries across).

Solve `theta(t) = theta` for t by Newton:
```
t0 = theta/w_ss + tau_c*(1 - w0/w_ss)
t_{n+1} = t_n - (theta(t_n) - theta) / w(t_n)      # 5 steps is enough, residual < 1e-6
```
Extension time: cascade `t_ext = t`; continuous `t_ext = t_A + t_B + t_C`.

Tip speed: cascade `v = N*w*r/G_ext`; continuous `v = w*r/G_ext`.

### 4.4 Optional tip-speed cap (v_cap > 0)
```
w_cap = v_cap*G_ext / (N*r)     cascade
w_cap = v_cap*G_ext / r         continuous
if w_cap >= w_ss: uncapped
else:
   t1     = -tau_c * ln((w_cap - w_ss)/(w0 - w_ss))
   theta1 = w_ss*t1 + (w0 - w_ss)*tau_c*(1 - exp(-t1/tau_c))
   t      = t1 + (theta - theta1)/w_cap
   end speed = w_cap   (carry into next phase for continuous)
if w0 >= w_cap (continuous later phase already at cap): t = theta / w_cap
```

### 4.5 Selection
```
diameters = linspace(d_min, d_max, 33)         # 2 mm step at 16..80
for each motor: t(d) for each d; skip STALL
best_d[motor]   = argmin t(d)
best_t[motor]   = min t(d)
window[motor]   = {d : t(d) <= 1.05 * best_t}   -> report min..max
best_motor      = argmin over motors of best_t
```
Also report at the chosen point: torque used `u`, current `I`, cable take-up, wraps = take_up/(pi*d), peak cable tension = F (cascade) or F_C (continuous).

---

## 5. RETRACTION (optional, from tab `Retraction`)
Gravity assists. Net force at cable = F_gravity - F_friction. If net > 0 the load drives the motor: `tau = -net*r*eta/G_ext` (efficiency multiplies on the way down). Steady descent speed exceeds no-load speed, so retraction is limited only by v_cap and braking. Regen braking torque available at the cap = `n_motors*T_stall_Nm*(w_cap/w_free)`. Empty-stack self-retract check per interface: `weight_below > breakaway_mult * sliding_drag` (breakaway_mult default 1.5). Interface 3 is the thinnest margin (~1.5x).

## 6. HOLDING / THERMAL (optional, from tab `Torque Check`)
Holding at full extension, motor stalled, no airflow: `tau_hold = F_grav * r / (G_ext*eta)`, `I_hold = I_free + tau_hold/kt`, fraction of stall = tau_hold/(T_stall*V/12). Safe indefinitely only below ~0.25 of stall (ESTIMATE). Largest pulley for safe hold = `2000*0.25*T_s*G_ext*eta/F_grav - d_string`.

---

## 7. VERIFICATION DATA (keep as regression tests)

External:
- goBILDA 2-stage Viper-Slide kit: 488 mm travel, 112 mm-circumference pulley, 435 RPM motor, "~4.4 rotations", "~0.6 s". Model: 488/112 = 4.357 rev (confirms continuous take-up = total travel, not travel/N); 488/(435/60*112) = 0.601 s (confirms their 0.6 s is free-speed, zero-load).
- FTC team The Clueless (CENTERSTAGE): 708.4 mm in <0.515 s with two 435s on belt overdrive = 1.376 m/s avg. Model, one 435, 700 mm, capped 1.5 m/s: 1.426 m/s avg. 3.7% apart.

Internal reference outputs — defaults above, travel 700, v_cap 0 (physics ceiling), one motor.
RECOMPUTED for ADDENDUM 4: end-stop deceleration, velocity-dependent drag, and the drag
calibration factor of 15.964. These supersede the original workbook figures and are model output,
not independently verified data. STALL means no buildable pulley lifts the load.
Columns: 1620, 1150, 435, 312, 223, 117.

BEST EXTENSION TIME (s), CASCADE
```
kg   1620    1150    435     312     223     117
0.0  1.8846  0.7568  0.7264  0.7647  0.7038  0.7622
0.2  31.4331  0.9358  0.7942  0.8399  0.7693  0.8138
0.4  STALL   1.2266  0.8657  0.9191  0.8346  0.8783
0.6  STALL   1.7568  0.9397  0.9983  0.9053  0.9511
0.8  STALL   3.1102  1.0137  1.0771  0.9757  1.0254
1.0  STALL   15.9686  1.0851  1.1552  1.0457  1.0997
```
BEST EXTENSION TIME (s), CONTINUOUS
```
0.0  0.9851  0.9424  0.9999  1.0583  1.1255  1.6841
0.2  1.0593  1.0150  1.0773  1.1297  1.1642  1.7096
0.4  1.1268  1.0824  1.1501  1.2057  1.2050  1.7357
0.6  1.1975  1.1461  1.2202  1.2797  1.2480  1.7627
0.8  1.2752  1.2081  1.2884  1.3522  1.2935  1.7904
1.0  1.3617  1.2709  1.3560  1.4237  1.3417  1.8189
```
BEST PULLEY DIA (mm), CASCADE
```
0.0  16      16      28      36      56      80
0.2  16      16      24      32      50      80
0.4  STALL   16      22      30      46      80
0.6  STALL   16      20      28      42      78
0.8  STALL   16      20      26      40      72
1.0  STALL   16      18      24      36      66
```
BEST PULLEY DIA (mm), CONTINUOUS
```
0.0  20      28      70      80      80      80
0.2  18      26      62      80      80      80
0.4  16      24      58      76      80      80
0.6  16      22      54      70      80      80
0.8  16      20      50      66      80      80
1.0  16      20      46      62      80      80
```
Spot checks (cascade, 0.6 kg): 1150 @16 mm -> u=0.860, I=8.12 A, window 16–16. 435 @20 mm -> u=0.463, I=4.52 A, window 16–24. 223 @42 mm -> window 34–52.
Spot check (cascade 1150, 1.0 kg): F=76.177 N at zero sliding speed. Only the 16 mm pulley still lifts, at t=15.97 s (d_stall = 16.30 mm).
Stall diameter formula: `d_stall = 2000*eta*T_s*G_ext/F - d_string` -> at 1 kg: casc435 39, casc1150 16, cont435 98, cont1150 41.
With v_cap = 1.5, cascade 0.6 kg: 435 -> 0.940 @20, 223 -> 0.905 @42 — identical to the uncapped values, because after calibration nothing reaches 1.5 m/s.

---

## 8. THINGS THAT BIT US (build these in as guards)
- Under a tip-speed cap all motors/riggings converge to travel/v_cap; the comparison only separates with v_cap = 0. Always show the uncapped case.
- The steady-state optimum `r_opt = eta*T_s/(2F)` is NOT the minimum-time pulley; inertia makes the true optimum smaller (5–10%). Always sweep and take the argmin.
- Cascade with the 1150 sits on a cliff: at 1 kg the usable window is 12–14 mm, unbuildable. Report the ±5% window, not just the optimum.
- Continuous with slow motors (435 and below) is pinned at d_max at every payload; report when a result is at a build limit and which limit.
- Charts: use true numeric x-axes (scatter/line with numeric x), not category axes. Cascade and continuous need pulleys ~3x apart, so plot them on separate charts. Clip y to ~1.6x the chart's best or the stall tails flatten everything.
- STALL cells must be excluded from min/argmin, not treated as 0.
- Continuous phases must carry end speed into the next phase; do not restart from rest.
- String diameter matters on small pulleys: effective radius uses (d + d_string)/2.

## 9. OUTPUT SPEC
Per (rigging, payload): table of motor -> best_d, best_t, u, I, window, rank; best_motor; answer block. Charts: (1) best_t vs payload per motor, cascade; (2) same, continuous; (3) t vs d at selected payload per motor, cascade; (4) same, continuous. Lines, no markers.

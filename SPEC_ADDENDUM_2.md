# SPEC ADDENDUM 2 — auto-pick rigging, and a second answer with external gearing

Read SPEC.md first. This changes the UI and adds one optimizer. Do all of it, run the tests, push, confirm the live page.

## A. Rigging is no longer an input

Remove the cascade/continuous selector. For every calculation, solve BOTH riggings and pick the one with the lower extension time. Show the winner in the Answer block as "Rigging: cascade" or "Rigging: continuous", and show the loser's best time next to it so the user can see the margin, e.g. `Rigging: continuous (0.457 s) — cascade would be 0.472 s (+3.3%)`.

Keep both riggings in the charts: charts 1–2 (time vs payload) and charts 3–4 (time vs diameter) stay as they are, labelled CASCADE and CONTINUOUS. The result table shows the winning rigging; add a toggle to view the losing rigging's table if the user wants it, but default to the winner.

Everything else in section 4 of SPEC.md is unchanged. Physics functions must not change; only the selection layer.

## B. Two answers

The Answer block becomes two side-by-side answers.

### Answer 1 — STOCK: best goBILDA Yellow Jacket, direct drive
Exactly what the calculator does today: `G_ext = 1`, sweep the six motors × 33 pulley diameters × both riggings, argmin time. Report motor, rigging, pulley, ±5% window, time, torque used, current.

### Answer 2 — GEARED: best achievable with a goBILDA motor plus external gearing
All Yellow Jackets share the same RS-555 core; the gearbox only sets the ratio. External gearing (belt, spur gears, chain) after the output shaft is another ratio stage. So the real question is: **what total output ratio, and therefore what equivalent output RPM, minimises extension time**, given the pulley must still be 16–80 mm.

Implement it as a search over three things:
- base motor: all six
- G_ext (external ratio, output speed = motor speed / G_ext): grid from 0.4 to 6.0, step 0.05. Values below 1 are overdrive (speed up), above 1 are reduction. Belt overdrive is a real FTC practice (see the Clueless data point in SPEC.md).
- pulley diameter: same 33-point grid, 16–80 mm

Physics changes for G_ext ≠ 1 — these already exist in SPEC.md section 4 as `G_ext`, so they should already be in `physics.js`; verify each one is actually wired up:
```
tau      = F * r / (G_ext * eta)               # torque at MOTOR shaft
theta    = (E/N) / r * G_ext                    # motor shaft angle target
J        = n*J_rot + J_sp/G_ext^2 + r^2*M_eff / (G_ext^2 * eta)
v_tip    = N * w * r / G_ext   (cascade)    w * r / G_ext   (continuous)
w_cap    = v_cap * G_ext / (N*r)  or  v_cap * G_ext / r
```
Note the pulley inertia is now also reflected by G_ext². If `J_sp` is not currently divided by G_ext² in physics.js, fix it (SPEC.md omitted that term; it is negligible at G_ext=1 and matters at 0.4).

Efficiency of the external stage: add a constant `eta_ext` default 0.95 per external stage, applied ONLY when G_ext ≠ 1 (multiply eta by eta_ext). Expose it in the Advanced panel. The existing `eta_spool = 0.95` already covers the spool bearing and stays as is.

Report for Answer 2:
- base motor (e.g. "1150 RPM 5.2:1")
- external ratio G_ext (e.g. "2.4:1 reduction" or "0.6:1 overdrive")
- **equivalent output RPM = rpm_free / G_ext** — this is the headline number, the "ideal RPM"
- equivalent stall torque at the pulley = T_stall × G_ext × eta_ext
- rigging, pulley, ±5% window, time, torque used, current
- improvement over Answer 1 as a percentage
- a one-line practical note: the nearest standard goBILDA ratio to G_ext using their pulley/gear tooth counts (they sell GT2/HTD pulleys and gears in tooth counts 16, 20, 24, 28, 32, 36, 40, 48, 60, 72, 80, 100, 120; pick the tooth pair whose ratio is closest to G_ext and print it, e.g. "≈ 48T:20T = 2.4:1"). Don't overthink it; closest single-stage pair is enough.

Tie-break and sanity:
- If Answer 2 improves on Answer 1 by less than 2%, say so plainly: "External gearing does not help here; build Answer 1."
- Because the pulley and G_ext both trade speed for torque, many (G_ext, d) pairs give the same result. Prefer G_ext = 1 on ties, then prefer the pulley nearest 40 mm. Report the ±5% window on BOTH G_ext and pulley for Answer 2.
- STALL cells excluded from argmin, as before.

Add a fifth chart: **best extension time vs equivalent output RPM** for the winning rigging, one line per base motor, x-axis = rpm_free/G_ext on a log scale from ~30 to ~4000 RPM, each point = min over pulley diameter. This is the chart that shows where the ideal RPM sits and how flat the bottom is. Lines only, no markers.

## C. Tests
- Existing 223 assertions must still pass unchanged (they test `G_ext = 1`).
- Add: for every reference-table cell, Answer 2 time ≤ Answer 1 time (gearing can never make it worse, since G_ext = 1 is in the grid).
- Add: at G_ext = 1 and eta_ext ignored, the geared optimizer reproduces the stock optimizer exactly.
- Add: identity test — motor A at G_ext = k must give the same time as a hypothetical motor with ratio×k, free speed/k, stall torque×k (with eta_ext = 1 and J_rot adjusted ×k²). This proves the G_ext wiring is right.

## D. Done means
- Live page has no rigging selector, shows the chosen rigging with the margin, shows Answer 1 and Answer 2 side by side, and chart 5 renders.
- Defaults (700 mm, 0.6 kg, v_cap 0) still give Answer 1 = continuous, 1150, 50 mm, 0.457 s.
- Tests pass. Push, wait for green, report the URL and Answer 2 for the defaults.

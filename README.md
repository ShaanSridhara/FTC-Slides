# FTC Vertical Linear Slide Calculator

Tell it how far you need to extend, what you are lifting, and optionally a tip-speed cap. It
searches every BWTLink slide, stage count, motor count, motor, rigging and pulley diameter, and
returns the fastest build. Three inputs, no knobs.

**Live:** https://shaansridhara.github.io/FTC-Slides/

## What it searches

| axis | values |
|---|---|
| slide | BL-200A-2M (8 in, 121 mm stroke), BL-300C-2M (12 in, 205), BL-350C-2M (14 in, 245.5), BL-400B-2M (16 in, 283) |
| stages | 2, 3, 4 — only combinations where `N × stroke ≥ extension`. Capped at 4: a fifth stage is more rigging, drag and slop than the fraction of a second it buys. |
| motors | 1 or 2 |
| motor | the six goBILDA Yellow Jackets |
| rigging | cascade and continuous, both always |
| pulley | 33-point grid, 16–80 mm |

Roughly 12,700 solves for Answer 1, and 113× that for the external-ratio sweep in Answer 2.
Answer 1, the table and the charts paint immediately; the geared search runs on the next tick and
fills Answer 2 in when it lands, so typing stays responsive without coarsening the search. Input is
debounced 200 ms.

Every constant from the recorded data is baked into `motors.js`. Travel used is the extension
asked for, not the stack's maximum, and the drag ramp and idler counts regenerate from N.

## Calibration

**Drag calibration factor: `drag_cal = 15.964`.**

The only measured full-system data point is FTC team The Clueless: 708.4 mm in ~0.515 s on two
435 RPM motors with belt overdrive. Running that configuration — 700 mm, 0.3 kg, 2 motors, 435,
external ratio free, 3 stages, uncapped — the model returned **0.3159 s** at `drag_cal = 1`, i.e.
39% too fast. Scaling every `d_i` by one common factor of **15.964** lands it on **0.5150 s**,
inside the ±0.01 s target.

That factor is large. Total drag goes from 2.40 N to **38.31 N** (d1/d2/d3 = 15.96 / 12.77 /
9.58 N). It is doing more than modelling friction — it is absorbing everything between this model
and a real robot on a real field, fitted to a single data point. Treat the drag figures as a
fitted parameter, not a measurement, and treat absolute times with corresponding caution. A second
measured point from a different stack would say a great deal about whether 15.964 is friction or a
catch-all.

Two consequences worth knowing:

- **Torque now beats speed.** At 38 N of drag the 223 RPM motor wins where the 1150 used to, and
  several single-motor combinations stall outright.
- **The tip-speed cap barely binds.** Nothing reaches 2 m/s through that much drag, so the default
  2.0 m/s cap costs almost nothing; the end-stop ramp is what shapes the answer.

## End-stop deceleration

The last `d_stop = 60 mm` of stage travel is a constant-deceleration ramp aiming to arrive at the
end stop at `v_stop = 0.3 m/s` — per phase for continuous, once for cascade. The ramp is limited by
what the motor can actually brake with: regen torque `T_stall × w/w_free` at the entry speed, plus
the load torque already opposing the lift. If that is not enough the stage arrives faster and the
page reports the real impact speed and warns.

This is what flipped the rigging verdict. Continuous pays N of these ramps to cascade's one, and
each one throws away the momentum that used to carry between phases — worth 34% before. **Cascade
now wins by 27%** at the defaults, where it used to lose by 3%.

Sliding drag is also velocity-dependent now: `d_i(v) = d_i × (1 + k_v·v)` with `k_v = 0.5 s/m`,
evaluated at the phase's own steady sliding speed (settled in three passes, since the speed sets
the drag which sets the speed).

## The physics

For every combination it works out the cable force, solves the motor operating point in closed
form, then integrates the exact solution of `J dw/dt = T_s(1 - w/w_f) - tau`.

Cascade moves all N stages together at 1:2:..:N with every drag acting at once, taking up
`travel / N` of cable; stage i contributes `i·m_i` to the force and `i²·m_i` to the inertia at the
drum. Continuous holds one string at uniform tension and extends **one stage at a time, top
first** — N phases each taking up `travel / N`, `travel` total, with the end speed of each phase
carried into the next rather than restarting from rest. That momentum is worth 34%.

Two motors scale torque, current and rotor inertia together; the port limit is checked against the
**per-motor** current, which is the total divided by the motor count. Stalled combinations are
excluded from every argmin rather than counted as zero. Ties break toward fewer stages, then fewer
motors, then no external stage, then a pulley near 40 mm.

The optimum pulley is found by sweeping all 33 diameters and taking the argmin — the steady-state
optimum `r = eta·T_s/(2F)` is *not* the minimum-time pulley, because inertia pulls the true optimum
5–10% smaller. Tip speed goes as RPM × pulley diameter, so those two are one knob, not two, and the
curve is flat near the bottom: being 20% off on the pulley costs about 2%.

Full detail: [SPEC.md](SPEC.md), [SPEC_ADDENDUM_2.md](SPEC_ADDENDUM_2.md),
[SPEC_ADDENDUM_3.md](SPEC_ADDENDUM_3.md).

## Running it

Open `index.html` directly — no build step, no framework, no install. Chart.js loads from a CDN;
without a network connection the numbers still work and the charts are skipped.

## Tests

```
node tests/physics.test.js
```

666 assertions covering every cell of the four reference tables (±0.002 s / ±2 mm), the spot
checks, the stall diameters, the tip-speed-cap cases, the two external validation points
(the goBILDA Viper-Slide kit and FTC team The Clueless), the section 8 modelling guards, and the
addendum's rigging pick and gearing optimizer. It also cross-checks that the answer block, the
result table and the chart series all agree, and that every reported +/-5% window really does
bracket its own optimum. The same suite gates deployment in CI.

The sharpest of these is an identity test: a motor geared by `k` must be indistinguishable from a
motor with `ratio × k`, `free speed / k`, `stall torque × k` and `rotor inertia × k²` run direct.
It holds to 1e-14, and it only holds because the spool inertia `J_sp` is reflected through
`G_ext²` — reverting that one term fails the test by 0.022 s.

### One correction to the spec

The original `Spot check (cascade 1150, 1.0 kg)` block did not reproduce at the documented
`d_string = 0.6 mm`, and contradicted the main reference table for its own cell — it gave
`t = 0.637` where the cascade 1.0 kg / 1150 table entry says `0.6297`. It reproduced to every
digit at `d_string = 1.0 mm`, so it was a leftover from an earlier workbook run with a thicker
string.

The block has been regenerated at 0.6 mm and the values in [SPEC.md](SPEC.md) replaced:

| | was (1.0 mm string) | now (0.6 mm string) |
|---|---|---|
| tau (d=16) | 0.4195 | 0.4096 |
| u (d=16) | 0.526 | 0.514 |
| I (d=16) | 5.10 | 4.98 |
| t (d=16) | 0.637 | 0.6297 |
| t (d=24) | 1.014 | 0.9770 |
| t (d=28) | 1.837 | 1.6756 |
| stalls at | 31 mm | 32 mm (d_stall = 31.37 mm) |

Everything else in section 7 — all four reference tables, the 0.6 kg spot checks, the stall
diameters, the tip-speed-cap checks and the acceptance criteria — already required 0.6 mm and is
reproduced exactly by the model, unchanged. The regenerated `t` at d=16 is now asserted to equal
the reference table cell, so the two can no longer drift apart.

## Stage count

Everything is generalized in N, set under Advanced (1–10). Masses are `m_slide + m_hw` for every
stage below the top and `m_slide·f_inner + m_hw` for the top one. Drag defaults to a
`1.0 − 0.2·(i−1)` ramp with a 0.4 N floor, and the idler counts follow `N+2` for cascade and `N+3`
for continuous. The per-interface drag fields regenerate when N changes — existing interfaces keep
their values, new ones take the ramp, and idler counts move to the new defaults unless they were
deliberately overridden.

At N = 3 every one of these reduces to the recorded values (1.0/0.8/0.6 N, 5 and 6 idlers), so the
reference tables are unaffected — the suite verifies that explicitly.

## Notes

Under a tip-speed cap every motor converges on `travel / v_cap`, so the comparison only separates
with the cap set to 0 — the uncapped case is always worth looking at.

Every recorded constant is editable under Advanced and everything recomputes live, so the
calculator can be re-pointed at a different stack, drag figures or battery condition without
touching the code.

## Layout

```
index.html   page
app.js       DOM wiring only
physics.js   the model - pure functions, no DOM, mirrors SPEC.md sections 2-4
motors.js    motor table and default constants
style.css
tests/physics.test.js
SPEC.md              the handoff spec this was built from
SPEC_ADDENDUM_2.md   auto-pick rigging, and the geared second answer
```

# FTC Vertical Linear Slide Calculator

A static web calculator for a 3-stage FTC vertical linear slide. Give it total travel, payload,
and an optional tip-speed cap; it picks the rigging for you and returns two answers — the best
stock goBILDA motor on direct drive, and the best achievable with external gearing — plus the
pulley tolerance windows and five charts.

**Live:** https://shaansridhara.github.io/FTC-Slides/

## What it computes

For every (motor, pulley diameter, payload, rigging) combination it works out the cable force,
solves the motor operating point in closed form, then integrates the exact solution of
`J dw/dt = T_s(1 - w/w_f) - tau` to get the time to wind in the required cable.

Cascade rigging moves all three stages together at 1:2:3 ratios with every sliding drag acting at
once, and takes up `travel / 3` of cable. Continuous rigging holds one string at uniform tension
and moves the stages sequentially from the top down, in three phases that each take up
`travel / 3` — `travel` total — with the end speed of each phase carried into the next rather than
restarting from rest. The supply voltage sags with the current drawn, the effective pulley radius
includes the string diameter, and stalled combinations (`tau >= T_stall`) are excluded from the
search rather than counted as zero.

The optimum pulley is found by sweeping all 33 buildable diameters and taking the argmin — the
steady-state optimum `r = eta*T_s/(2F)` is *not* the minimum-time pulley, because rotor and load
inertia pull the true optimum 5–10% smaller. Because that optimum can sit on a cliff, the tool
always reports the ±5% window alongside it, and flags any result pinned at the build limits.

### Rigging is chosen, not entered

Both riggings are solved for every input and the faster one wins. The answer states the pick and
the margin, e.g. `Rigging: continuous (0.457 s) — cascade would be 0.472 s (+3.3%)`. The result
table follows the winner, with a toggle for the loser; the charts always show both.

### Two answers

**Answer 1 — Stock** is direct drive (`G_ext = 1`): six motors × 33 pulley diameters × both
riggings, argmin time.

**Answer 2 — Geared** adds an external ratio, because every Yellow Jacket shares the same RS-555
core and the gearbox only sets the ratio — so the real question is what *total* output ratio, and
therefore what equivalent output RPM, minimises the time. It searches base motor × `G_ext`
(0.4–6.0 in 0.05 steps, below 1 being overdrive) × pulley diameter × rigging, and reports the
equivalent output RPM as the headline, along with the nearest stock goBILDA tooth pair. An
external stage costs `eta_ext` (default 0.95), applied only when `G_ext ≠ 1`. Ties resolve toward
no external stage, then toward a pulley near 40 mm.

With the defaults, gearing does **not** help: the pulley sweep already supplies the ratio, so
`G_ext = 1` wins outright and the tool says so plainly. Overdrive at `G_ext = 0.8` is genuinely
1.5% faster in the raw physics, but the 5% cost of the external stage more than eats it. Gearing
only pays when the pulley optimum is pinned at a build limit — force that (say a 60 mm minimum
pulley at 2 kg) and Answer 2 finds a 4.8% gain at a real reduction.

Full model, constants, and reference data: [SPEC.md](SPEC.md) and
[SPEC_ADDENDUM_2.md](SPEC_ADDENDUM_2.md).

## Running it

Open `index.html` directly — no build step, no framework, no install. Chart.js loads from a CDN;
without a network connection the numbers still work and the charts are skipped.

## Tests

```
node tests/physics.test.js
```

323 assertions covering every cell of the four reference tables (±0.002 s / ±2 mm), the spot
checks, the stall diameters, the tip-speed-cap cases, the two external validation points
(the goBILDA Viper-Slide kit and FTC team The Clueless), the section 8 modelling guards, and the
addendum's rigging pick and gearing optimizer. The same suite gates deployment in CI.

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

## Caveats

Sliding drags, per-stage hardware mass, carriage mass and the motor mechanical time constant are
estimates rather than measurements, so treat absolute times as good to roughly 10%. The motor and
pulley *ranking* is the real output. Under a tip-speed cap every motor converges on
`travel / v_cap`, so the comparison only separates with the cap set to 0.

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

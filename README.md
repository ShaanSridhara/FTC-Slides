# FTC Vertical Linear Slide Calculator

A static web calculator for a 3-stage FTC vertical linear slide. Give it total travel, rigging
(cascade or continuous), payload, and an optional tip-speed cap; it returns the fastest extension
time, the best goBILDA motor, the best pulley diameter, and the pulley tolerance window — plus
time-vs-payload and time-vs-diameter curves for all six motors.

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

Full model, constants, and reference data: [SPEC.md](SPEC.md).

## Running it

Open `index.html` directly — no build step, no framework, no install. Chart.js loads from a CDN;
without a network connection the numbers still work and the charts are skipped.

## Tests

```
node tests/physics.test.js
```

223 assertions covering every cell of the four reference tables (±0.002 s / ±2 mm), the spot
checks, the stall diameters, the tip-speed-cap cases, the two external validation points
(the goBILDA Viper-Slide kit and FTC team The Clueless), and the section 8 modelling guards.
The same suite gates deployment in CI.

### One conflict in the spec

The spec's `Spot check (cascade 1150, 1.0 kg)` block does **not** reproduce at the documented
`d_string = 0.6 mm`, but reproduces to every digit at `d_string = 1.0 mm`:

| | spec block | model @ 0.6 mm | model @ 1.0 mm |
|---|---|---|---|
| tau (d=16) | 0.4195 | 0.4096 | 0.4195 |
| u (d=16) | 0.526 | 0.514 | 0.526 |
| I (d=16) | 5.10 | 4.98 | 5.10 |
| t (d=16) | 0.637 | 0.6297 | 0.6373 |
| t (d=24) | 1.014 | 0.9770 | 1.0138 |
| t (d=28) | 1.837 | 1.6756 | 1.8371 |

It is a stale block left over from an earlier workbook run with a thicker string. Everything
authoritative — all four reference tables, the 0.6 kg spot checks, the tip-speed-cap checks, and
the acceptance criteria — requires 0.6 mm, and the model reproduces all of it exactly. So the model
uses `d_string = 0.6 mm`, and the stale block is kept as a test pinned to the 1.0 mm string it was
computed with. No expected value was edited.

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
SPEC.md      the handoff spec this was built from
```

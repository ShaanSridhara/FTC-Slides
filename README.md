# FTC Vertical Linear Slide Calculator

A static web calculator for a 3-stage FTC vertical linear slide. Give it total travel, payload,
and an optional tip-speed cap; it picks the rigging for you and returns two answers — the stock
goBILDA motor to build, and the ideal shaft speed for the load — plus the pulley tolerance window
and four charts.

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

### Why continuous usually wins, and why that is not a confident result

Continuous beats cascade at almost every payload here, by 3-5%. That is a real consequence of the
model, not a coding slip — the implementation reproduces all 144 reference-table cells exactly, and
an energy audit confirms both riggings do identical work (6.0889 J at 0.6 kg, matching the true
lift work of raising stage 1 by E/3, stage 2 by 2E/3 and the tip by E). Neither rigging is a free
lunch; they differ only in how that work is spread over time.

Cascade trades 3x force for 3x tip speed and winds `travel/3` of cable. Continuous winds the full
`travel` against the plain stack weight. What decides it is the spec's assumption that continuous
extends **one stage at a time, top first** — uniform string tension with no kinematic coupling, so
the least-loaded stage moves first. That lets the motor spin up on the light top stage (0.74 kg)
and carry that momentum into the heavy final phase. Cascade, kinematically locked, fights the full
28.5 N from a standstill.

That single assumption is load-bearing. Modelled the other way — all three stages moving together —
**cascade wins at every payload by roughly 9%**:

| payload | cascade | continuous (sequential) | continuous (simultaneous) |
|---|---|---|---|
| 0.0 kg | 0.2646 | **0.2358** | 0.2981 |
| 0.6 kg | 0.4720 | **0.4568** | 0.5172 |
| 2.0 kg | 0.9493 | **0.9143** | 0.9759 |

So treat the rigging verdict as weak. The 3.3% margin at the defaults sits inside the model's own
~10% accuracy, and the page says so rather than pretending otherwise. Cascade takes the lead
outright when it is built with fewer idlers than the assumed five (3 idlers flips it), at heavy
payload (6 kg), and it is a dead heat under a tip-speed cap (0.1%). It is *not* an artifact of the
16 mm pulley floor — cascade's optimum genuinely sits near 16 mm, and a 4 mm floor changes its time
by less than 0.002 s.

### Why the two answers land almost on top of each other

Tip speed goes as **RPM x pulley diameter**. They are one knob, not two — trading a slower shaft
against a bigger pulley is the same machine relabelled. At the defaults, Answer 1 is 1150 rpm on a
50 mm pulley (product 57,500) and Answer 2 is 719 rpm on an 80 mm pulley (product 57,500). Identical.
Of course they take the same time.

On top of that, the optimum is flat, as any minimum is — the first derivative is zero there, so
error costs only second order. Being 20% off on the pulley costs about 2%:

| pulley error | time cost |
|---|---|
| 6% | 0.2% |
| 12% | 0.9% |
| 18% | 2.1% |
| 24% | 3.7% |

This is good news for building: the +/-5% window is genuinely wide, and you do not need to hit the
optimum diameter exactly. It also means a "better" ideal RPM is usually worth very little.

**Answer 2's headline is the achievable time, not the theoretical one.** `t_ideal` assumes a
lossless external stage, which you cannot bolt to a robot; it is shown only as a dimmed footnote.
The card leads with what you would actually get after paying `eta_ext`, and the FASTEST badge always
goes to the quicker of the two *real* options — never to the lossless number. Tests enforce this.

### Two answers

**Answer 1 — Stock** is what you build: direct drive (`G_ext = 1`), six motors x 33 pulley
diameters x both riggings, argmin time.

**Answer 2 — Ideal** is the shaft speed the load actually wants. Every Yellow Jacket shares the
same RS-555 core — `rpm x ratio ≈ 5980` for all six — so the gearbox only sets a ratio, and the
real question is what *total* output ratio minimises the time. Gear all six motors to the same
equivalent output RPM and their curves collapse to within a few percent, which is what makes
"ideal RPM" a single well-defined number rather than a per-motor quirk. The residual spread tracks
`T_stall / ratio` (0.124–0.149 across the lineup), and that is why the 1150 is almost always the
best base motor.

The ideal search runs at `eta_ext = 1`, and this matters. `eta_ext` is a *step* cost: it is
charged at every ratio except exactly 1.0. Asking "which ratio is best" while one ratio alone
holds a 5% discount just returns that ratio every time — the reported ideal RPM would be pinned
to the stock RPM of whichever motor won, constant no matter what you typed. Searching on a level
playing field makes it a genuine property of the load: **1353 RPM at 0 kg, 719 at 0.6 kg, 192 at
2 kg**, and it moves with travel too.

The recommendation is then *priced* with the real external-stage loss, so the verdict stays
honest. With the defaults the ideal is 719 RPM, the 1150 sits 60% above it — but the better ratio
is worth only 0.9%, and an external stage costs 5%, so building it comes out **2.3% slower**. The
tool says so and tells you to build Answer 1. Gearing only earns its keep when the pulley optimum
is pinned at a build limit; force that (a 60 mm minimum pulley at 2 kg) and it finds a real gain.

Full model, constants, and reference data: [SPEC.md](SPEC.md) and
[SPEC_ADDENDUM_2.md](SPEC_ADDENDUM_2.md).

## Running it

Open `index.html` directly — no build step, no framework, no install. Chart.js loads from a CDN;
without a network connection the numbers still work and the charts are skipped.

## Tests

```
node tests/physics.test.js
```

378 assertions covering every cell of the four reference tables (±0.002 s / ±2 mm), the spot
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

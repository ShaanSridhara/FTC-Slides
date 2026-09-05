# SPEC ADDENDUM 3 — one input, one answer, no knobs

Read SPEC.md and SPEC_ADDENDUM_2.md first. This replaces the UI. Do all of it, keep the tests passing, push, confirm the live page.

## A. Remove every knob

Delete the Advanced panel. No Expert toggle, no footer link, nothing. Every constant in SPEC.md section 2 becomes a hard-coded default in `motors.js`. The user never sees or edits them.

## B. Inputs — exactly these three

| input | type | default |
|---|---|---|
| Extension needed | number, mm | 700 |
| Payload | number, kg | 0.6 |
| Tip-speed cap | number, m/s, 0 = none | 0 |

That is the whole input form.

## C. What it searches

For the entered extension, enumerate every combination of:

- **Slide length** — BWTLink, baked in:

| model | nominal | stroke per slide (mm) | mass per slide (kg) |
|---|---|---|---|
| BL-200A-2M | 8 in | 121 | 0.085 (not published; estimate) |
| BL-300C-2M | 12 in | 205 | 0.101 |
| BL-350C-2M | 14 in | 245.5 | 0.118 |
| BL-400B-2M | 16 in | 283 | 0.130 |

- **Stages N** — 2, 3, 4, 5. Only keep combos where `N × stroke ≥ extension`. If none reach it, say "no BWTLink stack reaches X mm" and stop.
- **Motors** — 1 or 2 (`n_motors`).
- **Motor type** — the six goBILDA Yellow Jackets from SPEC.md section 3.
- **Rigging** — cascade and continuous, both always.
- **Pulley diameter** — 33-point grid 16–80 mm.

For each (slide, N) set `m_slide`, N, the drag schedule (1.0, 0.8, 0.6, 0.4, floor 0.4), `n_idler_c = N+2`, `n_idler_k = N+3`, using the N-stage physics already built. Travel used = the entered extension (not the stack's max).

Solve everything. This is roughly 4 slides × 4 stage counts × 2 motor counts × 6 motors × 2 riggings × 33 diameters ≈ 12,700 solves; it is fast enough to run live on input change, but debounce the input by 200 ms.

## D. Outputs — two answers, then one table

### Answer 1 — STOCK (direct drive, `G_ext = 1`)
The single fastest combination. Show:
slide model and length · stages · number of motors · motor · rigging · pulley diameter · ±5% pulley window · extension time · retracted stack height (N is irrelevant here; height = the slide's nominal length) · stroke left over (`N × stroke − extension`).

### Answer 2 — GEARED
Same search but with the external ratio sweep from ADDENDUM 2 (G_ext 0.4–6.0). Show everything Answer 1 shows plus: base motor · external ratio · **equivalent output RPM** · nearest goBILDA tooth pair · improvement over Answer 1. If under 2% better, say "gearing doesn't help, build Answer 1" and grey it.

### The table
Every (slide, N) combination that reaches the extension, one row each, ranked by extension time. Columns: slide · stages · stack height · best motors (1 or 2) · best motor · rigging · pulley · time · stroke left over. This is the mix-and-match view; it lets the user see that e.g. 3 × 14 in beats 4 × 12 in and by how much. Highlight Answer 1's row.

### Charts — keep only two
1. Best extension time vs payload (0–1 kg in 0.2 steps) for Answer 1's combination, one line per motor, at Answer 1's slide/N/motors/rigging.
2. Time vs pulley diameter at the entered payload, same combination, one line per motor.
Lines, no markers, numeric axes, zoomed as before. Delete the rest.

## E. Rules
- STALL excluded from every argmin.
- Two motors: torque, current and rotor inertia all scale by 2, as the physics already does with `n_motors`. Current is checked against the 20 A port limit per motor, not total.
- Tie-break: fewer stages, then fewer motors, then `G_ext = 1`, then pulley nearest 40 mm.
- If the 8 in slide (BL-200A) wins anything, show it, but its mass is an estimate — put "(mass estimated)" next to it.

## F. Tests
- The 223 existing physics assertions must pass unchanged.
- Add: for extension 700 and payload 0.6, the table must contain 3 × BL-350C at 0.457 s, continuous, 1150, 50 mm, 1 motor (this is the verified reference).
- Add: every row's time is ≥ the kinematic floor `extension / v_cap` when a cap is set.
- Add: 2-motor time ≤ 1-motor time for every (slide, N) at G_ext = 1.

## G. Done means
Live page shows three inputs, two answers, the ranked table, two charts, and nothing else. Tests pass. Report the URL and Answer 1 + Answer 2 for the defaults.

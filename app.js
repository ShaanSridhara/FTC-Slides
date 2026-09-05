/* app.js - DOM wiring. All maths lives in physics.js. */
(function () {
  'use strict';

  var D = Motors.DEFAULTS;
  var SWEEP = Motors.PAYLOAD_SWEEP;
  var CLIP = 1.6;   // charts 3 and 4 hide anything above 1.6x that chart's minimum

  // Advanced panel layout. G_ext is deliberately absent: it is an optimizer output
  // now (Answer 2), not an input.
  var ADVANCED = [
    ['Geometry and masses', [
      ['N', 'stages', 1], ['m_slide', 'kg per slide', 0.001], ['f_inner', 'inner rail frac', 0.05],
      ['m_hw', 'kg hw/stage', 0.005], ['m_c', 'kg carriage', 0.005],
      ['d1', 'N drag i1', 0.1], ['d2', 'N drag i2', 0.1], ['d3', 'N drag i3', 0.1],
      ['F_spring', 'N assist', 0.5], ['g', 'm/s^2', 0.001]
    ]],
    ['Drive', [
      ['n_motors', 'motors', 1], ['d_string', 'mm string', 0.1],
      ['n_idler_c', 'idlers casc', 1], ['n_idler_k', 'idlers cont', 1],
      ['eta_idler', 'per idler', 0.01], ['eta_spool', 'spool+gear', 0.01],
      ['eta_ext', 'per ext stage', 0.01],
      ['J_sp', 'kg m^2 spool', 1e-5], ['t_m', 's motor tc', 0.001]
    ]],
    ['Electrical', [
      ['V_batt', 'V open ckt', 0.1], ['I_other', 'A other', 0.5], ['R_series', 'ohm', 0.005],
      ['I_port', 'A port limit', 1], ['I_stall', 'A stall', 0.1], ['I_free', 'A free', 0.05]
    ]],
    ['Build limits and gearing search', [
      ['d_min', 'mm smallest', 1], ['d_max', 'mm largest', 1],
      ['g_min', 'min G_ext', 0.05], ['g_max', 'max G_ext', 0.05], ['g_step', 'G_ext step', 0.01]
    ]]
  ];

  var COLORS = ['#1f5fd0', '#e2574c', '#0d9b6c', '#c9821a', '#7b52c9', '#4a5666'];

  var $ = function (id) { return document.getElementById(id); };
  var charts = {};
  var tableRig = null;      // null = follow the winner; otherwise a pinned rigging

  // ------------------------------------------------------------ formatting

  function f(v, n) { return (v === null || v === undefined || !isFinite(v)) ? '--' : v.toFixed(n); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function ratioText(g) {
    if (g === 1) return 'direct drive';
    return f(g, 2) + ':1 ' + (g < 1 ? 'overdrive' : 'reduction');
  }

  // --------------------------------------------------------------- inputs

  function buildAdvanced() {
    var host = $('advanced-body'), html = '';
    ADVANCED.forEach(function (grp) {
      html += '<div class="adv-group"><h3>' + esc(grp[0]) + '</h3><div class="adv-grid">';
      grp[1].forEach(function (fd) {
        html += '<div class="field"><label for="adv-' + fd[0] + '">' + esc(fd[0]) + '</label>' +
                '<div class="ctl"><input id="adv-' + fd[0] + '" type="number" step="' + fd[2] +
                '" data-key="' + fd[0] + '"></div>' +
                '<p class="hint">' + esc(fd[1]) + '</p></div>';
      });
      html += '</div></div>';
    });
    html += '<div class="derived" id="derived"></div>';
    host.innerHTML = html;
  }

  function writeInputs(vals) {
    ['travel', 'payload', 'v_cap'].forEach(function (k) { $(k).value = vals[k]; });
    document.querySelectorAll('#advanced-body input[data-key]').forEach(function (el) {
      el.value = vals[el.dataset.key];
    });
  }

  // Read the form; fall back to the default for anything blank or unparseable.
  function readParams() {
    var raw = {};
    for (var k in D) raw[k] = D[k];
    ['travel', 'payload', 'v_cap'].forEach(function (key) {
      var v = parseFloat($(key).value);
      if (isFinite(v)) raw[key] = v;
    });
    document.querySelectorAll('#advanced-body input[data-key]').forEach(function (el) {
      var v = parseFloat(el.value);
      if (isFinite(v)) raw[el.dataset.key] = v;
    });
    // Guards so a half-typed value cannot produce nonsense.
    raw.travel = Math.max(1, raw.travel);
    raw.payload = Math.max(0, raw.payload);
    raw.v_cap = Math.max(0, raw.v_cap);
    raw.N = Math.max(1, Math.round(raw.N));
    raw.n_motors = Math.max(1, Math.round(raw.n_motors));
    raw.d_min = Math.max(1, raw.d_min);
    raw.d_max = Math.max(raw.d_min + 1, raw.d_max);
    raw.g_step = Math.min(Math.max(0.01, raw.g_step), 1);
    raw.g_min = Math.min(Math.max(0.05, raw.g_min), 20);
    raw.g_max = Math.min(Math.max(raw.g_min, raw.g_max), 20);
    raw.G_ext = 1;                       // Answer 1 is direct drive by definition
    return Physics.deriveParams(raw);
  }

  // --------------------------------------------------------------- answer

  function stat(k, v, u) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v +
           (u ? ' <small>' + u + '</small>' : '') + '</div></div>';
  }

  function riggingLine(stock) {
    if (!stock.rigging) return '';
    var s = '<span class="rig-pick">Rigging: <b>' + esc(stock.rigging) + '</b> (' +
            f(stock.t, 3) + ' s)</span>';
    if (stock.other) {
      s += '<span class="rig-margin">&mdash; ' + esc(stock.other) + ' would be ' +
           f(stock.t_other, 3) + ' s (+' + f(stock.margin, 1) + '%)</span>';
    }
    return s;
  }

  // Answer 1 - stock, direct drive.
  function stockCard(stock, p) {
    var b = stock.best, r = b.best;
    return '<div class="ans">' +
      '<div class="ans-head"><h3>Answer 1 &mdash; Stock</h3>' +
        '<p class="ans-sub">Best Yellow Jacket, direct drive</p></div>' +
      '<div class="answer-head">' +
        '<div class="headline">Motor <strong>' + esc(b.motor.name) + '</strong> RPM</div>' +
        '<div class="headline">Pulley <strong class="big">' + f(b.best_d, 0) + '</strong> mm</div>' +
        '<div class="headline">In <strong class="big">' + f(b.best_t, 3) + '</strong> s</div>' +
      '</div>' +
      '<div class="stats">' +
        stat('Rigging', cap(stock.rigging), '') +
        stat('&plusmn;5% pulley window', f(b.window[0], 0) + '&ndash;' + f(b.window[1], 0), 'mm') +
        stat('Torque used', f(100 * r.u, 1), '% of stall') +
        stat('Current', f(r.I, 2), 'A') +
      '</div>' + flagsFor(b, r, p) + '</div>';
  }

  // Answer 2 - best base motor plus external gearing.
  function gearedCard(full, p) {
    var g = full.geared, b = g.best, r = b.res;
    var teeth = b.G_ext === 1
      ? 'No external stage &mdash; the pulley alone sets the ratio.'
      : '&asymp; ' + g.teeth.driven + 'T:' + g.teeth.driver + 'T = ' +
        f(g.teeth.ratio, 2) + ':1' +
        (g.teeth.err > 0.02 ? ' (nearest stock pair, ' + f(g.teeth.err, 2) + ' off)' : '');

    var verdict = full.gearingHelps
      ? '<div class="flag good">External gearing is worth it here: <b>' + f(full.gain, 1) +
        '% faster</b> than Answer 1.</div>'
      : '<div class="flag">External gearing does not help here; build Answer 1.' +
        (full.gain > 0.005 ? ' It would gain only ' + f(full.gain, 2) + '%.' : '') + '</div>';

    return '<div class="ans">' +
      '<div class="ans-head"><h3>Answer 2 &mdash; Geared</h3>' +
        '<p class="ans-sub">Best base motor plus external gearing</p></div>' +
      '<div class="answer-head">' +
        '<div class="headline">Ideal output <strong class="big">' + f(g.rpm_equiv, 0) +
          '</strong> RPM</div>' +
        '<div class="headline">Pulley <strong class="big">' + f(b.d, 0) + '</strong> mm</div>' +
        '<div class="headline">In <strong class="big">' + f(b.t, 3) + '</strong> s</div>' +
      '</div>' +
      '<div class="stats">' +
        stat('Base motor', esc(b.motor.name) + ' <small>RPM</small>', f(b.motor.ratio, 1) + ':1') +
        stat('External ratio', ratioText(b.G_ext), '') +
        stat('Rigging', cap(b.rigging), '') +
        stat('Stall torque at pulley', f(g.T_stall_equiv, 3), 'N&middot;m') +
        stat('G_ext window', f(g.gWindow[0], 2) + '&ndash;' + f(g.gWindow[1], 2), '') +
        stat('Pulley window', f(g.dWindow[0], 0) + '&ndash;' + f(g.dWindow[1], 0), 'mm') +
        stat('Torque used', f(100 * r.u, 1), '% of stall') +
        stat('Current', f(r.I, 2), 'A') +
      '</div>' +
      '<p class="teeth">' + teeth + '</p>' + verdict + '</div>';
  }

  // Guards worth surfacing (spec section 8), for the stock answer.
  function flagsFor(b, r, p) {
    var flags = [];
    if (b.at_min) flags.push('Best pulley is pinned at the <b>' + f(p.d_min, 0) +
      ' mm build minimum</b> &mdash; the true optimum is smaller than you can build.');
    if (b.at_max) flags.push('Best pulley is pinned at the <b>' + f(p.d_max, 0) +
      ' mm build maximum</b> &mdash; a larger pulley would still be faster.');
    if (b.window[0] === b.window[1]) flags.push('The &plusmn;5% window is a <b>single diameter</b>; ' +
      'this sits on a cliff, so a small build error costs real time.');
    if (r.I > p.I_port) flags.push('Draws <b>' + f(r.I, 2) + ' A</b>, over the ' + f(p.I_port, 0) +
      ' A Control Hub port limit.');
    return flags.map(function (m) { return '<div class="flag">' + m + '</div>'; }).join('');
  }

  function renderAnswer(p, full) {
    var stock = full.stock;
    $('answer-tag').textContent = f(p.payload, 1) + ' kg · ' + f(p.travel, 0) + ' mm';

    if (!stock.best) {
      $('rigging-line').innerHTML = '';
      $('answer-body').innerHTML = '<div class="flag stall">Every motor stalls at every pulley ' +
        'from ' + f(p.d_min, 0) + ' to ' + f(p.d_max, 0) + ' mm, on both riggings. ' +
        'Lower the payload, or allow a smaller pulley.</div>';
      return;
    }

    $('rigging-line').innerHTML = riggingLine(stock);
    $('answer-body').innerHTML = stockCard(stock, p) +
      (full.geared.best ? gearedCard(full, p) : '');

    $('derived').innerHTML = [
      'm1 = ' + f(p.m1, 3), 'm2 = ' + f(p.m2, 3), 'm3 = ' + f(p.m3, 3),
      'd_tot = ' + f(p.d_tot, 2) + ' N', 'eta_c = ' + f(p.eta_c, 4),
      'eta_k = ' + f(p.eta_k, 4), 'V_oc = ' + f(p.V_oc, 3) + ' V',
      'G_ext grid = ' + Physics.gearGrid(p).length + ' values'
    ].map(function (s) { return '<span>' + s + '</span>'; }).join('');
  }

  // ---------------------------------------------------------------- table

  function renderTable(p, full) {
    var stock = full.stock;
    var rig = tableRig || stock.rigging || 'cascade';
    var res = stock.byRigging[rig];

    $('table-tag').textContent = rig.toUpperCase() + ' · ' + f(p.payload, 1) + ' kg';
    document.querySelectorAll('#table-toggle button').forEach(function (btn) {
      var on = btn.dataset.rig === rig;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = cap(btn.dataset.rig) +
        (btn.dataset.rig === stock.rigging ? ' ✓' : '');
    });

    var tb = $('results').querySelector('tbody'), html = '';
    var order = res.ranked.concat(res.rows.filter(function (r) { return r.stalled; }));

    order.forEach(function (r) {
      if (r.stalled) {
        html += '<tr class="stalled"><td>&mdash;</td><td>' + esc(r.motor.name) +
          '</td><td colspan="6">STALL at every pulley ' + f(p.d_min, 0) + '&ndash;' +
          f(p.d_max, 0) + ' mm</td></tr>';
        return;
      }
      var notes = [];
      if (r.at_min) notes.push('<span class="pin">at d_min</span>');
      if (r.at_max) notes.push('<span class="pin">at d_max</span>');
      if (r.window[0] === r.window[1]) notes.push('<span class="pin">single-d window</span>');
      if (r.best.I > p.I_port) notes.push('<span class="pin">over port limit</span>');
      html += '<tr' + (r.rank === 1 ? ' class="winner"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td>' + esc(r.motor.name) + '</td>' +
        '<td>' + f(r.best_d, 0) + ' mm</td>' +
        '<td>' + f(r.best_t, 4) + ' s</td>' +
        '<td>' + f(100 * r.best.u, 1) + '%</td>' +
        '<td>' + f(r.best.I, 2) + ' A</td>' +
        '<td>' + f(r.window[0], 0) + '&ndash;' + f(r.window[1], 0) + ' mm</td>' +
        '<td>' + (notes.join(' ') || '') + '</td></tr>';
    });
    tb.innerHTML = html;

    $('table-note').textContent =
      'Direct drive (G_ext = 1). Torque used is the fraction of stall torque at the chosen ' +
      'pulley; for continuous it is phase C, the phase carrying the whole stack. Rows marked ' +
      '"at d_min" / "at d_max" are limited by the build range, not by the motor. ' +
      'The tick marks the rigging the calculator chose.';
  }

  // --------------------------------------------------------------- charts

  function axes(xTitle, yTitle, xType) {
    var grid = getComputedStyle(document.body).getPropertyValue('--line').trim();
    var ink = getComputedStyle(document.body).getPropertyValue('--ink-2').trim();
    return {
      x: { type: xType || 'linear', title: { display: true, text: xTitle, color: ink },
           grid: { color: grid }, ticks: { color: ink } },
      y: { title: { display: true, text: yTitle, color: ink }, beginAtZero: false,
           grid: { color: grid }, ticks: { color: ink } }
    };
  }

  function draw(id, datasets, xTitle, yTitle, xType, xMin, xMax) {
    if (typeof Chart === 'undefined') return;
    var ink = getComputedStyle(document.body).getPropertyValue('--ink-2').trim();
    var sc = axes(xTitle, yTitle, xType);
    if (xMin !== undefined) { sc.x.min = xMin; sc.x.max = xMax; }
    if (charts[id]) {
      charts[id].data.datasets = datasets;
      charts[id].options.scales = sc;
      charts[id].update('none');
      return;
    }
    charts[id] = new Chart($(id), {
      type: 'line',
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.15 } },
        plugins: {
          legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2, usePointStyle: false } },
          tooltip: { callbacks: { label: function (c) {
            return c.dataset.label + ': ' + c.parsed.y.toFixed(4) + ' s';
          } } }
        },
        scales: sc
      }
    });
  }

  // Charts 1 and 2: best time vs payload, one line per motor.
  function loadChart(id, rigging, p, motors) {
    var p1 = Physics.withParam(p, 'G_ext', 1);
    var ds = motors.map(function (m, i) {
      var pts = SWEEP.map(function (P) {
        var s = Physics.sweepMotor(m, P, rigging, p1);
        return s.stalled ? null : { x: P, y: s.best_t };
      }).filter(Boolean);
      return { label: m.name, data: pts, borderColor: COLORS[i], backgroundColor: COLORS[i] };
    });
    draw(id, ds, 'Payload (kg)', 'Best extension time (s)');
  }

  // Charts 3 and 4: time vs pulley diameter at the selected payload.
  // Anything above CLIP x the chart minimum is dropped so the axis stays zoomed.
  function diaChart(id, rigging, p, motors) {
    var p1 = Physics.withParam(p, 'G_ext', 1);
    var series = motors.map(function (m, i) {
      var s = Physics.sweepMotor(m, p.payload, rigging, p1);
      return { name: m.name, ds: s.diameters, times: s.times, color: COLORS[i] };
    });
    var min = Infinity;
    series.forEach(function (s) {
      s.times.forEach(function (t) { if (t !== null && t < min) min = t; });
    });
    var ceiling = isFinite(min) ? CLIP * min : Infinity;

    var ds = series.map(function (s) {
      var pts = [];
      for (var j = 0; j < s.ds.length; j++) {
        if (s.times[j] !== null && s.times[j] <= ceiling) pts.push({ x: s.ds[j], y: s.times[j] });
      }
      return { label: s.name, data: pts, borderColor: s.color, backgroundColor: s.color };
    });
    draw(id, ds, 'Pulley diameter (mm)', 'Extension time (s)');
  }

  // Chart 5: best time vs equivalent output RPM, winning rigging, one line per base motor.
  // Each point is the best pulley for that base motor at that external ratio.
  function rpmChart(full, p) {
    var g = full.geared;
    var rig = full.stock.rigging || 'cascade';

    // Same 1.6x zoom rule as charts 3 and 4: the slow motors run to ~8 s when badly
    // geared, which would flatten the bowl this chart exists to show.
    var min = Infinity;
    g.curves.forEach(function (c) {
      c.points.forEach(function (pt) {
        var t = pt.byRig[rig];
        if (t !== null && t < min) min = t;
      });
    });
    var ceiling = isFinite(min) ? CLIP * min : Infinity;

    var ds = g.curves.map(function (c, i) {
      var pts = [];
      c.points.forEach(function (pt) {
        var t = pt.byRig[rig];
        if (t !== null && t <= ceiling) pts.push({ x: pt.rpm, y: t });
      });
      return { label: c.motor.name, data: pts, borderColor: COLORS[i], backgroundColor: COLORS[i] };
    });

    $('rpm-tag').textContent = rig.toUpperCase() + ' · ' + f(p.payload, 1) + ' kg';
    $('rpm-range').textContent = f(p.g_min, 2) + ':1 to ' + f(p.g_max, 2) + ':1';
    draw('chart-rpm', ds, 'Equivalent output RPM (free RPM / G_ext)',
         'Best extension time (s)', 'logarithmic', 30, 4000);
  }

  // ---------------------------------------------------------------- render

  function render() {
    var p = readParams();
    var motors = Physics.deriveMotors(Motors.MOTORS, p);
    var full = Physics.fullAnswer(p.payload, p, motors);

    renderAnswer(p, full);
    renderTable(p, full);

    var lbl = f(p.payload, 1) + ' kg';
    $('dia-tag-c').textContent = lbl;
    $('dia-tag-k').textContent = lbl;

    loadChart('chart-load-cascade', 'cascade', p, motors);
    loadChart('chart-load-continuous', 'continuous', p, motors);
    diaChart('chart-dia-cascade', 'cascade', p, motors);
    diaChart('chart-dia-continuous', 'continuous', p, motors);
    rpmChart(full, p);
  }

  // ------------------------------------------------------------------ init

  buildAdvanced();
  writeInputs(D);
  if (typeof Chart === 'undefined') $('chartwarn').hidden = false;

  document.addEventListener('input', function (e) {
    if (e.target.matches('input')) { tableRig = null; render(); }
  });
  $('reset').addEventListener('click', function () {
    tableRig = null; writeInputs(D); render();
  });
  $('table-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-rig]');
    if (!btn) return;
    tableRig = btn.dataset.rig;
    render();
  });

  render();
})();

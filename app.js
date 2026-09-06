/* app.js - DOM wiring. All maths lives in physics.js. */
(function () {
  'use strict';

  var SWEEP = Motors.PAYLOAD_SWEEP;
  var CLIP = 1.6;         // the diameter chart hides anything above 1.6x its best
  var DEBOUNCE = 200;     // ms

  var INPUT_DEFAULTS = { extension: 700, payload: 0.6, v_cap: 2.0 };

  var COLORS = ['#1f5fd0', '#e2574c', '#0d9b6c', '#c9821a', '#7b52c9', '#4a5666'];

  var $ = function (id) { return document.getElementById(id); };
  var charts = {};
  var debounceTimer = null;
  var gearedTimer = null;
  var runId = 0;          // guards a slow geared search against newer input

  // ------------------------------------------------------------ formatting

  function f(v, n) { return (v === null || v === undefined || !isFinite(v)) ? '--' : v.toFixed(n); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function motorWord(n) { return n + (n === 1 ? ' motor' : ' motors'); }

  // --------------------------------------------------------------- inputs

  function readInputs() {
    var v = {};
    Object.keys(INPUT_DEFAULTS).forEach(function (k) {
      var raw = parseFloat($(k).value);
      v[k] = isFinite(raw) ? raw : INPUT_DEFAULTS[k];
    });
    v.extension = Math.max(1, v.extension);
    v.payload = Math.max(0, v.payload);
    v.v_cap = Math.max(0, v.v_cap);
    return v;
  }

  function writeInputs(v) {
    Object.keys(INPUT_DEFAULTS).forEach(function (k) { $(k).value = v[k]; });
  }

  // --------------------------------------------------------------- answer

  function stat(k, v, u) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v +
           (u ? ' <small>' + u + '</small>' : '') + '</div></div>';
  }

  function buildStats(c) {
    return stat('Slide', esc(c.slide.model), c.slide.nominal_in + ' in') +
      stat('Stages', c.N, '') +
      stat('Motors', c.n_motors, esc(c.motor.name) + ' RPM') +
      stat('Rigging', cap(c.rigging), '') +
      stat('Pulley window', f(c.window[0], 0) + '&ndash;' + f(c.window[1], 0), 'mm') +
      stat('Retracted height', f(c.height, 0), 'mm') +
      stat('Stroke spare', f(c.leftover, 0), 'mm') +
      stat('Torque used', f(100 * c.res.u, 1), '% of stall') +
      stat('End-stop impact', f(c.res.v_impact, 2), 'm/s');
  }

  function warnings(c) {
    var out = [];
    // The port limit is per motor: tau is the total across n_motors, so each
    // controller sees I / n_motors.
    var perMotor = c.res.I / c.n_motors;
    if (perMotor > c.params.I_port) {
      out.push('Each motor draws <b>' + f(perMotor, 2) + ' A</b>, over the ' +
        f(c.params.I_port, 0) + ' A port limit. Expect the port to trip.');
    }
    if (c.res.u > 0.7) {
      out.push('Running at <b>' + f(100 * c.res.u, 0) + '% of stall torque</b> &mdash; hot, and ' +
        'close to the cliff. A smaller pulley buys margin.');
    }
    if (c.res.hard_stop) {
      out.push('The motor cannot brake hard enough over the last ' +
        f(c.params.d_stop, 0) + ' mm: it hits the end stop at <b>' +
        f(c.res.v_impact, 2) + ' m/s</b> instead of ' + f(c.params.v_stop, 2) +
        ' m/s. Expect a bang.');
    }
    if (c.leftover < 0.02 * c.N * c.slide.stroke) {
      out.push('Only <b>' + f(c.leftover, 0) + ' mm</b> of stroke spare &mdash; almost no margin ' +
        'for rigging losses or a hard stop.');
    }
    return out.map(function (m) { return '<div class="flag">' + m + '</div>'; }).join('');
  }

  function stockCard(best, fastest, inp) {
    return '<div class="ans">' +
      '<div class="ans-head"><h3>Answer 1 &mdash; Stock' +
        (fastest ? ' <span class="fastest">FASTEST</span>' : '') + '</h3>' +
        '<p class="ans-sub">Direct drive, no external gearing</p></div>' +
      '<div class="answer-head">' +
        '<div class="headline">' + best.N + ' &times; <strong>' +
          esc(best.slide.model) + '</strong></div>' +
        '<div class="headline">Pulley <strong class="big">' + f(best.d, 0) + '</strong> mm</div>' +
        '<div class="headline">In <strong class="big">' + f(best.t, 3) + '</strong> s</div>' +
      '</div>' +
      '<div class="stats">' + buildStats(best) + '</div>' +
      ceilingLines(best, inp) + warnings(best) + '</div>';
  }

  // What the same build would do with no cap and no end-stop ramp - the headroom
  // the two are costing, so the user can see what is physics and what is policy.
  function ceilingLines(best, inp) {
    var free = Physics.withParam(Physics.withParam(best.params, 'v_cap', 0), 'd_stop', 0);
    var bt = Infinity;
    Physics.diameters(free).forEach(function (d) {
      var r = Physics.solve(best.motor, d, inp.payload, best.rigging, free);
      if (r && r.t < bt) bt = r.t;
    });
    if (!isFinite(bt)) return '';
    return '<p class="ceiling">Physics ceiling (no cap, no decel): <b>' + f(bt, 3) + ' s</b>' +
      '<br><span class="dim">The cap and the ' + f(best.params.d_stop, 0) +
      ' mm stopping ramp cost ' + f(best.t - bt, 3) + ' s of that.</span></p>';
  }

  function gearedCard(res, fastest) {
    if (!res) {
      return '<div class="ans pending"><div class="ans-head"><h3>Answer 2 &mdash; Geared</h3>' +
        '<p class="ans-sub">Searching every external ratio&hellip;</p></div></div>';
    }
    var g = res.geared, b = g.best, helps = res.gearingHelps;
    // Grey it out only when it is actually not faster. A sub-2% win is still a
    // win - it just is not worth the extra parts, which the verdict says.
    var faster = res.gain > 0;
    var reach = b.G_ext === 1
      ? 'No external stage &mdash; the pulley alone sets the ratio.'
      : 'Gear the <b>' + esc(b.motor.name) + '</b> at <b>' + f(b.G_ext, 2) + ':1</b>' +
        (g.teeth ? ' (&asymp; ' + g.teeth.driven + 'T:' + g.teeth.driver + 'T)' : '') + '.';

    var verdict;
    if (helps) {
      verdict = '<div class="flag good">Worth building: <b>' + f(res.gain, 1) +
        '% faster</b> than Answer 1.</div>';
    } else if (faster) {
      verdict = '<div class="flag">Fastest, but only by <b>' + f(res.gain, 1) +
        '%</b>. Answer 1 is simpler to build for almost the same time.</div>';
    } else {
      verdict = '<div class="flag">Gearing doesn&rsquo;t help &mdash; build Answer 1.</div>';
    }

    return '<div class="ans' + (faster ? '' : ' muted') + '">' +
      '<div class="ans-head"><h3>Answer 2 &mdash; Geared' +
        (fastest ? ' <span class="fastest">FASTEST</span>' : '') + '</h3>' +
        '<p class="ans-sub">Same search plus an external ratio</p></div>' +
      '<div class="answer-head">' +
        '<div class="headline">Output <strong class="big">' + f(g.rpm_equiv, 0) +
          '</strong> RPM</div>' +
        '<div class="headline">Pulley <strong class="big">' + f(b.d, 0) + '</strong> mm</div>' +
        '<div class="headline">In <strong class="big">' + f(b.t, 3) + '</strong> s</div>' +
      '</div>' +
      '<div class="stats">' + buildStats(b) +
        stat('External ratio', b.G_ext === 1 ? 'direct' : f(b.G_ext, 2) + ':1', '') +
      '</div>' +
      '<p class="teeth">' + reach + '</p>' + verdict + warnings(b) + '</div>';
  }

  function renderUnreachable(inp) {
    var max = 0;
    Motors.SLIDES.forEach(function (s) {
      Motors.STAGE_COUNTS.forEach(function (N) { max = Math.max(max, N * s.stroke); });
    });
    $('answer-tag').textContent = f(inp.extension, 0) + ' mm';
    $('answer-body').innerHTML = '<div class="flag stall">No BWTLink stack reaches ' +
      f(inp.extension, 0) + ' mm. The longest available is ' + f(max, 0) +
      ' mm (' + Math.max.apply(null, Motors.STAGE_COUNTS) + ' &times; BL-400B-2M).</div>';
    $('results').querySelector('tbody').innerHTML = '';
    $('table-note').textContent = '';
    $('table-card').hidden = true;
    $('charts').hidden = true;
  }

  // ---------------------------------------------------------------- table

  function renderTable(stock) {
    var tb = $('results').querySelector('tbody'), html = '';
    stock.rows.forEach(function (r) {
      var win = stock.best && r.slide.model === stock.best.slide.model && r.N === stock.best.N;
      html += '<tr' + (win ? ' class="winner"' : '') + '>' +
        '<td>' + esc(r.slide.model) + ' <small>' + r.slide.nominal_in + ' in</small></td>' +
        '<td>' + r.N + '</td>' +
        '<td>' + f(r.height, 0) + ' mm</td>' +
        '<td>' + r.n_motors + '</td>' +
        '<td>' + esc(r.motor.name) + '</td>' +
        '<td>' + cap(r.rigging) + '</td>' +
        '<td>' + f(r.d, 0) + ' mm</td>' +
        '<td>' + f(r.t, 4) + ' s</td>' +
        '<td>' + f(r.leftover, 0) + ' mm</td></tr>';
    });
    tb.innerHTML = html;
    $('table-note').textContent =
      'One row per slide and stage count that reaches the extension, each showing its own best ' +
      'build. Ranked fastest first; the highlighted row is Answer 1. Stroke spare is the travel ' +
      'the stack has left over.';
  }

  // --------------------------------------------------------------- charts

  function axes(xTitle, yTitle) {
    var grid = getComputedStyle(document.body).getPropertyValue('--line').trim();
    var ink = getComputedStyle(document.body).getPropertyValue('--ink-2').trim();
    return {
      x: { type: 'linear', title: { display: true, text: xTitle, color: ink },
           grid: { color: grid }, ticks: { color: ink } },
      y: { title: { display: true, text: yTitle, color: ink }, beginAtZero: false,
           grid: { color: grid }, ticks: { color: ink } }
    };
  }

  function draw(id, datasets, xTitle, yTitle) {
    if (typeof Chart === 'undefined') return;
    var ink = getComputedStyle(document.body).getPropertyValue('--ink-2').trim();
    if (charts[id]) {
      charts[id].data.datasets = datasets;
      charts[id].options.scales = axes(xTitle, yTitle);
      charts[id].update('none');
      return;
    }
    charts[id] = new Chart($(id), {
      type: 'line',
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.15 } },
        plugins: {
          legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2, usePointStyle: false } },
          tooltip: { callbacks: { label: function (c) {
            return c.dataset.label + ': ' + c.parsed.y.toFixed(4) + ' s';
          } } }
        },
        scales: axes(xTitle, yTitle)
      }
    });
  }

  // Both charts hold Answer 1's slide, stage count, motor count and rigging fixed
  // and vary only the motor, so they answer "what if I used a different motor in
  // this exact build".
  function renderCharts(best, inp) {
    var p = best.params;
    var motors = Physics.deriveMotors(Motors.MOTORS, p);
    var ds = Physics.diameters(p);
    var label = best.N + ' × ' + best.slide.model + ' · ' +
                motorWord(best.n_motors) + ' · ' + best.rigging;
    $('chart1-tag').textContent = label;
    $('chart2-tag').textContent = label + ' · ' + f(inp.payload, 1) + ' kg';

    var loadSets = motors.map(function (m, i) {
      var pts = [];
      SWEEP.forEach(function (P) {
        var bt = Infinity;
        ds.forEach(function (d) {
          var r = Physics.solve(m, d, P, best.rigging, p);
          if (r && r.t < bt) bt = r.t;
        });
        if (isFinite(bt)) pts.push({ x: P, y: bt });
      });
      return { label: m.name, data: pts, borderColor: COLORS[i], backgroundColor: COLORS[i] };
    });
    draw('chart-load', loadSets, 'Payload (kg)', 'Best extension time (s)');

    var series = motors.map(function (m, i) {
      return {
        name: m.name, color: COLORS[i],
        times: ds.map(function (d) {
          var r = Physics.solve(m, d, inp.payload, best.rigging, p);
          return r ? r.t : null;
        })
      };
    });
    var min = Infinity;
    series.forEach(function (s) {
      s.times.forEach(function (t) { if (t !== null && t < min) min = t; });
    });
    var ceiling = isFinite(min) ? CLIP * min : Infinity;
    var diaSets = series.map(function (s) {
      var pts = [];
      for (var j = 0; j < ds.length; j++) {
        if (s.times[j] !== null && s.times[j] <= ceiling) pts.push({ x: ds[j], y: s.times[j] });
      }
      return { label: s.name, data: pts, borderColor: s.color, backgroundColor: s.color };
    });
    draw('chart-dia', diaSets, 'Pulley diameter (mm)', 'Extension time (s)');
  }

  // ---------------------------------------------------------------- render

  function render() {
    var inp = readInputs();
    var me = ++runId;
    if (gearedTimer) { clearTimeout(gearedTimer); gearedTimer = null; }

    var stock = Physics.stockStack(inp.extension, inp.payload, inp.v_cap);
    if (!stock.reachable || !stock.best) { renderUnreachable(inp); return; }

    $('table-card').hidden = false;
    $('charts').hidden = false;
    $('answer-tag').textContent = f(inp.extension, 0) + ' mm · ' + f(inp.payload, 1) + ' kg' +
      (inp.v_cap > 0 ? ' · cap ' + f(inp.v_cap, 2) + ' m/s' : '');

    // Answer 1, the table and the charts are cheap - paint them now. The geared
    // search sweeps 113 ratios across every stack, so it runs on the next tick
    // and fills Answer 2 in when it lands.
    $('answer-body').innerHTML = stockCard(stock.best, true, inp) + gearedCard(null);
    renderTable(stock);
    renderCharts(stock.best, inp);

    gearedTimer = setTimeout(function () {
      if (me !== runId) return;                      // superseded by newer input
      var full = Physics.stackAnswer(inp.extension, inp.payload, inp.v_cap);
      if (me !== runId || !full.geared || !full.geared.best) return;
      var gearedWins = full.geared.best.t < stock.best.t - 1e-9;
      $('answer-body').innerHTML =
        stockCard(stock.best, !gearedWins, inp) + gearedCard(full, gearedWins);
    }, 0);
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE);
  }

  // ------------------------------------------------------------------ init

  writeInputs(INPUT_DEFAULTS);
  if (typeof Chart === 'undefined') $('chartwarn').hidden = false;
  document.addEventListener('input', function (e) {
    if (e.target.matches('input')) scheduleRender();
  });
  render();
})();

/* Tiny dependency-free SVG charts for the dashboard. Exposed as window.Charts. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const WIN = '#3fb950', LOSS = '#f0533f', MID = '#d8893f', LINE = '#2a323c', MUTED = '#8b97a4';

  function el(name, attrs, children) {
    const node = document.createElementNS(NS, name);
    for (const k in attrs || {}) node.setAttribute(k, attrs[k]);
    for (const c of children || []) node.appendChild(c);
    return node;
  }
  function text(x, y, str, cls, anchor) {
    const t = el('text', { x, y, 'text-anchor': anchor || 'middle' });
    if (cls) t.setAttribute('class', cls);
    t.textContent = str;
    return t;
  }
  function wrColor(wr) { return wr >= 0.55 ? WIN : wr <= 0.45 ? LOSS : MID; }
  function pct(wr) { return Math.round(wr * 100) + '%'; }
  function svg(w, h) {
    const s = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', preserveAspectRatio: 'xMidYMid meet' });
    s.style.display = 'block';
    return s;
  }
  function clear(container) { container.innerHTML = ''; }

  // Vertical winrate bars (role / account)
  function vbars(container, data) {
    clear(container);
    if (!data.length) return empty(container);
    const padL = 8, padR = 8, padT = 26, padB = 34, barW = 46, gap = 26, H = 220;
    const W = padL + padR + data.length * barW + (data.length - 1) * gap;
    const top = padT, bot = H - padB, plot = bot - top;
    const s = svg(Math.max(W, 240), H);
    // 50% reference
    const y50 = bot - 0.5 * plot;
    s.appendChild(el('line', { x1: padL, y1: y50, x2: W - padR, y2: y50, stroke: LINE, 'stroke-dasharray': '4 4' }));
    s.appendChild(text(W - padR, y50 - 4, '50%', null, 'end'));
    data.forEach((d, i) => {
      const x = padL + i * (barW + gap);
      const h = Math.max(2, d.winrate * plot);
      s.appendChild(el('rect', { x, y: bot - h, width: barW, height: h, rx: 5, fill: wrColor(d.winrate) }));
      s.appendChild(text(x + barW / 2, bot - h - 7, pct(d.winrate), 'bar-label'));
      s.appendChild(text(x + barW / 2, bot + 15, d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label));
      s.appendChild(text(x + barW / 2, bot + 28, d.games + 'g'));
    });
    container.appendChild(s);
  }

  // Horizontal winrate bars (maps)
  function hbars(container, data) {
    clear(container);
    if (!data.length) return empty(container);
    const rowH = 24, gap = 6, padT = 6, labelW = 150, valW = 70;
    const W = 720, barX = labelW, barW = W - labelW - valW;
    const H = padT * 2 + data.length * (rowH + gap);
    const s = svg(W, H);
    data.forEach((d, i) => {
      const y = padT + i * (rowH + gap);
      s.appendChild(text(labelW - 8, y + rowH / 2 + 4, d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label, 'bar-label', 'end'));
      s.appendChild(el('rect', { x: barX, y, width: barW, height: rowH, rx: 5, fill: '#1e252d' }));
      s.appendChild(el('rect', { x: barX, y, width: Math.max(2, d.winrate * barW), height: rowH, rx: 5, fill: wrColor(d.winrate) }));
      s.appendChild(text(barX + barW + valW - 8, y + rowH / 2 + 4, pct(d.winrate) + '  ' + d.games + 'g', null, 'end'));
    });
    container.appendChild(s);
  }

  // Line chart of winrate over time
  function line(container, points) {
    clear(container);
    if (points.length < 2) return empty(container);
    const padL = 36, padR = 14, padT = 16, padB = 26, H = 240, W = 720;
    const top = padT, bot = H - padB, plotH = bot - top, plotW = W - padL - padR;
    const s = svg(W, H);
    [0, 0.5, 1].forEach((g) => {
      const y = bot - g * plotH;
      s.appendChild(el('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: LINE, 'stroke-dasharray': g === 0.5 ? '4 4' : '0' }));
      s.appendChild(text(padL - 6, y + 4, Math.round(g * 100) + '%', null, 'end'));
    });
    const xAt = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const yAt = (wr) => bot - wr * plotH;
    let path = '';
    points.forEach((p, i) => { path += (i ? 'L' : 'M') + xAt(i) + ' ' + yAt(p.winrate) + ' '; });
    s.appendChild(el('path', { d: path, fill: 'none', stroke: '#f06414', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    points.forEach((p, i) => {
      s.appendChild(el('circle', { cx: xAt(i), cy: yAt(p.winrate), r: 3, fill: '#f06414' }));
    });
    const step = Math.ceil(points.length / 8);
    points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) s.appendChild(text(xAt(i), bot + 16, p.label.slice(5))); });
    container.appendChild(s);
  }

  function empty(container) {
    const d = document.createElement('div');
    d.style.cssText = 'color:#8b97a4;font-size:13px;padding:12px 2px';
    d.textContent = 'Not enough data yet.';
    container.appendChild(d);
  }

  window.Charts = { vbars, hbars, line, wrColor, pct };
})();

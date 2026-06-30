/* Dashboard controller: pulls computed stats from main and renders the UI. */
(function () {
  const $ = (id) => document.getElementById(id);
  const ROLE_LABEL = { tank: 'Tank', damage: 'Damage', support: 'Support', openQ: 'Open Q' };
  let optionsReady = false;
  let heroRows = [];
  let heroSort = { key: 'games', dir: -1 };

  function readFilters() {
    const days = $('fDays').value;
    return {
      account: $('fAccount').value,
      role: $('fRole').value,
      mode: $('fMode').value,
      days: days === 'all' ? 'all' : Number(days),
    };
  }

  function saveFilters() {
    try { localStorage.setItem('owsFilters', JSON.stringify(readFilters())); } catch (e) { /* ignore */ }
  }
  function applySavedFilters() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem('owsFilters') || '{}'); } catch (e) { return; }
    let changed = false;
    const set = (id, val) => {
      const el = $(id);
      if (val != null && [...el.options].some((o) => o.value === String(val)) && el.value !== String(val)) {
        el.value = String(val); changed = true;
      }
    };
    set('fAccount', saved.account); set('fRole', saved.role); set('fMode', saved.mode); set('fDays', saved.days);
    if (changed) refresh();
  }

  function fmt(n) {
    if (n == null) return '–';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(Math.round(n));
  }

  async function refresh() {
    $('status').textContent = 'Loading…';
    const data = await window.owstats.getDashboard(readFilters());
    render(data);
  }

  function render(d) {
    $('sampleBadge').classList.toggle('hidden', !d.isSample);
    if (!optionsReady) { populateOptions(d.options); applySavedFilters(); }
    saveFilters();

    $('kGames').textContent = d.overall.games;
    const wrEl = $('kWinrate');
    wrEl.textContent = d.overall.games ? Charts.pct(d.overall.winrate) : '–';
    wrEl.className = 'kpi-val ' + (d.overall.winrate >= 0.5 ? 'wr-good' : 'wr-bad');
    $('kRecord').textContent = `${d.overall.wins} · ${d.overall.losses} · ${d.overall.draws}`;
    const st = d.streak;
    const stEl = $('kStreak');
    stEl.textContent = st.type === 'none' ? '–' : `${st.type}${st.count}`;
    stEl.className = 'kpi-val ' + (st.type === 'W' ? 'wr-good' : st.type === 'L' ? 'wr-bad' : '');

    renderSession(d.session);
    Charts.line($('cTrend'), d.trend.map((t) => ({ label: t.key, winrate: t.winrate, games: t.games })));
    Charts.vbars($('cRole'), d.byRole.map((r) => ({ label: ROLE_LABEL[r.key] || r.key, winrate: r.winrate, games: r.games })));
    Charts.vbars($('cAccount'), d.byAccount.map((a) => ({ label: a.key, winrate: a.winrate, games: a.games })));
    Charts.vbars($('cMode'), d.byMode.map((m) => ({ label: m.key, winrate: m.winrate, games: m.games })));
    renderCalendar(d.calendar);
    Charts.hbars(
      $('cMap'),
      [...d.byMap].sort((a, b) => b.winrate - a.winrate).map((m) => ({ label: m.key, winrate: m.winrate, games: m.games })),
    );

    renderFocus(d.focusMaps);
    heroRows = d.heroStats;
    renderHeroes();

    const when = new Date(d.generatedAt).toLocaleTimeString();
    $('status').textContent = `${d.overall.games} games${d.isSample ? ' (demo data — play games to populate)' : ''} · updated ${when}`;
  }

  function populateOptions(opts) {
    $('fAccount').innerHTML = '<option value="all">All</option>' + opts.accounts.map((a) => `<option value="${a}">${a}</option>`).join('');
    $('fRole').innerHTML = '<option value="all">All</option>' + opts.roles.map((r) => `<option value="${r}">${ROLE_LABEL[r] || r}</option>`).join('');
    $('fMode').innerHTML = '<option value="all">All</option>' + (opts.modes || []).map((m) => `<option value="${m}">${m}</option>`).join('');
    optionsReady = true;
  }

  function renderFocus(items) {
    const c = $('cFocus');
    c.innerHTML = '';
    const losing = items.filter((i) => i.net > 0);
    if (!losing.length) {
      c.innerHTML = '<div class="focus-empty">No net-losing maps here — nice. 🎯</div>';
      return;
    }
    const max = losing[0].net;
    for (const it of losing) {
      const row = document.createElement('div');
      row.className = 'focus-row';
      const name = document.createElement('div');
      name.className = 'fname';
      name.textContent = it.key;
      const meta = document.createElement('div');
      meta.className = 'focus-meta';
      meta.textContent = `−${it.net} · ${Charts.pct(it.winrate)} (${it.games}g)`;
      const barWrap = document.createElement('div');
      barWrap.className = 'focus-bar-wrap';
      const span = document.createElement('span');
      span.style.width = Math.round((it.net / max) * 100) + '%';
      barWrap.appendChild(span);
      row.append(name, meta, barWrap);
      c.appendChild(row);
    }
  }

  function statBox(v, l, cls) {
    return `<div class="session-stat"><div class="v ${cls || ''}">${v}</div><div class="l">${l}</div></div>`;
  }
  function renderSession(s) {
    $('sessionTitle').textContent = s && s.games ? `Session — ${s.date}` : 'Latest session';
    const c = $('cSession');
    if (!s || !s.games) { c.innerHTML = '<div class="hint">No games yet.</div>'; return; }
    const st = s.streak;
    const maps = (s.topMaps || []).map((m) => `${m.key} (${m.games})`).join(' · ');
    c.innerHTML =
      statBox(s.games, 'Games') +
      statBox(Charts.pct(s.winrate), 'Winrate', s.winrate >= 0.5 ? 'wr-good' : 'wr-bad') +
      statBox(`${s.wins} · ${s.losses} · ${s.draws}`, 'W · L · D') +
      statBox(st.type === 'none' ? '–' : st.type + st.count, 'Streak', st.type === 'W' ? 'wr-good' : st.type === 'L' ? 'wr-bad' : '') +
      (maps ? `<div class="session-maps">Maps: ${maps}</div>` : '');
  }

  function renderCalendar(days) {
    const c = $('cCalendar');
    c.innerHTML = '';
    for (const d of days) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (d.games) {
        cell.style.background = Charts.wrColor(d.winrate);
        cell.style.opacity = (0.35 + Math.min(d.games, 6) / 6 * 0.65).toFixed(2);
        cell.title = `${d.date}: ${d.games}g · ${Charts.pct(d.winrate)}`;
      } else {
        cell.title = `${d.date}: no games`;
      }
      c.appendChild(cell);
    }
  }

  async function openHeroDrawer(hero) {
    const d = await window.owstats.heroDetail(hero, readFilters());
    renderHeroDetail(d);
    $('drawer').classList.remove('hidden');
  }
  function sb(v, l) { return `<div class="b"><div class="v">${v}</div><div class="l">${l}</div></div>`; }
  function renderHeroDetail(d) {
    const o = d.overall, s = d.stats, p = s && s.per10;
    let html = `<h3>${d.hero}</h3><p class="sub">${o.games} games · ${Charts.pct(o.winrate)} winrate · ${o.wins}W ${o.losses}L</p>`;
    if (s) {
      html += '<div class="statline">' +
        sb(s.kda.toFixed(1), 'KDA') + sb(p ? p.eliminations : '–', 'Elims/10') + sb(p ? p.deaths : '–', 'Deaths/10') +
        sb(p ? fmt(p.damage) : '–', 'Dmg/10') + sb(p ? fmt(p.healing) : '–', 'Heal/10') + sb(p ? fmt(p.mitigation) : '–', 'Mit/10') +
        '</div>';
    }
    html += '<h4>By map</h4>' + (d.byMap.map((m) =>
      `<div class="recent-row"><span style="flex:1">${m.key}</span><span class="${m.winrate >= 0.5 ? 'wr-good' : 'wr-bad'}">${Charts.pct(m.winrate)}</span><span style="color:#8b97a4">${m.games}g</span></div>`).join('') || '<div class="hint">—</div>');
    html += '<h4>Recent</h4>' + (d.recent.map((r) => {
      const t = r.result === 'Win' ? 'W' : r.result === 'Loss' ? 'L' : 'D';
      return `<div class="recent-row"><span class="pill ${t}">${t}</span><span style="flex:1">${r.map}</span><span style="color:#8b97a4">${r.account} · ${new Date(r.timestamp).toLocaleDateString()}</span></div>`;
    }).join('') || '<div class="hint">—</div>');
    $('drawerBody').innerHTML = html;
  }

  const HERO_COLS = [
    { key: 'hero', label: 'Hero', get: (h) => h.hero, txt: true },
    { key: 'role', label: 'Role', get: (h) => h.role, role: true },
    { key: 'games', label: 'G', get: (h) => h.games },
    { key: 'winrate', label: 'WR', get: (h) => h.winrate, wr: true },
    { key: 'kda', label: 'KDA', get: (h) => h.kda, fixed1: true },
    { key: 'elims', label: 'E/10', get: (h) => h.per10 && h.per10.eliminations },
    { key: 'deaths', label: 'D/10', get: (h) => h.per10 && h.per10.deaths },
    { key: 'assists', label: 'A/10', get: (h) => h.per10 && h.per10.assists },
    { key: 'damage', label: 'DMG/10', get: (h) => h.per10 && h.per10.damage, big: true },
    { key: 'healing', label: 'HEAL/10', get: (h) => h.per10 && h.per10.healing, big: true },
    { key: 'mitigation', label: 'MIT/10', get: (h) => h.per10 && h.per10.mitigation, big: true },
  ];

  function sortVal(h, key) {
    const col = HERO_COLS.find((c) => c.key === key);
    const v = col.get(h);
    return typeof v === 'number' ? v : v == null ? -1 : String(v);
  }

  function renderHeroes() {
    const wrap = $('cHeroes');
    const rows = [...heroRows].sort((a, b) => {
      const va = sortVal(a, heroSort.key), vb = sortVal(b, heroSort.key);
      if (va < vb) return heroSort.dir; if (va > vb) return -heroSort.dir; return 0;
    });
    const thead = '<tr>' + HERO_COLS.map((c) => `<th data-k="${c.key}" class="${c.key === heroSort.key ? 'sorted' : ''}">${c.label}</th>`).join('') + '</tr>';
    const body = rows.map((h) => `<tr class="clickable" data-hero="${h.hero}">` + HERO_COLS.map((c) => {
      const v = c.get(h);
      if (c.role) return `<td><span class="role-tag">${ROLE_LABEL[v] || '–'}</span></td>`;
      if (c.txt) return `<td>${v}</td>`;
      if (c.wr) return `<td class="${v >= 0.5 ? 'wr-good' : 'wr-bad'}">${Charts.pct(v)}</td>`;
      if (c.fixed1) return `<td>${v.toFixed(1)}</td>`;
      if (c.big) return `<td>${fmt(v)}</td>`;
      return `<td>${v == null ? '–' : Math.round(v)}</td>`;
    }).join('') + '</tr>').join('');
    wrap.innerHTML = `<table><thead>${thead}</thead><tbody>${body}</tbody></table>`;
    wrap.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.k;
      heroSort = { key: k, dir: heroSort.key === k ? -heroSort.dir : -1 };
      renderHeroes();
    }));
    wrap.querySelectorAll('tbody tr').forEach((tr) =>
      tr.addEventListener('click', () => openHeroDrawer(tr.dataset.hero)));
  }

  async function exportNotion() {
    const btn = $('exportBtn');
    btn.disabled = true;
    $('status').textContent = 'Exporting to Notion…';
    try {
      const res = await window.owstats.exportNotion(readFilters());
      if (res.unavailable) $('status').textContent = 'Notion export not configured (set a token in the tray menu).';
      else $('status').textContent = `Exported ${res.ok} game(s) to Notion${res.failed ? `, ${res.failed} failed` : ''}.`;
    } catch (e) {
      $('status').textContent = 'Export failed: ' + e;
    }
    btn.disabled = false;
  }

  ['fAccount', 'fRole', 'fMode', 'fDays'].forEach((id) => $(id).addEventListener('change', refresh));
  $('exportBtn').addEventListener('click', exportNotion);
  $('drawerClose').addEventListener('click', () => $('drawer').classList.add('hidden'));
  $('drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') $('drawer').classList.add('hidden'); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drawer').classList.add('hidden'); });
  window.addEventListener('focus', refresh); // pick up newly tracked games
  refresh();
})();

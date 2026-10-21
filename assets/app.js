const SITE_REPO = 'IsidroPenh/PORTal';

const STATUS = {
  complete: { label: 'Completo', desc: 'Jugable de principio a fin', color: 'var(--s-complete)', rank: 5 },
  playable: { label: 'Jugable', desc: 'Se puede jugar; partida completa sin confirmar', color: 'var(--s-playable)', rank: 4 },
  partial: { label: 'Parcial', desc: 'Jugable solo en algunos tramos (prólogo, primeros capítulos…)', color: 'var(--s-partial)', rank: 3 },
  early: { label: 'Temprano', desc: 'Arranca o llega a menús; desarrollo temprano o sin verificar', color: 'var(--s-early)', rank: 2 },
  research: { label: 'No jugable', desc: 'Investigación; el juego todavía no corre', color: 'var(--s-research)', rank: 1 },
  unknown: { label: 'Sin datos', desc: '', color: 'var(--s-research)', rank: 0 },
};
const TYPES = {
  native: 'Nativo',
  recomp: 'Recompilación',
  decomp: 'Decompilación',
  reimpl: 'Motor reescrito',
  wrapper: 'Fork de emulador',
};
const PLATFORMS = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };

const state = {
  q: '', sort: 'status',
  status: new Set(), platform: new Set(), type: new Set(),
  data: null,
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtNum = n => n == null ? '—' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k' : String(n);
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function ago(iso) {
  if (!iso) return '—';
  const s = (new Date(iso) - Date.now()) / 1000;
  const units = [['year', 31536e3], ['month', 2592e3], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec || u === 'minute') return rtf.format(Math.round(s / sec), u);
}
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const ghUrl = repo => `https://github.com/${repo}`;
const issueUrl = (template, params = {}) => {
  const u = new URL(`https://github.com/${SITE_REPO}/issues/new`);
  u.searchParams.set('template', template);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
};
const badge = (status) => {
  const s = STATUS[status] || STATUS.unknown;
  return `<span class="badge" style="--c:${s.color}" title="${esc(s.desc)}"><span class="dot"></span>${s.label}</span>`;
};
const plats = list => `<span class="plats">${(list || []).map(p => `<span class="plat">${PLATFORMS[p] || esc(p)}</span>`).join('')}</span>`;

async function load(file, fallback) {
  try {
    const r = await fetch(`data/${file}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn('no se pudo cargar', file, e);
    return fallback;
  }
}

function enrich(catalog, github, reports) {
  const gh = github.repos || {};
  const byRepo = new Map();
  for (const r of reports.items || []) {
    const k = r.repo.toLowerCase();
    if (!byRepo.has(k)) byRepo.set(k, []);
    byRepo.get(k).push(r);
  }
  const games = catalog.games.map(g => {
    const ports = g.ports.map(p => ({
      ...p,
      gh: gh[p.repo] || {},
      reports: byRepo.get(p.repo.toLowerCase()) || [],
    }));
    ports.sort((a, b) => STATUS[b.status].rank - STATUS[a.status].rank || (b.gh.stars || 0) - (a.gh.stars || 0));
    const live = ports.filter(p => !p.gh.missing);
    const best = (live.length ? live : ports)[0];
    return {
      ...g,
      ports,
      best,
      bestStatus: best.status,
      stars: Math.max(0, ...ports.map(p => p.gh.stars || 0)),
      lastPush: ports.map(p => p.gh.pushedAt).filter(Boolean).sort().pop() || null,
      firstCreated: ports.map(p => p.gh.createdAt).filter(Boolean).sort().pop() || null,
      platforms: [...new Set(ports.flatMap(p => p.platforms))],
      types: [...new Set(ports.map(p => p.type))],
      haystack: norm([g.title, g.developer, ...(g.cusa || []), ...ports.flatMap(p => [p.repo, p.name, p.summary])].join(' ')),
    };
  });
  return games;
}

// ---------- filtros ----------
function chip(group, value, label, color) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.type = 'button';
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = (color ? `<span class="dot" style="color:${color}"></span>` : '') + esc(label);
  b.addEventListener('click', () => {
    const set = state[group];
    set.has(value) ? set.delete(value) : set.add(value);
    b.setAttribute('aria-pressed', String(set.has(value)));
    renderGrid();
  });
  return b;
}
function buildFilters() {
  for (const [k, s] of Object.entries(STATUS)) if (k !== 'unknown') $('#f-status').append(chip('status', k, s.label, s.color));
  for (const [k, l] of Object.entries(PLATFORMS)) $('#f-platform').append(chip('platform', k, l));
  for (const [k, l] of Object.entries(TYPES)) $('#f-type').append(chip('type', k, l));
  $('#q').addEventListener('input', e => { state.q = norm(e.target.value.trim()); renderGrid(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });
}

function portMatches(p) {
  if (state.status.size && !state.status.has(p.status)) return false;
  if (state.platform.size && !p.platforms.some(x => state.platform.has(x))) return false;
  if (state.type.size && !state.type.has(p.type)) return false;
  return true;
}

function renderGrid() {
  const games = state.data.games
    .filter(g => !state.q || g.haystack.includes(state.q))
    .filter(g => g.ports.some(portMatches));
  const sorters = {
    status: (a, b) => STATUS[b.bestStatus].rank - STATUS[a.bestStatus].rank || b.stars - a.stars,
    stars: (a, b) => b.stars - a.stars,
    activity: (a, b) => String(b.lastPush).localeCompare(String(a.lastPush)),
    newest: (a, b) => String(b.firstCreated).localeCompare(String(a.firstCreated)),
    ports: (a, b) => b.ports.length - a.ports.length || b.stars - a.stars,
    az: (a, b) => a.title.localeCompare(b.title, 'es'),
  };
  games.sort(sorters[state.sort]);
  const portsShown = games.reduce((n, g) => n + g.ports.filter(portMatches).length, 0);
  $('#result-line').textContent = `${games.length} juego${games.length === 1 ? '' : 's'} · ${portsShown} port${portsShown === 1 ? '' : 's'}`;
  $('#grid').innerHTML = games.length ? games.map(cardHtml).join('') : `<p class="empty">Nada coincide con esos filtros.</p>`;
}

function cardHtml(g) {
  const ports = g.ports.filter(portMatches);
  const top = ports.find(p => !p.gh.missing) || ports[0];
  const color = STATUS[top.status].color;
  const list = ports.slice(0, 3).map(p =>
    `<span><span class="dot" style="color:${STATUS[p.status].color}"></span>${esc(p.name)}${p.gh.missing ? ' <span class="badge warn">eliminado</span>' : ''}</span>`).join('');
  const more = ports.length > 3 ? `<span class="muted">+${ports.length - 3} más</span>` : '';
  return `<button class="card" style="--status-color:${color}" data-game="${esc(g.id)}">
    <div><h3>${esc(g.title)}</h3><div class="sub">${esc(g.developer)} · ${g.year}</div></div>
    <div class="row" style="justify-content:flex-start">${badge(top.status)}<span class="muted" style="font-size:.8rem">${g.ports.length} port${g.ports.length === 1 ? '' : 's'}</span></div>
    <p class="summary">${esc(top.summary)}</p>
    <div class="portlist">${list}${more}</div>
    <div class="row">
      ${plats(g.platforms)}
      <span class="meta"><span title="Estrellas del port más popular">★ ${fmtNum(g.stars)}</span><span title="Último push">⟳ ${ago(g.lastPush)}</span></span>
    </div>
  </button>`;
}

// ---------- detalle ----------
function openGame(id, push = true) {
  const g = state.data.games.find(x => x.id === id);
  if (!g) return;
  const many = g.ports.length > 1;
  const compare = many ? `<div class="compare table-scroll"><table>
      <thead><tr><th>Port</th><th>Estado</th><th>Tipo</th><th>Plataformas</th><th>★</th><th>Commits 7d</th><th>Último push</th><th>Release</th></tr></thead>
      <tbody>${g.ports.map(p => `<tr>
        <td><a href="#port-${esc(p.repo)}" data-scroll>${esc(p.name)}</a></td>
        <td>${badge(p.status)}</td><td>${TYPES[p.type]}</td><td>${plats(p.platforms)}</td>
        <td>${fmtNum(p.gh.stars)}</td><td>${p.gh.commits7d ?? '—'}</td><td>${ago(p.gh.pushedAt)}</td><td>${esc(p.gh.release?.tag || '—')}</td>
      </tr>`).join('')}</tbody></table></div>` : '';
  $('#dlg-body').innerHTML = `
    <div class="dlg-head">
      <div>
        <h2 id="dlg-title">${esc(g.title)}</h2>
        <div class="muted">${esc(g.developer)} · ${g.year}${g.cusa?.length ? ` · ${g.cusa.map(esc).join(', ')}` : ''}</div>
      </div>
      <button class="close" aria-label="Cerrar">✕</button>
    </div>
    <p class="muted">${g.ports.length} port${many ? 's' : ''} conocido${many ? 's' : ''}. Todos requieren un dump de tu propia copia del juego.</p>
    ${compare}
    ${g.ports.map(p => portHtml(g, p)).join('')}`;
  const dlg = $('#game-dialog');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  $('#dlg-body .close').addEventListener('click', () => dlg.close());
  $('#dlg-body').querySelectorAll('[data-scroll]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  if (push) history.replaceState(null, '', `#juego/${g.id}`);
}

function portHtml(g, p) {
  const s = STATUS[p.status];
  const gh = p.gh;
  const li = arr => arr.map(x => `<li>${esc(x)}</li>`).join('');
  const reports = p.reports.length ? `<div class="reports"><h4 class="muted">Reportes de la comunidad (${p.reports.length})</h4>
      <div class="table-scroll"><table><thead><tr><th>Estado</th><th>FPS</th><th>GPU / CPU</th><th>SO</th><th>Ajustes</th><th>Notas</th></tr></thead><tbody>
      ${p.reports.slice(0, 12).map(r => `<tr><td>${badge(r.status)}</td><td>${esc(r.fps)}</td><td>${esc(r.gpu)}<br><span class="muted">${esc(r.cpu)}</span></td>
        <td>${esc(r.os)}</td><td>${esc(r.settings)}</td><td>${esc(r.notes)} <a href="${esc(r.url)}" target="_blank" rel="noopener">#${r.issue}</a></td></tr>`).join('')}
      </tbody></table></div></div>` : '';
  const warn = gh.missing ? `<span class="badge warn" title="El repositorio ya no está disponible en GitHub">Repositorio eliminado o privado</span>` : '';
  const archived = gh.archived ? `<span class="badge warn">Archivado</span>` : '';
  const ai = p.aiAssisted ? `<span class="badge type" title="El autor declara que usó herramientas de IA">Asistido por IA</span>` : '';
  return `<article class="port" id="port-${esc(p.repo)}" style="--status-color:${s.color}">
    <div class="port-head">
      <h3><a href="${ghUrl(p.repo)}" target="_blank" rel="noopener">${esc(p.name)}</a> <span class="muted" style="font-weight:400;font-size:.85rem">${esc(p.repo)}</span></h3>
      ${badge(p.status)}
    </div>
    <div class="tags"><span class="badge type">${TYPES[p.type]}</span>${plats(p.platforms)}${ai}${warn}${archived}</div>
    <p>${esc(p.summary)}</p>
    <dl class="kv">
      <div><dt>Versión del juego</dt><dd>${esc(p.gameVersion)}</dd></div>
      <div><dt>Estrellas</dt><dd>★ ${fmtNum(gh.stars)}</dd></div>
      <div><dt>Issues abiertos</dt><dd>${fmtNum(gh.openIssues)}</dd></div>
      <div><dt>Commits (7 días)</dt><dd>${gh.commits7d ?? '—'}</dd></div>
      <div><dt>Último push</dt><dd>${ago(gh.pushedAt)}</dd></div>
      <div><dt>Última release</dt><dd>${gh.release ? `<a href="${esc(gh.release.url || ghUrl(p.repo) + '/releases')}" target="_blank" rel="noopener">${esc(gh.release.tag)}</a>${gh.release.publishedAt ? ` <span class="muted">${fmtDate(gh.release.publishedAt)}</span>` : ''}` : '—'}</dd></div>
    </dl>
    <div class="cols">
      <div><h4>Rendimiento</h4>${p.performance.length ? `<ul class="perf">${li(p.performance)}</ul>` : '<p class="muted">Sin datos publicados todavía.</p>'}</div>
      <div><h4>Fallos conocidos</h4>${p.issues.length ? `<ul class="bugs">${li(p.issues)}</ul>` : '<p class="muted">No se listan fallos.</p>'}</div>
    </div>
    ${p.features.length ? `<div class="features">${p.features.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
    ${p.base?.length ? `<p class="muted" style="font-size:.82rem;margin:.8rem 0 0">Basado en: ${p.base.map(esc).join(' · ')}</p>` : ''}
    ${reports}
    <div class="port-actions">
      <a class="btn" href="${ghUrl(p.repo)}" target="_blank" rel="noopener">Ver en GitHub</a>
      <a class="btn ghost" href="${ghUrl(p.repo)}/issues" target="_blank" rel="noopener">Issues del port</a>
      <a class="btn ghost" href="${issueUrl('reporte.yml', { title: `[Reporte] ${g.title} — ${p.name}`, juego: g.title, repo: ghUrl(p.repo) })}" target="_blank" rel="noopener">Reportar cómo me anda</a>
    </div>
  </article>`;
}

// ---------- novedades ----------
function renderNews() {
  const ports = state.data.games.flatMap(g => g.ports.map(p => ({ g, p })));
  const created = ports.filter(x => x.p.gh.createdAt).sort((a, b) => b.p.gh.createdAt.localeCompare(a.p.gh.createdAt)).slice(0, 25);
  $('#new-ports').innerHTML = created.map(({ g, p }) => `<li><time>${fmtDate(p.gh.createdAt)}</time><div>
      <button class="linklike" data-game="${esc(g.id)}">${esc(g.title)}</button> ${badge(p.status)}
      <div class="t-sub">${esc(p.name)} · ${esc(p.repo)} · ★ ${fmtNum(p.gh.stars)}</div></div></li>`).join('');
  const rel = ports.filter(x => x.p.gh.release?.publishedAt).sort((a, b) => b.p.gh.release.publishedAt.localeCompare(a.p.gh.release.publishedAt)).slice(0, 25);
  const relNoDate = ports.filter(x => x.p.gh.release && !x.p.gh.release.publishedAt);
  $('#new-releases').innerHTML = (rel.length ? rel : relNoDate).map(({ g, p }) => `<li><time>${fmtDate(p.gh.release.publishedAt)}</time><div>
      <span class="t-title">${esc(p.gh.release.tag)}</span> — <button class="linklike" data-game="${esc(g.id)}">${esc(g.title)}</button>
      <div class="t-sub">${esc(p.name)}${p.gh.release.prerelease ? ' · pre-release' : ''}</div></div></li>`).join('') || '<li class="muted">Sin releases todavía.</li>';
}

// ---------- radar ----------
function renderRadar() {
  const items = state.data.candidates.items || [];
  $('#radar-count').textContent = items.length || '';
  $('#radar-line').textContent = `${items.length} candidato${items.length === 1 ? '' : 's'} · actualizado ${ago(state.data.candidates.generatedAt)}`;
  const gameTitle = id => state.data.games.find(g => g.id === id)?.title;
  $('#radar').innerHTML = items.length ? items.map(c => {
    const gt = c.game && gameTitle(c.game);
    return `<article class="card cand" style="--status-color:${c.kind === 'port' ? 'var(--accent)' : 'var(--line)'}">
      <div class="row"><h3><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.repo)}</a></h3>
        <span class="score" title="${esc((c.reasons || []).join('\n'))}">puntaje ${c.score}</span></div>
      <p class="summary">${esc(c.description || 'Sin descripción')}</p>
      <div class="tags" style="display:flex;gap:6px;flex-wrap:wrap">
        ${c.statusHint && c.statusHint !== 'unknown' ? badge(c.statusHint) : ''}
        ${gt ? `<button class="badge type linklike" data-game="${esc(c.game)}" style="cursor:pointer">${esc(gt)}</button>` : ''}
        ${(c.cusa || []).slice(0, 3).map(x => `<span class="badge type">${esc(x)}</span>`).join('')}
        ${c.kind !== 'port' ? '<span class="badge type">señal débil</span>' : ''}
      </div>
      ${c.fps?.length ? `<div class="muted" style="font-size:.82rem">⚡ ${c.fps.map(esc).join(' · ')}</div>` : ''}
      <div class="row">${plats(c.platforms)}<span class="meta"><span>★ ${fmtNum(c.stars)}</span><span>visto ${ago(c.firstSeen)}</span></span></div>
      <div class="port-actions" style="margin-top:0">
        <a class="btn ghost" href="${issueUrl('nuevo-port.yml', { title: `[Port] ${c.repo}`, repo: c.url, juego: gt || '' })}" target="_blank" rel="noopener">Confirmar como port</a>
      </div>
    </article>`;
  }).join('') : '<p class="empty">El radar no encontró nada nuevo.</p>';
}

// ---------- cómo funciona ----------
function renderAbout(catalog) {
  $('#bases').innerHTML = (catalog.bases || []).map(b => `<li><strong>${b.repo ? `<a href="${ghUrl(b.repo)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</strong> — <span class="muted">${esc(b.role)}</span></li>`).join('');
  $('#legend').innerHTML = Object.entries(STATUS).filter(([k]) => k !== 'unknown').map(([, s]) => `<dt>${badge(Object.keys(STATUS).find(k => STATUS[k] === s))}</dt><dd>${esc(s.desc)}</dd>`).join('');
  $('#btn-new-port').href = issueUrl('nuevo-port.yml');
  $('#btn-report').href = issueUrl('reporte.yml');
}

function renderStats(meta) {
  const games = state.data.games;
  const ports = games.flatMap(g => g.ports);
  const playable = games.filter(g => STATUS[g.bestStatus].rank >= STATUS.playable.rank).length;
  $('#stats').innerHTML = `<span class="stat"><b>${games.length}</b> juegos</span>
    <span class="stat"><b>${ports.length}</b> ports</span>
    <span class="stat"><b>${playable}</b> jugables</span>
    <span class="stat">act. <b>${ago(meta)}</b></span>`;
  $('#updated').textContent = `Métricas de GitHub actualizadas ${ago(meta)} (${fmtDate(meta)}).`;
}

// ---------- navegación ----------
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('juego/')) {
    showTab('juegos');
    openGame(h.slice(6), false);
    return;
  }
  const tab = ['juegos', 'novedades', 'radar', 'como-funciona'].includes(h) ? h : 'juegos';
  showTab(tab);
}
function showTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== `tab-${tab}`; });
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-selected', String(a.dataset.tab === tab)));
}

async function init() {
  const [catalog, github, candidates, reports] = await Promise.all([
    load('catalog.json', { games: [] }),
    load('github.json', { repos: {} }),
    load('candidates.json', { items: [] }),
    load('reports.json', { items: [] }),
  ]);
  state.data = { games: enrich(catalog, github, reports), candidates };
  buildFilters();
  renderStats(github.generatedAt);
  renderGrid();
  renderNews();
  renderRadar();
  renderAbout(catalog);

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-game]');
    if (el) { e.preventDefault(); openGame(el.dataset.game); }
  });
  $('#game-dialog').addEventListener('click', e => { if (e.target.id === 'game-dialog') e.target.close(); });
  $('#game-dialog').addEventListener('close', () => {
    if (location.hash.startsWith('#juego/')) history.replaceState(null, '', '#juegos');
  });
  window.addEventListener('hashchange', route);
  route();
}

init();

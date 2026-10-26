#!/usr/bin/env node
// Actualiza los datos del sitio desde la API de GitHub:
//  1. Métricas de cada repo del catálogo (estrellas, actividad, última release, si fue borrado).
//  2. Radar: busca repos nuevos que parezcan ports a PC de PS4, PS2, PS3 o Xbox 360 y los clasifica.
//  3. Reportes de la comunidad (issues con la etiqueta "reporte" de este repo).
//  4. Actualizaciones importantes (releases con +FPS, funciones nuevas, hitos, repos borrados):
//     se guardan en data/updates.json + data/feed.xml y se avisan comentando los issues "seguir".
// Uso: GITHUB_TOKEN=... node scripts/update.mjs   (en Actions el token viene solo)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEARCH_QUERIES, BASE_REPOS, classify, extractCusa, extractPlatforms, extractFps,
  extractStatus, guessGame, reportFromIssue, dedupeCandidates,
  analyzeRelease, buildAtom, parseIssueForm, repoFromText,
} from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const SELF = process.env.GITHUB_REPOSITORY || 'isidropenh/portal';
const DISCOVERY_DAYS = Number(process.env.DISCOVERY_DAYS || 45);
const CREATE_ISSUE = process.env.CREATE_RADAR_ISSUE === '1';
const NOTIFY = process.env.NOTIFY_UPDATES === '1';
const SITE_URL = process.env.SITE_URL || 'https://isidropenh.github.io/PORTal/';
const MAX_COMMENTS_PER_RUN = 25;

const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return fallback; }
};
const writeJson = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 2) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gh(p, { accept = 'application/vnd.github+json', method = 'GET', body } = {}) {
  const url = p.startsWith('http') ? p : `https://api.github.com${p}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: accept,
        'User-Agent': 'portal-updater',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // 404 borrado, 409 repo vacío, 451 bloqueado por DMCA, 422 búsqueda inválida: no son errores del script.
    if ([404, 409, 410, 422, 451].includes(res.status)) return { status: res.status, data: null };
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 2000 * 2 ** attempt), 65000);
      console.warn(`rate limit en ${p}, esperando ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      if (attempt === 3) throw new Error(`${res.status} ${url}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const data = accept.includes('raw') ? await res.text() : await res.json();
    return { status: res.status, data };
  }
  return { status: 0, data: null };
}

async function readme(repo) {
  const { data } = await gh(`/repos/${repo}/readme`, { accept: 'application/vnd.github.raw' });
  return typeof data === 'string' ? data.slice(0, 40000) : '';
}

// ---------- 1. métricas del catálogo ----------
function portIndex(catalog) {
  const idx = new Map();
  for (const g of catalog.games) for (const p of g.ports) {
    if (!idx.has(p.repo)) idx.set(p.repo, { gameId: g.id, gameTitle: g.title, portName: p.name });
  }
  return idx;
}

async function refreshCatalog(catalog, prev, events) {
  const idx = portIndex(catalog);
  const repos = [...idx.keys()];
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const out = {};
  for (const repo of repos) {
    try {
      out[repo] = await refreshRepo(repo, prev[repo], since, idx.get(repo), events);
    } catch (e) {
      // Un repo con problemas no frena al resto: se conservan sus últimos datos.
      console.warn(`! ${repo}: ${e.message}`);
      out[repo] = { ...(prev[repo] || {}), checkedAt: new Date().toISOString() };
    }
  }
  return out;
}

function event(info, repo, fields) {
  const date = fields.date || new Date().toISOString();
  return {
    id: `${repo}:${fields.type}:${fields.tag || date.slice(0, 10)}`,
    repo, game: info.gameId, gameTitle: info.gameTitle, port: info.portName, date, ...fields,
  };
}

async function refreshRepo(repo, prev, since, info, events) {
  // Solo se comparan datos reales de una corrida anterior; la primera vez es la línea de base.
  const baseline = prev && prev.checkedAt && !prev.seeded;
  const r = await gh(`/repos/${repo}`);
  if (!r.data) {
    // Conservamos lo último conocido y marcamos que el repo desapareció (DMCA, borrado, privado).
    console.warn(`✗ ${repo} no disponible (${r.status})`);
    if (baseline && !prev.missing) {
      events.push(event(info, repo, { type: 'removed', level: 'big', title: `${info.portName}: el repositorio ya no está disponible`,
        highlights: ['Puede haber sido borrado, hecho privado o bajado por DMCA.'], tags: ['eliminado'], url: `https://github.com/${repo}` }));
    }
    return { ...(prev || {}), missing: true, checkedAt: new Date().toISOString() };
  }
  const d = r.data;
  const rel = (await gh(`/repos/${d.full_name}/releases?per_page=1`)).data?.[0];
  const commits = (await gh(`/repos/${d.full_name}/commits?since=${since}&per_page=100`)).data;
  const readmeStatus = extractStatus(await readme(d.full_name).catch(() => ''));

  let analysis = null;
  if (rel) {
    analysis = rel.tag_name === prev?.release?.tag && prev?.release?.features
      ? null
      : analyzeRelease({ name: rel.name || rel.tag_name, body: rel.body || '', tag: rel.tag_name,
          prevTag: prev?.release?.tag, prevFeatures: prev?.release?.features || [] });
  }
  if (baseline && rel && rel.tag_name !== prev.release?.tag && analysis) {
    const first = !prev.release;
    events.push(event(info, repo, {
      type: 'release', tag: rel.tag_name, date: rel.published_at || new Date().toISOString(),
      level: first ? 'big' : analysis.level,
      title: `${info.portName} ${rel.tag_name}${first ? ': primera release' : ''}`,
      highlights: analysis.highlights, tags: analysis.tags, features: analysis.features, url: rel.html_url,
    }));
  }
  // Hito sin release: el README pasa a decir que se puede terminar de principio a fin.
  if (baseline && prev.readmeStatus && prev.readmeStatus !== 'complete' && readmeStatus === 'complete') {
    events.push(event(info, repo, { type: 'milestone', level: 'big', title: `${info.portName}: ahora se puede terminar de principio a fin`,
      highlights: ['El README ahora indica que el juego se completa de principio a fin.'], tags: ['milestone'], url: `https://github.com/${repo}` }));
  }
  if (baseline && prev.missing) {
    events.push(event(info, repo, { type: 'restored', level: 'normal', title: `${info.portName}: el repositorio volvió a estar disponible`,
      highlights: [], tags: [], url: `https://github.com/${repo}` }));
  }

  const result = {
    fullName: d.full_name,
    description: d.description,
    stars: d.stargazers_count,
    forks: d.forks_count,
    openIssues: d.open_issues_count,
    createdAt: d.created_at,
    pushedAt: d.pushed_at,
    archived: d.archived,
    license: d.license?.spdx_id || null,
    topics: d.topics || [],
    release: rel ? {
      tag: rel.tag_name, name: rel.name, publishedAt: rel.published_at, prerelease: rel.prerelease, url: rel.html_url,
      features: analysis ? analysis.allFeatures : prev?.release?.features || [],
    } : null,
    readmeStatus,
    commits7d: Array.isArray(commits) ? commits.length : null,
    missing: false,
    checkedAt: new Date().toISOString(),
  };
  console.log(`✓ ${repo} ★${d.stargazers_count}`);
  return result;
}

// ---------- 2. radar ----------
async function discover(catalog, prevCandidates, ignore, repoMeta) {
  const known = new Set(catalog.games.flatMap(g => g.ports.map(p => p.repo.toLowerCase())));
  for (const r of ignore.repos || []) known.add(r.toLowerCase());
  known.add(SELF.toLowerCase());
  // Las herramientas base (PS2Recomp, ps3recomp, ReXGlue…) se muestran en "Cómo funciona", no en el radar.
  for (const b of catalog.bases || []) if (b.repo) known.add(b.repo.toLowerCase());
  const since = new Date(Date.now() - DISCOVERY_DAYS * 864e5).toISOString().slice(0, 10);
  const seen = new Map();

  for (const q of SEARCH_QUERIES) {
    // Sin fork:true: la búsqueda devuelve solo repos originales; los forks se revisan aparte.
    const query = encodeURIComponent(`${q} pushed:>=${since}`);
    const { data } = await gh(`/search/repositories?q=${query}&sort=updated&per_page=50`);
    for (const it of data?.items || []) seen.set(it.full_name.toLowerCase(), it);
    await sleep(2500); // la API de búsqueda permite ~30 req/min
  }
  for (const base of BASE_REPOS) {
    const baseDesc = (await gh(`/repos/${base}`)).data?.description || '';
    const { data } = await gh(`/repos/${base}/forks?sort=newest&per_page=40`);
    for (const it of data || []) {
      // Los forks sin cambios no aportan; solo los que cambiaron descripción o ganaron estrellas.
      if (it.stargazers_count >= 3 || (it.description && it.description !== baseDesc)) {
        seen.set(it.full_name.toLowerCase(), { ...it, _forkOf: base });
      }
    }
  }

  const prev = new Map((prevCandidates.items || []).map(c => [c.repo.toLowerCase(), c]));
  const items = [];
  for (const [key, it] of seen) {
    if (known.has(key)) continue;
    const old = prev.get(key);
    // No volvemos a bajar el README si no hubo pushes desde la última vez.
    const text = old && old.pushedAt === it.pushed_at && old._readmeHash ? null : await readme(it.full_name).catch(() => '');
    const base = { name: it.name, description: it.description || '', topics: it.topics || [] };
    // Con el README sin cambios se reutiliza el puntaje, pero las reglas de descarte se aplican siempre.
    let cls;
    if (text === null) {
      const quick = classify(base);
      cls = ['port', 'weak'].includes(quick.kind)
        ? { kind: old.kind, score: old.score, reasons: old.reasons, console: old.platform || quick.console }
        : quick;
    } else {
      cls = classify({ ...base, readme: text });
    }
    if (!['port', 'weak'].includes(cls.kind)) continue;
    if (cls.kind === 'weak' && cls.score < 4) continue;
    const blob = `${it.description || ''}\n${text ?? ''}`;
    const cusa = text === null ? old.cusa : extractCusa(blob);
    items.push({
      repo: it.full_name,
      url: it.html_url,
      description: it.description || '',
      stars: it.stargazers_count,
      forks: it.forks_count,
      language: it.language,
      createdAt: it.created_at,
      pushedAt: it.pushed_at,
      forkOf: it._forkOf || (it.fork ? 'fork' : null),
      platform: cls.console || null,
      kind: cls.kind,
      score: cls.score,
      reasons: cls.reasons,
      cusa,
      game: guessGame(catalog, { name: it.name, description: it.description || '', cusa }),
      platforms: text === null ? old.platforms : extractPlatforms(blob),
      fps: text === null ? old.fps : extractFps(blob),
      statusHint: text === null ? old.statusHint : extractStatus(blob),
      firstSeen: old?.firstSeen || new Date().toISOString(),
      _readmeHash: text === null ? old._readmeHash : String(text.length),
    });
  }
  // Lo que ya estaba en el radar se mantiene mientras siga activo, aunque esta vez la búsqueda no lo devuelva.
  for (const [key, old] of prev) {
    if (seen.has(key) || known.has(key)) continue;
    if (!old.pushedAt || old.pushedAt.slice(0, 10) < since) continue;
    // Se reclasifica por si cambiaron las reglas del clasificador.
    const q = classify({ name: old.repo.split('/')[1], description: old.description || '' });
    if (!['spam', 'to-ps4', 'tool', 'mobile', 'other-console'].includes(q.kind)) items.push({ ...old, platform: old.platform || q.console || null });
  }
  const knownDesc = Object.values(repoMeta).map(r => r.description).filter(Boolean);
  const result = dedupeCandidates(items, knownDesc).filter(c => ['port', 'weak'].includes(c.kind));
  result.sort((a, b) => (b.kind === 'port') - (a.kind === 'port') || b.score - a.score || b.stars - a.stars);
  const fresh = result.filter(c => !prev.has(c.repo.toLowerCase()) && c.kind === 'port');
  return { items: result, fresh };
}

async function openRadarIssue(fresh) {
  if (!CREATE_ISSUE || !TOKEN || fresh.length === 0) return;
  const lines = fresh.map(c =>
    `- [ ] [${c.repo}](${c.url}) ★${c.stars} — ${c.description || 'sin descripción'}` +
    (c.cusa.length ? ` · ${c.cusa.join(', ')}` : '') + ` · puntaje ${c.score}`);
  const body = `El radar detectó ${fresh.length} posible(s) port(s) nuevo(s) de PS4 a PC.\n\n` +
    `Revisá cada uno y, si corresponde, agregalo a \`data/catalog.json\` (o a \`data/ignore.json\` si no es un port).\n\n` +
    lines.join('\n') + '\n\n---\n_Generado automáticamente por scripts/update.mjs_';
  const date = new Date().toISOString().slice(0, 10);
  await gh(`/repos/${SELF}/issues`, { method: 'POST', body: { title: `Radar ${date}: ${fresh.length} port(s) nuevo(s)`, body, labels: ['radar'] } });
}

// ---------- 3. reportes ----------
async function fetchReports(catalog) {
  const index = new Map(catalog.games.flatMap(g => g.ports.map(p => [p.repo.toLowerCase(), p.repo])));
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const { data } = await gh(`/repos/${SELF}/issues?labels=reporte&state=all&per_page=100&page=${page}`);
    if (!data?.length) break;
    for (const issue of data) {
      if (issue.pull_request || issue.state_reason === 'not_planned') continue;
      const r = reportFromIssue(issue, index);
      if (r) out.push(r);
    }
    if (data.length < 100) break;
  }
  return out;
}

// ---------- 4. actualizaciones importantes y avisos ----------
async function listIssues(label) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const { data } = await gh(`/repos/${SELF}/issues?labels=${label}&state=open&per_page=100&page=${page}`);
    if (!data?.length) break;
    out.push(...data.filter(i => !i.pull_request));
    if (data.length < 100) break;
  }
  return out;
}

// Issues "seguir": uno por port; quien se suscribe recibe mail y notificación de GitHub.
async function loadFollows(catalog) {
  const known = new Map(catalog.games.flatMap(g => g.ports.map(p => [p.repo.toLowerCase(), p.repo])));
  const items = {};
  for (const issue of await listIssues('seguir')) {
    const f = parseIssueForm(issue.body || '');
    const raw = repoFromText(f['Repositorio del port'] || '') || repoFromText(issue.title.replace(/^\[seguir\]\s*/i, ''));
    const repo = raw && known.get(raw.toLowerCase());
    if (!repo) continue;
    // Si hay duplicados queda el más viejo, que es el que tiene más suscriptores.
    if (!items[repo] || issue.number < items[repo].issue) items[repo] = { issue: issue.number, url: issue.html_url, comments: issue.comments };
  }
  const global = (await listIssues('avisos'))[0];
  return { items, global: global ? { issue: global.number, url: global.html_url } : null };
}

function commentFor(e) {
  const lines = [`### ${e.level === 'big' ? '🚀' : 'ℹ️'} ${e.title}`, ''];
  if (e.gameTitle) lines.push(`**Juego:** ${e.gameTitle}`);
  if (e.features?.length) lines.push(`**Funciones nuevas:** ${e.features.join(', ')}`);
  // El texto viene de notas de terceros: sin HTML y sin @menciones que notifiquen a otra gente.
  if (e.highlights?.length) lines.push('', ...e.highlights.map(h => `- ${h.replace(/[<>]/g, '').replace(/@/g, '@\u200b')}`));
  lines.push('', `[Ver la release](${e.url}) · [Ficha en PORTal](${SITE_URL}#juego/${e.game})`, '', '_Aviso automático de PORTal_');
  return lines.join('\n');
}

// El issue global se crea apenas se activan los avisos, así el sitio siempre tiene a dónde mandar.
async function ensureGlobalIssue(follows) {
  if (follows.global || !NOTIFY || !TOKEN) return;
  const { data } = await gh(`/repos/${SELF}/issues`, { method: 'POST', body: {
    title: '📣 Avisos: actualizaciones importantes de todos los ports',
    labels: ['avisos'],
    body: 'Suscribite a este issue (botón **Subscribe** a la derecha) para recibir un aviso por mail y en la app de GitHub ' +
      'cada vez que un port saca una actualización importante: mejoras de FPS, funciones nuevas, hitos o repos eliminados.\n\n' +
      `Para seguir un solo port, usá el botón "Avisarme" en su ficha de ${SITE_URL}.`,
  } });
  if (data) follows.global = { issue: data.number, url: data.html_url };
}

async function notify(fresh, follows) {
  if (!NOTIFY || !TOKEN) return;
  const big = fresh.filter(e => e.level === 'big');
  if (!big.length) return;
  let budget = MAX_COMMENTS_PER_RUN;
  for (const e of big) {
    const f = follows.items[e.repo];
    if (f && budget-- > 0) await gh(`/repos/${SELF}/issues/${f.issue}/comments`, { method: 'POST', body: { body: commentFor(e) } });
  }
  // Issue global: un solo comentario por corrida con todas las novedades grandes.
  const global = follows.global;
  if (global) {
    const body = `## ${big.length} actualización(es) importante(s)\n\n` + big.map(commentFor).join('\n\n---\n\n');
    await gh(`/repos/${SELF}/issues/${global.issue}/comments`, { method: 'POST', body: { body: body.slice(0, 60000) } });
  }
}

async function main() {
  if (!TOKEN) console.warn('Sin GITHUB_TOKEN: la API limita a 60 req/h, probablemente no alcance.');
  const catalog = readJson('catalog.json');
  const prevGithub = readJson('github.json', { repos: {} });
  const prevCandidates = readJson('candidates.json', { items: [] });
  const ignore = readJson('ignore.json', { repos: [] });

  const events = [];
  const repos = await refreshCatalog(catalog, prevGithub.repos || {}, events);
  writeJson('github.json', { generatedAt: new Date().toISOString(), repos });

  // Novedades: se acumulan sin duplicar y se guardan las 300 más recientes.
  const prevUpdates = readJson('updates.json', { items: [] });
  const seenIds = new Set(prevUpdates.items.map(e => e.id));
  const fresh = events.filter(e => !seenIds.has(e.id));
  const updates = [...fresh, ...prevUpdates.items].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 300);
  writeJson('updates.json', { generatedAt: new Date().toISOString(), items: updates });
  fs.writeFileSync(path.join(DATA, 'feed.xml'), buildAtom(updates, SITE_URL));
  console.log(`novedades: ${fresh.length} nuevas (${fresh.filter(e => e.level === 'big').length} grandes)`);

  // Si una etapa falla, las demás igual se guardan; el error se reporta al final.
  let failed = false;
  try {
    const { items, fresh } = await discover(catalog, prevCandidates, ignore, repos);
    writeJson('candidates.json', { generatedAt: new Date().toISOString(), items });
    console.log(`radar: ${items.length} candidatos (${fresh.length} nuevos)`);
    await openRadarIssue(fresh);
  } catch (e) { failed = true; console.error('radar:', e); }

  try {
    const reports = await fetchReports(catalog);
    writeJson('reports.json', { generatedAt: new Date().toISOString(), items: reports });
    console.log(`reportes: ${reports.length}`);
  } catch (e) { failed = true; console.error('reportes:', e); }
  try {
    const follows = await loadFollows(catalog);
    await ensureGlobalIssue(follows);
    await notify(fresh, follows);
    writeJson('follows.json', { generatedAt: new Date().toISOString(), ...follows });
  } catch (e) { failed = true; console.error('avisos:', e); }
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// Actualiza los datos del sitio desde la API de GitHub:
//  1. Métricas de cada repo del catálogo (estrellas, actividad, última release, si fue borrado).
//  2. Radar: busca repos nuevos que parezcan ports PS4 → PC y los clasifica.
//  3. Reportes de la comunidad (issues con la etiqueta "reporte" de este repo).
// Uso: GITHUB_TOKEN=... node scripts/update.mjs   (en Actions el token viene solo)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEARCH_QUERIES, BASE_REPOS, classify, extractCusa, extractPlatforms, extractFps,
  extractStatus, guessGame, reportFromIssue,
} from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const SELF = process.env.GITHUB_REPOSITORY || 'isidropenh/portal';
const DISCOVERY_DAYS = Number(process.env.DISCOVERY_DAYS || 45);
const CREATE_ISSUE = process.env.CREATE_RADAR_ISSUE === '1';

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
async function refreshCatalog(catalog, prev) {
  const repos = [...new Set(catalog.games.flatMap(g => g.ports.map(p => p.repo)))];
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const out = {};
  for (const repo of repos) {
    try {
      out[repo] = await refreshRepo(repo, prev[repo], since);
    } catch (e) {
      // Un repo con problemas no frena al resto: se conservan sus últimos datos.
      console.warn(`! ${repo}: ${e.message}`);
      out[repo] = { ...(prev[repo] || {}), checkedAt: new Date().toISOString() };
    }
  }
  return out;
}

async function refreshRepo(repo, prev, since) {
  const r = await gh(`/repos/${repo}`);
  if (!r.data) {
    // Conservamos lo último conocido y marcamos que el repo desapareció (DMCA, borrado, privado).
    console.warn(`✗ ${repo} no disponible (${r.status})`);
    return { ...(prev || {}), missing: true, checkedAt: new Date().toISOString() };
  }
  const d = r.data;
  const rel = (await gh(`/repos/${d.full_name}/releases?per_page=1`)).data?.[0];
  const commits = (await gh(`/repos/${d.full_name}/commits?since=${since}&per_page=100`)).data;
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
    release: rel ? { tag: rel.tag_name, name: rel.name, publishedAt: rel.published_at, prerelease: rel.prerelease, url: rel.html_url } : null,
    commits7d: Array.isArray(commits) ? commits.length : null,
    missing: false,
    checkedAt: new Date().toISOString(),
  };
  console.log(`✓ ${repo} ★${d.stargazers_count}`);
  return result;
}

// ---------- 2. radar ----------
async function discover(catalog, prevCandidates, ignore) {
  const known = new Set(catalog.games.flatMap(g => g.ports.map(p => p.repo.toLowerCase())));
  for (const r of ignore.repos || []) known.add(r.toLowerCase());
  const since = new Date(Date.now() - DISCOVERY_DAYS * 864e5).toISOString().slice(0, 10);
  const seen = new Map();

  for (const q of SEARCH_QUERIES) {
    const query = encodeURIComponent(`${q} pushed:>=${since} fork:true`);
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
    const cls = text === null ? { kind: old.kind, score: old.score, reasons: old.reasons } : classify({ ...base, readme: text });
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
    if (old.pushedAt && old.pushedAt.slice(0, 10) >= since) items.push(old);
  }
  items.sort((a, b) => (b.kind === 'port') - (a.kind === 'port') || b.score - a.score || b.stars - a.stars);
  const fresh = items.filter(c => !prev.has(c.repo.toLowerCase()) && c.kind === 'port');
  return { items, fresh };
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

async function main() {
  if (!TOKEN) console.warn('Sin GITHUB_TOKEN: la API limita a 60 req/h, probablemente no alcance.');
  const catalog = readJson('catalog.json');
  const prevGithub = readJson('github.json', { repos: {} });
  const prevCandidates = readJson('candidates.json', { items: [] });
  const ignore = readJson('ignore.json', { repos: [] });

  const repos = await refreshCatalog(catalog, prevGithub.repos || {});
  writeJson('github.json', { generatedAt: new Date().toISOString(), repos });

  // Si una etapa falla, las demás igual se guardan; el error se reporta al final.
  let failed = false;
  try {
    const { items, fresh } = await discover(catalog, prevCandidates, ignore);
    writeJson('candidates.json', { generatedAt: new Date().toISOString(), items });
    console.log(`radar: ${items.length} candidatos (${fresh.length} nuevos)`);
    await openRadarIssue(fresh);
  } catch (e) { failed = true; console.error('radar:', e); }

  try {
    const reports = await fetchReports(catalog);
    writeJson('reports.json', { generatedAt: new Date().toISOString(), items: reports });
    console.log(`reportes: ${reports.length}`);
  } catch (e) { failed = true; console.error('reportes:', e); }
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });

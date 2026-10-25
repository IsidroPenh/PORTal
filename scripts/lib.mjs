// Funciones puras del radar: clasificación de repos, extracción de datos del README
// y parseo de reportes de la comunidad. Sin dependencias para poder testearlas offline.

export const SEARCH_QUERIES = [
  'ps4 "pc port" in:name,description,topics',
  'ps4 "native port" in:name,description,topics',
  'ps4 "runs natively" in:description,readme',
  'ps4 "running natively" in:description,readme',
  'ps4 "port nativo" in:description,readme',
  '"bring your own" dump ps4 windows',
  '"no game files" ps4 linux',
  'CUSA vulkan port in:description,readme',
  'bbport in:description,readme',
  'gow3_pc in:description,readme',
  'SacredFire in:description,readme',
  'PS4RT in:name,description',
  'shadps4 "video core" native in:readme',
  'topic:pc-port topic:ps4',
  'topic:native-port topic:ps4',
  'ps4 recomp in:name,description',
];

// Repos base: sus forks nuevos suelen ser ports de otros juegos.
export const BASE_REPOS = [
  'deadinside28/bloodborne_pc',
  'Supermedo/bloodborne_pc',
  'FelipePrado0/SpartanPort',
  'GetLostIn/CTR-NitroFueled-PC',
];

const SPAM = /torrent|\bcrack(ed)?\b|repack|free[- ]download|download[- ]free|t\.me\/|telegram|mega\.nz|mediafire|full[- ]game|ready[- ]to[- ]play/i;
// Ports HACIA PS4 (homebrew), no desde PS4. Se evalúa solo sobre nombre + descripción.
const TO_PS4 = /goldhen|native ps4 port|ps4 port of|openorbis|jailbroken ps4|jailbroken playstation|for ps4\b|on ps4\b|to ps4\b|para ps4\b|ps4 homebrew|fake ?pkg|\bfpkg\b|orbis homebrew/i;
const TOOL = /\blauncher\b|\bwiki\b|translation(?! layer)|tradu[cç]|localization|mod ?pack|\bmods?\b for|patch for|ultrawide patch|death counter|trainer|cheats?\b|roadmap|cat[aá]log|radar|tracker|directory|research commons|\blist of\b|open list|recompiled[- ]games[- ]list|rich presence|\ba (shadps4 )?mod\b|5\.1 sound|corre[cç][aã]o/i;
// Ports a móviles: no son PC.
const MOBILE = /\bandroid\b|\bios\b|iphone|\bipad\b/i;
const OTHER_CONSOLE = /\b(ps5|ps3|psp|vita|xbox ?360|xbox|switch|wii ?u?|gamecube|n64|nes|snes|dreamcast|saturn|ps2|ps1|psx)\b/i;

const POSITIVE = [
  [/\bps4\b|playstation ?4|\borbis\b/i, 2],
  [/\bnative(ly)?\b|\bnativo\b/i, 2],
  [/pc[- ]port|port (nativo )?(para|for) (pc|windows|linux)|windows port|linux port|runs? natively|running natively|on windows|on linux/i, 3],
  [/\bCUSA\d{5}\b/i, 3],
  [/bbport|bloodborne_pc|gow3_pc|spartanport|sacredfire|ps4rt|\bryty\b|shadgt|video core/i, 2],
  [/bring your own|your own (game |legally obtained )?dump|own dump|no game files|sin archivos del juego|seu pr[oó]prio dump|tu propio dump/i, 2],
  [/\bvulkan\b/i, 1],
  [/recomp|static recompil|decomp/i, 1],
  [/\beboot\.bin\b|param\.sfo|sce_sys/i, 1],
];

export function extractCusa(text = '') {
  return [...new Set((text.match(/\bCUSA\d{5}\b/gi) || []).map(s => s.toUpperCase()))];
}

export function extractPlatforms(text = '') {
  const p = [];
  if (/\bwindows\b|win(10|11)|\.exe\b/i.test(text)) p.push('windows');
  if (/\blinux\b|appimage|steam ?deck|proton/i.test(text)) p.push('linux');
  if (/\bmac ?os\b|apple silicon|\bmetal\b|moltenvk/i.test(text)) p.push('macos');
  return p;
}

export function extractFps(text = '') {
  const out = [];
  const re = /(?:~|about |around |aprox\.? )?(\d{2,3})(?:\s*(?:-|–|to|a)\s*(\d{2,3}))?\s*fps/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 6) {
    const s = m[2] ? `${m[1]}–${m[2]} FPS` : `${m[1]} FPS`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function extractStatus(text = '') {
  const t = text.toLowerCase();
  const COMPLETE = /start to finish|beginning to end|from start to end|de principio a fin|completed? (the|a) (full )?playthrough|can (now )?be finished|whole campaign is playable/;
  // Solo cuenta si la frase no está negada ("not yet playable from start to finish", "sin verificar…").
  const NEGATED = /\b(not|no|never|yet|unverified|untested|todav[ií]a|sin verificar|ainda n[aã]o|n[aã]o)\b/;
  const sentences = t.split(/(?<=[.!?\n])\s*/);
  if (sentences.some(x => COMPLETE.test(x) && !NEGATED.test(x))) return 'complete';
  if (/not playable|doesn'?t run (on it )?yet|does not run yet|no jugable|não jog[aá]vel|research only/.test(t)) return 'research';
  if (/\bplayable\b|\bjugable\b|\bjog[aá]vel\b/.test(t)) return 'playable';
  if (/boots?\b|title screen|menus? work|early (development|alpha)|work in progress|\bwip\b/.test(t)) return 'early';
  return 'unknown';
}

// Devuelve { kind, score, reasons } donde kind ∈ port | to-ps4 | tool | spam | other-console | weak
export function classify({ name = '', description = '', topics = [], readme = '' }) {
  const head = `${name} ${description} ${topics.join(' ')}`;
  const all = `${head}\n${readme.slice(0, 20000)}`;
  const reasons = [];
  if (SPAM.test(head)) return { kind: 'spam', score: -100, reasons: ['palabras de piratería/spam'] };

  let score = 0;
  for (const [re, w] of POSITIVE) {
    if (re.test(head)) { score += w; reasons.push(`+${w} ${re.source.slice(0, 24)}`); }
    else if (re.test(all)) { score += Math.ceil(w / 2); reasons.push(`+${Math.ceil(w / 2)} (readme) ${re.source.slice(0, 24)}`); }
  }

  const mentionsPc = /\b(pc|windows|linux|mac ?os)\b/i.test(head);
  if (TO_PS4.test(head) && !/\bto (pc|windows|linux)|para (pc|windows|linux)|\bon (windows|linux)\b/i.test(head)) {
    return { kind: 'to-ps4', score: score - 10, reasons: [...reasons, 'port hacia PS4 (homebrew)'] };
  }
  if (MOBILE.test(head)) return { kind: 'mobile', score: score - 6, reasons: [...reasons, 'port a móvil'] };
  if (TOOL.test(head)) return { kind: 'tool', score: score - 4, reasons: [...reasons, 'herramienta/mod/launcher'] };

  const other = head.match(OTHER_CONSOLE);
  if (other && !/\bps4\b|playstation ?4/i.test(head)) {
    return { kind: 'other-console', score: score - 6, reasons: [...reasons, `otra consola (${other[0]})`] };
  }
  if (!mentionsPc && !/natively|nativo|native/i.test(head)) score -= 2;
  return { kind: score >= 7 ? 'port' : 'weak', score, reasons };
}

// Agrupa copias: repos con la misma descripción que un port del catálogo se descartan
// (son forks/copias sin cambios) y entre candidatos idénticos queda el de más estrellas.
export function dedupeCandidates(items, knownDescriptions) {
  const key = c => norm(c.description || '');
  const known = new Set([...knownDescriptions].map(d => norm(d || '')).filter(d => d.length >= 15));
  const groups = new Map();
  for (const c of items) {
    const k = key(c);
    if (k.length >= 15 && known.has(k)) continue;
    // Sin descripción y sin estrellas casi siempre es una copia personal; no hay nada que mostrar.
    if (!k && (c.stars || 0) < 3) continue;
    const g = k.length >= 15 ? k : `repo:${c.repo}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  return [...groups.values()].map(arr => {
    arr.sort((a, b) => b.stars - a.stars || String(a.createdAt).localeCompare(String(b.createdAt)));
    return { ...arr[0], copies: arr.length - 1 };
  });
}

// Intenta adivinar el juego: primero por CUSA conocido, luego por título en nombre/descripción.
export function guessGame(catalog, { name = '', description = '', cusa = [] }) {
  for (const g of catalog.games) {
    if (cusa.some(c => (g.cusa || []).includes(c))) return g.id;
  }
  const hay = norm(`${name} ${description}`);
  let best = null;
  for (const g of catalog.games) {
    const t = norm(g.title.replace(/\(.*?\)/g, ''));
    const key = t.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
    if (key && hay.includes(key)) best = g.id;
  }
  return best;
}

export function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Parseo de Issue Forms de GitHub: "### Etiqueta\n\nValor"
export function parseIssueForm(body = '') {
  const out = {};
  const parts = body.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const label = part.slice(0, nl).trim();
    let value = part.slice(nl + 1).trim();
    if (value === '_No response_' || value === 'None') value = '';
    out[label] = value;
  }
  return out;
}

export function repoFromText(s = '') {
  const m = s.match(/github\.com\/([\w.-]+\/[\w.-]+)/i) || s.match(/^\s*([\w.-]+\/[\w.-]+)\s*$/);
  return m ? m[1].replace(/\.git$/, '').replace(/[).,]+$/, '') : null;
}

const STATUS_FROM_FORM = {
  'Completo (de principio a fin)': 'complete',
  'Jugable': 'playable',
  'Jugable con fallos': 'partial',
  'Arranca pero no se puede jugar': 'early',
  'No arranca': 'research',
};

export function reportFromIssue(issue, repoIndex) {
  const f = parseIssueForm(issue.body || '');
  const repoRaw = repoFromText(f['Repositorio del port'] || '');
  if (!repoRaw) return null;
  const repo = repoIndex.get(repoRaw.toLowerCase()) || repoRaw;
  return {
    issue: issue.number,
    url: issue.html_url,
    user: issue.user?.login || null,
    date: issue.created_at,
    repo,
    portVersion: f['Versión del port'] || '',
    status: STATUS_FROM_FORM[f['Estado']] || 'unknown',
    fps: f['FPS promedio'] || '',
    settings: f['Resolución y ajustes'] || '',
    cpu: f['CPU'] || '',
    gpu: f['GPU'] || '',
    os: f['Sistema operativo'] || '',
    notes: (f['Fallos encontrados'] || '').slice(0, 600),
  };
}

// ---------- detector de actualizaciones importantes ----------
// Las notas de release vienen en inglés, español y portugués; las reglas cubren los tres.

const MILESTONE = /start to (finish|end)|beginning to end|full playthrough|whole (game|campaign|story)|ending and credits|can (now )?be (finished|completed|beaten)|de principio a fin|del principio al final|do in[ií]cio ao fim|zerad[oa]|now (fully )?playable|ahora (es )?jugable|agora (é )?jog[aá]vel|first playable/i;
const PERF_STRONG = [
  /\+\s?\d{1,3}\s?%/,
  /\d{1,3}\s?%\s*(more|faster|higher|better|boost|gain|fps|mais|m[aá]s|mejor|maior)/i,
  /\+\s?fps|more fps|higher fps|mais fps|m[aá]s fps|fps (boost|gain|increase)|double[sd]? (the )?fps|2x (fps|faster)/i,
];
const PERF_WEAK = /\bfaster\b|speed ?up|performance|rendimiento|desempenho|optimi[sz]|stutter|travad|tir[oó]n|frame ?(time|pacing)|hitch|smoother|m[aá]s fluido/i;
const FPS_JUMP = /(\d{2,3})\s?(?:fps\s?)?(?:→|->|=>|to|a|para)\s?(\d{2,3})\s?fps/i;
const FIX = /\bfix(e[sd])?\b|crash|corrig|arregl|corre[cç][aã]o|leak|vazamento|fuga de memoria|bug/i;
const FEATURE_LINE = /^(added?|adds|new|novo|nova|nuevo|nueva|agregad[oa]|añadid[oa]|adicionad[oa]|now supports?|support for|soporte (para|de)|suporte (a|para)|introduc|implement)/i;
export const FEATURE_TOKENS = [
  ['FSR 4', /fsr ?4/i], ['FSR 3', /fsr ?3/i], ['DLSS', /\bdlss\b/i], ['XeSS', /\bxess\b/i],
  ['Frame generation', /frame ?gen|gera[cç][aã]o de quadros|generaci[oó]n de (fotogramas|cuadros)|\bfg\b/i],
  ['Ultrawide', /ultra-?wide|21:9|32:9/i], ['4K', /\b4k\b|2160p/i],
  ['60+ FPS', /\b(60|90|120|144|240)\s?fps|unlocked (fps|frame ?rate)|fps (libres|desbloquead)/i],
  ['Online', /\bonline\b|multiplayer|multijugador|multijogador/i], ['Co-op', /co-?op/i],
  ['Teclado y mouse', /keyboard|mouse|teclado|rat[oó]n/i], ['Mods', /\bmods?\b|modding/i],
  ['Launcher', /launcher/i], ['HDR', /\bhdr\b/i], ['VR', /\bvr\b|openxr/i],
  ['Logros', /achievement|troph|conquista|logro/i], ['Ray tracing', /ray ?trac|\brt\b/i],
  ['Linux / Steam Deck', /\blinux\b|steam ?deck|appimage/i], ['macOS', /mac ?os|apple silicon/i],
  ['Nueva región / versión', /cusa\d{5}|european|europe[ao]|region/i],
];

export function versionJump(prevTag, tag) {
  const parse = t => (String(t || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/) || []).slice(1).map(n => Number(n || 0));
  const a = parse(prevTag), b = parse(tag);
  if (!a.length || !b.length) return null;
  if (b[0] > a[0]) return 'major';
  // En proyectos 0.x, subir el segundo número (0.2 → 0.3) suele ser una versión grande.
  if (b[0] === a[0] && b[1] > a[1]) return a[0] === 0 ? 'major' : 'minor';
  if (b[0] === a[0] && b[1] === a[1] && b[2] > a[2]) return 'patch';
  return null;
}

// prevFeatures: funciones que ya mencionaba la release anterior; no cuentan como nuevas.
export function analyzeRelease({ name = '', body = '', tag = '', prevTag = '', prevFeatures = [] }) {
  const text = `${name}\n${body}`.slice(0, 30000);
  const lines = text.split('\n')
    .map(l => l.replace(/^[\s>*\-+•#\d.)]+/, '').replace(/\*\*/g, '').trim())
    .filter(l => l.length > 3 && l.length < 400);

  const tags = new Set();
  const highlights = [];
  const push = l => { const s = l.length > 140 ? l.slice(0, 137) + '…' : l; if (!highlights.includes(s) && highlights.length < 5) highlights.push(s); };

  const milestone = lines.filter(l => MILESTONE.test(l));
  if (milestone.length) { tags.add('milestone'); milestone.slice(0, 1).forEach(push); }

  let perfStrong = false;
  for (const l of lines) {
    const jump = l.match(FPS_JUMP);
    const strong = PERF_STRONG.some(re => re.test(l)) || (jump && Number(jump[2]) >= Number(jump[1]) * 1.2);
    if (strong) { perfStrong = true; tags.add('fps'); push(l); }
  }
  if (!perfStrong && lines.some(l => PERF_WEAK.test(l))) {
    tags.add('rendimiento');
    lines.filter(l => PERF_WEAK.test(l)).slice(0, 1).forEach(push);
  }

  // Funciones nuevas: tokens conocidos en el título/primer tramo + viñetas que empiezan con "Added/Nuevo/…".
  const head = `${name}\n${body.slice(0, 2500)}`;
  const allFeatures = FEATURE_TOKENS.filter(([, re]) => re.test(head)).map(([label]) => label);
  const features = allFeatures.filter(f => !prevFeatures.includes(f));
  const featureLines = lines.filter(l => FEATURE_LINE.test(l));
  if (features.length || featureLines.length) tags.add('funciones');
  featureLines.slice(0, 2).forEach(push);

  const fixes = lines.filter(l => FIX.test(l)).length;
  if (fixes) tags.add('arreglos');
  if (!highlights.length && name) push(name);

  const jump = versionJump(prevTag, tag);
  const big = milestone.length > 0 || perfStrong || features.length >= 3 || featureLines.length >= 3 ||
    (jump === 'major' && (features.length >= 1 || featureLines.length >= 1 || tags.has('rendimiento')));
  return { level: big ? 'big' : 'normal', tags: [...tags], features, allFeatures, fixes, versionJump: jump, highlights };
}

const xml = s => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
export function buildAtom(events, siteUrl) {
  const items = events.filter(e => e.level === 'big').slice(0, 50);
  const updated = items[0]?.date || new Date().toISOString();
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>PORTal: actualizaciones importantes de ports PS4 → PC</title>
  <link href="${xml(siteUrl)}"/>
  <link rel="self" href="${xml(siteUrl)}data/feed.xml"/>
  <id>${xml(siteUrl)}</id>
  <updated>${xml(updated)}</updated>
${items.map(e => `  <entry>
    <title>${xml(e.title)}</title>
    <link href="${xml(e.url || siteUrl)}"/>
    <id>${xml(siteUrl)}#${xml(e.id)}</id>
    <updated>${xml(e.date)}</updated>
    <summary>${xml([e.gameTitle, ...(e.highlights || [])].filter(Boolean).join(' · '))}</summary>
  </entry>`).join('\n')}
</feed>
`;
}

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
const TOOL = /\blauncher\b|\bwiki\b|translation(?! layer)|tradu[cç]|localization|mod ?pack|\bmods?\b for|patch for|ultrawide patch|death counter|trainer|cheats?\b|roadmap|catalog|radar|tracker|directory|research commons/i;
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
  if (/start to finish|beginning to end|from start to end|de principio a fin|completed? (the|a) (full )?playthrough|can be finished|whole campaign is playable/.test(t)) return 'complete';
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
  if (TOOL.test(head)) return { kind: 'tool', score: score - 4, reasons: [...reasons, 'herramienta/mod/launcher'] };

  const other = head.match(OTHER_CONSOLE);
  if (other && !/\bps4\b|playstation ?4/i.test(head)) {
    return { kind: 'other-console', score: score - 6, reasons: [...reasons, `otra consola (${other[0]})`] };
  }
  if (!mentionsPc && !/natively|nativo|native/i.test(head)) score -= 2;
  return { kind: score >= 7 ? 'port' : 'weak', score, reasons };
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

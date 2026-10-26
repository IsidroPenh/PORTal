// Tests offline del clasificador y parsers: node scripts/test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classify, detectConsole, extractCusa, extractFps, extractPlatforms, extractStatus,
  guessGame, parseIssueForm, dedupeCandidates, analyzeRelease, versionJump, buildAtom, repoFromText, reportFromIssue,
} from './lib.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

// Casos reales vistos en GitHub (octubre 2026)
const cases = [
  ['port', { name: 'iss_pc', description: 'Native PC port (Linux/Windows) of inFAMOUS Second Son (PS4, CUSA00223) — in development, playable; runs your own game dump; no game or firmware files included.' }],
  ['port', { name: 'sotcport', description: 'Shadow of the Colossus (PS4, CUSA08809) running natively on Windows — fork of the Bloodborne PC port (bbport) runtime and its shadPS4-based Vulkan renderer' }],
  ['port', { name: 'port-ga-gotoku', description: 'Windows port of Fist of the North Star: Lost Paradise (Hokuto ga Gotoku, PS4), based on bbport. Unofficial, no game files included.' }],
  ['port', { name: 'lego-dimensions-pc', description: 'Unofficial native port of LEGO Dimensions (PS4) to Windows - requires your own dump of the game', topics: ['pc-port', 'ps4', 'vulkan'] }],
  ['to-ps4', { name: 'dusklight-ps4', description: 'Native PS4 port of Dusklight (decomp PC port) – no emulator. Runs on GoldHEN at up to 60 FPS with PlayStation buttons.' }],
  ['to-ps4', { name: 'shipofharkinian-ps4', description: 'Experimental native PS4 port of Ship of Harkinian (Ocarina of Time PC port). No ROM or Sony binaries included.', readme: 'Build a fake PKG for your jailbroken PS4 with OpenOrbis.' }],
  ['spam', { name: 'god-of-war-3-remastered-PC-CUSA01623-extracted-ready-to-play-T.ME-SUP232-torrent-download', description: 'T.ME/SUP232' }],
  ['tool', { name: 'gow3_pclauncher', description: 'Launcher for God Of War 3 PC on Linux and Windows' }],
  ['tool', { name: 'bbport-wiki', description: 'Fan wiki for the bbport - the unofficial Bloodborne PC port: install guides, FPS, online play and shadPS4 comparison.' }],
  ['mobile', { name: 'gow3_android', description: 'Native Android port of God of War III Remastered (PS4).' }],
  ['tool', { name: 'recompiled-games-list', description: 'Open list of fan projects that turn console games into native PC programs' }],
  ['tool', { name: 'Gatito-Ports', description: 'Catálogo de ports (ARM + PC), ferramentas e docs — BYO data, sem jogos' }],
  ['port', { name: 'ratchet-clank-pc', description: 'Ratchet & Clank (PS4, 2016) running natively on Linux. Playable, experimental. Built on bbport' }],
  ['tool', { name: 'BBSC', description: 'Bloodborne Seamless Co-op: a shadPS4 mod that keeps co-op alive' }],
  ['tool', { name: 'bloodborne-rpc', description: 'A lightweight, standalone Discord Rich Presence companion for Bloodborne PC' }],
  ['mobile', { name: 'peggle2-nx', description: 'Peggle 2 (Xbox Live Arcade) running natively on Nintendo Switch: static recompilation' }],
  ['port', { name: 'wet-recomp', description: 'Fan PC port of WET (Xbox 360) using ReXGlue. Does not include game files.' }],
  ['port', { name: 'god-of-war-recomp', description: 'Native PC port of God of War (PS2, SCUS-97399) via PS2Recomp static recompilation for Windows' }],
  ['port', { name: 'inFAMOUSreborn', description: 'Static recompilation of inFAMOUS (PS3) to native Windows using ps3recomp' }],
  ['other-console', { name: 'OpenTricky', description: 'Unofficial PC port of SSX Tricky via static recompilation of the Xbox version' }],
  ['other-console', { name: 'mario64-recomp', description: 'Super Mario 64 (N64) native PC port' }],
  ['tool', { name: 'pcsx2-gow-patches', description: 'PCSX2 fork with widescreen patches for God of War PS2' }],
  ['mobile', { name: 'gta4-ps5', description: 'Grand Theft Auto IV (Xbox 360) port that runs on jailbroken PS5' }],
];
t('detectConsole', () => {
  assert.equal(classify({ name: 'x', description: 'Sonic Unleashed (Xbox 360) recompiled for PC' }).console, 'x360');
  assert.equal(classify({ name: 'x', description: 'Demon\'s Souls PS3 native PC port, BLUS30443' }).console, 'ps3');
  assert.equal(classify({ name: 'x', description: 'Ratchet & Clank PS2 port to Rust, SCES-50916' }).console, 'ps2');
  assert.equal(classify({ name: 'x', description: 'Bloodborne CUSA03173 native Windows port' }).console, 'ps4');
});
for (const [kind, repo] of cases) {
  t(`classify ${repo.name} → ${kind}`, () => assert.equal(classify(repo).kind, kind, JSON.stringify(classify(repo))));
}

t('dedupeCandidates', () => {
  const mk = (repo, stars, description) => ({ repo, stars, description, createdAt: '2026-10-01' });
  const out = dedupeCandidates([
    mk('a/copy1', 0, 'Native Windows port of Shadow of the Colossus (PS4) - bring your own dump'),
    mk('b/new', 3, 'Ratchet & Clank (PS4) running natively on Linux'),
    mk('c/new-copy', 9, 'Ratchet & Clank (PS4) running natively on Linux'),
    mk('d/nodesc', 0, ''),
    mk('e/nodesc-popular', 5, ''),
  ], ['Native Windows port of Shadow of the Colossus (PS4) - bring your own dump']);
  assert.deepEqual(out.map(c => [c.repo, c.copies]).sort(), [['c/new-copy', 1], ['e/nodesc-popular', 0]]);
});
t('extractCusa', () => assert.deepEqual(extractCusa('needs cusa03173 and CUSA00900, CUSA03173'), ['CUSA03173', 'CUSA00900']));
t('extractFps', () => assert.deepEqual(extractFps('About 90 FPS at 4K, 42–60 fps in races, ~60fps'), ['90 FPS', '42–60 FPS', '60 FPS']));
t('extractPlatforms', () => assert.deepEqual(extractPlatforms('Windows 10/11 and a Linux AppImage; macOS planned'), ['windows', 'linux', 'macos']));
t('extractStatus complete', () => assert.equal(extractStatus('Tested and playable from start to finish'), 'complete'));
t('extractStatus negado no es completo', () => assert.equal(extractStatus('Playable, but not yet verified from start to finish.'), 'playable'));
t('extractStatus research', () => assert.equal(extractStatus("The game doesn't run on it yet"), 'research'));
t('extractStatus playable', () => assert.equal(extractStatus('Experimental, playable through chapter 4'), 'playable'));
t('guessGame por CUSA', () => assert.equal(guessGame(catalog, { cusa: ['CUSA08809'] }), 'shadow-of-the-colossus'));
t('guessGame por título', () => assert.equal(guessGame(catalog, { name: 'x', description: 'Bloodborne on Windows' }), 'bloodborne'));
t('repoFromText', () => {
  assert.equal(repoFromText('https://github.com/HayatoG/iss_pc'), 'HayatoG/iss_pc');
  assert.equal(repoFromText('  HayatoG/iss_pc '), 'HayatoG/iss_pc');
  assert.equal(repoFromText('cualquier cosa'), null);
});

const body = `### Juego\n\ninFAMOUS Second Son\n\n### Repositorio del port\n\nhttps://github.com/hayatog/ISS_PC\n\n### Versión del port\n\n_No response_\n\n### Estado\n\nJugable con fallos\n\n### FPS promedio\n\n45\n\n### Resolución y ajustes\n\n1440p FSR\n\n### CPU\n\nRyzen 5 5600\n\n### GPU\n\nRX 6700 XT\n\n### Sistema operativo\n\nLinux\n\n### Fallos encontrados\n\nParpadeo en el agua`;
t('parseIssueForm', () => {
  const f = parseIssueForm(body);
  assert.equal(f['Juego'], 'inFAMOUS Second Son');
  assert.equal(f['Versión del port'], '');
});
t('reportFromIssue normaliza repo', () => {
  const index = new Map([['hayatog/iss_pc', 'HayatoG/iss_pc']]);
  const r = reportFromIssue({ number: 3, html_url: 'u', body, created_at: '2026-10-21', user: { login: 'a' } }, index);
  assert.equal(r.repo, 'HayatoG/iss_pc');
  assert.equal(r.status, 'partial');
  assert.equal(r.gpu, 'RX 6700 XT');
});

// Notas de release reales (portugués, inglés) y casos sintéticos
const rel = (name, body, tag, prevTag, prevFeatures) => analyzeRelease({ name, body, tag, prevTag, prevFeatures });
t('release: +FPS en portugués es grande', () => {
  const r = rel('v0.60.5 — Seletor de texturas, menu F1, +FPS, vazamento de memória', '- +12% FPS em áreas abertas', 'v0.60.5', 'v0.60.4');
  assert.equal(r.level, 'big'); assert.ok(r.tags.includes('fps'));
});
t('release: varias funciones nuevas es grande', () => {
  const r = rel('v0.4 - new launcher with Controls and Achievements, European edition, FSR 4, frame generation and ultrawide', '', 'v0.4', 'v0.3');
  assert.equal(r.level, 'big'); assert.ok(r.features.includes('FSR 4') && r.features.includes('Ultrawide'));
});
t('release: funciones que ya tenía no cuentan', () => {
  const r = rel('v0.5', 'Supports FSR 4, frame generation and ultrawide. Fixed a crash.', 'v0.5', 'v0.4', ['FSR 4', 'Frame generation', 'Ultrawide']);
  assert.equal(r.level, 'normal'); assert.deepEqual(r.features, []);
});
t('release: hito de principio a fin es grande', () => assert.equal(rel('0.60.3', 'The game can now be finished from start to end.', '0.60.3', '0.60.2').level, 'big'));
t('release: solo arreglos es normal', () => assert.equal(rel('1.2.1', '- Fix crash on AMD\n- Fix typo', '1.2.1', '1.2.0').level, 'normal'));
t('release: salto de FPS 30 → 60', () => assert.equal(rel('0.3', 'Gameplay now runs 30 → 60 fps on most GPUs', '0.3.1', '0.3.0').level, 'big'));
t('release: arreglos que nombran funciones no son funciones nuevas', () => {
  const body = '### Fixes\n- Fixed overexposed SDR races (HDR off)\n- Fixed mouse input in the launcher\n- Fixed Linux build\n- Fixed a crash on Windows\n- CUSA05670 is now marked as tested';
  const r = rel('WipEout Omega Collection PC — v0.2.2', body, 'windows-v0.2.2', 'windows-v0.2.1', []);
  assert.equal(r.level, 'normal', JSON.stringify(r)); assert.deepEqual(r.features, []);
});
t('release: viñetas bajo "New features" cuentan', () => {
  const r = rel('v1.1', '## New features\n- Online races\n- HDR output\n- 21:9 ultrawide\n## Fixes\n- Fixed crash', 'v1.1', 'v1.0', []);
  assert.equal(r.level, 'big'); assert.deepEqual(r.features.sort(), ['HDR', 'Online', 'Ultrawide']);
});
t('versionJump', () => {
  assert.equal(versionJump('v0.3', 'v0.4'), 'major');
  assert.equal(versionJump('1.2.0', '1.3.0'), 'minor');
  assert.equal(versionJump('v0.60.4', 'v0.60.5'), 'patch');
  assert.equal(versionJump(null, 'v1'), null);
});
t('buildAtom escapa y solo incluye grandes', () => {
  const x = buildAtom([{ id: 'a', level: 'big', title: 'A <b>&', date: '2026-10-25T00:00:00Z', url: 'u' }, { id: 'b', level: 'normal', title: 'B', date: '2026-10-24T00:00:00Z' }], 'https://s/');
  assert.ok(x.includes('A &lt;b&gt;&amp;')); assert.ok(!x.includes('<title>B</title>'));
});

t('catálogo: estados, tipos y plataformas válidos', () => {
  const S = ['complete', 'playable', 'partial', 'early', 'research'];
  const T = ['native', 'recomp', 'decomp', 'reimpl', 'wrapper'];
  const C = ['ps4', 'ps2', 'ps3', 'x360'];
  const P = ['windows', 'linux', 'macos'];
  const ids = new Set();
  for (const g of catalog.games) {
    assert.ok(!ids.has(g.id), `id duplicado ${g.id}`); ids.add(g.id);
    assert.ok(C.includes(g.platform), `${g.id} platform ${g.platform}`);
    for (const p of g.ports) {
      assert.ok(S.includes(p.status), `${p.repo} status ${p.status}`);
      assert.ok(T.includes(p.type), `${p.repo} type ${p.type}`);
      assert.ok(p.platforms.every(x => P.includes(x)), `${p.repo} platforms`);
      assert.match(p.repo, /^[\w.-]+\/[\w.-]+$/);
    }
  }
});

console.log(`\n${n} tests OK`);

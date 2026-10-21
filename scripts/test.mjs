// Tests offline del clasificador y parsers: node scripts/test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classify, extractCusa, extractFps, extractPlatforms, extractStatus,
  guessGame, parseIssueForm, repoFromText, reportFromIssue,
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
  ['other-console', { name: 'wet-recomp', description: 'Fan PC port of WET (Xbox 360) using ReXGlue. Does not include game files.' }],
];
for (const [kind, repo] of cases) {
  t(`classify ${repo.name} → ${kind}`, () => assert.equal(classify(repo).kind, kind, JSON.stringify(classify(repo))));
}

t('extractCusa', () => assert.deepEqual(extractCusa('needs cusa03173 and CUSA00900, CUSA03173'), ['CUSA03173', 'CUSA00900']));
t('extractFps', () => assert.deepEqual(extractFps('About 90 FPS at 4K, 42–60 fps in races, ~60fps'), ['90 FPS', '42–60 FPS', '60 FPS']));
t('extractPlatforms', () => assert.deepEqual(extractPlatforms('Windows 10/11 and a Linux AppImage; macOS planned'), ['windows', 'linux', 'macos']));
t('extractStatus complete', () => assert.equal(extractStatus('Tested and playable from start to finish'), 'complete'));
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

t('catálogo: estados, tipos y plataformas válidos', () => {
  const S = ['complete', 'playable', 'partial', 'early', 'research'];
  const T = ['native', 'recomp', 'decomp', 'reimpl', 'wrapper'];
  const P = ['windows', 'linux', 'macos'];
  const ids = new Set();
  for (const g of catalog.games) {
    assert.ok(!ids.has(g.id), `id duplicado ${g.id}`); ids.add(g.id);
    for (const p of g.ports) {
      assert.ok(S.includes(p.status), `${p.repo} status ${p.status}`);
      assert.ok(T.includes(p.type), `${p.repo} type ${p.type}`);
      assert.ok(p.platforms.every(x => P.includes(x)), `${p.repo} platforms`);
      assert.match(p.repo, /^[\w.-]+\/[\w.-]+$/);
    }
  }
});

console.log(`\n${n} tests OK`);

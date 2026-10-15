// 대결의 **모드**(통상 / 변형 · 변신(NT-D) · 시스템 발동(트랜잠))가 셈에 들어가는가 — 실측.
//   node tools/duelform_check.js
//
// ■ 왜 — 2026-10-15 사용자: 「나 혹은 상대가 변형 스킬(가변, NTD, 트란잠 시스템 등)을 켰을 때의
//   공격 수치가 반영이 안 됨」. 대결은 calcStats 에 form 자리로 null 을 넘기고 방어 스킬 · 경직 ·
//   공중 격투도 'normal' 로 박아, 모드를 바꿀 수단이 아예 없었다. 유니콘 NT-D 는 사격 46 → 13 ·
//   격투 22 → 65, 더블오 라이저 트랜잠은 사격 46 → 61 · 격투 30 → 60 인데 늘 통상으로 셌다.
// ■ 자 — 기대값은 **core 로 따로** 센다(앱의 셈을 베끼지 않는다). 무장 목록은 원문(＜変身時＞ 등)을
//   직접 읽어 「그 모드에서 못 쓰는 무장이 목록에 있는가」 를 본다.
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = require('./lib/duelgate.js');

let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.split(path.sep).join('/').split(' ').join('%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const C = require(path.join(ROOT, 'src', 'core.js'));
const MS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const PARTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parts.json'), 'utf8'));
const FULL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fullst.json'), 'utf8'));
const top = base => MS.filter(m => m.MS名.replace(/_LV\d+$/, '') === base)
  .sort((a, b) => C.msLevel(b.MS名) - C.msLevel(a.MS名))[0];

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1500, height: 1300, deviceScaleFactor: 1 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2400);

  /* 앱 안의 기체 객체에는 override(_altMode · 트랜잠 절대값)가 들어 있다 — 기대값은 그 객체로 센다 */
  const appMs = base => pg.evaluate(base => {
    const all = window.GBO2_DATA.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === base);
    return all.sort((a, b) => window.GBO2Core.msLevel(b.MS名) - window.GBO2Core.msLevel(a.MS名))[0];
  }, base);
  const want = async (base, form) => {
    const m = await appMs(base);
    const t = C.calcStats(m, [], 6, C.EXPANSION_NONE, PARTS, FULL, null, form, null).total;
    return { shoot: Math.round(t.shoot), melee: Math.round(t.meleeCorrection) };
  };
  const now = () => pg.evaluate(() => {
    const S = window.GBO2Duel.state, a = window.GBO2Duel.attack(S.L, S.R);
    return a && { corr: Math.round(a.corr), per: a.per, melee: !!a.wp.melee, name: a.wp.w.name, form: S.L.form,
      btns: [...document.querySelectorAll('.duel-side[data-side="L"] .ds-form .seg-btn')].map(b => b.textContent) };
  });

  /* ① 보정이 모드를 따른다 — 사격(더블오 라이저 · 트랜잠), 격투(유니콘 · NT-D) */
  for (const [base, melee, label] of [['ダブルオーライザー', false, '더블오 라이저 사격'], ['ユニコーンガンダム', true, '유니콘 격투']]) {
    const n = await G.measure(pg, { me: base, foe: 'ザクⅡ', melee });
    const a = await now();
    const t = await G.measure(pg, { me: base, foe: 'ザクⅡ', melee, form: 'transform' });
    const b = await now();
    const wn = await want(base, 'normal'), wt = await want(base, 'transform');
    const k = melee ? 'melee' : 'shoot';
    if (n.오류 || t.오류 || !a || !b) { ok(label + ' — 잴 무장을 골랐다', false, { n, t }); continue; }
    ok(label + ' — 모드 단추가 있다 (' + a.btns.join(' / ') + ')', a.btns.length === 2, a.btns);
    ok(label + ' 보정 — 통상 ' + a.corr + ' = core ' + wn[k], a.corr === wn[k], { 화면: a, core: wn });
    ok(label + ' 보정 — 변신 ' + b.corr + ' = core ' + wt[k] + '   (was 늘 통상 ' + wn[k] + ')', b.corr === wt[k] && wt[k] !== wn[k], { 화면: b, core: wt });
  }

  /* ② 무장 목록 — 원문이 그 모드를 빼는 무장은 목록에 없다 */
  const listOf = async (base, form) => {
    await G.measure(pg, { me: base, foe: 'ザクⅡ', form });
    return pg.evaluate(() => window.GBO2Duel.weaponsOf(window.GBO2Duel.state.L).map(x => x.w.name + '|' + ((x.w.info && x.w.info['備考']) || '')));
  };
  const modeOf = note => {
    const m = /^\s*[＜<]([^＞>]+)[＞>]/.exec(note);
    if (!m) return null;
    const parts = m[1].replace(/使用可$/, '').split(/[/／]/);
    return { normal: parts.some(x => /^通常/.test(x.trim())), alt: parts.some(x => x.trim() && !/^通常/.test(x.trim())) };
  };
  for (const base of ['ユニコーンガンダム', 'ダブルオーライザー']) {
    const ln = await listOf(base, 'normal'), lt = await listOf(base, 'transform');
    const badN = ln.filter(x => { const m = modeOf(x.split('|')[1]); return m && !m.normal; });
    const badT = lt.filter(x => { const m = modeOf(x.split('|')[1]); return m && !m.alt; });
    ok(base + ' — 통상 목록에 변신 전용 무장이 없다 (' + ln.length + '개)', badN.length === 0, badN.map(x => x.split('|')[0]));
    ok(base + ' — 변신 목록에 통상 전용 무장이 없다 (' + lt.length + '개)', badT.length === 0, badT.map(x => x.split('|')[0]));
    ok(base + ' — 두 목록이 실제로 다르다 (모드에 따라 바뀐다)', JSON.stringify(ln) !== JSON.stringify(lt), { 통상: ln.length, 변신: lt.length });
  }

  /* ③ 맞는 쪽이 변신하면 방어 스킬도 그 모드 값 — 밴시 노른 A·아머 DE 40% ↔ 50% */
  const chips = async foeForm => {
    await G.measure(pg, { me: 'ザクⅡ', foe: 'バンシィ・ノルン', foeForm });
    return pg.evaluate(() => [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.def')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  };
  const cn = await chips('normal'), ct = await chips('transform');
  ok('맞는 쪽 변신 — 방어 스킬 칩이 그 모드 것으로 바뀐다 (밴시 노른)', cn.length > 0 && ct.length > 0 && JSON.stringify(cn) !== JSON.stringify(ct), { 통상: cn, 변신: ct });

  /* ④ 모드가 없는 기체에는 단추가 없다 */
  await G.measure(pg, { me: 'ザクⅡ', foe: 'ザクⅡ' });
  const noBtn = await pg.evaluate(() => document.querySelectorAll('.duel-side[data-side="L"] .ds-form').length);
  ok('모드가 없는 기체(자쿠Ⅱ)에는 모드 단추가 없다', noBtn === 0, noBtn);

  /* ⑤ 앱에서 변신 화면을 보며 짠 구성을 가져오면 변신으로 온다 */
  await pg.evaluate(() => window.GBO2Duel.close());
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2400);
  /* 카드는 data-ms(원래 이름)로 고른다 — 한글 글자로 찾으니 「유니콘 건담 PF」 를 골랐다(모드 없는 기체) */
  await pg.evaluate(() => {
    const q = document.querySelector('#msQuery'); q.value = 'ユニコーンガンダム'; q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(600);
  const picked = await pg.evaluate(() => {
    const c = [...document.querySelectorAll('#msList .ms-card')].find(e => /^ユニコーンガンダム_LV\d+$/.test(e.dataset.ms || ''));
    if (c) c.click();
    return c ? c.dataset.ms : null;
  });
  ok('가져오기 시험용 기체(유니콘 건담)를 골랐다', !!picked, picked);
  await sleep(700);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1000);
  const flipped = await pg.evaluate(() => {
    const b = [...document.querySelectorAll('#formSeg .seg-btn')].find(x => x.textContent !== '통상');
    if (b) b.click();
    return !!b;
  });
  await sleep(500);
  await pg.evaluate(() => document.getElementById('duelBtn').click());
  await sleep(1200);
  const seeded = await pg.evaluate(() => ({ form: window.GBO2Duel.state.L.form, ms: (window.GBO2Duel.state.L.ms || {}).MS名 }));
  ok('앱에서 변신 화면을 보다가 대결을 열면 왼쪽이 변신으로 온다', flipped && seeded.form === 'transform', { flipped, seeded });

  ok('콘솔 오류가 없다', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

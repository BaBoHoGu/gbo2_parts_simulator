// 대결의 「4분 경과」 — 체크가 보이고, 진짜로 누르면 양쪽 피해가 4분 뒤 값으로 바뀌는가.
//   node tools/duel_late_check.js        (먼저 node tools/build.js)
//
// ■ 왜 — 교육형 컴퓨터의 4분 뒤 값을 넣으면서 대결은 앱 화면의 체크를 따라가게만 했는데,
//   대결 안에는 체크가 없었고, 앱 화면의 체크는 **내 구성에** 해당 파츠가 있을 때만 보여
//   상대 쪽 교육형은 켤 길이 없었다(2026-10-20 사용자 지적). 4분은 한 판의 시간이라 양쪽 공통이다.
// ■ 자 — 사자비(교육형) vs 돔(교육형[特格]). 나는 사격, 상대는 격투. 값은 GBO2Duel.attack() 결과로 잰다.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const GBO2Browser = require('./lib/browser.js');
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
const ok = (l, g, x) => { console.log((g ? '  PASS ' : '  FAIL ') + l + (!g && x !== undefined ? '  — ' + JSON.stringify(x) : '')); g ? pass++ : fail++; };

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2500);
  const setup = parts => pg.evaluate(async ([mine, foe]) => {
    const G = window.GBO2_DATA, D = window.GBO2Duel, S = D.state;
    const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
    const part = n => Object.values(G.parts).flat().find(p => p.name === n);
    D.open(); await new Promise(r => setTimeout(r, 300));
    S.L.ms = by('サザビー'); S.R.ms = by('ドム'); S.L.parts = mine.map(part); S.R.parts = foe.map(part);
    S.L.buffs.clear(); S.R.buffs.clear(); S.L.defs.clear(); S.R.defs.clear();
    const wl = D.weaponsOf(S.L).find(x => !x.melee), wr = D.weaponsOf(S.R).find(x => x.melee);
    S.L.wKey = wl && wl.key; S.R.wKey = wr && wr.key;
    D.open();                      // 열려 있으면 다시 그리기만 한다
    await new Promise(r => setTimeout(r, 300));
  }, parts);
  const look = () => pg.evaluate(() => {
    const D = window.GBO2Duel, S = D.state, a = D.attack(S.L, S.R), d = D.attack(S.R, S.L);
    return { a: a && a.hit, ap: a && a.partPct, d: d && d.hit, dp: d && d.partPct, box: !!document.querySelector('.dc-late') };
  });

  await setup([[], []]);
  const none = await look();
  ok('해당 파츠가 없으면 「4분 경과」 체크가 안 보인다', none.box === false, none);
  await setup([['教育型コンピューター_LV1'], ['教育型コンピューター[特格]_LV1']]);
  const early = await look();
  ok('어느 쪽이든 교육형을 달면 체크가 보인다', early.box === true, early);
  ok('끄면 초반 값 — 나 +3% · 상대 격투 +5%', early.ap === 3 && early.dp === 5, early);
  /* 진짜로 누른다(elementFromPoint 로 닿는지 먼저) */
  const reach = await pg.evaluate(() => {
    const b = document.querySelector('.dc-late input'); if (!b) return 'no';
    const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return h === b || (h && h.closest('.dc-late')) ? 'ok' : (h ? h.tagName + '.' + h.className : 'null');
  });
  ok('체크가 눌리는 자리에 있다', reach === 'ok', reach);
  const box = await pg.$('.dc-late input');
  if (box) { await box.click(); await sleep(400); }
  const late = await look();
  ok('켜면 4분 뒤 값 — 나 +8% · 상대 격투 +8%', late.ap === 8 && late.dp === 8, late);
  ok('켜면 내 피해가 오른다 (×1.08 / ×1.03)', late.a > early.a && Math.abs(late.a / early.a - 1.08 / 1.03) < 0.01, { early: early.a, late: late.a });
  /* 상대 격투 피해: 상대 [特格] +5→+8%, 내 교육형 경감 −3→−8% — 둘 다 바뀐 값과 맞는가 */
  const want = (1.08 * 0.92) / (1.05 * 0.97);
  ok('켜면 상대 격투 피해가 4분 뒤 값으로 (×1.08×0.92 / ×1.05×0.97)', Math.abs(late.d / early.d - want) < 0.01, { early: early.d, late: late.d, 비: (late.d / early.d).toFixed(4), 기대: want.toFixed(4) });
  ok('스크립트 오류 없음', errs.length === 0, errs);
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

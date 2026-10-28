// 대결 — 이 LV 위력이 위키에 없는 무장을 뺐다고 화면에 밝히는가(윙 건담 제로 LV2) · LV1 은 안 뜨는가.
//   node tools/duel_missing_check.js   (먼저 node tools/build.js)
// 예전엔 조용히 빠져 「무장이 왜 없지」 가 됐다(2026-10-28 점검: 9칸 · 5기). 다른 LV 값을 빌려 쓰지는 않는다.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const B = require(ROOT + '/tools/lib/browser.js');
const { findChrome } = require(ROOT + '/tools/lib/wiki_fetch.js');
const FILE = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
(async () => {
  const br = await B.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.setViewport({ width: 1500, height: 950 });
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await pg.waitForFunction(() => window.GBO2Duel && window.GBO2UiTest, { timeout: 60000 });
  const r = await pg.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ms = window.GBO2UiTest.msData();
    const out = {};
    for (const lv of [1, 2]) {
      const m = ms.find(x => x.MS名.normalize('NFC') === 'ウイングガンダムゼロ_LV' + lv);
      const list = window.GBO2Duel.weaponsOf({ ms: m });
      out['LV' + lv] = { 무장: list.length, 뺀것: (list.missing || []).map(x => x.w.name) };
    }
    // 화면에 실제로 그리기 — 대결을 열고 왼쪽 기체를 LV2 로
    window.GBO2Duel.open(); await wait(600);
    const S = window.GBO2Duel.state, side = S.A || S.a || S.left || Object.values(S).find(v => v && typeof v === 'object' && 'ms' in v);
    side.ms = ms.find(x => x.MS名.normalize('NFC') === 'ウイングガンダムゼロ_LV2');
    window.GBO2Duel.close(); await wait(200); window.GBO2Duel.open(); await wait(800);
    out.화면 = [...document.querySelectorAll('.ds-block .ds-empty')].map(e => e.textContent).filter(t => /뺀 무장/.test(t));
    return out;
  });
  let pass = 0, fail = 0; const ok = (l, c, x) => { if (c) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l + '  ' + JSON.stringify(x)); } };
  ok('LV1 은 뺀 무장이 없다', r.LV1 && r.LV1.뺀것.length === 0, r.LV1);
  ok('LV2 는 위력이 없는 ZERO 시스템 무장을 뺀 것으로 센다', r.LV2 && r.LV2.뺀것.some(n => /ZEROシステム/.test(n)), r.LV2);
  ok('뺀 무장을 화면에 밝힌다', r.화면.length === 1 && /ZERO/.test(r.화면[0]), r.화면);
  ok('스크립트 오류 없음', !errs.length, errs.slice(0, 2));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exitCode = fail ? 1 : 0;
  await br.close();
})();

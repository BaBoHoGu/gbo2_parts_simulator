// 원본이 기체 이름을 바꿨을 때 — 데이터가 새 이름으로 이어졌는가 · 옛 이름으로 저장한 구성이 살아 있는가.
//   node tools/msrename_check.js        (먼저 node tools/build.js)
//
// ■ 왜 — gbo2.jp 가 2026-11-05 에 「クロスボーン・ガンダムＸ-０」 를 「X-0」(반각)으로 바꿨다.
//   기체는 이름 전체로 찾으므로, 스킬 · 번역 · 저장 구성이 옛 이름에 묶인 채면 말없이 사라진다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require('../src/core.js');
let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const base = n => n.replace(/_LV\d+$/, '');
const msData = rd('data', 'msData.json').map(m => String(m.MS名).normalize('NFC'));
const skills = rd('data', 'ms_skills.json');
const auto = rd('data', 'i18n', 'ms.auto.json'), manual = rd('data', 'i18n', 'ms.json');
const pairs = Object.entries(C.MS_RENAMED);
ok('이름 변경 표가 비어 있지 않다', pairs.length > 0);
for (const [o, n] of pairs) {
  ok(n + ' 가 원본에 있다', msData.includes(n));
  ok(o + ' 는 원본에 없다(있으면 두 기체를 하나로 합치는 것이다)', !msData.includes(o));
  ok(n + ' 의 스킬이 새 이름에 있다', (skills[base(n)] || []).some(g => (g.skills || []).length));
  ok(n + ' 의 한국어 이름이 있다', !!(manual[base(n)] || auto[base(n)]));
  ok(o + ' 스킬이 옛 이름에 남아 있지 않다', !skills[base(o)]);
}
(async () => {
  const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  const { findChrome } = require('./lib/wiki_fetch.js');
  const GBO2Browser = require('./lib/browser.js');
  const br = await GBO2Browser.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const pg = await br.newPage();
    const url = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
    await pg.goto(url, { waitUntil: 'load', timeout: 180000 });
    const [o, n] = pairs[0];
    const got = await pg.evaluate((o, n) => {
      localStorage.setItem('gbo2-offline-builds', JSON.stringify([{ id: 'a', name: 'x', ms: o, parts: [], stage: 6 }]));
      localStorage.setItem('gbo2-offline-fav', JSON.stringify([o]));
      localStorage.setItem('gbo2-offline-recent', JSON.stringify([o]));
      localStorage.setItem('gbo2.plan', JSON.stringify([{ id: 'p', ms: o, stage: 6 }]));
      return window.GBO2UiTest.storedMsNames();
    }, o, n);
    ok('저장 목록의 옛 이름이 새 이름으로 읽힌다', got.builds[0] === n, got.builds);
    ok('즐겨찾기의 옛 이름이 살아 있다', got.fav[0] === n, got.fav);
    ok('최근 목록의 옛 이름이 살아 있다', got.recent[0] === n, got.recent);
    ok('플랜의 옛 이름이 새 이름으로 읽힌다', got.plan[0] === n, got.plan);
  } finally { await br.close(); }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

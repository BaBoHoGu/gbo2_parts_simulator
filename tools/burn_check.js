// 소이(焼夷) 고정 피해 — 위키 5891 실측표에 있는 파츠 조합은 **범위가 아니라 실측 한 값**으로 나오는가.
//
//   node tools/burn_check.js        (먼저 node tools/build.js)
//
// 소이 히트 수는 계산으로 한 값을 못 낸다(지속÷간격 내림이라 두 정수에 걸친다 — 03-weapons fixedDamageWithParts).
// 그래서 앱은 「11~12히트」 처럼 범위로 내고, 위키가 실제로 재 본 조합만 그 값을 쓴다.
// 예전엔 「연소제 단독」 열만 썼다. 2026-10-27 부터 「연소제 + 이레귤러 DBL」 · 「연소제 + 탄약 강화 키트」 열도 쓴다
// (표 본문에 둘은 같이 못 낀다고 적혀, 열의 조건이 분명해졌다).
// 앱이 실제로 쓰는 함수(GBO2UiTest.fixedDamageWithParts)와 실제 파츠 설명으로 잰다 — 배율을 검사에 베끼지 않는다.
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

const parts = Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parts.json'), 'utf8'))).flat();
const P = n => parts.find(p => p.name.normalize('NFC') === n);
const COMBO = {
  soi: ['特殊燃焼剤'],
  dbl: ['特殊燃焼剤', 'イレギュラーDBL'],
  kit: ['特殊燃焼剤', '弾薬強化キット_LV1'],
};
const ov = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'burn.override.json'), 'utf8'));

(async () => {
  const sets = {};
  for (const [k, names] of Object.entries(COMBO)) sets[k] = names.map(P);
  ok('시험 파츠가 데이터에 있다', Object.values(sets).every(s => s.every(Boolean)));

  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await pg.waitForFunction(() => window.GBO2UiTest && window.GBO2UiTest.fixedDamageWithParts, { timeout: 60000 });

  const res = await pg.evaluate((ov, sets) => {
    const T = window.GBO2UiTest, W = T.weaponData();
    const out = [];
    for (const [key, v] of Object.entries(ov)) {
      const i = key.indexOf('|');
      const w = ((W[key.slice(0, i)] || {}).weapons || []).find(x => x.name === key.slice(i + 1));
      if (!w) { out.push({ key, missing: true }); continue; }
      const row = { key };
      for (const k of ['soi', 'dbl', 'kit']) {
        const f = T.fixedDamageWithParts(w, sets[k]);
        row[k] = f && { per: f.per, hits: f.hits, ranged: f.ranged, measured: f.measured };
      }
      out.push(row);
    }
    return out;
  }, ov, sets);
  await br.close();

  for (const k of ['soi', 'dbl', 'kit']) {
    const want = res.filter(r => !r.missing && ov[r.key][k]);
    const bad = want.filter(r => !r[k] || r[k].ranged || !r[k].measured
      || r[k].per !== ov[r.key][k][0] || r[k].hits !== ov[r.key][k][1]);
    // 바닥만 막는다 — 개수를 박지 않는다(표가 늘고 줄 수 있다)
    ok(COMBO[k].join(' + ') + ' — 실측이 있는 무장 ' + want.length + '종이 실측 한 값으로 나온다',
      want.length >= 20 && !bad.length,
      bad.slice(0, 5).map(r => r.key + ' 앱 ' + JSON.stringify(r[k]) + ' / 실측 ' + ov[r.key][k].join('×')));
  }
  // 실측이 없는 조합은 지어내지 않는다 — 범위로 남는다
  const none = res.filter(r => !r.missing && !ov[r.key].dbl);
  ok('DBL 실측이 없는 무장은 실측 표시를 하지 않는다 (' + none.length + '종)',
    none.every(r => r.dbl && !r.dbl.measured), none.map(r => r.key));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

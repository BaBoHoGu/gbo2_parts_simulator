// 무장 피해를 계산하는 **두 경로**가 같은 답을 내는지 실측한다.
//
//   node tools/damage_path_check.js
//
// 왜 필요한가 — 피해 계산이 한 곳이 아니다.
//   ① 무장표·PNG 카드·저장구성 → weaponHitDamage() (공용)
//   ② 피탄 「내 무장 → 적」      → D.shootingDamage / D.meleeDamage 직접 호출
// ②가 따로인 이유는 공용 함수가 상성(attr)·방향 배율(ccd)을 안 받기 때문이다.
// 그래서 새 보정을 넣을 때 두 곳을 다 고쳐야 하는데, 이 저장소는 이미 두 번 물렸다
// (「고정 피해가 한쪽만」·「1히트 vs 전탄」). 그 재발을 여기서 막는다.
//
// 두 값은 **같아야 하는 게 아니라, 설명되는 만큼만 달라야** 한다:
//   피탄 = floor(무장표 1히트 × 상성배율) × 전탄배수  (+ 고정 피해)
// 상성 배율은 기체마다 하나뿐이므로, 한 기체 안에서 무장마다 배율이 달라지면 그것이 버그다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MECHS = ['건담 Ez8', '자쿠Ⅱ', '짐 커맨드'];
const ATTR_MULT = [['동일', 1], ['우위', 1.3], ['열세', 0.8]];
const FIRE = [1, 2, 3, 4, 5, 6, 8];       // 동시발사 배수로 있을 수 있는 값

let pass = 0, fail = 0;
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n      ' + extra : '')); }
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1600, height: 1200 });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 80)));
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  for (const name of MECHS) {
    await pg.evaluate(() => { const x = document.querySelector('#pietanClose'); if (x) x.click(); });
    await sleep(350);
    await pg.evaluate(() => { const b = document.querySelector('#backToSelect'); if (b) b.click(); });
    await sleep(700);
    await pg.evaluate(n => {
      const i = document.querySelector('#msQuery'); i.value = n;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }, name);
    await sleep(900);
    const got = await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (!c) return false; c.click(); return true; });
    if (!got) { check(name + ' — 기체를 찾음', false); continue; }
    await sleep(1000);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1400);
    // 보정이 실제로 걸리도록 공격 파츠를 끼운다 — 맨몸이면 두 경로가 우연히 같을 수 있다
    for (const kw of ['사격 강화', '격투 강화']) {
      await pg.evaluate(k => {
        const i = document.querySelector('#partQuery'); i.value = k;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }, kw);
      await sleep(420);
      await pg.evaluate(() => { const c = document.querySelector('#partList > *'); if (c) c.click(); });
      await sleep(420);
    }
    // ① 무장표: 「기본 (+보정)」 의 합 = 1히트 최종 피해
    const screen = await pg.evaluate(() => {
      const out = {};
      for (const r of document.querySelectorAll('#weaponList > *')) {
        const t = r.innerText;
        const nm = (t.split('\n').map(x => x.trim()).filter(Boolean)[1] || '');
        const m = t.match(/([\d,]+)\s*\(\+([\d,]+)\)/);
        if (nm && m) out[nm] = Number(m[1].replace(/,/g, '')) + Number(m[2].replace(/,/g, ''));
      }
      return out;
    });
    // ② 피탄 「내 무장 → 적」
    await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /피탄 시뮬/.test(y.textContent)); if (x) x.click(); });
    await sleep(1500);
    // 구역 이름표(.pietan-sec-lb)가 아니라 **진짜 기체 줄**을 누른다.
    await pg.evaluate(() => {
      const t = document.querySelector('#pietanList .pietan-row');
      if (t) (t.querySelector('button') || t).click();
    });
    await sleep(1600);
    const pie = await pg.evaluate(() => {
      const out = {};
      const r = document.querySelector('#pietanResult');
      if (!r) return out;
      for (const row of r.querySelectorAll('*')) {
        const t = (row.innerText || '').trim();
        const m = t.match(/^(?:실탄|빔|격투|실드|기타)\s*\n?\s*(.+?)\s+([\d,]+)(?:\s*\(×\d+\))?\s+([\d,]+)발$/);
        if (m) out[m[1].trim()] = Number(m[2].replace(/,/g, ''));
      }
      return out;
    });

    const keys = Object.keys(screen).filter(k => pie[k] != null);
    if (!keys.length) { check(name + ' — 대조할 무장이 있음', false, '무장표 ' + Object.keys(screen).length + ' · 피탄 ' + Object.keys(pie).length); continue; }

    // 무장마다 「어떤 상성×전탄 조합으로 설명되는가」를 찾는다
    const explained = [], odd = [];
    for (const k of keys) {
      let hit = null;
      for (const [lbl, m] of ATTR_MULT)
        for (const f of FIRE)
          if (Math.floor(screen[k] * m) * f === pie[k]) { hit = { lbl, m, f }; break; }
      if (hit) explained.push({ k, ...hit });
      else odd.push(k + ': 무장표 ' + screen[k] + ' vs 피탄 ' + pie[k]
        + ' (비 ' + (pie[k] / screen[k]).toFixed(3) + ')');
    }
    check(name + ' — 모든 무장이 상성×전탄으로 설명된다 (' + keys.length + '종)',
      odd.length === 0, odd.slice(0, 4).join('\n      '));
    // 상성 배율은 기체 하나에 하나뿐이다 — 무장마다 다르면 그것이 어긋남이다
    const mults = [...new Set(explained.map(x => x.m))];
    check(name + ' — 상성 배율이 무장마다 같다',
      mults.length <= 1, '나온 배율: ' + mults.join(', '));
  }
  await br.close();

  check('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

// 피탄 시뮬의 「적 공격보정」이 적 설정을 따라오는가.
//   node tools/pietancorr_check.js
//
// 예전에는 **무장을 고를 때만** 채웠다. 그래서
//   · 기체를 바꿔도 칸에 앞 기체 숫자가 남았고(실측: 자쿠Ⅱ 19 → 구프로 바꿔도 19)
//   · 상대 파츠를 끼우거나 빼도 보정이 안 따라왔다.
// 이제 적 설정이 바뀌는 길이 **전부** pietanRedrawAll 을 지나가므로 거기서 맞춘다.
// 손으로 고친 값은 같은 기체 안에서만 지켜지고, 기체를 바꾸면 풀린다.
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra != null ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const parts = rd('data', 'parts.json');
const msData = rd('data', 'msData.json');
const fullst = rd('data', 'fullst.json');
const dict = { ...rd('data', 'i18n', 'ms.auto.json'), ...rd('data', 'i18n', 'ms.json') };
const allParts = [].concat(...Object.values(parts).filter(Array.isArray));

/* 기대값은 앱이 아니라 core 로 직접 센다 — 같은 식을 베끼면 같이 틀린다. */
const corrOf = (ms, ps, stage) =>
  Math.round(C.calcStats(ms, ps, stage, '拡張スキル無し', parts, fullst, null, 'normal').total.shoot || 0);
const meleeOf = (ms, ps, stage) =>
  Math.round(C.calcStats(ms, ps, stage, '拡張スキル無し', parts, fullst, null, 'normal').total.meleeCorrection || 0);

/* 앱은 기체를 고르면 **그 이름의 최고 LV** 를 쓴다(selectPietanMs). 기댓값도 그 엔트리로
   세야 한다 — 처음엔 _LV1 로 세어 「앱 46 / 손 15」 처럼 전부 어긋났다. */
const baseOf = m => String(m.MS名).replace(/_LV\d+$/, '');
const byBase = new Map();
for (const m of msData) {
  const b = baseOf(m);
  const cur = byBase.get(b);
  if (!cur || C.msLevel(m.MS名) > C.msLevel(cur.MS名)) byBase.set(b, m);
}
// 사격보정이 서로 다른 기체 둘을 데이터에서 고른다 (이름을 코드에 박지 않는다)
const pool = [...byBase.values()].filter(m => dict[baseOf(m)] && (m.fullst || []).length);
const msA = pool.find(m => corrOf(m, [], 6) >= 15);
const msB = pool.find(m => msA && corrOf(m, [], 6) > 0 && corrOf(m, [], 6) < corrOf(msA, [], 6) - 5);
const shootPart = allParts.find(p => p.name === '射撃強化プログラム_LV1')
  || allParts.find(p => /射撃強化プログラム/.test(p.name));
ok('표본 기체 둘과 사격 파츠를 찾았다', !!(msA && msB && shootPart),
  { A: msA && msA.MS名, B: msB && msB.MS名, 파츠: shootPart && shootPart.name });
if (!msA || !msB || !shootPart) process.exit(1);
const koA = dict[baseOf(msA)];
const koB = dict[baseOf(msB)];

(async () => {
  const br = await GBO2Browser.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1500, height: 1100 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  // 저장 구성 하나를 심는다 (③ 용) — 파츠가 든 구성
  await pg.evaluate((ms, pn) => {
    localStorage.setItem('gbo2-offline-builds', JSON.stringify([{
      id: 'probe', name: '검사용 구성', ms, parts: [pn], stage: 6,
      expansion: null, expLevel: null, ts: Date.now()
    }]));
  }, msB.MS名, shootPart.name);
  await pg.reload({ waitUntil: 'load', timeout: 120000 });
  await sleep(1800);

  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery');
    i.value = '건담 Ez8'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(1300);
  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(1600);

  // 보정 칸은 **둘**이다 — 사격·격투. 고른 무장의 속성에 맞는 칸이 쓰인다.
  const corrOfBox = k => pg.evaluate(sel => Number((document.querySelector(sel) || {}).value),
    k === 'melee' ? '#pietanCorrMelee' : '#pietanCorrShoot');
  const corr = () => corrOfBox('shoot');
  const back = async () => {
    await pg.evaluate(() => {
      // 「‹ 다른 기체」는 머리 **행 안의 버튼**이다 — 행을 누르면 아무 일도 안 일어난다
      const row = [...document.querySelectorAll('#pietanList > *')].find(e => /다른 기체/.test(e.textContent));
      if (row) (row.querySelector('button') || row).click();
    });
    await sleep(700);
  };
  const pickMs = async (ko) => {
    await pg.evaluate(t => {
      const e = document.querySelector('#pietanQuery');
      e.value = t; e.dispatchEvent(new Event('input', { bubbles: true }));
    }, ko);
    await sleep(1100);
    const got = await pg.evaluate(t => {
      const e = [...document.querySelectorAll('#pietanList > *')]
        .find(x => x.textContent.indexOf(t) >= 0 && !/검사용 구성/.test(x.textContent));
      if (!e) return false;
      e.click(); return true;
    }, ko);
    await sleep(1400);
    return got;
  };
  // 무장 줄만 고른다 — 목록에는 머리줄·LV 선택 줄도 섞여 있다(속성 꼬리표로 가른다)
  const pickWeapon = async (kind) => {
    const r = await pg.evaluate(k => {
      const items = [...document.querySelectorAll('#pietanList > *')]
        .filter(e => new RegExp('^' + k).test(e.textContent.replace(/\s+/g, '')));
      if (!items[0]) return null;
      const t = items[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 30);
      items[0].click(); return t;
    }, kind);
    await sleep(1200);
    return r;
  };

  // ── ① 새 기체를 고르면 **무장을 고르기 전에** 그 기체 값으로 채워진다
  ok('A 기체를 골랐다', await pickMs(koA), koA);
  const a0 = await corr();
  ok('새 기체를 고르면 바로 그 기체의 사격보정이 채워진다',
    a0 === corrOf(msA, [], 6), { 앱: a0, 손: corrOf(msA, [], 6), 기체: msA.MS名 });
  await back();
  ok('B 기체를 골랐다', await pickMs(koB), koB);
  const b0 = await corr();
  ok('기체를 바꾸면 앞 기체 값이 남지 않는다',
    b0 === corrOf(msB, [], 6) && b0 !== a0, { A: a0, B: b0, 손: corrOf(msB, [], 6) });

  // 무장 속성에 따라 기준이 바뀐다
  // 두 칸이 **동시에** 제 값으로 차 있어야 한다 (예전엔 한 칸이라 번갈아 덮였다)
  ok('사격·격투 칸이 동시에 제 값으로 찬다',
    (await corrOfBox('shoot')) === corrOf(msB, [], 6)
    && (await corrOfBox('melee')) === meleeOf(msB, [], 6),
    { 사격: await corrOfBox('shoot'), 격투: await corrOfBox('melee'),
      손: [corrOf(msB, [], 6), meleeOf(msB, [], 6)] });
  const mw = await pickWeapon('격투');
  if (mw) {
    ok('격투 무장을 골라도 두 칸은 그대로다 (쓰는 쪽만 격투)',
      (await corrOfBox('shoot')) === corrOf(msB, [], 6)
      && (await corrOfBox('melee')) === meleeOf(msB, [], 6),
      { 사격: await corrOfBox('shoot'), 격투: await corrOfBox('melee'), 무장: mw });
    /* **칸이 찬 것만 봐서는 모자란다.** 「늘 사격 칸을 쓴다」로 심어 봤더니 그대로 통과했다.
       계산이 어느 칸을 쓰는지는 **결과 숫자**로만 알 수 있다 — 격투 칸만 흔들어 본다. */
    const killOf = () => pg.evaluate(() => {
      const m = [...document.querySelectorAll('#pietanModal .pietan-metric')]
        .find(x => (x.querySelector('.pietan-mlb') || {}).textContent === '격파까지');
      return m ? m.querySelector('.pietan-mv').textContent.trim() : null;
    });
    const k0 = await killOf();
    await pg.evaluate(() => {
      const i = document.querySelector('#pietanCorrMelee');
      i.value = '250'; i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(800);
    const kMelee = await killOf();
    ok('격투 무장일 때 **격투 칸**을 흔들면 결과가 바뀐다',
      !!k0 && kMelee !== k0, { 원래: k0, 격투250: kMelee });
    // 되돌리고, 이번엔 사격 칸만 흔든다 — 격투 무장이니 결과가 바뀌면 안 된다
    await pg.evaluate(m => {
      const i = document.querySelector('#pietanCorrMelee');
      i.value = String(m); i.dispatchEvent(new Event('input', { bubbles: true }));
    }, meleeOf(msB, [], 6));
    await sleep(700);
    const kBack = await killOf();
    await pg.evaluate(() => {
      const i = document.querySelector('#pietanCorrShoot');
      i.value = '250'; i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(800);
    ok('격투 무장일 때 사격 칸을 흔들어도 결과가 안 바뀐다',
      (await killOf()) === kBack, { 되돌린뒤: kBack, 사격250: await killOf() });
    /* 위에서 두 칸을 손으로 만져 **고정**해 뒀다 — 그대로 두면 뒤의 파츠 검사가
       움직이지 않는다(실제로 그렇게 걸렸다). 기체를 다시 골라 고정을 푼다. */
    await back();
    await pg.evaluate(() => {
      const q = document.querySelector('#pietanQuery');
      if (q) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await sleep(700);
    await pickMs(koB);
  } else console.log('  (이 기체엔 격투 무장이 없어 건너뜀)');

  /* ── ② 파츠를 끼우면 그 값이 반영된다.
     **기준값은 바로 직전 값으로 잡는다** — 앞에서 격투 무장을 골랐으면 기준이 격투보정이라,
     처음 값(사격보정)과 견주면 파츠와 상관없이 어긋난다(실제로 그렇게 틀렸다).
     그리고 **사격 기준으로 돌려놓고** 잰다 — 격투 무장을 고른 채로 사격 파츠를 끼우면
     안 변하는 것이 맞아서, 그대로 재면 기능이 멀쩡한데 검사가 실패한다(실제로 그랬다). */
  await pickWeapon('실탄');
  const beforeAdd = await corr();
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /\+\s*파츠/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(900);
  await pg.evaluate(() => {
    const q = document.querySelector('.pietan-ep-pick input');
    if (q) { q.value = '사격 강화'; q.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(900);
  const added = await pg.evaluate(() => {
    const rows = [...document.querySelectorAll('.pietan-ep-row')].filter(r => !r.classList.contains('off'));
    if (!rows.length) return null;
    const t = rows[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 30);
    rows[0].click(); return t;
  });
  await sleep(1200);
  const withPart = await corr();
  ok('사격 파츠를 끼웠다', !!added, added);
  ok('파츠를 끼우면 보정이 따라 오른다', withPart > beforeAdd, { 끼우기전: beforeAdd, 끼운뒤: withPart });

  // 뺐을 때도 따라 내린다
  await pg.evaluate(() => {
    const c = document.querySelector('.pietan-ep-chip');
    if (c) c.click();
  });
  await sleep(1200);
  const removed = await corr();
  ok('파츠를 빼면 보정이 되돌아간다', removed === beforeAdd, { 뺀뒤: removed, 원래: beforeAdd });

  // ── ③ 저장 구성은 파츠가 반영된 값으로 온다
  await back();
  // 검색어가 남아 있으면 저장 구성 줄이 걸러져 안 보인다 — 먼저 비운다
  await pg.evaluate(() => {
    const q = document.querySelector('#pietanQuery');
    if (q) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(1000);
  const gotBuild = await pg.evaluate(() => {
    const e = [...document.querySelectorAll('#pietanList > *')].find(x => /검사용 구성/.test(x.textContent));
    if (!e) return false;
    e.click(); return true;
  });
  await sleep(1500);
  ok('저장 구성을 골랐다', gotBuild);
  const chips = await pg.evaluate(() => [...document.querySelectorAll('.pietan-ep-chip')].length);
  const bCorr = await corr();
  /* 구성의 파츠가 **실제로 장착된 것만** 센다 — 슬롯이 모자라면 앱이 덜어낸다.
     기대값도 같은 규칙으로 만들어야 한다(여기서 손으로 더하면 앱이 맞는데도 틀렸다고 한다). */
  const fit = C.checkEquip(shootPart, msB, [], C.calcSlots(msB, [], 6, fullst)).ok ? [shootPart] : [];
  ok('저장 구성의 파츠가 칩으로 들어왔다', chips === fit.length, { 칩: chips, 들어가야: fit.length });
  ok('저장 구성은 파츠가 반영된 보정으로 온다',
    bCorr === corrOf(msB, fit, 6), { 앱: bCorr, 손: corrOf(msB, fit, 6), 파츠없이: corrOf(msB, [], 6) });

  // ── 손으로 고친 값은 같은 기체 안에서만 지켜진다
  const meleeBefore = await corrOfBox('melee');
  await pg.evaluate(() => {
    const i = document.querySelector('#pietanCorrShoot');
    i.value = '999'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(600);
  await pickWeapon('실탄');
  const kept = await corr();
  ok('손으로 고친 값은 무장을 바꿔도 지켜진다', kept === 999, kept);
  // **한 칸만** 고정된다 — 사격을 만졌다고 격투까지 묶이면 안 된다
  ok('사격 칸을 만져도 격투 칸은 자동 그대로다',
    (await corrOfBox('melee')) === meleeBefore,
    { 격투: await corrOfBox('melee'), 원래: meleeBefore });
  await back();
  await pg.evaluate(() => {
    const q = document.querySelector('#pietanQuery');
    if (q) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(800);
  await pickMs(koA);
  const reset = await corr();
  ok('기체를 바꾸면 손으로 고친 값이 풀린다',
    reset === corrOf(msA, [], 6), { 앱: reset, 손: corrOf(msA, [], 6) });
  ok('기체를 바꾸면 격투 칸도 새 기체 값이다',
    (await corrOfBox('melee')) === meleeOf(msA, [], 6),
    { 앱: await corrOfBox('melee'), 손: meleeOf(msA, [], 6) });

  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

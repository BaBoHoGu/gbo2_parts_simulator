// 「끼워도 아무 수치도 안 바뀌는 파츠」를 전수로 찾아, 화면이 그 사실을 밝히는지 본다.
//
//   node tools/part_effect_check.js
//
// 왜 필요한가 — 파츠 효과는 위키 원문을 정규식으로 읽는다. 문구가 조금만 달라도 조용히
// 0 이 되는데, 설명은 화면에 그대로 보이니 아무도 모른다(part-effect-parser 메모).
// 그래서 코드를 읽지 않고 **실제로 끼웠다 빼며** 화면 숫자를 떠서 비교한다.
//
// 두 방향을 다 본다:
//   ① 아무것도 안 바뀌는데 「반영 안 됨」 고지가 없다  → 사용자가 슬롯을 헛되이 쓴다
//   ② 고지를 달아 뒀는데 실제로는 수치가 바뀐다        → 고지가 거짓말이다
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

const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/parts.json'), 'utf8'));
const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/i18n/parts.json'), 'utf8'));
const koOf = n => (i18n[n] && i18n[n].n) || n;
// 수치가 적힌 파츠만 본다 — 「효과 없음」이라 적힌 것까지 셀 필요는 없다.
const targets = Object.values(parts).flat()
  .filter(p => /\d+\s*[%％]|\d{2,}/.test(String(p.description || '')));

/* 조건이 맞아야만 수치가 움직이는 파츠 — 시험 기체에서는 안 변하는 것이 정상이다.
   (특수 연소제는 소이 무장이 있어야, 이레귤러 DBL 은 상태이상 무장이 있어야 걸린다)
   여기 적는 것은 「파서가 실제로 있다」를 확인하고 넣는다. */
const CONDITIONAL = new Set([
  '特殊燃焼剤', 'イレギュラーDBL', '試験型イレギュラーDBL_LV1',
  'AD-ASL_LV2', '電子防護システム_LV1'
]);

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1600, height: 1200 });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 80)));
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);
  // 슬롯이 넉넉한 고레벨 기체로 — 슬롯 부족으로 못 끼우면 판정이 안 선다
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery'); i.value = '건담 Ez8';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) c.click(); });
  await sleep(1100);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1600);

  const SNAP = () => {
    const out = [];
    for (const sel of ['.stat-row', '.dura-row', '.thr-row', '.mi-sg', '#weaponList', '.stagger-row'])
      for (const el of document.querySelectorAll(sel))
        for (const m of (el.innerText || '').matchAll(/[\d,]+(?:\.\d+)?/g)) out.push(m[0]);
    return out.join('|');
  };

  let pass = 0, fail = 0;
  const bad1 = [], bad2 = [], skipped = [];
  for (const p of targets) {
    await pg.evaluate(() => { const b = document.querySelector('#clearParts'); if (b) b.click(); });
    await sleep(260);
    const before = await pg.evaluate(SNAP);
    const ok = await pg.evaluate(k => {
      const i = document.querySelector('#partQuery'); i.value = k;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, koOf(p.name));
    await sleep(340);
    await pg.evaluate(() => { const c = document.querySelector('#partList > *'); if (c) c.click(); });
    await sleep(340);
    const on = await pg.evaluate(() => document.querySelectorAll('#equipped .eq:not(.empty)').length);
    if (!ok || !on) { skipped.push(p.name); continue; }
    const after = await pg.evaluate(SNAP);
    const moved = before !== after;
    const marked = await pg.evaluate(() => !!document.querySelector('#partDetail .d-unmod, .d-unmod'));
    if (!moved && !marked && !CONDITIONAL.has(p.name)) bad1.push(koOf(p.name));
    if (moved && marked) bad2.push(koOf(p.name));
  }
  /* ── 「※ 위키」 메모는 게임 안 설명이 아니다 ──
     번역문 끝에 「※ 위키: 상한이 50 → 70 이 된다」처럼 **우리가 조사해 적어 둔 배경**이
     16칸 붙어 있다. 한 덩어리로 보여 주면 게임이 그렇게 적어 둔 것처럼 읽힌다.
     갈라 놓았는지, 그리고 **메모가 없는 파츠에는 빈 칸이 안 생기는지**를 함께 본다. */
  const memo = await pg.evaluate(async () => {
    const open = async (q) => {
      const i = document.querySelector('#partQuery');
      i.value = q; i.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      const t = document.querySelector('#partList > *');
      if (!t) return null;
      t.click();
      await new Promise(r => setTimeout(r, 450));
      const tx = document.querySelector('#detailBody .d-eff-tx');
      const wiki = document.querySelector('#detailBody .d-wiki');
      return {
        boxes: document.querySelectorAll('#detailBody .d-eff').length,
        lb: (document.querySelector('#detailBody .d-eff-lb') || {}).textContent,
        main: tx && tx.firstChild ? tx.firstChild.textContent : '',
        memoLb: (document.querySelector('.d-wiki-lb') || {}).textContent || null,
        memo: (document.querySelector('.d-wiki-tx') || {}).textContent || null,
        inside: !!(wiki && tx && tx.contains(wiki)),
        // 떨림의 원인은 **칸 높이가 파츠마다 달라지는 것**이었다 — 그것을 직접 잰다
        panelH: Math.round(document.querySelector('#detailPanel').getBoundingClientRect().height),
        listTop: Math.round(document.querySelector('#partList').getBoundingClientRect().top)
      };
    };
    return { withMemo: await open('신형 내실탄 장갑'), without: await open('격투 강화') };
  });

  /* ── 떨림은 표본 둘로는 못 잡는다 ──
     메모를 상자 안으로 넣어 16 파츠는 잡았는데, 「계산 안 함」이 붙는 14 파츠에서
     칸이 461 → 478 → 524 로 뛰고 목록이 63px 밀리는 것이 그대로 남아 있었다.
     표본 둘만 보면 둘 다 461 이라 통과해 버린다 — **163종을 전부** 훑어
     칸 높이와 목록 자리가 **한 가지뿐인지** 본다. 가려지는 내용은 굴려서 닿는지도 함께. */
  const sweep = await pg.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const s = document.querySelector('#partQuery');
    s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(600);
    const H = new Set(), T = new Set();
    let n = 0, cut = 0, reach = 0;
    for (const t of [...document.querySelectorAll('#partList > *')]) {
      t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(25);
      n++;
      H.add(Math.round(document.querySelector('#detailPanel').getBoundingClientRect().height));
      T.add(Math.round(document.querySelector('#partList').getBoundingClientRect().top));
      const body = document.querySelector('#detailBody');
      if (body.scrollHeight > body.clientHeight + 1) {
        cut++;
        body.scrollTop = body.scrollHeight;
        await wait(15);
        // 끝까지 굴렸을 때 마지막 내용이 칸 안에 들어오면 닿는 것이다
        const last = body.lastElementChild;
        if (last && last.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 2) reach++;
        body.scrollTop = 0;
      }
    }
    return { n, 높이: [...H], 목록자리: [...T], 잘린파츠: cut, 굴려서닿음: reach };
  });
  await br.close();

  const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('  PASS ' + label); }
    else { fail++; console.log('  FAIL ' + label + (extra ? '\n      ' + extra : '')); }
  };

  console.log('수치가 적힌 파츠 ' + targets.length + '종을 하나씩 끼워 봤다'
    + (skipped.length ? ' (못 끼운 것 ' + skipped.length + ' 제외)' : '') + '\n');
  check('아무것도 안 바뀌는데 고지가 없는 파츠가 없다', bad1.length === 0,
    bad1.length ? bad1.join(', ') + '\n      → UNMODELLED_FX 에 넣거나, 효과를 구현하세요.' : '');
  check('고지를 달았는데 수치가 바뀌는 파츠가 없다', bad2.length === 0,
    bad2.length ? bad2.join(', ') + '\n      → 구현됐으면 UNMODELLED_FX 에서 그 줄을 지우세요.' : '');
  {
    const a = memo && memo.withMemo, b = memo && memo.without;
    check('위키 메모를 「위키 메모」로 갈라 적는다',
      !!a && a.memoLb === '위키 메모' && !!a.memo, JSON.stringify(a));
    // 갈라 놓기만 하고 게임 설명 쪽에 「※ 위키」가 남아 있으면 갈린 것이 아니다
    check('게임 설명 쪽에 「※ 위키」가 남지 않는다',
      !!a && !/※\s*위키/.test(a.main) && !/※\s*위키/.test(a.memo || ''), JSON.stringify(a));
    check('메모가 없는 파츠에는 메모 칸이 없다',
      !!b && b.memo === null, JSON.stringify(b));

    /* ── 여기가 진짜 검사다 ──
       메모를 **상자 밖에** 따로 두었더니 메모가 있는 16 파츠에서만 상세 칸이 97px 길어졌고
       (실측 581 ↔ 484), 그만큼 아래 파츠 목록이 밀렸다(697 ↔ 600). 목록이 밀리면 커서 밑의
       파츠가 바뀌어 상자가 또 바뀐다 — 예전에 잡았던 떨림이 그대로 되살아났다(사용자 지적).
       DOM 모양만 보면 이걸 못 잡는다. **칸 높이와 목록 자리**로 잰다. */
    check('메모가 있어도 상세 칸 높이가 그대로다 (떨림 방지)',
      !!a && !!b && a.panelH === b.panelH, JSON.stringify({ 메모있음: a, 메모없음: b }));
    check('메모가 있어도 파츠 목록이 안 밀린다',
      !!a && !!b && a.listTop === b.listTop, JSON.stringify({ a, b }));

    // 전수 — 여기가 떨림을 진짜로 막는 자리다
    const sw = sweep;
    check('163종을 훑어도 상세 칸 높이가 한 가지뿐이다',
      sw && sw.n > 150 && sw.높이.length === 1, JSON.stringify(sw));
    check('163종을 훑어도 파츠 목록이 한 자리에 있다',
      sw && sw.목록자리.length === 1, JSON.stringify(sw));
    // 막기만 하고 내용이 닿지 않으면 고친 것이 아니다
    check('칸에 안 들어가는 내용은 굴려서 닿는다',
      sw && sw.잘린파츠 > 0 && sw.굴려서닿음 === sw.잘린파츠, JSON.stringify(sw));
    // 상자가 하나뿐이어야 위 두 가지가 성립한다 — 원인 쪽도 못 박는다
    check('메모는 특성 상자 안에 들어간다',
      !!a && a.inside && a.boxes === 1 && !!b && b.boxes === 1, JSON.stringify({ a, b }));
  }
  check('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

// 폰에서 무장표를 볼 수 있는가 — 밀어도 이름이 남는가, 글자가 잘리지 않는가.
//
//   node tools/wsticky_check.js
//
// 왜 필요한가 — 무장표는 칸이 열 개라 합이 1,054px(964 + 간격 90)이다. 폰에서는 어느
// 보기로도 한 화면에 안 들어가 옆으로 밀어야 한다. 밀고 나면 왼쪽 이름이 사라져
// **어느 무장 줄을 보고 있는지 알 수 없었다**(사용자 지적). 구분·이름 두 칸을 붙여 뒀다.
//
// **폰 보기가 둘이라 둘 다 본다.** 하나만 보면 다른 쪽이 조용히 빠진다 — 실제로 그랬다:
//   넓게 보기 — 폭을 768px 로 **잡아** 축소해 보여 준다. 스크롤 주체는 #weaponList.
//   크게 보기 — 폭 = 기기 폭(390px). 무장표가 아래 시트에 담기고 **시트가** 스크롤한다.
//               목록만 재면 1,120/1,120 으로 「안 넘친다」가 나와 고정이 안 걸렸었다.
//               넘침도 771px 로 넓게 보기(320px)의 두 배다.
//
// 보는 것:
//   ① 두 보기 모두에서 실제로 넘치는가 (안 넘치면 이 검사가 헛돈다)
//   ② 두 보기 모두 이름 칸이 붙는가
//   ③ 오른쪽 끝까지 밀어도 이름이 제자리인가
//   ④ 붙인 칸이 행을 덮는가 — 안 덮으면 밀려 오는 글자가 위아래로 비친다
//   ⑤ 이름 칸에서 칩이 잘리지 않는가 — 「스프레이 빔 포드 4발 ×4연사」가 140px 칸에 174px 필요했다
//   ⑥ 안 넘치는 화면(데스크톱·폰가로)에는 안 켜지는가 — 그림자만 남으면 군더더기다
const GBO2Browser = require('./lib/browser.js');   // 크롬 임시 프로필 정리가 프로세스를 죽이지 않게
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

async function measure(br, { w, h, mobile, viewMode }) {
  const pg = await br.newPage();
  await pg.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
  // 화면 모드는 **첫 그리기 전에** 정해져야 한다 — 메타 뷰포트를 바꾸므로 나중이면 늦다
  if (viewMode) {
    await pg.evaluateOnNewDocument(m => {
      try { localStorage.setItem('gbo2.viewMode', m); } catch (e) {}
    }, viewMode);
  }
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await sleep(3500);
  const r = await pg.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (document.body.classList.contains('info-open')) { document.querySelector('#infoClose').click(); await wait(300); }
    const q = document.querySelector('#msQuery');
    q.value = 'V2 어설트 버스터'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(900);
    const card = document.querySelector('#msList .ms-card');
    if (!card) return { err: '기체를 못 골랐다' };
    card.click(); await wait(1800);

    const box = document.querySelector('#weaponList');
    if (!box) return { err: '#weaponList 가 없다' };
    // 「크게 보기」는 무장표가 아래 시트에 있다 — 안 보이면 액션바의 「무장」을 눌러 연다
    if (!box.getClientRects().length) {
      const b = [...document.querySelectorAll('button')]
        .find(x => /무장/.test(x.textContent) && x.getBoundingClientRect().top > innerHeight * 0.7);
      if (b) { b.click(); await wait(800); }
    }
    if (!box.getClientRects().length) return { err: '무장표를 못 열었다' };
    box.scrollIntoView({ block: 'center' }); await wait(400);

    // 가로로 넘치는 **주체**를 찾는다 — 목록이 아닐 수 있다(크게 보기는 시트가 스크롤한다)
    let n = box, sc = null;
    while (n && n !== document.documentElement) {
      if (n.scrollWidth > n.clientWidth + 2) {
        sc = { el: n, name: n.id || String(n.className).slice(0, 20), over: n.scrollWidth - n.clientWidth };
        break;
      }
      n = n.parentElement;
    }

    const row = box.querySelector('.weapon');
    if (!row) return { err: '무장 행이 없다' };
    const nm = row.querySelector('.w-nm');
    const base = () => (sc ? sc.el : box).getBoundingClientRect().left;
    const before = Math.round(nm.getBoundingClientRect().left - base());
    let scrolled = 0;
    if (sc) { sc.el.scrollLeft = sc.el.scrollWidth; await wait(400); scrolled = Math.round(sc.el.scrollLeft); }
    const after = Math.round(nm.getBoundingClientRect().left - base());

    /* 붙인 칸이 행의 **내용 상자**를 덮는가. 행 전체 높이와 견주면 안 된다 —
       행의 위아래 여백은 행 배경이 칠하므로 거기로는 안 비친다(48 vs 34 로 거짓 실패가 났었다). */
    const rcs = getComputedStyle(row);
    const rh = row.getBoundingClientRect().height
      - parseFloat(rcs.paddingTop) - parseFloat(rcs.paddingBottom);
    const covers = ['.w-sec', '.w-nm'].map(sel => {
      const e = row.querySelector(sel);
      return { sel, h: Math.round(e.getBoundingClientRect().height), row: Math.round(rh) };
    });

    // 이름 칸에서 잘리는 글자
    const cut = [];
    for (const e of box.querySelectorAll('.w-nm-top, .w-nm-sub')) {
      if (e.scrollWidth > e.clientWidth + 1)
        cut.push({ have: e.clientWidth, need: e.scrollWidth, t: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 24) });
    }

    return {
      vw: innerWidth, over: sc ? sc.over : 0, scroller: sc ? sc.name : '(없음)',
      canX: box.classList.contains('can-x'), pos: getComputedStyle(nm).position,
      before, after, moved: Math.abs(after - before), scrolled, covers,
      cut: cut.slice(0, 4), cutN: cut.length
    };
  });
  await pg.close();
  return r;
}

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const wide = await measure(br, { w: 390, h: 844, mobile: true, viewMode: 'wide' });
  const large = await measure(br, { w: 390, h: 844, mobile: true, viewMode: 'large' });
  const land = await measure(br, { w: 844, h: 390, mobile: true });
  const desk = await measure(br, { w: 1500, h: 1000, mobile: false });
  await br.close();

  const rows = [['폰 넓게', wide], ['폰 크게', large], ['폰가로', land], ['데스크톱', desk]];
  for (const [n, r] of rows) {
    if (r.err) { console.log('FAIL  ' + n + ' — ' + r.err); process.exit(1); }
    console.log('  ' + (n + '        ').slice(0, 9) + ' 폭' + String(r.vw).padStart(5)
      + ' · 넘침 ' + String(r.over).padStart(4) + 'px(' + r.scroller + ')'
      + ' · 고정 ' + (r.canX ? 'O' : 'X') + ' · 잘림 ' + r.cutN);
  }
  console.log('');

  // ① 잴 것이 실제로 있는가
  ok('폰 넓게에서 무장표가 넘친다 (200px 이상)', wide.over >= 200, { 넘침: wide.over });
  ok('폰 크게에서 무장표가 넘친다 (200px 이상)', large.over >= 200, { 넘침: large.over });
  // ② 두 보기 모두 붙는가 — 크게 보기가 조용히 빠졌던 자리다
  ok('폰 넓게에서 이름 칸이 붙는다', wide.canX === true && wide.pos === 'sticky', { pos: wide.pos });
  ok('폰 크게에서 이름 칸이 붙는다', large.canX === true && large.pos === 'sticky', { pos: large.pos });
  // ③ 밀어도 남는가
  ok('폰 넓게 — 끝까지 밀어도 이름이 제자리 (20px 이내)', wide.scrolled >= 200 && wide.moved <= 20,
    { 민거리: wide.scrolled, 밀기전: wide.before, 민뒤: wide.after });
  ok('폰 크게 — 끝까지 밀어도 이름이 제자리 (20px 이내)', large.scrolled >= 200 && large.moved <= 20,
    { 민거리: large.scrolled, 밀기전: large.before, 민뒤: large.after });
  // ④ 행을 덮는가
  const thin = [...wide.covers, ...large.covers].filter(c => c.h < c.row - 2);
  ok('붙인 칸이 행 높이를 덮는다 (두 보기 모두)', thin.length === 0, thin);
  // ⑤ 칩이 잘리지 않는가
  ok('이름 칸에서 칩이 잘리지 않는다 (두 보기 모두)', wide.cutN === 0 && large.cutN === 0,
    { 넓게: wide.cut, 크게: large.cut });
  /* ⑥ **켜짐 여부 = 넘침 여부.** 화면 이름으로 기대를 박으면 틀린다 —
     처음엔 「폰가로는 안 넘친다」고 적었는데, 시트를 안 열고 잰 탓이었다.
     실제로는 378px 넘친다(폰가로도 무장표가 시트에 담긴다). 넘치면 켜고 안 넘치면 끈다. */
  const mismatch = rows.filter(([, r]) => (r.over > 0) !== r.canX)
    .map(([n, r]) => n + ' 넘침' + r.over + 'px 인데 고정=' + (r.canX ? 'O' : 'X'));
  ok('켜짐 여부가 넘침 여부와 맞는다 (군더더기도 빠짐도 없다)', mismatch.length === 0, mismatch);

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

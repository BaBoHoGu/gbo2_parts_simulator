// 무장표를 옆으로 밀어도 **어느 무장 줄인지** 잃지 않는가.
//
//   node tools/wsticky_check.js
//
// 왜 필요한가 — 무장표는 칸이 열 개라 합이 1,054px(964 + 간격 90)이다.
// 폰 세로는 768px 안에 넣으므로 320px 이 넘쳐 옆으로 밀어야 다 보인다.
// 밀고 나면 왼쪽 이름이 사라져 **어느 무장 줄을 보고 있는지 알 수 없었다**(사용자 지적).
// 구분·이름 두 칸을 붙여 뒀는데, 이건 CSS 한 줄이면 조용히 풀린다 — 그래서 실제로 밀어 본다.
//
// 여기서 보는 것 넷:
//   ① 좁은 화면에서 실제로 넘치는가 (안 넘치면 이 검사 자체가 헛돈다)
//   ② 표시(can-x)가 **넘칠 때만** 켜지는가 — 데스크톱·폰가로에 그림자가 남으면 군더더기다
//   ③ 오른쪽 끝까지 밀어도 이름 칸이 제자리에 남는가
//   ④ 붙인 칸이 **행 높이를 다 덮는가** — 안 덮으면 밀려 오는 글자가 위아래로 비친다
//      (행이 align-items:center 라 칸은 내용 높이만큼만 커진다. 실제로 그렇게 겹쳐 보였다)
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

async function measure(br, w, h, mobile) {
  const pg = await br.newPage();
  await pg.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
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
    box.scrollIntoView({ block: 'center' }); await wait(300);

    const row = box.querySelector('.weapon');
    if (!row) return { err: '무장 행이 없다' };
    const nm = row.querySelector('.w-nm');
    const boxL = () => box.getBoundingClientRect().left;
    const before = Math.round(nm.getBoundingClientRect().left - boxL());
    box.scrollLeft = box.scrollWidth; await wait(400);
    const after = Math.round(nm.getBoundingClientRect().left - boxL());

    /* 붙인 칸이 행의 **내용 상자**를 다 덮는가.
       행 전체 높이와 견주면 안 된다 — 행의 위아래 여백(padding)은 행 자신의 배경이
       칠하므로 거기로는 글자가 안 비친다. 칸은 내용 상자만 덮으면 충분하다.
       (처음에 행 전체와 견줬다가 48 vs 34 로 거짓 실패가 났다) */
    const rcs = getComputedStyle(row);
    const rh = row.getBoundingClientRect().height
      - parseFloat(rcs.paddingTop) - parseFloat(rcs.paddingBottom);
    const covers = ['.w-sec', '.w-nm'].map(sel => {
      const e = row.querySelector(sel);
      return { sel, h: Math.round(e.getBoundingClientRect().height), row: Math.round(rh) };
    });
    return {
      over: box.scrollWidth - box.clientWidth,
      canX: box.classList.contains('can-x'),
      pos: getComputedStyle(nm).position,
      before, after, moved: Math.abs(after - before),
      scrolled: Math.round(box.scrollLeft), covers
    };
  });
  await pg.close();
  return r;
}

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const phone = await measure(br, 390, 844, true);
  const land = await measure(br, 844, 390, true);
  const desk = await measure(br, 1500, 1000, false);
  await br.close();

  for (const [n, r] of [['폰세로', phone], ['폰가로', land], ['데스크톱', desk]]) {
    if (r.err) { console.log('FAIL  ' + n + ' — ' + r.err); process.exit(1); }
    console.log('  ' + (n + '      ').slice(0, 7) + ' 넘침 ' + String(r.over).padStart(4)
      + 'px · can-x=' + (r.canX ? 'O' : 'X') + ' · 이름칸 ' + r.pos);
  }
  console.log('');

  // ① 잴 것이 실제로 있는가 — 안 넘치면 아래 검사들이 전부 헛돈다
  ok('폰 세로에서 무장표가 실제로 넘친다 (200px 이상)', phone.over >= 200, { 넘침: phone.over });
  // ② 넘칠 때만 켠다
  ok('넘치는 화면에서 표시가 켜진다', phone.canX === true);
  ok('안 넘치는 화면에서는 안 켜진다 (군더더기 없음)',
    land.canX === false && desk.canX === false, { 폰가로: land.canX, 데스크톱: desk.canX });
  // ③ 밀어도 남는가
  ok('오른쪽 끝까지 밀었다 (실제로 움직였다)', phone.scrolled >= 200, { 민거리: phone.scrolled });
  ok('밀어도 이름 칸이 제자리에 남는다 (20px 이내)', phone.moved <= 20,
    { 밀기전: phone.before, 민뒤: phone.after });
  // ④ 행 높이를 덮는가 — 안 덮으면 위아래로 뒤 글자가 비친다
  const thin = phone.covers.filter(c => c.h < c.row - 2);
  ok('붙인 칸이 행 높이를 다 덮는다', thin.length === 0, thin);

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

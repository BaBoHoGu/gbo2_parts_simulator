// 폰에서 **손가락 판정 영역**이 실제로 넓어졌는지, 그러면서 이웃의 자리를 뺏지 않는지 잰다.
//
//   node tools/tap_target_check.js
//
// 보이는 크기는 그대로 두고 투명 ::before 로 판정만 넓혔다(style.css 「손가락 판정 영역」).
// 규칙만 봐서는 실제로 눌리는지 알 수 없으므로, **좌표를 찍어 elementFromPoint 로** 확인한다.
//   ① 늘린 만큼 위아래 가장자리에서 그 버튼이 잡히는가
//   ② 이웃 버튼의 한가운데는 여전히 **이웃**이 잡히는가 (자리를 뺏지 않았는가)
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

const MIN = 34;   // 늘린 뒤 이만큼은 돼야 한다(36px 목표, 반올림 여유 2px)

let pass = 0, fail = 0;
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n      ' + extra : '')); }
};

/* 실제로 눌리는 높이를 잰다 — 가운데에서 위아래로 한 픽셀씩 나가 보며,
   그 버튼(또는 그 자손)이 잡히는 마지막 지점을 찾는다.
   **먼저 화면 안으로 올린다.** elementFromPoint 는 지금 보이는 자리만 본다 —
   스크롤 밖에 있는 버튼을 그냥 찍으면 그 자리에 있는 푸터가 잡혀서, 「버튼이 가려졌다」는
   거짓 실패가 난다(실제로 그렇게 12개를 잘못 잡았다). */
const PROBE = sel => {
  const out = [];
  for (const el of [...document.querySelectorAll(sel)].slice(0, 6)) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    if (!r.width || r.height >= 44) continue;
    if (r.top < 0 || r.bottom > innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    const cx = Math.round(r.left + r.width / 2);
    const mid = Math.round(r.top + r.height / 2);
    const mine = q => { let e = q; while (e) { if (e === el) return true; e = e.parentElement; } return false; };
    let up = 0, down = 0;
    for (let d = 1; d <= 30; d++) { if (mine(document.elementFromPoint(cx, mid - d))) up = d; else break; }
    for (let d = 1; d <= 30; d++) { if (mine(document.elementFromPoint(cx, mid + d))) down = d; else break; }
    out.push({ box: Math.round(r.height), tap: up + down + 1 });
  }
  return out;
};

/* 이웃의 한가운데가 여전히 이웃인가 — 넓힌 영역이 남의 자리를 덮었는지 본다. */
const STEAL = sel => {
  const els = [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width);
  let bad = 0, n = 0;
  for (const el of els.slice(0, 40)) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    // 화면 안으로 못 올리면 잴 수 없다. 가로도 본다 — 닫힌 드로어는 **옆으로** 밀려 있어
    // 세로만 보면 「화면 안」으로 보인다(자동 구성 드로어의 버튼 둘이 그랬다).
    if (r.top < 0 || r.bottom > innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    let e = hit, ok = false;
    while (e) { if (e === el) { ok = true; break; } e = e.parentElement; }
    n++; if (!ok) bad++;
  }
  return { n, bad };
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  // ── 기체 선택: 필터 칩 ──
  let r = await pg.evaluate(PROBE, '.chip');
  check('칩 판정이 ' + MIN + 'px 이상 (' + r.length + '개)',
    r.length > 0 && r.every(x => x.tap >= MIN),
    r.map(x => '보이는 ' + x.box + ' → 판정 ' + x.tap).join(' · '));
  let st = await pg.evaluate(STEAL, '.chip');
  check('칩끼리 자리를 뺏지 않는다 (' + st.n + '개)', st.bad === 0, '가려진 것 ' + st.bad);

  /* ── 기체 카드의 ⓘ ──
     카드를 누르면 곧바로 파츠로 가고, 정보는 ⓘ 로만 연다. 그래서 ⓘ 가 작으면
     **빗나간 탭이 그대로 파츠로 넘어간다** — 실제로 그 신고를 받았다.
     보이는 크기(24px)는 그대로 두고 눌리는 넓이만 넓혔으므로, 보이는 크기가 아니라
     **빗나가도 잡히는지**를 잰다. 대각선으로 빗나가는 쪽이 더 가혹해서 그쪽으로 본다. */
  const iInfo = await pg.evaluate(() => {
    const card = document.querySelector('#msList .ms-card');
    if (!card) return null;
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = card.querySelector('.ms-info');
    const f = card.querySelector('.ms-fav');
    if (!b) return { missing: true };
    const box = b.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const reach = (dx, dy) => {
      for (let d = 0; d <= 60; d++) {
        const e = document.elementFromPoint(cx + dx * d, cy + dy * d);
        if (!e || !e.closest('.ms-info')) return d - 1;
      }
      return 60;
    };
    const favBox = f ? (() => {
      const q = f.getBoundingClientRect();
      const fx = q.left + q.width / 2, fy = q.top + q.height / 2;
      const fr = (dx, dy) => { for (let d = 0; d <= 60; d++) {
        const e = document.elementFromPoint(fx + dx * d, fy + dy * d);
        if (!e || !e.closest('.ms-fav')) return d - 1; } return 60; };
      return fr(1, 0) + fr(-1, 0);
    })() : 0;
    return { w: reach(1, 0) + reach(-1, 0), h: reach(0, 1) + reach(0, -1),
      diag: reach(0.7, 0.7), favW: favBox };
  });
  if (!iInfo) console.log('  건너뜀 기체 카드 ⓘ — 목록이 없음');
  else if (iInfo.missing) check('기체 카드에 ⓘ 가 있다', false);
  else {
    check('ⓘ 판정이 ' + MIN + 'px 이상', iInfo.w >= MIN && iInfo.h >= MIN - 2,
      '판정 ' + iInfo.w + '×' + iInfo.h);
    // ★ 는 오래 써 온 기준이다. 새로 넣은 ⓘ 가 그보다 작으면 새로 나빠진 것이다.
    check('ⓘ 가 ★ 보다 누르기 쉽다', iInfo.w >= iInfo.favW,
      'ⓘ ' + iInfo.w + ' · ★ ' + iInfo.favW);
    // 12px 로 뒀더니 넓히기 **전**에도 통과했다 — 24px 짜리 네모만으로 대각 17px 이 나온다.
    // 넓힌 뒤에는 28px 이므로, 그 사이인 22 로 둬야 없어졌을 때 잡힌다.
    check('대각선으로 빗나가도 22px 까지는 ⓘ 가 잡힌다', iInfo.diag >= 22, '여유 ' + iInfo.diag + 'px');
  }

  // 기체를 골라 파츠 화면으로
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery'); i.value = '건담 Ez8';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) c.click(); });
  await sleep(1000);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1500);

  for (const [sel, ko] of [['.tool-btn', '도구 버튼'], ['.back-btn', '돌아가기'], ['.panel-fold', '칸 접기']]) {
    const rr = await pg.evaluate(PROBE, sel);
    if (!rr.length) { console.log('  건너뜀 ' + ko + ' — 화면에 없음'); continue; }
    check(ko + ' 판정이 ' + MIN + 'px 이상', rr.every(x => x.tap >= MIN),
      rr.map(x => '보이는 ' + x.box + ' → 판정 ' + x.tap).join(' · '));
  }
  // 손대지 않은 것들이 그대로인지도 적어 둔다(줄일 생각이 없다는 뜻)
  const seg = await pg.evaluate(PROBE, '.seg-btn');
  console.log('  참고 — seg-btn 은 이웃 여유가 2px 뿐이라 넓히지 않았다: '
    + seg.slice(0, 3).map(x => '보이는 ' + x.box + ' → 판정 ' + x.tap).join(' · '));

  const stAll = await pg.evaluate(STEAL, 'button');
  check('파츠 화면의 버튼이 서로 가리지 않는다 (' + stAll.n + '개)', stAll.bad === 0, '가려진 것 ' + stAll.bad);

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

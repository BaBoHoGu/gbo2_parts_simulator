// 하단 안내문이 화면 높이를 얼마나 먹는가 — 기기별로 실측한다.
//   node tools/foot_height.js
//
// ■ 왜 — 이 앱에서 가장 큰 높이 손해다. body 가 100vh·overflow:hidden·flex 이고
//   .app-foot 이 그 마지막 줄이라 **어느 화면에서나 늘 보인다.** 폰 가로에서는
//   안내문만 화면의 37% 였다(측정 2026-10-12).
//
// ■ 자가 하는 일 — 고지를 줄일 때 「줄었다」를 숫자로 말하게 한다. 문구를 고치면
//   줄바꿈이 달라져 높이가 기기마다 다르게 변하므로, 눈으로 한 기기만 보면 다른 기기에서
//   되레 늘어난 것을 놓친다. 그리고 **고지 내용이 빠지지 않았는지**도 같이 본다 —
//   높이만 재면 「다 지워서 통과」가 가능하다.
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

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
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* px 는 **2026-10-14 에 실측한 값**이다(고지를 줄인 뒤). 여유 2px 를 두었다 —
   폰세로만 84px 로 조금 느슨하다: 글자 바닥을 올리면서 그 화면 고지가
   9.5 → 10.5px 로 **커졌고**(--fs-3xs 를 쓰던 자리) 그만큼 4px 를 내줬다.
   94 → 82px 이라 줄기는 줄었고, 글자는 전보다 크다. 그 교환을 적어 둔다.
   글꼴 렌더가 기기마다 1px 쯤 달라진다. 늘어나면 운다. 줄어드는 것은 막지 않는다.
   was = 줄이기 전 값. 다시 늘어났는지 한눈에 보려고 적어 둔다. */
const VIEWS = [
  { tag: '데스크톱 1500×1000', w: 1500, h: 1000, touch: false, mobile: false, px: 75, was: 99 },
  { tag: '노트북 1280×720', w: 1280, h: 720, touch: false, mobile: false, px: 75, was: 115 },
  { tag: '태블릿 1024×768', w: 1024, h: 768, touch: true, mobile: false, px: 90, was: 115 },
  { tag: '폰세로(넓게) 390×844', w: 390, h: 844, touch: true, mobile: false, viewMode: 'wide', px: 84, was: 94 },
  { tag: '폰세로(크게) 390×844', w: 390, h: 844, touch: true, mobile: true, viewMode: 'large', px: 84, was: 94 },
  /* 폰가로는 .foot-img · .foot-src 가 이미 display:none 이라 문단을 합쳐도 줄 것이 없다.
     더 줄이려면 숨기거나 접어야 하는데 그것은 운영자가 안 하기로 했다. 62px 에서 묶어 둔다. */
  { tag: '폰가로 844×390', w: 844, h: 390, touch: true, mobile: true, px: 64, was: 62 },
  { tag: '스타일러스 800×372', w: 800, h: 372, touch: false, mobile: true, px: 64, was: 76 }
];

/* 고지에 반드시 남아 있어야 하는 말 — **높이만 재면 「다 지워서 통과」가 된다.**
   낱말이 아니라 뜻으로 고른다(문구를 다듬어도 이 뜻은 남아야 한다). */
const MUST = [
  ['비공식', /비공식/],
  ['권리자', /권리(자|는)/],
  ['제작·배급사와 무관', /제작[·、,]?\s*배급사와\s*(관련이\s*없|아무\s*관련)/],
  ['©SUNRISE', /©\s*SUNRISE/],
  ['©BANDAI NAMCO', /©\s*BANDAI NAMCO/],
  ['이미지는 공식 자료', /공식\s*사이트\s*자료|공식\s*사이트의\s*자료/],
  ['비영리', /비영리/],
  ['광고·수익 없음', /광고[·、,]?\s*수익/],
  ['판매·재배포 안 함', /판매|재배포/],
  ['요청 시 내림', /내리(겠습니다|ㅂ니다)|내립니다/],
  ['알리는 길', /GitHub Issues/],
  ['출처 링크 6개', null]
];

(async () => {
  const rows = [];
  for (const v of VIEWS) {
    const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
    const pg = await br.newPage();
    await pg.setViewport({ width: v.w, height: v.h, isMobile: v.mobile, hasTouch: v.touch,
      deviceScaleFactor: 1 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2600);
    if (v.viewMode) {
      await pg.evaluate(m => { try { localStorage.setItem('gbo2.viewMode', m); } catch { /* 무시 */ } }, v.viewMode);
      await pg.reload({ waitUntil: 'load', timeout: 180000 });
      await sleep(2600);
    }
    const r = await pg.evaluate(() => {
      const f = document.querySelector('.app-foot');
      const t = document.querySelector('.topbar');
      return {
        foot: f ? Math.round(f.getBoundingClientRect().height) : 0,
        top: t ? Math.round(t.getBoundingClientRect().height) : 0,
        vh: window.innerHeight,
        text: f ? (f.innerText || '').replace(/\s+/g, ' ').trim() : '',
        links: f ? f.querySelectorAll('.foot-links a').length : 0,
        para: f ? f.querySelectorAll('p').length : 0
      };
    });
    await br.close();
    const pct = r.vh ? Math.round(r.foot / r.vh * 1000) / 10 : 0;
    rows.push({ v, r, pct });
    console.log('  ' + v.tag.padEnd(22) + ' 안내문 ' + String(r.foot).padStart(4) + 'px'
      + ' (' + String(pct).padStart(5) + '%)  was ' + String(v.was).padStart(4) + 'px'
      + '  상단바 ' + String(r.top).padStart(3) + 'px  문단 ' + r.para + ' · 링크 ' + r.links);
  }
  console.log('');
  for (const { v, r, pct } of rows) {
    ok(v.tag + ' 안내문이 ' + v.px + 'px 를 넘지 않는다 (지금 ' + r.foot + 'px · ' + pct + '%'
      + ' · was ' + v.was + 'px)', r.foot <= v.px, { px: r.foot, 한도: v.px, vh: r.vh });
  }
  /* 내용이 빠지지 않았는가 — **고지가 다 보이는 화면**(데스크톱)에서 본다.
     폰에서는 CSS 가 .foot-img · .foot-src 를 display:none 으로 가린다. 그건 내가 한 것이
     아니고 전부터(2505959) 그랬다 — 높이를 아끼려는 선택이다. 그래서 「줄였는가」와
     「내용이 남았는가」는 **다른 화면에서** 재야 한다. 한 화면에서 둘을 재면
     폰에서 숨긴 것을 「내가 지웠다」로 읽는다(실제로 그렇게 울었다). */
  const full = rows.find(x => /데스크톱/.test(x.v.tag)) || rows[0];
  for (const [name, re] of MUST) {
    if (!re) continue;
    ok('고지에 「' + name + '」 이 남아 있다', re.test(full.r.text), full.r.text.slice(0, 140));
  }
  ok('출처 링크가 6개 그대로다', full.r.links === 6, full.r.links);

  /* **폰에서 어떤 고지가 안 보이는가** — 재서 적어 둔다. 지금은 그것이 운영자의 선택이라
     실패로 두지 않지만, 숨은 항목이 **늘어나면** 운다. 법적 문구가 조용히 더 사라지는 것을
     막는 자리다. was = 2026-10-14 실측(이미지 출처·비영리·판매금지·요청 시 내림·GitHub). */
  const HIDDEN_MAX = 6;
  for (const { v, r } of rows) {
    if (/데스크톱/.test(v.tag)) continue;
    const miss = MUST.filter(([, re]) => re && !re.test(r.text)).map(([n]) => n);
    if (miss.length) console.log('  (참고) ' + v.tag + ' 에서 안 보이는 고지 '
      + miss.length + '개 — ' + miss.join(' · '));
    ok(v.tag + ' 에서 숨은 고지가 ' + HIDDEN_MAX + '개를 넘지 않는다 (지금 ' + miss.length + '개)',
      miss.length <= HIDDEN_MAX, miss);
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

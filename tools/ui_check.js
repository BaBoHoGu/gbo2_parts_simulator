// 배포 전 UI 회귀 점검 — 실제 Chrome 으로 dist 를 띄워 "화면이 깨졌는지" 를 본다.
//   node tools/ui_check.js            전체 점검 (실패하면 exit 1)
//   node tools/ui_check.js --shots    실패한 단계의 스크린샷을 dist/ui_check/ 에 남긴다
//
// smoke.js(jsdom)는 로직·번역·이미지를 보고, 이쪽은 jsdom 이 못 보는 것 — 레이아웃·미디어쿼리·
// 겹침·터치 타겟 — 만 본다. 여기 들어 있는 항목은 전부 "실제로 배포까지 나갔던 회귀" 다.
//
//   ① 닫힌 모달이 앱을 덮음        #pietanModal{display:flex} 가 [hidden] 을 특이도로 이겼다
//   ② 가로 폰이 데스크톱으로 뜸    미디어쿼리가 (pointer:coarse) 하나에만 걸려 있었다
//   ③ 상단이 상태바에 먹힘         body 의 safe-area padding 은 position:fixed 에 안 걸린다
//   ④ 눌리지 않는 버튼            .toast{pointer-events:none} · 액션바가 드로어 위
//   ⑤ 가로 스크롤                 무장 표가 화면을 밀어냈다
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 인자로 HTML 경로를 주면 그걸 본다(배포본 검사·자체 점검용). 없으면 dist.
const ARG_FILE = process.argv.slice(2).find(a => !a.startsWith('--'));
const FILE = ARG_FILE ? path.resolve(ARG_FILE) : path.join(ROOT, 'dist', 'gbo2-simulator.html');
const SHOT_DIR = path.join(ROOT, 'dist', 'ui_check');
const WANT_SHOTS = process.argv.includes('--shots');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch (e) {
  console.log('SKIP  puppeteer-core 가 없어 UI 점검을 건너뜁니다.');
  process.exit(0);
}
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 가 없어 UI 점검을 건너뜁니다.'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome/Edge 를 찾지 못해 UI 점검을 건너뜁니다.'); process.exit(0); }

const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0; const fails = [];
function check(where, label, ok, extra) {
  if (ok) { pass++; return true; }
  fails.push({ where, label, extra: extra || '' });
  console.log('  FAIL ' + label + (extra ? '  — ' + extra : ''));
  return false;
}

/* ── 페이지 안에서 도는 검사들 (문자열로 넘기지 않고 함수로 넘긴다) ────────── */

// 닫힌 오버레이가 화면을 차지하고 있지 않은지. [hidden] 인데 실제로 보이면 회귀.
function probeHiddenOverlays() {
  const bad = [];
  for (const e of document.querySelectorAll('.auto-modal, .drawer, .mskill-inline, .png-menu')) {
    const hidden = e.hasAttribute('hidden');
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    if (hidden && cs.display !== 'none' && r.width > 0 && r.height > 0) {
      bad.push((e.id || e.className.split(' ')[0]) + ' display=' + cs.display);
    }
  }
  // 화면 한가운데가 '닫혀 있어야 할' 오버레이에 잡히면 그것도 회귀
  const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const owner = mid && mid.closest('.auto-modal[hidden], .drawer[hidden]');
  if (owner) bad.push('화면 중앙이 ' + (owner.id || owner.className) + ' 에 덮임');
  return bad;
}

// 가로 스크롤 / 화면 밖으로 나간 요소. 오프캔버스 시트·드로어·가로 슬라이드 스트립은 정상이라 뺀다.
function probeOverflow() {
  const SKIP = '.build-stats, .build-weapons, .mskill-inline, .drawer, .topbar, .chips, .filter-group, .w-tools, .weapon-list, .weapon, .weapon-head';
  const out = { hScroll: document.documentElement.scrollWidth > innerWidth + 1, beyond: [] };
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (e.closest(SKIP)) continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right > innerWidth + 2 || r.left < -2) {
      out.beyond.push((e.id ? '#' + e.id : '.' + String(e.className).split(' ')[0]) + ' x=' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  }
  out.beyond = [...new Set(out.beyond)].slice(0, 6);
  return out;
}

// 이 요소를 그 자리에서 실제로 누를 수 있는가 (다른 것이 위에 덮고 있지 않은가)
function probeHittable(sel) {
  const e = document.querySelector(sel);
  if (!e) return { found: false };
  const r = e.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { found: true, visible: false };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  // 그 좌표에서 잡히는 게 자기 자신이거나 자기 자식이어야 '눌린다'.
  // 조상이 잡히면 그건 자기 자신이 이벤트를 못 받는다는 뜻이다(pointer-events:none 등).
  const hit = document.elementFromPoint(x, y);
  const blocker = hit && !(hit === e || e.contains(hit))
    ? (hit.id ? '#' + hit.id : '.' + String(hit.className).split(' ')[0]) : null;
  return { found: true, visible: true, ok: !blocker, blocker, inView: r.top >= 0 && r.bottom <= innerHeight + 1 };
}

// 고정 오버레이가 상단 안전영역(상태바)을 침범하지 않는가.
// env() 는 데스크톱 Chrome 에서 늘 0 이라 흉내낼 수 없으므로, 같은 자리에 인셋을 강제로 넣고 본다.
function probeSafeTop(sel, inset) {
  const e = document.querySelector(sel);
  if (!e) return { found: false };
  const kids = [...e.children].filter(c => c.getBoundingClientRect().height > 0);
  if (!kids.length) return { found: true, empty: true };
  const top = Math.round(kids[0].getBoundingClientRect().top);
  const r = e.getBoundingClientRect();
  return { found: true, top, inset, ok: top >= inset - 1, overflowBelow: Math.round(r.bottom - innerHeight) };
}

/* ── 시나리오 ─────────────────────────────────────────────────────────────── */

const VIEWS = [
  { tag: 'desktop', w: 1500, h: 1000, touch: false, mobile: false },
  { tag: '폰세로', w: 390, h: 844, touch: true, mobile: true },
  { tag: '폰가로', w: 844, h: 390, touch: true, mobile: true },
  // S펜 단말·DeX 처럼 터치인데 pointer:fine 을 보고하는 경우. ② 회귀가 여기서만 났다.
  { tag: '폰가로(스타일러스)', w: 800, h: 372, touch: false, mobile: true }
];

// 상단 인셋을 강제로 넣어 ③ 을 본다. env() 와 같은 자리에 들어가므로 동작이 동일하다.
const INSET = 44;
const INSET_CSS = `
  body { padding-top: ${INSET}px !important; }
  #pietanModal { padding-top: ${INSET}px !important; }
  .drawer { padding-top: ${INSET}px !important; }
  .auto-modal:not(#pietanModal) { top: calc(50% + ${INSET / 2}px) !important; max-height: calc(100vh - ${INSET + 20}px) !important; }
  .build-stats, .build-weapons, .mskill-inline.sheet-open { padding-top: ${INSET}px !important; }
`;

async function shot(pg, name) {
  if (!WANT_SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  try { await pg.screenshot({ path: path.join(SHOT_DIR, name.replace(/[^\w가-힣]+/g, '_') + '.png') }); } catch (e) { /* 무시 */ }
}

async function step(pg, view, name) {
  const hidden = await pg.evaluate(probeHiddenOverlays);
  const over = await pg.evaluate(probeOverflow);
  const okA = check(view.tag, `[${name}] 닫힌 오버레이가 화면을 덮지 않음`, hidden.length === 0, hidden.join(' | '));
  const okB = check(view.tag, `[${name}] 가로 스크롤 없음`, !over.hScroll);
  const okC = check(view.tag, `[${name}] 화면 밖으로 나간 요소 없음`, over.beyond.length === 0, over.beyond.join(' | '));
  if (!(okA && okB && okC)) await shot(pg, view.tag + '_' + name);
}

async function runView(view) {
  console.log('\n■ ' + view.tag + ' (' + view.w + 'x' + view.h + ', pointer=' + (view.touch ? 'coarse' : 'fine') + ')');
  const browser = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const pg = await browser.newPage();
    if (view.touch) {
      await pg.emulate({ viewport: { width: view.w, height: view.h, isMobile: true, hasTouch: true },
        userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' });
    } else {
      await pg.setViewport({ width: view.w, height: view.h });
    }
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
    await pg.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
    for (let i = 0; i < 80 && !(await pg.$('.ms-card')); i++) await sleep(100);
    check(view.tag, '기체 목록이 그려짐', !!(await pg.$('.ms-card')));
    await pg.addStyleTag({ content: INSET_CSS });     // ③ 검사를 위해 상단 인셋 강제
    await step(pg, view, '선택화면');

    // ── 빌드 화면 ──
    await pg.evaluate(() => document.querySelector('.ms-card').click());
    await sleep(1600);
    await step(pg, view, '빌드화면');

    // ② 폰 크기면 모바일 레이아웃이 걸려야 한다 (pointer 와 무관하게)
    if (view.mobile) {
      const m = await pg.evaluate(() => ({
        actionbar: !!document.querySelector('.m-actionbar') && getComputedStyle(document.querySelector('.m-actionbar')).display !== 'none',
        more: !!document.querySelector('#topbarMore') && getComputedStyle(document.querySelector('#topbarMore')).display !== 'none'
      }));
      check(view.tag, '모바일 레이아웃 적용 (하단 액션바·⋯ 메뉴)', m.actionbar && m.more, JSON.stringify(m));
    }

    // ── 파츠 장착 + ④ 되돌리기 토스트가 실제로 눌리는가 ──
    await pg.evaluate(() => [...document.querySelectorAll('#partList .part-tile')].slice(0, 3).forEach(t => t.click()));
    await sleep(900);
    const undo = await pg.evaluate(probeHittable, '.toast-act');
    check(view.tag, '되돌리기 버튼이 눌리는 자리에 있음', undo.found && undo.visible && undo.ok && undo.inView,
      JSON.stringify(undo));
    if (!(undo.ok && undo.inView)) await shot(pg, view.tag + '_토스트');
    await step(pg, view, '파츠장착');

    // ── 모바일 시트 3종 ──
    if (view.mobile) {
      const n = await pg.evaluate(() => document.querySelectorAll('.m-actionbar button').length);
      for (let i = 0; i < n; i++) {
        await pg.evaluate(k => document.querySelectorAll('.m-actionbar button')[k].click(), i);
        await sleep(800);
        const nm = ['성능시트', '무장시트', '스킬시트'][i] || ('시트' + (i + 1));
        await step(pg, view, nm);
        const closeSel = i === 2 ? '#mskillClose' : '.sheet-open > .sheet-close';
        const c = await pg.evaluate(probeHittable, closeSel);
        check(view.tag, `[${nm}] 닫기 버튼이 눌리는 자리에 있음`, c.found && c.visible && c.ok, JSON.stringify(c));
        // ③ 시트 상단이 상태바에 안 먹히는가
        if (i < 2) {
          const sel = i === 0 ? '.build-stats' : '.build-weapons';
          const st = await pg.evaluate(probeSafeTop, sel, INSET);
          check(view.tag, `[${nm}] 상단 안전영역 존중`, st.found && st.ok, JSON.stringify(st));
        }
        await pg.evaluate(() => { const b = document.querySelector('.sheet-backdrop'); if (b) b.click(); });
        await sleep(500);
      }
    }

    // ── 자동 구성 드로어: ④ 「구성 찾기」 가 액션바에 가리지 않는가 ──
    await pg.evaluate(() => document.querySelector('#openAuto').click());
    await sleep(2600);
    const run = await pg.evaluate(probeHittable, '.drawer-foot button');
    check(view.tag, '자동 구성 실행 버튼이 눌리는 자리에 있음', run.found && run.visible && run.ok && run.inView, JSON.stringify(run));
    const dr = await pg.evaluate(probeSafeTop, '.drawer', INSET);
    check(view.tag, '자동 구성 드로어 상단 안전영역 존중', dr.found && dr.ok, JSON.stringify(dr));
    if (!(run.ok && dr.ok)) await shot(pg, view.tag + '_드로어');
    await pg.evaluate(() => document.querySelector('#closeAuto').click());
    await sleep(700);

    // ── 모달들 ──
    const MODALS = [
      ['#load', '#savedModal', '저장목록', '#savedModalClose'],
      ['#compareBtn', '#compareModal', '비교', '#compareModalClose'],
      ['#ownedBtn', '#ownedModal', '기본파츠', '#ownedModalClose']
    ];
    for (const [open, sel, nm, close] of MODALS) {
      await pg.evaluate(s => { const b = document.querySelector(s); if (b) b.click(); }, open);
      await sleep(1100);
      await step(pg, view, nm);
      const st = await pg.evaluate(probeSafeTop, sel, INSET);
      check(view.tag, `[${nm}] 상단 안전영역 존중`, st.found && st.ok, JSON.stringify(st));
      const cl = await pg.evaluate(probeHittable, close);
      check(view.tag, `[${nm}] 닫기 버튼이 눌리는 자리에 있음`, cl.found && cl.visible && cl.ok, JSON.stringify(cl));
      if (!(st.ok && cl.ok)) await shot(pg, view.tag + '_' + nm);
      await pg.evaluate(s => { const b = document.querySelector(s); if (b) b.click(); }, close);
      await sleep(600);
    }

    // ── 피탄 시뮬 (① 이 났던 자리) ──
    await pg.evaluate(() => document.querySelector('#pietanBtn').click());
    await sleep(1000);
    await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); if (q) { q.value = '자쿠'; q.dispatchEvent(new Event('input')); } });
    await sleep(800);
    await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
    await sleep(1200);
    await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
    await sleep(1000);
    await step(pg, view, '피탄시뮬');
    const pt = await pg.evaluate(probeSafeTop, '#pietanModal', INSET);
    check(view.tag, '[피탄시뮬] 상단 안전영역 존중', pt.found && pt.ok, JSON.stringify(pt));
    // 모달이 화면 밖으로 늘어지지 않고 안쪽이 스크롤되는가
    const fit = await pg.evaluate(() => {
      const m = document.querySelector('#pietanModal'), r = m.getBoundingClientRect();
      const res = m.querySelector('.pietan-result');
      return { below: Math.round(r.bottom - innerHeight),
        resBelow: res ? Math.round(res.getBoundingClientRect().bottom - innerHeight) : 0 };
    });
    check(view.tag, '[피탄시뮬] 모달이 화면 안에 들어옴', fit.below <= 1 && fit.resBelow <= 1, JSON.stringify(fit));
    if (!(pt.ok && fit.below <= 1)) await shot(pg, view.tag + '_피탄');
    await pg.evaluate(() => document.querySelector('#pietanClose').click());
    await sleep(600);

    check(view.tag, '페이지 오류 없음', errs.length === 0, errs.join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log('UI 회귀 점검 — ' + path.relative(ROOT, FILE));
  for (const v of VIEWS) await runView(v);
  console.log('\n' + '─'.repeat(52));
  if (!fails.length) {
    console.log('UI 점검 통과 — ' + pass + '개 항목 이상 없음');
    process.exit(0);
  }
  console.log('UI 점검 실패 — ' + fails.length + '건 (통과 ' + pass + ')');
  for (const f of fails) console.log('  · [' + f.where + '] ' + f.label + (f.extra ? '  — ' + f.extra : ''));
  if (WANT_SHOTS) console.log('\n스크린샷: ' + path.relative(ROOT, SHOT_DIR));
  else console.log('\n--shots 를 붙이면 실패한 단계의 스크린샷을 남깁니다.');
  process.exit(1);
})().catch(e => { console.error('UI 점검 중 오류:', e); process.exit(1); });

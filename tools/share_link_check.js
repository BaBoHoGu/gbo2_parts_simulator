// 공유 링크 — 누르면 그 구성으로 바로 열리는가.
//   node tools/build.js && node tools/share_link_check.js
//
// 왜 (2026-11-27 사용자 요청) — 공유 코드만 건네면 받는 사람이 사이트를 열고 · 기체를 고르고 ·
// 「⋯ → 가져오기」를 찾아 붙여넣어야 했다. 「사이트로 공유하기 힘들다」. 이제 「🔗 공유」는
// `https://gbo2-parts.pages.dev/#b=<코드>` 를 만들고, 그 주소로 열면 구성이 곧바로 적용된다.
//
// 재는 것
//   ① 링크로 열면 파츠 화면에 그 기체 · 그 파츠가 선다
//   ② 연 뒤 주소에서 #b= 가 지워진다(새로고침하면 고치던 구성이 링크 것으로 돌아가므로)
//   ③ **뒤로가기로 링크 구성이 되살아나지 않는다** — 뒤로가기 덫(pushState)이 해시 달린 주소를
//      복제하면 뒤로 갈 때 hashchange 가 와서 구성이 다시 열린다(만들다 실제로 그랬다)
//   ④ 「🔗 공유」가 PC 에서는 사이트 주소 링크를 복사하고, 폰(터치)에서는 공유 창을 띄운다
//   ⑤ 「가져오기」 칸에 링크를 통째로 붙여넣어도 받는다 · 이미 열린 탭에서 해시만 바뀌어도 연다
// 누르기는 elementFromPoint 로 닿는지 보고 진짜 마우스로 누른다.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'gbo2-simulator.html');
const SITE = 'https://gbo2-parts.pages.dev/';

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 앱의 encodeShare 와 같은 꼴(base64url, 패딩 없음) — 키 m·p·s·e·l */
const encode = b => Buffer.from(JSON.stringify({ m: b.ms, p: b.parts, s: b.stage, e: b.exp, l: b.expLv }), 'utf8')
  .toString('base64url');
const decode = code => { try { return JSON.parse(Buffer.from(code, 'base64url').toString('utf8')); } catch { return null; } };
const codeOf = link => { const m = String(link || '').match(/#b=([A-Za-z0-9_\-]+)/); return m ? m[1] : null; };

/* 시험할 구성 — 실제로 공유된 구성(갤러리 백업)에서 파츠가 넉넉한 것을 고른다. 없으면 기본값. */
function sampleBuild() {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'share-backup', 'builds.json'), 'utf8'));
    const list = (Array.isArray(all) ? all : Object.values(all)).filter(b => b && b.ms && Array.isArray(b.parts));
    const b = list.find(x => x.parts.length >= 4);
    if (b) return b;
  } catch { /* 백업이 없으면 아래로 */ }
  return { ms: 'ガンダムEz8_LV1', parts: [], stage: 6, exp: '', expLv: 5 };
}

(async () => {
  if (!fs.existsSync(DIST)) { console.log('  (건너뜀) dist 가 없다 — node tools/build.js 먼저'); process.exit(1); }
  const GBO2Browser = require('./lib/browser.js');
  const { findChrome } = require('./lib/wiki_fetch.js');
  const br = await GBO2Browser.launch({ executablePath: findChrome(), headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const BASE = 'file:///' + DIST.split(path.sep).join('/').replace(/ /g, '%20');
  const b = sampleBuild();
  const code = encode(b);
  console.log('  시험 구성: ' + b.ms + ' · 파츠 ' + b.parts.length + '개');

  /** 복사·공유 창을 가로채는 페이지 — 클립보드·navigator.share 는 헤드리스에서 막히므로 붙잡아 둔다 */
  async function page(opt = {}) {
    const pg = await br.newPage();
    await pg.setViewport(opt.phone
      ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
      : { width: 1500, height: 1000, deviceScaleFactor: 1 });
    await pg.evaluateOnNewDocument(() => {
      window.__copied = null; window.__shared = null;
      try {
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } });
        Object.defineProperty(navigator, 'share', { configurable: true,
          value: d => { window.__shared = d; return Promise.resolve(); } });
      } catch (e) { /* 못 바꾸면 해당 항목이 실패로 드러난다 */ }
    });
    pg.__prompts = [];
    pg.on('dialog', d => { pg.__prompts.push(d.message()); d.accept(pg.__answer || ''); });
    return pg;
  }
  const state = pg => pg.evaluate(() => ({
    view: (document.body.className.match(/view-[a-z]+/) || [])[0],
    hash: location.hash,
    title: (document.querySelector('#msTitle, .build-ms-name, .hero-name') || {}).textContent || ''
  }));
  /** 메뉴 버튼을 열고 그 안의 항목(.pm-t 글자)을 진짜 마우스로 누른다 */
  async function menuClick(pg, opener, label) {
    const at = await pg.evaluate(sel => {
      const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect(); if (!r.width) return null;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const h = document.elementFromPoint(x, y);
      return { x, y, hit: !!(h && (h === e || e.contains(h))) };
    }, opener);
    if (!at || !at.hit) return { err: opener + ' 에 안 닿는다', at };
    await pg.mouse.click(at.x, at.y); await sleep(300);
    const it = await pg.evaluate(lb => {
      const m = document.querySelector('.more-menu'); if (!m) return null;
      const t = [...m.querySelectorAll('.pm-t')].find(x => x.textContent.trim() === lb);
      if (!t) return { items: [...m.querySelectorAll('.pm-t')].map(x => x.textContent.trim()) };
      const e = t.closest('button') || t;
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const h = document.elementFromPoint(x, y);
      return { x, y, hit: !!(h && (h === e || e.contains(h))) };
    }, label);
    if (!it || !it.hit) return { err: label + ' 항목에 안 닿는다', it };
    await pg.mouse.click(it.x, it.y); await sleep(700);
    return { ok: true };
  }
  /** 앱이 지금 들고 있는 구성 — 「🔗 공유」로 뽑아 본다(앱에 따로 묻는 창구를 만들지 않는다) */
  async function currentByShare(pg) {
    const r = await menuClick(pg, '#exportMenuBtn', '🔗 공유');
    const got = await pg.evaluate(() => ({ copied: window.__copied, shared: window.__shared }));
    return { ...r, ...got, prompts: pg.__prompts.slice() };
  }

  /* ── ① ② 링크로 연다 ───────────────────────────────────── */
  const pg = await page();
  await pg.goto(BASE + '#b=' + code, { waitUntil: 'load', timeout: 180000 });
  await sleep(2500);
  const s1 = await state(pg);
  ok('① 공유 링크로 열면 곧바로 파츠 화면이다', s1.view === 'view-build', s1);
  ok('② 연 뒤 주소에서 #b= 를 지운다', !/b=/.test(s1.hash), s1);

  const c1 = await currentByShare(pg);
  const back1 = decode(codeOf(c1.copied)) || {};
  ok('① 링크의 기체가 그대로 섰다', back1.m === b.ms, { 원래: b.ms, 앱: back1.m, c1 });
  const kept = (back1.p || []).filter(p => b.parts.includes(p)).length;
  ok('① 링크의 파츠가 섰다 (원래 ' + b.parts.length + '개)',
    b.parts.length === 0 || (kept >= Math.min(1, b.parts.length) && kept === (back1.p || []).length),
    { 원래: b.parts, 앱: back1.p });

  /* ── ④ PC 의 「🔗 공유」 는 사이트 주소 링크를 복사한다 ───────── */
  ok('④ PC: 「🔗 공유」가 사이트 주소 링크를 복사한다',
    typeof c1.copied === 'string' && c1.copied.startsWith(SITE + '#b='), c1);
  ok('④ PC: 공유 창은 띄우지 않는다(복사만)', c1.shared == null, c1);
  ok('④ 파일로 연 앱에서도 링크는 사이트 주소다(받는 사람이 앱이 없어도 열린다)',
    typeof c1.copied === 'string' && !/^file:/.test(c1.copied), c1.copied);

  /* ── ③ 뒤로가기로 링크 구성이 되살아나지 않는다 ─────────────── */
  await pg.evaluate(() => history.back()); await sleep(1200);
  const s3 = await state(pg);
  ok('③ 뒤로가기는 한 걸음 물러난다(기체 선택)', s3.view === 'view-select', s3);
  await sleep(600);
  const s3b = await state(pg);
  ok('③ 뒤로가기로 링크 구성이 다시 열리지 않는다', s3b.view === 'view-select' && !/b=/.test(s3b.hash), s3b);

  /* ── ⑤ 이미 열린 탭에서 해시만 바뀌어도 연다 ───────────────
     **다른** 링크를 넣는다. 방금 연 코드는 일부러 다시 안 연다(뒤로가기 때 되살아나는 것을 막는 대가). */
  const code2 = encode({ ...b, stage: 4 });
  await pg.evaluate(c => { location.hash = '#b=' + c; }, code2); await sleep(1200);
  const s5 = await state(pg);
  ok('⑤ 이미 열린 탭에 다른 링크를 넣어도 그 구성이 열린다', s5.view === 'view-build' && !/b=/.test(s5.hash), { view: s5.view, hash: s5.hash.slice(0, 20) });

  /* 깨진 링크 — 앱이 멈추지 않고 화면도 안 바뀐다 */
  await pg.evaluate(() => history.back()); await sleep(1000);
  const before = await state(pg);
  await pg.evaluate(() => { location.hash = '#b=%%%garbage'; }); await sleep(900);
  await pg.evaluate(() => { location.hash = '#b=bm90LWpzb24'; }); await sleep(900);
  const sBad = await state(pg);
  ok('깨진 링크는 화면을 바꾸지 않는다', sBad.view === before.view, { before, sBad });
  await pg.close();

  /* ── ⑤ 「가져오기」 칸에 링크를 통째로 붙여넣는다 ─────────────── */
  {
    const p2 = await page();
    await p2.goto(BASE, { waitUntil: 'load', timeout: 180000 });
    await sleep(2500);
    p2.__answer = '이 구성 써 봐 ' + SITE + '#b=' + code + ' ㅎㅎ';   // 메시지째 붙여넣는 경우
    const r = await menuClick(p2, '#topbarMore', '가져오기');
    const s = await state(p2);
    ok('⑤ 「가져오기」가 링크(메시지째)를 받는다', !!r.ok && s.view === 'view-build', { r, s, prompts: p2.__prompts });
    const c = await currentByShare(p2);
    ok('⑤ 가져온 기체가 링크의 기체다', (decode(codeOf(c.copied)) || {}).m === b.ms, c);
    await p2.close();
  }

  /* ── ④ 폰: 공유 창을 띄운다 ─────────────────────────────── */
  {
    const p3 = await page({ phone: true });
    await p3.goto(BASE + '#b=' + code, { waitUntil: 'load', timeout: 180000 });
    await sleep(2500);
    const c = await currentByShare(p3);
    const url = c.shared && c.shared.url;
    ok('④ 폰: 「🔗 공유」가 공유 창을 띄운다(카카오톡·디스코드로 바로)',
      typeof url === 'string' && url.startsWith(SITE + '#b='), c);
    ok('④ 폰: 공유 창에 넘긴 링크가 그 구성이다', (decode(codeOf(url)) || {}).m === b.ms, url);
    await p3.close();
  }

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

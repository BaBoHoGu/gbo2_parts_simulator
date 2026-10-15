// 아홉 모달이 **진짜 모달**로 도는가 — 실측(CSS 10단계).
//   node tools/modal_check.js
//
// ■ 왜 — 모달 아홉이 div + 뒤판 div + z-index 51 이었다. Tab 이 뒤 화면으로 새고, 닫아도 포커스가
//   연 단추로 안 돌아갔다. <dialog> + showModal() 로 바꿨다(ui.js setModal, 대결 창과 같은 길).
//   모달마다 ① :modal ② Tab 이 안 샌다 ③ Esc ④ 뒤판 ⑤ 폰 뒤로가기(cancel) ⑥ 포커스 복귀 를 본다.
//
// ■ 최상위 층으로 옮기면서 생긴 함정 둘도 같이 잰다.
//   · 강화 플랜 → 「기체 고르기」 서랍: 모달 dialog 위의 것은 **inert** 라 서랍을 못 누른다
//     (Chrome 실측 — 위에 popover 를 띄워도 클릭이 안 먹었다). 서랍이 열린 동안 모달을 비모달로 내린다.
//   · 토스트: z-index 60 으로는 최상위 층의 모달 뒤에 깔린다 — popover 로 맨 위에 다시 띄운다.
//     이미 떠 있던 토스트도 새 모달이 열리면 다시 올린다(안 그러면 뒤판 밑에서 흐려진다).
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

/* [모달 id, 여는 단추(보이는 것이면 마우스로 누르고 포커스 복귀를 잰다), 열기 앞 준비] */
const MODALS = [
  ['stageHelpModal', '#stageHelp'],
  ['expHelpModal', '#expHelp'],
  ['compareModal', '#compareBtn'],
  ['savedModal', '#load'],
  ['ownedModal', '#ownedBtn'],
  ['uploadModal', '#uploadBtn'],
  ['adminModal', '#galleryAdmin'],
  ['pngModal', '#pngBtn', 'png'],
  ['planEditModal', '.plan-add', 'plan'],
];

async function freshBuild(br, view) {
  const ctx = await br.createBrowserContext();
  const pg = await ctx.newPage();
  pg.on('dialog', d => d.accept('modal').catch(() => {}));
  await pg.setViewport(view);
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2400);
  await pg.evaluate(() => {
    const q = document.querySelector('#msQuery');
    q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(500);
  await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(600);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(900);
  return { ctx, pg };
}

const state = (pg, id) => pg.evaluate(id => {
  const d = document.getElementById(id);
  const a = document.activeElement;
  return { open: !!d && !d.hidden, modal: !!d && d.matches(':modal'), inside: !!d && (a === d || d.contains(a)),
    active: a ? (a.id || a.tagName + '.' + String(a.className).slice(0, 20)) : null,
    ring: a ? getComputedStyle(a).outlineStyle : null,
    lockedBack: [...document.querySelectorAll('.auto-modal-back')].filter(b => !b.hidden).map(b => b.id) };
}, id);

async function openIt(pg, id, sel, prep) {
  if (prep === 'plan') {
    await pg.evaluate(() => document.getElementById('planBtn').click());
    await sleep(800);
  }
  /* 보이는 단추는 진짜 마우스로 — 그래야 「닫으면 그 단추로 포커스가 돌아간다」 를 잴 수 있다 */
  const box = await pg.evaluate(sel => {
    const e = document.querySelector(sel);
    if (!e) return null;
    e.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = e.getBoundingClientRect();
    return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, sel);
  if (box) await pg.mouse.click(box.x, box.y);
  else await pg.evaluate(sel => document.querySelector(sel).click(), sel);
  await sleep(400);
  if (prep === 'png') {
    await pg.evaluate(() => document.querySelector('.png-menu-item').click());
    await sleep(5000);
  }
  await sleep(500);
  return !!box && prep !== 'png';     // png 는 메뉴를 거쳐 열리므로 포커스가 단추로 안 돌아가도 맞다
}

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const DESK = { width: 1500, height: 1000, deviceScaleFactor: 1 };

  for (const [id, sel, prep] of MODALS) {
    const { ctx, pg } = await freshBuild(br, DESK);
    const byMouse = await openIt(pg, id, sel, prep);
    let s = await state(pg, id);
    ok(id + ' ① 열면 최상위 층(:modal) · 예전 뒤판 div 는 안 쓴다', s.open && s.modal && !s.lockedBack.length, s);
    ok(id + '    열 때 포커스가 창 안에 있다', s.inside, s);

    /* 모달 dialog 에서 마지막 칸 다음 Tab 은 **브라우저 바깥(주소창 등)** 으로 간다 — 그때 activeElement 는
       BODY 다(실측: 「닫기 | BODY | 닫기 | BODY …」). 그건 새는 것이 아니다. 새는 것은 **뒤 화면의 진짜 요소**
       (상단바 단추·파츠 타일)에 가는 것이다 — 처음엔 BODY 도 밖으로 세어 여덟 개가 거짓으로 울었다.
       BODY 에 간 다음 Tab 은 다시 창 안으로 돌아와야 한다(그래야 「돌고 있다」). */
    const out = [], ring = [];
    let wasBody = false, cameBack = true;
    for (let i = 0; i < 10; i++) {
      await pg.keyboard.press('Tab');
      const t = await state(pg, id);
      const body = t.active && /^(BODY|HTML)\b/.test(t.active);
      if (!t.inside && !body) out.push(t.active);
      if (wasBody && !t.inside && !body) cameBack = false;
      wasBody = body;
      ring.push(t.inside ? 'in' : (body ? 'body' : 'OUT'));
    }
    ok(id + ' ② Tab 열 번에 뒤 화면의 요소로 안 간다 (창 안 ↔ 브라우저만 돈다)', out.length === 0 && cameBack, { out, ring });

    await pg.keyboard.press('Escape');
    await sleep(400);
    s = await state(pg, id);
    ok(id + ' ③ Esc 로 닫힌다', !s.open && !s.modal, s);
    const sel0 = sel.startsWith('#') ? sel.slice(1) : null;
    if (byMouse && sel0) ok(id + ' ⑥ 닫으면 포커스가 연 단추로 돌아간다', s.active === sel0, s);

    /* ④ 뒤판 — 창 밖 왼쪽 위 구석 */
    await openIt(pg, id, sel, prep === 'plan' ? null : prep);
    if (prep === 'plan') { await pg.evaluate(() => document.querySelector('.plan-add').click()); await sleep(600); }
    const corner = await pg.evaluate(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { x: Math.max(3, r.left / 2), y: Math.max(3, r.top / 2) };
    }, id);
    await pg.mouse.click(corner.x, corner.y);
    await sleep(400);
    s = await state(pg, id);
    ok(id + ' ④ 뒤판을 누르면 닫힌다', !s.open, { ...s, corner });

    /* ⑤ 폰 뒤로가기 몸짓 = cancel */
    await openIt(pg, id, sel, prep === 'plan' ? null : prep);
    if (prep === 'plan') { await pg.evaluate(() => document.querySelector('.plan-add').click()); await sleep(600); }
    const rc = await pg.evaluate(async id => {
      const d = document.getElementById(id);
      if (typeof d.requestClose !== 'function') return { skip: true };
      d.requestClose();
      await new Promise(r => setTimeout(r, 300));
      return { hidden: d.hidden, modal: d.matches(':modal') };
    }, id);
    if (!rc.skip) ok(id + ' ⑤ 뒤로가기 몸짓(cancel)으로 닫히면 hidden 도 풀린다', rc.hidden && !rc.modal, rc);
    await ctx.close();
  }

  /* ── 관리자 창: 닫으면 비밀번호 칸을 비운다 — 닫는 길이 뒤판 onclick 하나로 모였는지 ── */
  {
    const { ctx, pg } = await freshBuild(br, DESK);
    for (const how of ['Escape', 'cancel']) {
      await pg.evaluate(() => document.getElementById('galleryAdmin').click());
      await sleep(400);
      await pg.evaluate(() => { document.getElementById('adminPw').value = 'typed-secret'; });
      if (how === 'Escape') await pg.keyboard.press('Escape');
      else await pg.evaluate(() => { const d = document.getElementById('adminModal'); if (d.requestClose) d.requestClose(); else d.dispatchEvent(new Event('cancel', { cancelable: true })); });
      await sleep(300);
      const v = await pg.evaluate(() => document.getElementById('adminPw').value);
      ok('관리자 창을 ' + how + ' 로 닫으면 비밀번호 칸이 비워진다', v === '', v ? '(남아 있음)' : v);
    }
    await ctx.close();
  }

  /* ── 강화 플랜 → 기체 고르기 서랍이 눌리고, 고른 뒤 모달로 돌아온다 ── */
  {
    const { ctx, pg } = await freshBuild(br, DESK);
    await openIt(pg, 'planEditModal', '.plan-add', 'plan');
    await pg.evaluate(() => document.getElementById('planPickMs').click());
    await sleep(900);
    const hit = await pg.evaluate(() => {
      const c = document.querySelector('#msDrawerList .ms-card');
      if (!c) return { none: true };
      const r = c.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { onCard: !!e && (e === c || c.contains(e)), at: e ? (e.id || e.className) : null,
        modalNow: document.getElementById('planEditModal').matches(':modal') };
    });
    ok('강화 플랜 위 기체 서랍의 카드가 눌린다 (모달 뒤판·inert 에 안 막힌다)', hit.onCard, hit);
    await pg.evaluate(() => document.querySelector('#msDrawerList .ms-card').click());
    await sleep(700);
    const back = await pg.evaluate(() => {
      const d = document.getElementById('planEditModal');
      return { open: !d.hidden, modal: d.matches(':modal'),
        drawer: document.getElementById('msDrawer').classList.contains('open') };
    });
    ok('기체를 고르면 서랍이 닫히고 강화 플랜이 다시 모달이 된다', back.open && back.modal && !back.drawer, back);
    await ctx.close();
  }

  /* ── 토스트가 모달 위에 **밝게** 보인다 ──
     inert 라 elementFromPoint 로는 못 잰다 — 화면을 찍어 토스트 바탕색이 그대로인지 본다
     (뒤판 밑에 깔리면 검게 55% 눌린다). */
  {
    const { ctx, pg } = await freshBuild(br, DESK);
    /* 토스트를 먼저 띄우고(파츠 장착) 모달을 연다 — 「떠 있던 토스트」 길 */
    await pg.evaluate(() => document.querySelector('#partList .part-tile').click());
    await sleep(150);
    await pg.evaluate(() => document.getElementById('compareBtn').click());
    await sleep(400);
    const t = await pg.evaluate(() => {
      const e = document.getElementById('toast');
      const r = e.getBoundingClientRect();
      return { shown: e.classList.contains('show'), x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2),
        bg: getComputedStyle(e).backgroundColor };
    });
    const shot = await pg.screenshot({ clip: { x: t.x, y: t.y, width: 1, height: 1 }, encoding: 'base64' });
    const px = await pg.evaluate(async b64 => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
    }, shot);
    const want = (t.bg.match(/\d+/g) || []).slice(0, 3).map(Number);
    const near = want.length === 3 && px.every((v, i) => Math.abs(v - want[i]) <= 12);
    ok('떠 있던 토스트가 새 모달 위에 밝게 보인다 (뒤판에 안 깔린다)', t.shown && near, { 화면: px, 바탕: want });
    await ctx.close();
  }

  /* ── 폰: 열 때 「닫기」 에 고리가 안 그려진다 (메뉴 길 = click()) ── */
  {
    const { ctx, pg } = await freshBuild(br, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await pg.evaluate(() => document.getElementById('load').click());
    await sleep(600);
    const s = await state(pg, 'savedModal');
    ok('폰에서 메뉴 길로 열어도 고리가 안 그려진다', s.open && s.inside && s.ring === 'none', s);
    await ctx.close();
  }

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

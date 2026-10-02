// 강화 플랜 화면 실측 — 버튼·영역·저장·드래그·뒤로가기.
//   node tools/plan_check.js
//
// 드래그는 **포인터 이벤트로 직접** 만들었다(HTML5 드래그는 터치에서 안 걸린다).
// 그래서 여기서도 CDP 로 진짜 마우스를 움직여 끌어 본다 — dispatchEvent 로 만든
// 가짜 이벤트는 setPointerCapture·elementFromPoint 를 제대로 안 거쳐서,
// 통과해도 사람이 끌었을 때 되는지는 모른다.
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const ROOT = path.join(__dirname, '..');

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

(async () => {
  const br = await GBO2Browser.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1400, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);

  // ── 버튼이 토큰 오른쪽에 있다 (요청한 자리)
  const btn = await pg.evaluate(() => {
    const p = document.querySelector('#planBtn'), t = document.querySelector('#tokenBtn');
    if (!p || !t) return null;
    return { text: p.textContent.trim(), afterToken: t.compareDocumentPosition(p) & 4 ? true : false };
  });
  ok('토큰 오른쪽에 강화 플랜 버튼이 있다', !!btn && btn.afterToken, btn);

  // ── 따로 떨어진 화면으로 열린다
  await pg.evaluate(() => document.querySelector('#planBtn').click());
  await sleep(600);
  const opened = await pg.evaluate(() => ({
    cls: document.body.className.split(/\s+/).filter(c => c.indexOf('view-') === 0),
    visible: !!document.querySelector('#screenPlan') && getComputedStyle(document.querySelector('#screenPlan')).display !== 'none',
    others: ['#screenSelect', '#screenBuild', '#screenToken', '#screenCodex']
      .filter(s => document.querySelector(s) && getComputedStyle(document.querySelector(s)).display !== 'none')
  }));
  ok('강화 플랜이 독립 화면으로 열린다', opened.visible && opened.cls.includes('view-plan'), opened);
  ok('다른 화면은 함께 보이지 않는다', opened.others.length === 0, opened.others);

  // ── 1~3순위 구역과 ＋ 박스
  const zones = await pg.evaluate(() => ({
    heads: [...document.querySelectorAll('.plan-zone-head')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    drops: [...document.querySelectorAll('.plan-drop')].map(e => e.dataset.rank),
    adds: document.querySelectorAll('.plan-add').length,
    filters: [...document.querySelectorAll('#screenPlan .filter-lb')].map(e => e.textContent.trim())
  }));
  ok('1~3순위 구역이 있다', zones.drops.join(',') === '1,2,3', zones.drops);
  ok('구역마다 ＋ 박스가 있다', zones.adds === 3, zones.adds);
  ok('상단에 속성·코스트·레벨·등급·순위 필터가 있다',
    ['속성', '코스트', '레벨', '등급', '순위'].every(k => zones.filters.includes(k)), zones.filters);

  // ── ＋ → 기체 선택 → 강화·확장 지정 → 저장 → 박스 생성
  await pg.evaluate(() => document.querySelector('.plan-drop[data-rank="2"] .plan-add').click());
  await sleep(400);
  const modal = await pg.evaluate(() => {
    const m = document.querySelector('#planEditModal');
    return { open: m && !m.hidden, saveDisabled: document.querySelector('#planSave').disabled,
      note: document.querySelector('#planEditNote').textContent.trim() };
  });
  ok('＋ 를 누르면 설정 칸이 열린다', modal.open, modal);
  ok('기체를 안 고르면 저장이 막히고 그 이유를 적는다',
    modal.saveDisabled && /기체/.test(modal.note), modal);

  await pg.evaluate(() => document.querySelector('#planPickMs').click());
  await sleep(700);

  /* **여기서 한 번 틀렸다.** 처음엔 카드를 el.click() 으로 눌렀는데, 그건 가려진 것도
     눌린다 — 서랍이 모달 뒤(z-index 41 vs 51)로 들어가 사람은 아무것도 못 누르는데
     검사는 통과했다(사용자가 html 을 열어 보고 찾았다).
     그래서 **그 자리에 실제로 무엇이 있는지** 보고, 진짜 마우스로 누른다. */
  const hit = await pg.evaluate(() => {
    const c = document.querySelector('#msDrawerList .ms-card');
    if (!c) return { err: 'no-card' };
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const dr = document.querySelector('#msDrawer');
    return {
      x, y,
      name: ((c.querySelector('.nm') || {}).textContent || '').trim(),
      inDrawer: !!(top && dr.contains(top)),
      topWas: top ? (top.id || top.className || top.tagName) : null,
      drawerZ: Number(getComputedStyle(dr).zIndex) || 0,
      modalZ: Number(getComputedStyle(document.querySelector('#planEditModal')).zIndex) || 0
    };
  });
  ok('서랍이 모달 위로 올라온다 (뒤에 깔리지 않는다)',
    !hit.err && hit.drawerZ > hit.modalZ, hit);
  ok('기체 카드 자리를 눌렀을 때 실제로 그 카드가 닿는다', !hit.err && hit.inDrawer, hit);
  if (!hit.err && hit.inDrawer) await pg.mouse.click(hit.x, hit.y);
  await sleep(300);
  const picked = hit.name;
  ok('기체 선택 서랍에서 기체를 고른다', !!picked, picked);
  await sleep(500);
  const afterPick = await pg.evaluate(() => ({
    drawerOpen: document.querySelector('#msDrawer').classList.contains('open'),
    btn: document.querySelector('#planPickMs').textContent.trim(),
    saveDisabled: document.querySelector('#planSave').disabled
  }));
  ok('고르면 서랍이 닫히고 이름이 칸에 들어간다',
    !afterPick.drawerOpen && afterPick.btn === picked, afterPick);
  ok('기체를 고르면 저장이 열린다', !afterPick.saveDisabled, afterPick);

  // 강화 4단계 · 확장 스킬 하나를 지정한다
  const setGoal = await pg.evaluate(() => {
    const st = [...document.querySelectorAll('#planStageSeg .seg-btn')].find(b => b.dataset.v === '4');
    if (st) st.click();
    const exp = document.querySelector('#planExp');
    // 「확장 없음」이 아닌 첫 항목
    const opt = [...exp.options].find((o, i) => i > 0);
    if (opt) { exp.value = opt.value; exp.dispatchEvent(new Event('change')); }
    const lv = document.querySelector('#planExpLevel');
    lv.value = '3'; lv.dispatchEvent(new Event('change'));
    return { stage: st ? st.textContent.trim() : '', exp: opt ? opt.textContent.trim() : '',
      lvDisabled: lv.disabled };
  });
  ok('강화 단계와 확장 스킬을 지정할 수 있다', !!setGoal.stage && !!setGoal.exp, setGoal);
  ok('확장을 고르면 레벨 칸이 열린다', setGoal.lvDisabled === false, setGoal);

  await pg.evaluate(() => document.querySelector('#planSave').click());
  await sleep(500);
  const saved = await pg.evaluate(() => {
    const card = document.querySelector('.plan-drop[data-rank="2"] .plan-card');
    return {
      closed: document.querySelector('#planEditModal').hidden,
      inRank2: !!card,
      name: card ? (card.querySelector('.plan-name') || {}).textContent.trim() : '',
      tags: card ? [...card.querySelectorAll('.plan-tags span')].map(s => s.textContent.trim()) : [],
      stored: (() => { try { return JSON.parse(localStorage.getItem('gbo2.plan') || '[]').length; } catch { return -1; } })()
    };
  });
  ok('저장하면 박스가 생긴다', saved.closed && saved.inRank2, saved);
  ok('박스가 고른 기체 이름을 적는다', saved.name === picked, saved);
  ok('박스가 강화 단계와 확장 스킬을 적는다',
    saved.tags.some(t => /단계|풀강|미강화/.test(t)) && saved.tags.some(t => /LV3/.test(t)), saved.tags);
  ok('저장소에 남는다', saved.stored === 1, saved.stored);

  // ── 진짜 마우스로 2순위 → 3순위로 끈다
  const box = await pg.evaluate(() => {
    const grip = document.querySelector('.plan-drop[data-rank="2"] .plan-card .plan-grip');
    const target = document.querySelector('.plan-drop[data-rank="3"]');
    if (!grip || !target) return null;
    const a = grip.getBoundingClientRect(), b = target.getBoundingClientRect();
    return { fx: a.left + a.width / 2, fy: a.top + a.height / 2,
      tx: b.left + b.width / 2, ty: b.top + b.height / 2 };
  });
  ok('손잡이와 받는 자리를 찾았다', !!box, box);
  if (box) {
    await pg.mouse.move(box.fx, box.fy);
    await pg.mouse.down();
    await pg.mouse.move(box.fx + 20, box.fy + 10, { steps: 4 });
    await pg.mouse.move(box.tx, box.ty, { steps: 12 });
    await sleep(120);
    const during = await pg.evaluate(() => ({
      ghost: document.querySelectorAll('.plan-card.ghost').length,
      over: !!document.querySelector('.plan-drop[data-rank="3"].over')
    }));
    ok('끄는 동안 유령 카드가 따라오고 받는 자리가 표시된다',
      during.ghost === 1 && during.over, during);
    await pg.mouse.up();
    await sleep(400);
    const moved = await pg.evaluate(() => ({
      r2: document.querySelectorAll('.plan-drop[data-rank="2"] .plan-card').length,
      r3: document.querySelectorAll('.plan-drop[data-rank="3"] .plan-card').length,
      ghost: document.querySelectorAll('.plan-card.ghost').length,
      stored: (() => { try { return (JSON.parse(localStorage.getItem('gbo2.plan') || '[]')[0] || {}).rank; } catch { return -1; } })()
    }));
    ok('드래그로 3순위로 옮겨진다', moved.r2 === 0 && moved.r3 === 1, moved);
    ok('유령 카드가 남지 않는다', moved.ghost === 0, moved);
    ok('옮긴 순위가 저장된다', moved.stored === 3, moved);
  }

  // ── 드래그를 못 쓰는 길 — 카드의 1·2·3 단추
  const byButton = await pg.evaluate(() => {
    const b = [...document.querySelectorAll('.plan-drop[data-rank="3"] .plan-card .plan-move button')]
      .find(x => x.textContent.trim() === '1');
    if (!b) return null;
    b.click();
    return true;
  });
  await sleep(300);
  const movedBtn = await pg.evaluate(() => ({
    r1: document.querySelectorAll('.plan-drop[data-rank="1"] .plan-card').length,
    stored: (() => { try { return (JSON.parse(localStorage.getItem('gbo2.plan') || '[]')[0] || {}).rank; } catch { return -1; } })()
  }));
  ok('단추로도 순위를 옮길 수 있다', !!byButton && movedBtn.r1 === 1 && movedBtn.stored === 1, movedBtn);

  // ── 순위 필터
  await pg.evaluate(() => {
    const chip = [...document.querySelectorAll('#planRankChips .chip')].find(c => c.textContent.trim() === '2순위');
    if (chip) chip.click();
  });
  await sleep(300);
  const filtered = await pg.evaluate(() => document.querySelectorAll('.plan-card').length);
  ok('순위 필터가 걸린다 (2순위만 보면 1순위 카드가 안 보인다)', filtered === 0, filtered);
  await pg.evaluate(() => {
    const chip = [...document.querySelectorAll('#planRankChips .chip')].find(c => c.textContent.trim() === '전체');
    if (chip) chip.click();
  });
  await sleep(300);

  // ── 뒤로가기: 플랜 화면 → 되돌아간다 (토큰 화면이 못 하던 것)
  const back = await pg.evaluate(() => {
    const r = window.GBO2Back();
    return { r, view: document.body.className.split(/\s+/).filter(c => c.indexOf('view-') === 0) };
  });
  ok('플랜 화면에서 뒤로가기가 되돌아간다 (앱을 닫지 않는다)',
    back.r === 'back' && !back.view.includes('view-plan'), back);

  // 토큰 화면도 같이 고쳤으니 함께 본다
  const tokenBack = await pg.evaluate(() => {
    document.querySelector('#tokenBtn').click();
    const was = document.body.className.indexOf('view-token') >= 0;
    const r = window.GBO2Back();
    return { was, r, view: document.body.className.split(/\s+/).filter(c => c.indexOf('view-') === 0) };
  });
  ok('토큰 화면에서도 뒤로가기가 되돌아간다', tokenBack.was && tokenBack.r === 'back'
    && !tokenBack.view.includes('view-token'), tokenBack);

  // ── 다시 열었을 때 남아 있다
  await pg.reload({ waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  const kept = await pg.evaluate(() => {
    document.querySelector('#planBtn').click();
    return document.querySelectorAll('.plan-drop[data-rank="1"] .plan-card').length;
  });
  ok('새로 열어도 플랜이 남아 있다', kept === 1, kept);

  // ── 삭제
  await pg.evaluate(() => document.querySelector('.plan-drop[data-rank="1"] .plan-card').click());
  await sleep(400);
  await pg.evaluate(() => document.querySelector('#planDelete').click());
  await sleep(400);
  const deleted = await pg.evaluate(() => ({
    cards: document.querySelectorAll('.plan-card').length,
    stored: (() => { try { return JSON.parse(localStorage.getItem('gbo2.plan') || '[]').length; } catch { return -1; } })()
  }));
  ok('박스를 지울 수 있다', deleted.cards === 0 && deleted.stored === 0, deleted);

  /* ── 폰에서 — 두 가지를 여기서만 알 수 있다.
     ① 버튼은 좁은 화면에서 ⋯ 안으로 접힌다. 접힌 뒤 거기서 **닿는지**를 봐야 한다
        (상단바에서 사라졌는데 메뉴에도 없으면 폰에서는 아예 못 쓰는 기능이 된다).
     ② 드래그를 포인터 이벤트로 만든 이유가 터치다. 마우스로만 재면 정작 쓰는 쪽을 안 잰다. */
  const ph = await br.newPage();
  const phErrs = [];
  ph.on('pageerror', e => phErrs.push(String(e.message).slice(0, 160)));
  await ph.setViewport({ width: 420, height: 900, hasTouch: true, isMobile: true });
  await ph.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1800);
  // 항목 하나를 심어 두고 다시 연다 (추가 경로는 위에서 이미 쟀다)
  const seedMs = await ph.evaluate(() => {
    const c = document.querySelector('.ms-card');
    return c ? c.dataset.ms : null;
  });
  ok('폰 화면에 기체 카드가 있다 (심을 기체를 찾았다)', !!seedMs, seedMs);
  await ph.evaluate(name => localStorage.setItem('gbo2.plan', JSON.stringify([
    { id: 'p1', ms: name, stage: 6, exp: '拡張スキル無し', expLevel: 1, rank: 1 }])), seedMs);
  await ph.reload({ waitUntil: 'load', timeout: 120000 });
  await sleep(1800);

  const folded = await ph.evaluate(() => {
    const b = document.querySelector('#planBtn');
    return { width: b ? b.getBoundingClientRect().width : -1, inMore: b && b.classList.contains('in-more') };
  });
  ok('폰에서는 상단바에서 접힌다', folded.width === 0 && folded.inMore, folded);

  await ph.evaluate(() => document.querySelector('#topbarMore').click());
  await sleep(300);
  const viaMenu = await ph.evaluate(() => {
    const it = [...document.querySelectorAll('.more-menu .png-menu-item')]
      .find(x => /강화 플랜/.test(x.textContent));
    if (!it) return null;
    it.click();
    return true;
  });
  await sleep(600);
  const phView = await ph.evaluate(() => ({
    view: document.body.className.match(/view-\w+/g) || [],
    cards: document.querySelectorAll('.plan-card').length
  }));
  ok('⋯ 메뉴에서 강화 플랜으로 들어갈 수 있다',
    !!viaMenu && phView.view.includes('view-plan'), { viaMenu, ...phView });
  ok('폰에서도 박스가 보인다', phView.cards === 1, phView);

  /* 폰에서도 기체 선택이 닿는지 — 서랍은 92vw, 모달은 94vw 라 화면을 거의 다 덮는다.
     쌓임 순서가 PC 와 같아도 **자리**가 달라질 수 있어 여기서 다시 재 본다. */
  await ph.evaluate(() => document.querySelector('.plan-drop[data-rank="2"] .plan-add').click());
  await sleep(400);
  await ph.evaluate(() => document.querySelector('#planPickMs').click());
  await sleep(800);
  const phHit = await ph.evaluate(() => {
    const c = document.querySelector('#msDrawerList .ms-card');
    if (!c) return { err: 'no-card' };
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const dr = document.querySelector('#msDrawer');
    return { x, y, inDrawer: !!(top && dr.contains(top)),
      topWas: top ? (top.id || top.className || top.tagName) : null,
      onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
  });
  ok('폰에서도 기체 카드가 화면 안에 있고 닿는다',
    !phHit.err && phHit.inDrawer && phHit.onScreen, phHit);
  // 뒤로가기로 서랍→모달 순서대로 닫히는지 (쌓인 둘을 한 번에 날리면 안 된다)
  const phBack1 = await ph.evaluate(() => { const r = window.GBO2Back();
    return { r, drawer: document.querySelector('#msDrawer').classList.contains('open'),
      modal: !document.querySelector('#planEditModal').hidden }; });
  ok('폰 뒤로가기가 서랍을 먼저 닫는다 (모달은 남는다)',
    phBack1.r === 'back' && !phBack1.drawer && phBack1.modal, phBack1);
  await sleep(400);
  const phBack2 = await ph.evaluate(() => { const r = window.GBO2Back();
    return { r, modal: !document.querySelector('#planEditModal').hidden,
      view: document.body.className.match(/view-\w+/g) || [] }; });
  ok('한 번 더 누르면 모달이 닫히고 플랜 화면이 남는다',
    phBack2.r === 'back' && !phBack2.modal && phBack2.view.includes('view-plan'), phBack2);
  /* 서랍은 .open 을 떼도 **0.18초 동안 제자리에 있다**(transform 전환).
     기다리지 않고 재니 손잡이 자리에 서랍 속 기체 이미지가 잡혀, 앱이 아니라
     검사가 틀린 것을 앱 버그로 읽을 뻔했다. 전환이 끝날 때까지 기다린다. */
  await sleep(500);

  const tbox = await ph.evaluate(() => {
    const g = document.querySelector('.plan-drop[data-rank="1"] .plan-card .plan-grip');
    const t = document.querySelector('.plan-drop[data-rank="3"]');
    if (!g || !t) return null;
    const a = g.getBoundingClientRect(), b = t.getBoundingClientRect();
    const fx = a.left + a.width / 2, fy = a.top + a.height / 2;
    const top = document.elementFromPoint(fx, fy);
    return { fx, fy,
      tx: b.left + b.width / 2, ty: b.top + b.height / 2,
      touchAction: getComputedStyle(g).touchAction,
      gripHit: top === g || (top && g.contains(top)),
      topWas: top ? (top.tagName + '#' + (top.id || '') + '.' + (top.className || '')) : null,
      // 가려진 것이 있으면 무엇에 가렸는지 바로 보이게 (실제로 이것 때문에 원인을 찾았다)
      stack: document.elementsFromPoint(fx, fy).slice(0, 4)
        .map(e => e.tagName + '#' + (e.id || '') + '.' + (String(e.className) || '')),
      targetOnScreen: b.top >= 0 && b.bottom <= innerHeight };
  });
  ok('손잡이가 터치 스크롤을 막아 둔다 (touch-action: none)',
    !!tbox && tbox.touchAction === 'none', tbox && tbox.touchAction);
  ok('폰에서 손잡이 자리가 실제로 손잡이다', !!tbox && tbox.gripHit, tbox);
  ok('받는 자리(3순위)가 화면 안에 있다', !!tbox && tbox.targetOnScreen, tbox);
  if (tbox) {
    await ph.touchscreen.touchStart(tbox.fx, tbox.fy);
    await ph.touchscreen.touchMove(tbox.fx + 15, tbox.fy + 8);
    await ph.touchscreen.touchMove(tbox.tx, tbox.ty);
    await sleep(120);
    const dur = await ph.evaluate(() => ({
      ghost: document.querySelectorAll('.plan-card.ghost').length,
      over: !!document.querySelector('.plan-drop[data-rank="3"].over')
    }));
    await ph.touchscreen.touchEnd();
    await sleep(400);
    const aft = await ph.evaluate(() => ({
      r1: document.querySelectorAll('.plan-drop[data-rank="1"] .plan-card').length,
      r3: document.querySelectorAll('.plan-drop[data-rank="3"] .plan-card').length,
      stored: (JSON.parse(localStorage.getItem('gbo2.plan') || '[]')[0] || {}).rank
    }));
    ok('터치로 끄는 동안 유령과 받는 자리가 보인다', dur.ghost === 1 && dur.over, dur);
    ok('터치 드래그로 순위가 옮겨진다', aft.r1 === 0 && aft.r3 === 1 && aft.stored === 3, aft);
  }
  ok('폰 화면에서 페이지 오류 없음', phErrs.length === 0, phErrs.slice(0, 3));

  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

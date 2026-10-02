// 강화 플랜 우측 「강화 수치」 계산 실측.
//   node tools/plancalc_check.js
//
// 숫자는 **규칙에서 직접 센 값**과 맞댄다 — 앱의 식을 베껴 오면 같은 실수를 같이 한다.
// 규칙(사용자 제공):
//   ① 1회 = 70시간 · 100pt   ② 티켓 1장 = 5시간 (14장 = 70시간)
//   ③ 티켓을 겹쳐 최대 10배 (140장 = 1000pt)   ④ 성공 · 대성공×2 · 초성공×3
//   ⑤ 중복 획득 = 개방 전 상한치의 등급별 %   ⑥ 3배 이벤트면 중복 ×3
//   ⑦ 4→5, 5→6 개방 두 번 — 등급별 개량 키트 + DP
// 「개방 전 상한치」는 ms.fullst 네 번째 points 다(강화리스트 화면의 'N pt').
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const fs = require('fs');
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

const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const DUP_PCT = { 1: 15, 2: 22.5, 3: 35, 4: 45, 5: 60 };
const OPEN = {
  1: [[150, 40000], [300, 50000]], 2: [[150, 60000], [300, 70000]],
  3: [[150, 80000], [300, 100000]], 4: [[150, 160000], [300, 240000]],
  5: [[150, 240000], [300, 360000]]
};

// 등급마다 한 기씩 — 쓰는 자리(4·6번째)가 있는 기체. 이름을 코드에 박지 않는다.
const byRar = {};
for (const m of msData) {
  const r = String(m.レアリティ || '').length;
  if (!r || byRar[r]) continue;
  const f = m.fullst || [];
  if (f.length === 6 && f[3] && f[3].points != null && f[5] && f[5].points != null) byRar[r] = m;
}
// 상한치가 아예 없는 기체 (50기) — 숫자를 지어내지 않는지 보는 데 쓴다
const noCap = msData.find(m => {
  const f = m.fullst || [];
  return f.length === 6 && f[3] && f[3].points == null;
});

(async () => {
  const br = await GBO2Browser.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1500, height: 1000 });

  ok('등급 1~5성 표본을 찾았다', Object.keys(byRar).length === 5, Object.keys(byRar));
  ok('상한치 없는 기체 표본을 찾았다', !!noCap, noCap && noCap.MS名);

  const openPlanWith = async (items, opt) => {
    await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
    await sleep(1200);
    await pg.evaluate((a, b) => {
      localStorage.setItem('gbo2.plan', JSON.stringify(a));
      localStorage.setItem('gbo2.planOpt', JSON.stringify(b));
    }, items, opt);
    await pg.reload({ waitUntil: 'load', timeout: 120000 });
    await sleep(1500);
    await pg.evaluate(() => document.querySelector('#planBtn').click());
    await sleep(500);
  };
  // 패널의 줄을 { 라벨: 맨 앞 수 } 로 읽는다. 괄호 안에 또 숫자가 있어(「1회 (1회 100 pt)」)
  // 전부 긁으면 붙어 버린다 — 맨 앞 수 하나만 읽는다.
  const readPanel = () => pg.evaluate(() => {
    const out = {};
    for (const d of document.querySelectorAll('#planCalc .pc-line')) {
      const k = d.children[0].textContent.trim();
      const v = (d.querySelector('b') || {}).textContent
        || (d.querySelector('input') || {}).value || '';
      out[k] = String(v).trim();
    }
    out.__text = document.querySelector('#planCalc').textContent.replace(/\s+/g, ' ');
    return out;
  });
  const n = (p, label) => {
    if (!(label in p)) return null;
    /* 빼는 값은 화면에 **U+2212(−)** 로 적힌다 — ASCII 하이픈만 보면 음수를 양수로 읽는다.
       (처음에 그래서 「손 −162 / 앱 162」가 나왔다. 앱이 아니라 이 자가 틀렸던 것이다.) */
    const m = String(p[label]).replace(/,/g, '').replace(/[−–—]/g, '-')
      .match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  };

  // ── 등급별로 규칙과 맞댄다
  const cases = [
    { stage: 6, now: 0, dup: 0, boost: 1, succ: 1, x3: false },
    { stage: 6, now: 0, dup: 2, boost: 1, succ: 1, x3: true },
    { stage: 4, now: 100, dup: 1, boost: 10, succ: 3, x3: false },
    { stage: 4, now: 0, dup: 0, boost: 3, succ: 2, x3: false }
  ];
  let mismatch = [];
  for (const r of Object.keys(byRar)) {
    const m = byRar[r];
    const f = m.fullst.map(e => e.points);
    const cap4 = f[3], p6 = f[5];
    for (const c of cases) {
      await openPlanWith([{ id: 'c1', ms: m.MS名, stage: c.stage, exp: '拡張スキル無し',
        expLevel: 1, rank: 1, now: c.now, dup: c.dup }],
      { boost: c.boost, succ: c.succ, x3: c.x3 });
      const p = await readPanel();

      const goal = c.stage === 4 ? cap4 : p6;
      const left = Math.max(0, goal - Math.min(c.now, goal));
      const dupOne = Math.round(cap4 * DUP_PCT[r] / 100) * (c.x3 ? 3 : 1);
      const dupGot = Math.min(dupOne * c.dup, left);
      const runs = Math.ceil((left - dupGot) / (100 * c.boost * c.succ));
      const want = {
        '남은 pt': left,
        ['등급 보상 (상한치의 ' + DUP_PCT[r] + '%)']: dupOne,
        '중복으로 채우는 pt': -dupGot,
        '남은 작업': runs,
        '티켓으로 다 건너뛰면': runs * 14 * c.boost
      };
      for (const k of Object.keys(want)) {
        const got = n(p, k);
        if (got !== want[k]) mismatch.push({ 기체: m.MS名, 등급: r + '성', 경우: c, 항목: k, 손: want[k], 앱: got });
      }
      // ⑦ 개방 — 풀강일 때만 나와야 하고, 비용은 등급별 두 번의 합
      const kit = n(p, '개량 키트[' + '★'.repeat(Number(r)) + ']');
      const dp = n(p, 'DP');
      if (c.stage === 6) {
        const wk = OPEN[r][0][0] + OPEN[r][1][0], wd = OPEN[r][0][1] + OPEN[r][1][1];
        if (kit !== wk || dp !== wd) mismatch.push({ 기체: m.MS名, 항목: '개방', 손: [wk, wd], 앱: [kit, dp] });
      } else if (kit != null || dp != null) {
        mismatch.push({ 기체: m.MS名, 항목: '4단계인데 개방 비용이 나왔다', 앱: [kit, dp] });
      }
    }
  }
  ok('등급 1~5성 · 네 경우의 수치가 규칙과 맞는다', mismatch.length === 0, mismatch.slice(0, 3));

  // ── 상한치가 없는 기체는 숫자를 지어내지 않는다
  if (noCap) {
    await openPlanWith([{ id: 'c2', ms: noCap.MS名, stage: 6, exp: '拡張スキル無し',
      expLevel: 1, rank: 1, now: 0, dup: 0 }], { boost: 1, succ: 1, x3: false });
    const p = await readPanel();
    ok('상한치가 없는 기체는 「자료 없음」이라고 말한다',
      /자료가 없습니다/.test(p.__text) && !/티켓으로 다 건너뛰면/.test(p.__text),
      { ms: noCap.MS名, text: p.__text.slice(0, 120) });
  }

  // ── 자리와 조작
  const m2 = byRar[2], m3 = byRar[3];
  await openPlanWith([
    { id: 'A', ms: m2.MS名, stage: 4, exp: '拡張スキル無し', expLevel: 1, rank: 1, now: 0, dup: 0 },
    { id: 'B', ms: m3.MS名, stage: 6, exp: '拡張スキル無し', expLevel: 1, rank: 2, now: 0, dup: 0 }
  ], { boost: 1, succ: 1, x3: false });

  const place = await pg.evaluate(() => {
    const z = document.querySelector('#planBody').getBoundingClientRect();
    const c = document.querySelector('#planCalc').getBoundingClientRect();
    const el = document.querySelector('#planCalc');
    return { zoneRight: Math.round(z.right), calcLeft: Math.round(c.left),
      sameRow: Math.abs(z.top - c.top) < 60,
      scrolls: el.scrollHeight > el.clientHeight + 1,
      overflowY: getComputedStyle(el).overflowY,
      clipped: el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY === 'visible' };
  });
  ok('계산이 플랜 **우측**에 있다', place.calcLeft >= place.zoneRight - 2 && place.sameRow, place);
  ok('길어져도 잘리지 않고 구를 수 있다', !place.clipped, place);

  const sel1 = await pg.evaluate(() => {
    const cards = [...document.querySelectorAll('.plan-card')];
    const b = cards.find(c => c.dataset.id === 'B');
    // 이름 줄을 누른다 — 카드 아래쪽은 1·2·3 순위 단추라 거기 누르면 선택이 아니라 이동이다
    const nm = b.querySelector('.plan-name').getBoundingClientRect();
    return { x: nm.left + nm.width / 2, y: nm.top + nm.height / 2 };
  });
  await pg.mouse.click(sel1.x, sel1.y);
  await sleep(400);
  const afterSel = await pg.evaluate(() => ({
    name: (document.querySelector('#planCalc .pc-ms') || {}).textContent,
    selCards: [...document.querySelectorAll('.plan-card.sel')].map(c => c.dataset.id),
    modalOpen: !document.querySelector('#planEditModal').hidden
  }));
  ok('박스를 누르면 계산이 그 기체를 본다 (설정 칸은 안 뜬다)',
    !afterSel.modalOpen && afterSel.selCards.join() === 'B', afterSel);

  // ✎ 는 고치기
  const editBtn = await pg.evaluate(() => {
    const b = document.querySelector('.plan-card[data-id="B"] .plan-edit-btn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: !!(top && (top === b || b.contains(top))) };
  });
  ok('✎ 단추가 실제로 닿는다', !!editBtn && editBtn.hit, editBtn);
  if (editBtn && editBtn.hit) {
    await pg.mouse.click(editBtn.x, editBtn.y);
    await sleep(400);
    const opened = await pg.evaluate(() => !document.querySelector('#planEditModal').hidden);
    ok('✎ 를 누르면 설정 칸이 열린다', opened);
    await pg.evaluate(() => document.querySelector('#planEditClose').click());
    await sleep(300);
  }

  // ── 입력 칸이 포커스를 잃지 않는다 (값이 바뀔 때마다 패널을 다시 그리기 때문)
  await pg.evaluate(() => {
    const i = document.querySelector('#planCalc input[data-k="now"]');
    i.focus(); i.value = '12'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const focusKept = await pg.evaluate(() => {
    const a = document.activeElement;
    return { k: a && a.dataset ? a.dataset.k : null, v: a ? a.value : null };
  });
  ok('값을 치는 동안 입력 칸에 포커스가 남는다', focusKept.k === 'now', focusKept);

  // ── 저장되는가 (새로 열어도 남는다)
  await pg.reload({ waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  const kept = await pg.evaluate(() => {
    document.querySelector('#planBtn').click();
    try { return (JSON.parse(localStorage.getItem('gbo2.plan') || '[]').find(x => x.id === 'B') || {}).now; }
    catch { return -1; }
  });
  ok('친 pt 가 저장된다', kept === 12, kept);

  // ── 폰에서는 아래로 내려간다
  const ph = await br.newPage();
  const phErrs = [];
  ph.on('pageerror', e => phErrs.push(String(e.message).slice(0, 160)));
  await ph.setViewport({ width: 420, height: 900, hasTouch: true, isMobile: true });
  await ph.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await ph.evaluate(name => localStorage.setItem('gbo2.plan', JSON.stringify([
    { id: 'P', ms: name, stage: 6, exp: '拡張スキル無し', expLevel: 1, rank: 1, now: 0, dup: 0 }])),
  byRar[3].MS名);
  await ph.reload({ waitUntil: 'load', timeout: 120000 });
  await sleep(1600);
  await ph.evaluate(() => document.querySelector('#planBtn').click());
  await sleep(600);
  const phPlace = await ph.evaluate(() => {
    const z = document.querySelector('#planBody').getBoundingClientRect();
    const c = document.querySelector('#planCalc').getBoundingClientRect();
    return { below: c.top >= z.bottom - 2, gap: Math.round(c.top - z.bottom),
      full: Math.abs(c.width - z.width) < 4, w: Math.round(c.width) };
  });
  ok('폰에서는 계산이 플랜 아래로 내려간다', phPlace.below && phPlace.full, phPlace);
  ok('폰에서 플랜과 계산 사이가 벌어지지 않는다', phPlace.gap < 80, phPlace);
  ok('폰 화면에서 페이지 오류 없음', phErrs.length === 0, phErrs.slice(0, 3));

  /* ── ① 3배 이벤트는 **걸리는 자리(기체 중복) 바로 아래**에 있고, 아래 설명 줄은 없다 */
  await openPlanWith([{ id: 'X', ms: byRar[3].MS名, stage: 6, exp: '拡張スキル無し',
    expLevel: 1, rank: 1, now: 0, dup: 0 }], { boost: 1, succ: 1, x3: false });
  const x3place = await pg.evaluate(() => {
    const box = document.querySelector('#planCalc');
    const chk = box.querySelector('.pc-chk');
    if (!chk) return { err: '체크박스 없음' };
    const kids = [...box.children];
    const at = kids.indexOf(chk);
    // 차례: 「기체 중복」 머리 → 3배 체크 → 「등급 보상」 줄
    const prev = at > 0 ? kids[at - 1].textContent.replace(/\s+/g, ' ').trim() : '';
    const next = kids[at + 1] ? kids[at + 1].textContent.replace(/\s+/g, ' ').trim() : '';
    return { prev, next, shownNotes: [...box.querySelectorAll('.pc-note')].filter(n => !n.hidden).length };
  });
  ok('차례가 기체 중복 → 3배 이벤트 → 등급 보상 이다',
    /^기체 중복/.test(x3place.prev) && /등급 보상/.test(x3place.next), x3place);
  ok('설명 줄이 펼쳐진 채로 있지 않다', x3place.shownNotes === 0, x3place);

  /* ── ② 설명은 「강화 작업」의 ? 로 연다 */
  const help = await pg.evaluate(() => {
    const secs = [...document.querySelectorAll('#planCalc .pc-sec')];
    const work = secs.find(s => /강화 작업/.test(s.textContent));
    const q = work && work.querySelector('.pc-help');
    if (!q) return { err: '? 없음' };
    const before = [...document.querySelectorAll('#planCalc .pc-note')].filter(n => !n.hidden).length;
    q.click();
    const after = [...document.querySelectorAll('#planCalc .pc-note')].filter(n => !n.hidden);
    const txt = after.map(n => n.textContent).join(' ');
    q.click();
    const closed = [...document.querySelectorAll('#planCalc .pc-note')].filter(n => !n.hidden).length;
    return { before, opened: after.length, txt, closed };
  });
  ok('「강화 작업」에 ? 가 있고 눌러야 설명이 뜬다',
    !help.err && help.before === 0 && help.opened === 1 && help.closed === 0, help);
  ok('설명에 티켓 환산과 「기댓값이 아니다」가 들어 있다',
    !help.err && /14장/.test(help.txt) && /기댓값이 아닙니다/.test(help.txt),
    help.txt && help.txt.slice(0, 120));

  /* ── ② 같은 기체를 두 번 담지 못한다 */
  await pg.evaluate(() => document.querySelector('.plan-drop[data-rank="2"] .plan-add').click());
  await sleep(400);
  await pg.evaluate(() => document.querySelector('#planPickMs').click());
  await sleep(800);
  const sameName = await pg.evaluate(nm => {
    const cards = [...document.querySelectorAll('#msDrawerList .ms-card')];
    const c = cards.find(x => x.dataset.ms === nm);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    c.scrollIntoView({ block: 'center' });
    return true;
  }, byRar[3].MS名);
  if (!sameName) {
    // 목록이 길어 안 보이면 검색으로 좁힌다
    await pg.evaluate(nm => {
      const q = document.querySelector('#msDrawerQuery');
      q.value = nm; q.dispatchEvent(new Event('input', { bubbles: true }));
    }, byRar[3].MS名);
    await sleep(800);
  }
  await pg.evaluate(nm => {
    const c = [...document.querySelectorAll('#msDrawerList .ms-card')].find(x => x.dataset.ms === nm);
    if (c) c.click();
  }, byRar[3].MS名);
  await sleep(500);
  const guard = await pg.evaluate(() => ({
    note: document.querySelector('#planEditNote').textContent.trim(),
    saveDisabled: document.querySelector('#planSave').disabled
  }));
  ok('이미 플랜에 있는 기체는 저장이 막힌다', guard.saveDisabled, guard);
  ok('막은 이유와 어디 있는지를 적는다',
    /이미 플랜에 있습니다/.test(guard.note) && /순위/.test(guard.note), guard);
  // 막아 두기만 하는 게 아니라 눌러도 안 들어가야 한다
  await pg.evaluate(() => document.querySelector('#planSave').click());
  await sleep(300);
  const afterTry = await pg.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('gbo2.plan') || '[]').length; } catch { return -1; }
  });
  ok('저장을 눌러도 중복이 들어가지 않는다', afterTry === 1, afterTry);
  await pg.evaluate(() => document.querySelector('#planEditClose').click());
  await sleep(300);

  /* ── ③ 확장 스킬 1~3순위 */
  const expRows = await pg.evaluate(() => {
    document.querySelector('.plan-card .plan-edit-btn').click();
    const labels = [...document.querySelectorAll('#planExpRows .pe-row > label')].map(l => l.textContent.trim());
    const sels = [...document.querySelectorAll('#planExpRows select')].map(s => s.id);
    return { labels, sels };
  });
  ok('확장 칸이 1~3순위로 셋이다',
    expRows.labels.join(',') === '확장 1순위,확장 2순위,확장 3순위', expRows);
  ok('확장 칸마다 레벨 칸이 따로 있다', expRows.sels.length === 6, expRows);
  const setThree = await pg.evaluate(() => {
    const names = [];
    for (let i = 0; i < 3; i++) {
      const s = document.querySelector('#planExp' + i);
      const o = [...s.options].slice(1 + i)[0];
      s.value = o.value; s.dispatchEvent(new Event('change'));
      names.push(o.textContent.trim());
      const lv = document.querySelector('#planExpLevel' + i);
      lv.value = String(i + 1); lv.dispatchEvent(new Event('change'));
    }
    document.querySelector('#planSave').click();
    return names;
  });
  await sleep(500);
  const tagTxt = await pg.evaluate(() => {
    const c = document.querySelector('.plan-card');
    return [...c.querySelectorAll('.plan-tags span')].map(s => s.textContent.trim());
  });
  ok('박스가 확장 셋을 ①②③ 로 적는다',
    ['①', '②', '③'].every(mark => tagTxt.some(t => t.indexOf(mark) === 0))
    && tagTxt.some(t => /LV1/.test(t)) && tagTxt.some(t => /LV3/.test(t)),
    { tagTxt, setThree });
  const stored = await pg.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('gbo2.plan') || '[]')[0] || {}).exps; }
    catch { return null; }
  });
  ok('확장 셋이 순서대로 저장된다',
    Array.isArray(stored) && stored.length === 3
    && stored[0].level === 1 && stored[2].level === 3, stored);

  /* ── ④ 순위마다 도합 (티켓 · 개량 키트 · DP) */
  const foot = await pg.evaluate(() => {
    const z = document.querySelector('.plan-zone');
    const f = z.querySelector('.plan-foot');
    return f ? { txt: f.textContent.replace(/\s+/g, ' ').trim(),
      vals: [...f.querySelectorAll('.pf-v')].map(v => v.textContent.trim()) } : null;
  });
  ok('순위 아래에 도합 줄이 있다', !!foot, foot);
  ok('도합에 티켓 · 개량 키트 · DP 가 모두 있다',
    !!foot && /티켓/.test(foot.txt) && /개량 키트/.test(foot.txt) && /DP/.test(foot.txt), foot);
  // 숫자가 맞는가 — 1순위에 든 그 한 기의 값과 같아야 한다
  const fm3 = byRar[3], f3 = fm3.fullst.map(e => e.points);
  const wantTickets = Math.ceil(f3[5] / 100) * 14;
  const wantKit = OPEN[3][0][0] + OPEN[3][1][0], wantDp = OPEN[3][0][1] + OPEN[3][1][1];
  const fnum = i => {
    const m = String(foot.vals[i]).replace(/,/g, '').match(/\d+/);
    return m ? Number(m[0]) : null;
  };
  ok('도합 숫자가 규칙과 맞는다',
    !!foot && fnum(0) === wantTickets && fnum(1) === wantKit && fnum(2) === wantDp,
    { 앱: foot && foot.vals, 손: [wantTickets, wantKit, wantDp] });
  // 빈 순위에는 도합을 달지 않는다 (0 만 적힌 줄은 읽을 것이 없다)
  const emptyFoot = await pg.evaluate(() =>
    [...document.querySelectorAll('.plan-zone')].map(z =>
      ({ cards: z.querySelectorAll('.plan-card').length, foot: !!z.querySelector('.plan-foot') })));
  ok('빈 순위에는 도합 줄이 없다',
    emptyFoot.every(z => (z.cards > 0) === z.foot), emptyFoot);

  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

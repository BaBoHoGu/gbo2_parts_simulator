// 버그 탐색에서 잡은 5건의 수정 실측.
//   node tools/audit_fix_check.js
//
// ① 자세 보정 라벨이 실제 계산값과 같은가
// ② 자동 구성 목표가 기체를 바꾸면 지워지는가 / 손으로도 지울 수 있는가
// ③ 피탄 「격파까지」가 히트가 아니라 발(전탄) 기준인가
// ④ 받는 쪽에도 고정 피해가 들어가는가
// ⑤ 실효 HP 파츠가 '공격' 으로 분류되지 않는가
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

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};

const pickMs = async (pg, q) => {
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /기체 다시|다른 기체/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(400);
  await pg.evaluate(s => { const e = document.querySelector('#msQuery'); e.value = s; e.dispatchEvent(new Event('input', { bubbles: true })); }, q);
  await sleep(900);
  const ok = await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) { c.click(); return true; } return false; });
  await sleep(1400);
  return ok;
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pickMs(pg, '짐 스나이퍼');

  // ── ① 자세 보정 라벨 = 실제 계산값 ─────────────────────────────
  const posture = await pg.evaluate(() => {
    document.querySelector('#postureBtn').click();
    const items = [...document.querySelectorAll('.posture-menu .skill-item')]
      .map(i => i.textContent.replace(/\s+/g, ' ').trim());
    document.querySelector('.posture-menu').remove();
    const E = window.GBO2Damage.ETC_ATTACK;
    return { items, etc: { crouch: E.crouch, prone: E.prone, scope: E.scope } };
  });
  const want = t => t.map(x => '+' + Math.round(x * 100) + '%');
  const [wc, wp, ws] = want([posture.etc.crouch, posture.etc.prone, posture.etc.scope]);
  const has = (re) => posture.items.some(t => re.test(t));
  check('앉기 라벨이 계산값(' + wc + ')과 같다', has(new RegExp('앉기.*' + wc.replace('+', '\\+'))),
    posture.items.join(' | '));
  check('엎드리기 라벨이 계산값(' + wp + ')과 같다', has(new RegExp('엎드리기.*' + wp.replace('+', '\\+'))));
  check('스코프 라벨이 계산값(' + ws + ')과 같다', has(new RegExp('스코프.*' + ws.replace('+', '\\+'))));

  // ── ③④ 피탄: 발 기준 + 고정 피해 ───────────────────────────────
  // 산탄(동시발사) 무장을 가진 적을 골라 「1발 = A ×N발」 표기가 나오는지 본다
  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(700);
  // 건탱크의 「120mm 캐논 x2」 는 2발 동시발사 — 1히트가 아니라 1발 기준이어야 한다
  await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); q.value = '건탱크'; q.dispatchEvent(new Event('input')); });
  await sleep(800);
  await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
  await sleep(1200);
  // 무장을 훑어 동시발사 표기가 붙은 것을 찾는다
  const inc = await pg.evaluate(async () => {
    const rows = [...document.querySelectorAll('#pietanModal .pietan-row')];
    for (let i = 0; i < rows.length; i++) {
      [...document.querySelectorAll('#pietanModal .pietan-row')][i].click();
      await new Promise(r => setTimeout(r, 500));
      const m = [...document.querySelectorAll('#pietanModal .pietan-metric')].find(x => /격파까지/.test(x.textContent));
      const t = m ? m.textContent.replace(/\s+/g, ' ').trim() : '';
      if (/1발 =/.test(t)) return t;
    }
    const m = [...document.querySelectorAll('#pietanModal .pietan-metric')].find(x => /격파까지/.test(x.textContent));
    return m ? m.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  check('격파까지 근거가 「1발」 기준이다', /÷ 1발/.test(inc), inc.slice(0, 140));
  check('전탄 배수가 근거에 드러난다', /1발 = [\d,]+ × /.test(inc), inc.slice(0, 160));
  // 「1발 = A × N발 …」 → 1발 피해가 A×N 과 맞는지 산수까지 확인
  const mm = inc.match(/÷ 1발 ([\d,]+) \(1발 = ([\d,]+) × (\d+)발/);
  const num = s => Number(String(s).replace(/,/g, ''));
  check('1발 피해 = 1히트 × 발수', !!mm && num(mm[1]) === num(mm[2]) * Number(mm[3]),
    mm ? `${mm[1]} vs ${mm[2]}×${mm[3]}` : '표기를 못 읽음');
  console.log('   ' + inc.slice(0, 150));

  // ④ 고정 피해(소이) — 받는 쪽 격파 수에도 들어가야 한다.
  // 액트 자쿠의 「핸드 그레네이드[소이]」 = 1500 고정(150x10HIT).
  await pg.evaluate(() => { const bk = document.querySelector('.pietan-back'); if (bk) bk.click(); });
  await sleep(400);
  await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); q.value = '액트 자쿠'; q.dispatchEvent(new Event('input')); });
  await sleep(800);
  await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
  await sleep(1200);
  const soi = await pg.evaluate(async () => {
    const n = document.querySelectorAll('#pietanModal .pietan-row').length;
    for (let i = 0; i < n; i++) {
      [...document.querySelectorAll('#pietanModal .pietan-row')][i].click();
      await new Promise(r => setTimeout(r, 500));
      const chip = document.querySelector('#pietanModal .w-fixed');
      if (!chip) continue;
      const m = [...document.querySelectorAll('#pietanModal .pietan-metric')].find(x => /격파까지/.test(x.textContent));
      return { chip: chip.title.replace(/\s+/g, ' '), metric: m ? m.textContent.replace(/\s+/g, ' ').trim() : '' };
    }
    return null;
  });
  if (!soi) check('소이 무장을 찾음', false, '고정 피해 칩이 있는 무장이 없음');
  else {
    check('받는 쪽 격파 근거에 고정 피해가 더해진다', /\+ 고정 [\d,]+/.test(soi.metric), soi.metric.slice(0, 160));
    check('칩 설명이 「포함돼 있다」로 바뀌었다', /포함돼 있다/.test(soi.chip), soi.chip.slice(0, 120));
    console.log('   ' + soi.metric.slice(0, 150));
  }

  // ── ② 목표: 걸고 → 기체 바꾸면 사라지는가 ───────────────────────
  await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); q.value = '자쿠'; q.dispatchEvent(new Event('input')); });
  await sleep(800);
  await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
  await sleep(900);
  await pg.evaluate(() => { const r = [...document.querySelectorAll('#pietanModal .pietan-row')].pop(); if (r) r.click(); });
  await sleep(900);
  const set = await pg.evaluate(() => {
    const g = document.querySelector('.pietan-goal');
    if (!g) return null;
    g.querySelector('.btn-primary').click();
    return true;
  });
  check('버티기 목표를 걸 수 있다', !!set);
  await sleep(900);
  const after = await pg.evaluate(() => ({
    filled: [...document.querySelectorAll('#autoGrid input.auto-tgt')].map(i => i.value).filter(Boolean).length,
    note: (document.querySelector('#autoTargetNote') || {}).textContent || '',
    clearShown: !!(document.querySelector('#clearTargets') && !document.querySelector('#clearTargets').hidden)
  }));
  check('목표가 걸렸고 개수가 표시된다', after.filled > 0 && /\d+개/.test(after.note), after.note);
  check('「목표 지우기」 버튼이 나온다', after.clearShown);

  await pg.evaluate(() => document.querySelector('#closeAuto').click());
  await sleep(300);
  await pickMs(pg, '자쿠Ⅱ');
  const moved = await pg.evaluate(() => {
    document.querySelector('#openAuto').click();
    return {
      filled: [...document.querySelectorAll('#autoGrid input.auto-tgt')].map(i => i.value).filter(Boolean).length,
      note: (document.querySelector('#autoTargetNote') || {}).textContent || ''
    };
  });
  await sleep(300);
  check('기체를 바꾸면 목표가 지워진다', moved.filled === 0 && /없음/.test(moved.note),
    `채워진 칸 ${moved.filled} · ${moved.note}`);

  // 손으로도 지워지는가
  await pg.evaluate(() => {
    const inp = document.querySelector('#autoGrid input.auto-tgt');   // 첫 하한 칸(HP)
    inp.value = '99999'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const manual = await pg.evaluate(() => {
    const before = (document.querySelector('#autoTargetNote') || {}).textContent;
    document.querySelector('#clearTargets').click();
    return { before, after: (document.querySelector('#autoTargetNote') || {}).textContent,
      filled: [...document.querySelectorAll('#autoGrid input.auto-tgt')].map(i => i.value).filter(Boolean).length };
  });
  check('「목표 지우기」로 비워진다', manual.filled === 0 && /없음/.test(manual.after),
    `${manual.before} → ${manual.after} · 남은 칸 ${manual.filled}`);

  // ── ⑤ 실효 HP 파츠가 '공격' 으로 분류되지 않는가 ────────────────
  const role = await pg.evaluate(async () => {
    document.querySelector('#runAuto').click();
    for (let i = 0; i < 60 && document.querySelectorAll('#autoResults .auto-cand').length === 0; i++)
      await new Promise(r => setTimeout(r, 500));
    const why = document.querySelector('#autoResults .ac-why');
    if (!why) return null;
    why.click();
    await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('#autoResults .why-row')].map(r => ({
      txt: r.textContent.replace(/\s+/g, ' ').trim(),
      role: (r.querySelector('.why-role') || {}).textContent || ''
    }));
  });
  if (!role) check('「왜 이 파츠?」 목록', false, '후보를 못 만듦');
  else {
    const bad = role.filter(r => /실효 HP|실효 실효/.test(r.txt));
    check('실효 HP 항목이 「실효 실효」로 겹치지 않는다', !role.some(r => /실효 실효/.test(r.txt)),
      (role.find(r => /실효 실효/.test(r.txt)) || {}).txt);
    const wrong = role.filter(r => /실효 (HP )?(실탄|빔|격투)/.test(r.txt) && r.role === '공격');
    check('내구성 실효 지표가 「공격」으로 분류되지 않는다', wrong.length === 0,
      wrong.map(r => r.txt).join(' | ').slice(0, 160));
    console.log('   ' + role.slice(0, 3).map(r => r.txt.slice(0, 60)).join('\n   '));
  }

  check('스크립트 오류 없음', errs.length === 0, errs.join(' / '));
  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n수정 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

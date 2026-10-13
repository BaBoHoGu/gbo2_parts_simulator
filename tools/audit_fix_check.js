// 버그 탐색에서 잡은 5건의 수정 실측.
//   node tools/audit_fix_check.js
//
// ① 자세 보정 라벨이 실제 계산값과 같은가
// ② 자동 구성 목표가 기체를 바꾸면 지워지는가 / 손으로도 지울 수 있는가
// ③ 피탄 「격파까지」가 히트가 아니라 발(전탄) 기준인가
// ④ 받는 쪽에도 고정 피해가 들어가는가
// ⑤ 실효 HP 파츠가 '공격' 으로 분류되지 않는가
const GBO2Browser = require('./lib/browser.js');   // 크롬 임시 프로필 정리가 프로세스를 죽이지 않게
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
  await sleep(1100);
  // 카드를 누르면 **기체 정보 칸이 열릴 뿐** 기체가 바뀌지 않는다(그 화면이 생긴 뒤로).
  // 「파츠 고르기」까지 눌러야 state.ms 가 바뀐다 — 안 누르면 이 검사는 바뀌지 않은
  // 기체를 놓고 「목표가 안 지워졌다」고 말하게 된다.
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1300);
  return ok;
};

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
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

  // ── ③④ 대결: 발 기준 + 고정 피해 ───────────────────────────────
  /* 피탄 시뮬이 있던 자리. 예전에는 화면 **글자**(「÷ 1발 N (1발 = A × B발)」)를 읽어
     셈이 발 기준인지 봤는데, 글자는 화면마다 달라진다. 이제 attack() 이 내놓는 값으로
     **뜻을 직접** 잰다 — 한 방아쇠 피해 = 1히트 × 히트 수 + 고정 피해. */
  const DG = require('./lib/duelgate.js');

  // 건탱크의 「120mm 캐논 x2」 는 2발 동시발사 — 1히트가 아니라 1발 기준이어야 한다
  const multi = await DG.measure(pg, { me: 'ザクⅡ', foe: 'ガンタンク', from: 'R', melee: false });
  check('동시발사 무장을 찾음', !multi.오류, JSON.stringify(multi).slice(0, 160));
  if (!multi.오류) {
    // 그 기체의 무장을 훑어 히트 수가 2 이상인 것을 찾는다
    let found = null;
    for (const nm of await DG.weaponsOf(pg, { me: 'ガンタンク', foe: 'ザクⅡ' })) {
      const r = await DG.measure(pg, { me: 'ガンタンク', foe: 'ザクⅡ', weaponExact: nm });
      if (!r.오류 && r.히트 > 1) { found = r; break; }
    }
    check('전탄(동시발사) 배수가 1보다 큰 무장이 있다', !!found, '없음');
    if (found) {
      check('한 방아쇠 피해 = 1히트 × 히트 수 + 고정 피해',
        found.한발 === found.히트 * (found.한발 - found.고정) / found.히트 + found.고정
        && found.한발 > (found.한발 - found.고정) / found.히트,
        JSON.stringify({ 무장: found.무장, 한발: found.한발, 히트: found.히트, 고정: found.고정 }));
      check('격파 발수가 내구 지표 ÷ 한 방아쇠 다 (히트가 아니다)',
        found.발수 === Math.ceil(found.내구 / found.한발),
        JSON.stringify({ 발수: found.발수, 내구: found.내구, 한발: found.한발 }));
      console.log('   ' + found.무장 + ' — 한발 ' + found.한발 + ' · ' + found.히트 + '히트 · ' + found.발수 + '발');
    }
  }

  // ④ 고정 피해(소이) — 격파 수에도 들어가야 한다.
  // 액트 자쿠의 「핸드 그레네이드[소이]」 = 1500 고정(150x10HIT).
  let soi = null;
  for (const nm of await DG.weaponsOf(pg, { me: 'アクト・ザク', foe: 'ザクⅡ' })) {
    const r = await DG.measure(pg, { me: 'アクト・ザク', foe: 'ザクⅡ', weaponExact: nm });
    if (!r.오류 && r.고정 > 0) { soi = r; break; }
  }
  if (!soi) check('소이 무장을 찾음', false, '고정 피해가 붙은 무장이 없음');
  else {
    check('고정 피해가 한 방아쇠 피해에 더해진다', soi.고정 > 0 && soi.한발 > soi.고정,
      JSON.stringify({ 무장: soi.무장, 한발: soi.한발, 고정: soi.고정 }));
    check('그 고정 피해가 격파 발수에도 들어간다', soi.발수 === Math.ceil(soi.내구 / soi.한발),
      JSON.stringify({ 발수: soi.발수, 내구: soi.내구, 한발: soi.한발 }));
    console.log('   ' + soi.무장 + ' — 한발 ' + soi.한발 + ' (고정 ' + soi.고정 + ')');
  }

  // ── ② 목표: 걸고 → 기체 바꾸면 사라지는가 ───────────────────────
  /* 버티기 목표 줄은 **맞는 쪽이 내 구성(왼쪽)** 일 때만 뜬다. 오른쪽에서 쏘게 세운다. */
  const goal = await DG.measure(pg, { me: 'ザクⅡ', foe: 'ガンタンク', from: 'R', melee: false });
  check('버티기 목표 줄이 그려진다', (goal.목표줄 || []).length > 0, JSON.stringify(goal).slice(0, 160));
  await sleep(900);
  const set = await pg.evaluate(() => {
    const g = document.querySelector('#duelModal .goal-row');
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

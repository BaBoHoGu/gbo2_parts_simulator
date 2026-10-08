// 때가 되면 **바뀌는** 파츠를 바뀌는 것으로 다루는가.
//   node tools/modepart_check.js
//
// 사용자 보고(2026-10-08): 「의문의 전자 회로 LV1」은
//   선회·스피드·고속이동 +3  →  (4분 경과)  →  사격·격투 보정 +5
// 로 **바뀐다**. 앞의 효과는 그때 사라진다. 그런데 자료(parts.json)가 두 효과를 한 파츠에
// 다 싣고 있어서, 그대로 더하면 한 장이 두 장 몫을 한다.
// 실제로 자동 구성이 표본 18기 **전부**에서 이 파츠를 골랐다 — 과대평가다.
//
// 자료는 생성물이라 고칠 수 없다. core 의 MODE_PARTS 가 「지금 쓰는 쪽만」 남긴다.
// 되돌아가면 화면은 멀쩡해 보이고 수치만 조용히 부푼다 — 그래서 여기서 지킨다.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));
const O = require(path.join(ROOT, 'src', 'optimizer.js'));
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra != null ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const byCat = rd('parts.json'), msAll = rd('msData.json'), fullst = rd('fullst.json');
const every = [].concat(...Object.values(byCat));

ok('MODE_PARTS 표가 있다', !!C.MODE_PARTS && Object.keys(C.MODE_PARTS).length > 0,
  { 개수: C.MODE_PARTS ? Object.keys(C.MODE_PARTS).length : 0 });

/* 표에 적힌 파츠가 **실제로 있고**, 적어 둔 두 묶음이 그 파츠에 다 들어 있는가.
   자료에서 이름이 바뀌거나 한쪽이 빠지면 표가 조용히 헛돈다. */
for (const [name, m] of Object.entries(C.MODE_PARTS || {})) {
  const p = every.find(x => x.name === name);
  ok('표의 파츠가 자료에 있다: ' + name, !!p);
  if (!p) continue;
  const miss = [...m.early, ...m.late].filter(k => typeof p[k] !== 'number');
  ok('적어 둔 스탯이 모두 그 파츠에 있다: ' + name, miss.length === 0, miss);
  /* 설명에 「바뀐다」가 적혀 있는가 — 자료가 바뀌어 더 이상 전환형이 아니면 알아야 한다. */
  ok('설명이 여전히 「바뀐다」다: ' + name, /切り替わ|切替わ|に変わる/.test(String(p.description || '')),
    { desc: String(p.description || '').slice(0, 40) });
}

const ms = msAll.find(m => m.MS名 === 'ドライセン_LV1');
const P = every.find(p => p.name === '謎の電子回路_LV1');
const tot = (late) => C.calcStats(ms, [P], 6, C.EXPANSION_NONE, byCat, fullst, null, 'normal', null, null, late).total;
const base = C.calcStats(ms, [], 6, C.EXPANSION_NONE, byCat, fullst, null, 'normal').total;

if (P) {
  const early = tot(false), late = tot(true);

  /* 가장 중요한 줄 — **둘이 한꺼번에 붙으면 안 된다.** */
  ok('초반에는 이동만 오른다 (보정은 그대로)',
    early.speed > base.speed && early.highSpeedMovement > base.highSpeedMovement
    && early.shoot === base.shoot && early.meleeCorrection === base.meleeCorrection,
    { 스피드: early.speed, 고속: early.highSpeedMovement, 사격: early.shoot, 격투: early.meleeCorrection });

  ok('4분 뒤에는 보정만 오른다 (이동은 사라진다)',
    late.shoot > base.shoot && late.meleeCorrection > base.meleeCorrection
    && late.speed === base.speed && late.highSpeedMovement === base.highSpeedMovement,
    { 스피드: late.speed, 고속: late.highSpeedMovement, 사격: late.shoot, 격투: late.meleeCorrection });

  /* 값까지 본다 — 「둘 다 0」 같은 꼴로도 위 두 줄은 통과할 수 있다. */
  ok('초반 이동 +3', early.speed - base.speed === 3 && early.highSpeedMovement - base.highSpeedMovement === 3,
    { 스피드: early.speed - base.speed, 고속: early.highSpeedMovement - base.highSpeedMovement });
  ok('4분 뒤 보정 +5', late.shoot - base.shoot === 5 && late.meleeCorrection - base.meleeCorrection === 5,
    { 사격: late.shoot - base.shoot, 격투: late.meleeCorrection - base.meleeCorrection });

  /* 안 넘기면 초반으로 — 옛 호출부(인자를 모르는 곳)가 조용히 4분 뒤로 돌면 안 된다. */
  const noArg = C.calcStats(ms, [P], 6, C.EXPANSION_NONE, byCat, fullst, null, 'normal').total;
  ok('lateMode 를 안 넘기면 초반 효과다', noArg.speed === early.speed && noArg.shoot === early.shoot,
    { 스피드: noArg.speed, 사격: noArg.shoot });

  /* 자동 구성도 같은 쪽을 본다 — 화면과 다른 기준으로 고르면 「고른 근거」가 어긋난다. */
  const sample = msAll.sort((a, b) => a.MS名 < b.MS名 ? -1 : 1).filter((_, i) => i % 97 === 0).slice(0, 18);
  const cnt = (late) => sample.filter(m => O.optimize(m, { stage: 6, restarts: 1, lateMode: late,
    weights: { shoot: 2, meleeCorrection: 2, speed: 1, highSpeedMovement: 1 } }, byCat, fullst)
    .parts.some(p => p.name === P.name)).length;
  const nEarly = cnt(false), nLate = cnt(true);
  /* 보정 중심 가중치다 — 4분 뒤(보정 +5)에 더 자주 골라야 뜻이 맞는다.
     둘 다 전부(18/18)면 두 효과를 다 주고 있다는 신호다(고치기 전이 그랬다). */
  ok('자동 구성이 모드를 구분한다 (보정 중심 가중치)', nLate > nEarly && !(nEarly === sample.length),
    { 초반: nEarly + '/' + sample.length, '4분뒤': nLate + '/' + sample.length });
  console.log('  (참고) 보정 중심 가중치에서 고른 기체 — 초반 ' + nEarly + ' · 4분 뒤 ' + nLate + ' / ' + sample.length);
}

/* 자동 구성에 넘기는가 — 글자로 본다(아래 브라우저 검사가 수치로 다시 확인한다). */
{
  const u = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  ok('자동 구성에도 넘긴다', u.includes('lateMode: state.lateMode'));
}

/* ── 화면에서 **진짜로 눌러 본다** ───────────────────────────────────
   「state.lateMode 라는 글자가 있는가」로 재면 아무것도 못 지킨다 — 실제로
   `state.lateMode = false` 로 바꿔 심었더니 그 검사가 통과했다(낱말만 보고 있었다).
   칸을 눌러 **수치가 바뀌는지**를 봐야 한다. */
(async () => {
  const DIST = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  if (!fs.existsSync(DIST)) { console.log('  (건너뜀) dist 가 없다 — node tools/build.js 먼저'); }
  else {
    const GBO2Browser = require('./lib/browser.js');
    const { findChrome } = require('./lib/wiki_fetch.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const b64 = s => Buffer.from(s, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // 공유 코드로 그 파츠를 단 구성을 넣는다 (파츠를 손으로 찾아 누르는 것보다 확실하다)
    const code = 'GBO2-' + b64(JSON.stringify({ m: 'ドライセン_LV1', p: ['謎の電子回路_LV1'],
      s: 6, e: '拡張スキル無し', l: 5 }));

    const br = await GBO2Browser.launch({ executablePath: findChrome(), headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files'] });
    const pg = await br.newPage();
    await pg.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await pg.goto('file:///' + DIST.replace(/\\/g, '/').replace(/ /g, '%20'),
      { waitUntil: 'load', timeout: 180000 });
    await sleep(2500);
    await pg.evaluate(v => { window.prompt = () => v; }, code);
    await pg.evaluate(() => document.querySelector('#importBtn').click());
    await sleep(1200);

    /* 성능표에서 숫자를 읽는다 — 화면이 실제로 보여 주는 값이다. */
    const read = () => pg.evaluate(() => {
      /* 성능표의 진짜 꼴은 `.stat-row > .label / .total` 이다.
         처음에 `.st / .st-k / .st-v`(기체 정보 칸의 꼴)로 읽었더니 **아무것도 안 읽혀**
         「바뀐 칸 없음」이 나왔다 — 앱이 멀쩡한데 자가 운 것이다. 읽은 칸 수도 함께 센다. */
      const out = {};
      for (const r of document.querySelectorAll('#statBody .stat-row')) {
        const k = (r.querySelector('.label') || {}).textContent || '';
        const v = (r.querySelector('.total') || {}).textContent || '';
        if (k.trim()) out[k.trim()] = parseFloat(String(v).replace(/[^\d.-]/g, ''));
      }
      return { stats: out, boxShown: !document.querySelector('#lateBox').hidden,
        checked: !!document.querySelector('#lateChk').checked };
    });

    const a = await read();
    ok('성능표를 실제로 읽었다 (자가 헛돌지 않게)', Object.keys(a.stats).length > 5,
      { 읽은칸: Object.keys(a.stats).length });
    ok('파츠를 달면 「4분 경과」 칸이 보인다', a.boxShown === true, { 보임: a.boxShown });
    ok('처음에는 꺼져 있다', a.checked === false);

    // 진짜 마우스로 누른다 — el.click() 은 가려진 것도 누른다
    const p = await pg.evaluate(() => { const e = document.querySelector('#lateChk');
      const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await pg.mouse.click(p.x, p.y);
    await sleep(700);
    const b = await read();

    ok('누르면 켜진다', b.checked === true);
    const changed = Object.keys(a.stats).filter(k => a.stats[k] !== b.stats[k]);
    ok('누르면 **수치가 바뀐다**', changed.length > 0, { 바뀐칸: changed });
    /* 어느 쪽으로 바뀌는지까지 — 이동이 내리고 보정이 올라야 한다 */
    const d = k => (b.stats[k] || 0) - (a.stats[k] || 0);
    ok('이동이 내리고 보정이 오른다',
      d('스피드') < 0 && d('고속이동') < 0 && d('사격 보정') > 0 && d('격투 보정') > 0,
      { 스피드: d('스피드'), 고속이동: d('고속이동'), 사격: d('사격 보정'), 격투: d('격투 보정') });

    await br.close();
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

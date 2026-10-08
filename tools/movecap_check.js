// ① 「고속이동이 상승하는 파츠와 동시 장착 불가」가 지켜지는가.
// ② 고속이동 상한(250)이 실제로 자르는가.
//   node tools/movecap_check.js
//
// 사용자 보고(2026-10-08):
//   · CP 내장 특수 구조재 LV1 과 하로(V) LV1 이 **같이 달렸다**.
//     CP 설명은 「なお、高速移動が上昇するパーツとの同時装備は行えない」인데, 앱에는
//     **스피드·선회 금지만** 있고 고속이동 금지가 아예 없었다. 하로는 고속이동 +3 이라 걸린다.
//     하로의 금지는 「스피드」라서 반대로는 안 걸린다 — **한쪽에만 적힌 금지**다.
//   · 고속이동이 250 을 넘었다. DEFAULT_LIMITS 가 Infinity 라 아무리 올려도 안 잘렸다.
//
// 둘 다 화면은 멀쩡해 보이고 수치만 틀린다 — 그래서 여기서 지킨다.
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
const find = n => every.find(p => p.name === n);

/* ── ① 동시 장착 금지 ───────────────────────────────────────── */
const halo = find('ハロ（V）_LV1');
const cp = find('CP内蔵特殊構造材_LV1');
ok('두 파츠가 자료에 있다', !!halo && !!cp);

if (halo && cp) {
  /* **양쪽 모두** 막아야 한다. 금지는 짝에 대한 것이라 어느 쪽을 먼저 달든 같아야 한다.
     한쪽만 막으면 「먼저 단 순서에 따라 되기도 하고 안 되기도」 한다. */
  ok('하로를 단 뒤 CP 를 막는다', C.conflictsWithMovement(cp, [halo]) === true);
  ok('CP 를 단 뒤 하로를 막는다', C.conflictsWithMovement(halo, [cp]) === true);
  /* 혼자서는 당연히 달려야 한다 — 너무 넓게 막으면 멀쩡한 것까지 못 단다. */
  ok('하로 혼자는 달린다', C.conflictsWithMovement(halo, []) === false);
  ok('CP 혼자는 달린다', C.conflictsWithMovement(cp, []) === false);
  /* 고속이동과 무관한 파츠와는 같이 달려야 한다. */
  const plain = every.find(p => !p.highSpeedMovement && !p.speed
    && !p.turnPerformanceGround && !p.turnPerformanceSpace && p.name !== cp.name);
  if (plain) ok('고속이동과 무관한 파츠는 CP 와 같이 달린다',
    C.conflictsWithMovement(plain, [cp]) === false, { 파츠: plain.name });

  /* 자동 구성도 둘을 같이 담으면 안 된다 — 장착 판정을 안 보는 길이 따로 있으면 거기서 샌다. */
  const sample = msAll.sort((a, b) => a.MS名 < b.MS名 ? -1 : 1).filter((_, i) => i % 61 === 0).slice(0, 14);
  const both = sample.filter(m => {
    const r = O.optimize(m, { stage: 6, restarts: 1,
      weights: { highSpeedMovement: 3, speed: 2, hp: 1 } }, byCat, fullst);
    const n = r.parts.map(p => p.name);
    return n.includes(halo.name) && n.includes(cp.name);
  });
  ok('자동 구성이 둘을 같이 담지 않는다', both.length === 0, both.map(m => m.MS名));
}

/* 적어 둔 목록이 **설명과 어긋나지 않는가.**
   이름으로 적어 두었으니(정규식은 문구가 바뀌면 조용히 샌다), 설명에서 다시 뽑아 대조한다.
   새 파츠가 같은 금지를 들고 오면 여기서 운다 — 목록이 낡는 것을 막는 유일한 길이다. */
{
  const want = every.filter(p => /高速移動が(?:上昇|増加)する[^。]*?同時装備/.test(String(p.description || '')))
    .map(p => p.name);
  const got = want.filter(n => (C.HIGHSPEED_EXCLUSIVE || []).some(x => n.includes(x)));
  ok('설명에 그 금지가 적힌 파츠를 빠짐없이 적어 두었다', got.length === want.length,
    { 설명: want, 빠진것: want.filter(n => !got.includes(n)) });
  ok('목록이 비어 있지 않다', (C.HIGHSPEED_EXCLUSIVE || []).length > 0);
}

/* ── ② 고속이동 상한 ────────────────────────────────────────── */
ok('기본 상한이 250 이다 (전에는 Infinity)', C.DEFAULT_LIMITS.highSpeedMovement === 250,
  { 상한: C.DEFAULT_LIMITS.highSpeedMovement });

{
  /* 말만으로는 모른다 — **실제로 잘리는 장면**을 찾아 본다.
     소체가 가장 높은 기체에 고속이동을 몰아주면 251 이 나오고, 표시는 250 이어야 한다. */
  const tops = msAll.slice().sort((a, b) => Number(b['高速移動']) - Number(a['高速移動'])).slice(0, 8);
  let clipped = null, best = 0;
  for (const m of tops) {
    const r = O.optimize(m, { stage: 6, restarts: 1, weights: { highSpeedMovement: 5 } }, byCat, fullst);
    const st = C.calcStats(m, r.parts, 6, C.EXPANSION_NONE, byCat, fullst, null, 'normal');
    best = Math.max(best, st.total.highSpeedMovement);
    if (st.rawTotal.highSpeedMovement > st.total.highSpeedMovement)
      clipped = { ms: m.MS名, raw: st.rawTotal.highSpeedMovement, shown: st.total.highSpeedMovement };
  }
  ok('상한을 넘기는 구성이 실제로 잘린다', !!clipped, { 찾음: clipped });
  ok('어느 구성도 250 을 넘겨 보이지 않는다', best <= 250, { 가장높은표시: best });
  if (clipped) console.log('  (참고) ' + clipped.ms + '  원시 ' + clipped.raw + ' → 표시 ' + clipped.shown);

  /* 확장 스킬은 그 위로 올려 줘야 한다 — 통상치만 막는 것이지 확장까지 막는 것이 아니다. */
  const m0 = tops[0];
  let raised = null;
  for (const e of (C.EXPANSION_SKILLS || [])) {
    const lv = C.EXPANSION_LEVELS && C.EXPANSION_LEVELS[e];
    const rr = C.calcStats(m0, [], 6, e, byCat, fullst, lv ? lv.length : null, 'normal');
    if (rr.currentLimits.highSpeedMovement > 250) raised = { exp: e, cap: rr.currentLimits.highSpeedMovement };
  }
  ok('확장 스킬은 상한을 더 올려 준다', !!raised, { 찾음: raised });
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

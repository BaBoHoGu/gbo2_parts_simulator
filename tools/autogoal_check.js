// 자동 구성이 **닿을 수 있는 목표에 닿는가**.
//   node tools/autogoal_check.js
//
// 사용자 보고(2026-10-08): 손으로 짜면 HP 29,550 이 되는데 자동 구성은 28,750 이 한계라며
// 목표 29,000 을 못 맞췄다. 게다가 화면은 「어떤 구성으로도 달성하지 못했습니다 —
// 도달 가능한 최댓값 … (가용 파츠·이 기체 상한 한계)」라고 **단정**하고 있었다.
//
// 원인은 한 줄이었다: `const beamStart = hasTargets ? null : beamSearch();`
// 목표가 걸리면 빔 서치를 끄고 탐욕(feasBuild)과 무작위 재시작만 남겼다.
// 목표가 있을 때가 바로 빔이 가장 필요한 때다 — 「여럿이 모여야 효과가 나는 조합」은
// 탐욕이 첫 수에서 버린다. 실측:
//   탐욕 28,750 · 1스왑 등반 28,750 · 2스왑 등반 29,250 · 빔(폭 8) 29,550
// 손 구성은 3스왑 거리이고 가는 길이 먼저 1,500 내려간다 — **올라가는 이동만 받는
// 등반으로는 반경을 넓혀도 원리적으로 못 넘는다.** 되돌리면 화면은 멀쩡해 보이고
// 「이 기체로는 안 되는구나」로 읽힌다. 그래서 여기서 지킨다.
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

const byCat = rd('parts.json');
const msAll = rd('msData.json');
const fullst = rd('fullst.json');
const every = [].concat(...Object.values(byCat));

/* 사용자가 보고한 그 설정 그대로. **화면과 같은 restarts: 1** 로 돌린다 —
   재시작을 늘려 재면 탐색의 약점이 가려진다(운으로 메워진다). */
const MS_NAME = 'ザクⅡ_LV5';
const EXP = 'パーツ拡張[HP]';
const STAGE = 6, EXPLV = 5, GOAL = 29000;
const MANUAL = ['オーバーチューン[フレーム]_LV1', 'カテゴリ特攻プログラム_汎用_LV1', '緊急修復モジュール_LV1',
  'コネクティングシステム[汎用Ⅱ型] _LV1', '新型フレーム_LV2', 'シールド補強材_LV1',
  'シールド補強材_LV2', '背部特殊装甲_LV1'];

const ms = msAll.find(m => m.MS名 === MS_NAME);
ok('기체를 찾았다: ' + MS_NAME, !!ms);
if (!ms) { console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(1); }

const manual = MANUAL.map(n => every.find(p => p.name === n));
const missing = MANUAL.filter((n, i) => !manual[i]);
ok('손 구성 파츠가 모두 있다', missing.length === 0, missing);
if (missing.length) { console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(1); }

const hpOf = set => C.calcStats(ms, set, STAGE, EXP, byCat, fullst, EXPLV, 'normal').total.hp;
const manualHp = hpOf(manual);

/* 이 자가 재는 **전제**를 먼저 박아 둔다 — 손 구성이 정말 유효하고 정말 목표를 넘는가.
   자료가 바뀌어 전제가 깨지면 「통과」가 거짓이 된다. */
ok('손 구성이 장착 가능한 구성이다', O.isValidSet(ms, manual, STAGE, fullst));
ok('손 구성이 목표를 넘는다 (' + manualHp + ' ≥ ' + GOAL + ')', manualHp >= GOAL, { hp: manualHp });

const opts = { stage: STAGE, expansion: EXP, expLevel: EXPLV,
  weights: { hp: 2 }, minimums: { hp: GOAL }, restarts: 1 };
const t0 = Date.now();
const r = O.optimize(ms, opts, byCat, fullst);
const took = Date.now() - t0;
const autoHp = r.stats ? r.stats.total.hp : 0;

ok('목표를 달성했다고 답한다', r.feasible === true, { feasible: r.feasible, hp: autoHp });
ok('실제로 목표를 넘겼다 (' + autoHp + ' ≥ ' + GOAL + ')', autoHp >= GOAL, { hp: autoHp });
/* 손 구성에 **닿는지**까지 본다. 목표만 보면 29,000 을 간신히 넘는 답으로도 통과해,
   탐색이 다시 나빠져도 모른다. */
/* **점수로** 견준다. 원시 HP 로만 재면 틀린다 — 점수는 실효 HP(내성 반영)를 보므로,
   목표를 넘긴 뒤에는 원시 HP 가 낮아도 더 튼튼한 구성이 정답일 수 있다. 자동 구성이
   손으로 짠 것보다 **제 자로 재서** 못하면 그때가 문제다. */
{
  const sc = O.makeScorer(ms, opts, byCat, fullst);
  const sa = sc(r.parts).value, sm = sc(manual).value;
  ok('손으로 짠 것보다 점수가 낮지 않다', sa >= sm - 1e-6,
    { 자동: Number(sa.toFixed(1)), 손: Number(sm.toFixed(1)), 자동HP: autoHp, 손HP: manualHp });
}

/* 빔 서치가 **목표가 있을 때도** 도는가 — 고친 그 한 줄이 되돌아가면 여기서 운다.
   값이 아니라 코드를 보는 검사라 약하지만, 위 검사와 짝이 되어 「왜」를 말해 준다. */
{
  /* **주석은 걷어내고 본다.** 고친 이유를 적으면서 옛 코드와 옛 문구를 그대로 인용했더니,
     이 검사가 그 주석을 코드로 읽고 울었다. 「낱말이 있는가」로 재는 검사의 고질병이다. */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const src = strip(fs.readFileSync(path.join(ROOT, 'src', 'optimizer.js'), 'utf8'));
  ok('목표가 있어도 빔 서치를 끄지 않는다',
    !/hasTargets\s*\?\s*null\s*:\s*beamSearch\(\)/.test(src));
}

/* 화면 문구가 **「불가능하다」고 단정하지 않는가.** best 는 찾은 것 중 최고값이지 상한이 아니다. */
{
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const ui = strip(fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8'));
  ok('「어떤 구성으로도 달성하지 못했습니다」라고 단정하지 않는다',
    !ui.includes('어떤 구성으로도 달성하지 못했습니다'));
  ok('「가용 파츠·이 기체 상한 한계」라고 단정하지 않는다',
    !ui.includes('가용 파츠·이 기체 상한 한계'));
}

/* ── 상한에 막힌 목표 ────────────────────────────────────────────────
   사용자 보고(2026-10-08, 드라이센 LV1 · 파츠확장[장갑] LV5 · 목표 내실 44/내빔 44/내격 70):
   손으로 짜면 44/44/70 인데 자동 구성은 48/50/46 이었다.

   내격투 상한은 50 이고 `新型耐格闘装甲` 가 70 으로 올린다. 그런데 그 파츠는 **혼자 달면
   이득이 0** 이다 — 상한이 50 인데 50 을 못 넘는 동안에는 슬롯만 먹는다. 점수로 고르는 한
   영원히 안 뽑힌다. 빔 너비를 16→256 으로 올려도 안 뽑혔다.

   두 가지를 고쳐 길을 열었다:
     ① 페널티를 **거리**로 잰다(개수가 아니라). 전에는 못 맞춘 목표마다 1000 을 더해
        「셋이 조금씩 모자람」이 「하나가 크게 모자람」보다 나빠 보였다 — 답에 가까운 쪽이
        버려졌다. 1960 vs 3240 이던 것이 960 vs 240 으로 뒤집힌다.
     ② 목표가 상한을 넘으면 **그 상한 파츠를 넣은 채로** 빔을 한 번 더 돌린다.
   결과: 내격투 46 → 68, 미달 9.6 → 2.4.

   **아직 44/44/70 에는 못 닿는다.** 마지막 한 걸음이 「슬롯을 더 싸게 쓰는 3스왑」이라
   등반으로는 못 넘는다. 그래서 이 검사는 「달성한다」가 아니라 **「상한 파츠를 쓰는가」와
   「충분히 가까운가」**를 잰다. 되돌아가면 46 으로 떨어져 여기서 운다. */
{
  const ms2 = msAll.find(m => m.MS名 === 'ドライセン_LV1');
  const EXP2 = 'パーツ拡張[装甲]';
  const G2 = { armorRange: 44, armorBeam: 44, armorMelee: 70 };
  const U2 = { armorRange: 2.5, armorBeam: 2.5, armorMelee: 2.5 };
  ok('기체를 찾았다: ドライセン_LV1', !!ms2);
  if (ms2) {
    const r2 = O.optimize(ms2, { stage: 6, expansion: EXP2, expLevel: 5, restarts: 1,
      weights: { armorRange: 1, armorBeam: 1, armorMelee: 1 }, minimums: G2 }, byCat, fullst);
    const t2 = r2.stats ? r2.stats.total : {};
    const sh = Object.keys(G2).reduce((a, k) => a + Math.max(0, G2[k] - (t2[k] || 0)) / U2[k], 0);

    /* **상한을 실제로 넘겼는가.** 50 이하면 상한 파츠를 안 쓴 것이다 — 가장 확실한 신호다. */
    ok('상한(50)을 넘겨 올린다 — 상한 파츠를 쓴다는 뜻',
      (t2.armorMelee || 0) > 50, { 내격투: t2.armorMelee });
    /* 전에는 9.6 이었다. 넉넉히 잡아 4.0 — 그보다 멀어지면 길이 다시 막힌 것이다. */
    /* **달성한다.** 칸 바구니 빔 + 미달 우선 줄 세우기로 손 구성(44/44/70)에 닿았다.
       전에는 9.6 → 2.4 → 0.0 으로 줄여 왔다. 느슨하게 두면 다시 2.4 로 물러나도 모른다. */
    ok('목표를 달성한다고 답한다', r2.feasible === true, { feasible: r2.feasible });
    ok('실제로 세 목표를 다 넘겼다 (미달 ' + sh.toFixed(1) + ')', sh === 0,
      { 미달: Number(sh.toFixed(2)), 내실: t2.armorRange, 내빔: t2.armorBeam, 내격: t2.armorMelee });
    console.log('  (참고) 드라이센 ' + t2.armorRange + '/' + t2.armorBeam + '/' + t2.armorMelee
      + '  미달 ' + sh.toFixed(1) + '  (손 구성 44/44/70)');
  }
}

/* 페널티가 **거리**로 재는가 — 개수로 되돌아가면 위 검사가 먼저 울겠지만,
   왜 울었는지는 이 줄이 말해 준다. */
{
  const strip = s2 => s2.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const src2 = strip(fs.readFileSync(path.join(ROOT, 'src', 'optimizer.js'), 'utf8'));
  ok('미달 페널티를 목표 개수로 세지 않는다',
    !/penalty \+= 1000 \+ 100 \* \(short/.test(src2));
}

console.log('  (참고) 자동 ' + autoHp + ' · 손 ' + manualHp + ' · 평가 '
  + (r.evaluations || 0).toLocaleString() + '회 · ' + took + 'ms');
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

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
ok('손 구성만큼 올린다 (' + autoHp + ' ≥ ' + manualHp + ')', autoHp >= manualHp,
  { 자동: autoHp, 손: manualHp, 모자람: manualHp - autoHp });

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

console.log('  (참고) 자동 ' + autoHp + ' · 손 ' + manualHp + ' · 평가 '
  + (r.evaluations || 0).toLocaleString() + '회 · ' + took + 'ms');
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

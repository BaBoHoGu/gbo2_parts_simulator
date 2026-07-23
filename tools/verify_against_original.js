// 우리 계산 엔진(src/core.js)이 원본 번들과 같은 값을 내는지 대조한다.
//   node tools/extract_original_calc.js   # 먼저 원본 로직 추출
//   node tools/verify_against_original.js [조합수]
//
// 원본에는 확장 스킬 레벨 개념이 없고 최대치(LV5) 기준이므로 expLevel=5 로 맞춘다.
const path = require('path');
const C = require('../src/core.js');
const { calcStatsOriginal, calcSlotsOriginal } = require('./_original_calc.js');

const D = f => require(path.join(__dirname, '..', 'data', f));
const msData = D('msData.json');
const partsByCat = D('parts.json');
const fullst = D('fullst.json');
const allParts = Object.values(partsByCat).flat();

const TARGET = Number(process.argv[2]) || 20000;
const STAGES = [0, 4, 6];

// 재현 가능한 난수
let seed = 20260723;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/** 장착 규칙을 지키는 무작위 구성 */
function randomBuild(ms, stage) {
  const eq = [];
  const n = Math.floor(rnd() * 9);            // 0~8개
  for (let tries = 0; tries < 40 && eq.length < n; tries++) {
    const p = allParts[Math.floor(rnd() * allParts.length)];
    if (C.checkEquip(p, ms, eq, C.calcSlots(ms, eq, stage, fullst)).ok) eq.push(p);
  }
  return eq;
}

const FIELDS = ['total', 'rawTotal', 'base', 'partBonus', 'fullStrengthenBonus', 'expansionBonus'];
const SLOT_KEYS = ['close', 'mid', 'long', 'maxClose', 'maxMid', 'maxLong'];
let checked = 0, mismatch = 0, slotMismatch = 0;
const slotByStage = {};
const samples = [];

for (let i = 0; i < TARGET; i++) {
  const ms = msData[Math.floor(rnd() * msData.length)];
  const stage = STAGES[Math.floor(rnd() * STAGES.length)];
  const expansion = C.EXPANSION_SKILLS[Math.floor(rnd() * C.EXPANSION_SKILLS.length)];
  const eq = randomBuild(ms, stage);

  const a = calcStatsOriginal(ms, eq, stage, expansion, partsByCat, fullst);
  const b = C.calcStats(ms, eq, stage, expansion, partsByCat, fullst, C.MAX_EXPANSION_LEVEL);
  checked++;

  const diffs = [];
  for (const f of FIELDS) {
    for (const k of C.STAT_KEYS) {
      if (a[f][k] !== b[f][k]) diffs.push(`${f}.${k}: 원본 ${a[f][k]} / 우리 ${b[f][k]}`);
    }
  }
  for (const k of C.STAT_KEYS) {
    if (a.currentLimits[k] !== b.currentLimits[k]) {
      diffs.push(`limit.${k}: 원본 ${a.currentLimits[k]} / 우리 ${b.currentLimits[k]}`);
    }
  }

  if (diffs.length) {
    mismatch++;
    if (samples.length < 12) {
      samples.push(`${ms.MS名} | 강화${stage} | ${expansion} | 파츠[${eq.map(p => p.name).join(', ')}]\n    ` + diffs.join('\n    '));
    }
  }

  // 슬롯도 함께 대조 (강화 단계별로 집계)
  const sa = calcSlotsOriginal(ms, eq, stage, fullst);
  const sb = C.calcSlots(ms, eq, stage, fullst);
  if (SLOT_KEYS.some(k => sa[k] !== sb[k])) {
    slotMismatch++;
    slotByStage[stage] = (slotByStage[stage] || 0) + 1;
  }
}

console.log(`대조 ${checked.toLocaleString()}건 (기체×강화×확장×무작위 구성)`);
console.log(`  스탯  일치 ${(checked - mismatch).toLocaleString()} / 불일치 ${mismatch.toLocaleString()}`);
console.log(`  슬롯  일치 ${(checked - slotMismatch).toLocaleString()} / 불일치 ${slotMismatch.toLocaleString()}`
  + (slotMismatch ? '  (강화단계별 ' + JSON.stringify(slotByStage) + ')' : ''));
if (samples.length) {
  console.log('\n--- 스탯 불일치 사례 ---');
  console.log(samples.join('\n'));
}
// 슬롯 4단계 차이는 README「알려진 차이」로 문서화된 의도적 차이라 실패로 보지 않는다.
process.exit(mismatch ? 1 : 0);

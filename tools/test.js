const path = require('path');
const fs = require('fs');
const core = require('../src/core.js');
const opt = require('../src/optimizer.js');

// 출력용 한국어 표기 (계산은 원본 일본어 키 그대로)
const NF = x => x.normalize('NFC');
const I18N_MS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'i18n', 'ms.json'), 'utf8'));
const I18N_PART = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'i18n', 'parts.json'), 'utf8'));
const msKo = new Map(Object.entries(I18N_MS).map(([k, v]) => [NF(k), v]));
const partKo = new Map(Object.entries(I18N_PART).map(([k, v]) => [NF(k), v.n]));
const kMs = n => {
  const m = NF(n).match(/^(.*?)(_LV\d+)?$/);
  return (msKo.get(m[1]) || n) + (m[2] ? ' ' + m[2].slice(1) : '');
};
const kPart = n => partKo.get(NF(n)) || n;

const D = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8'));
const msData = D('msData.json');
const partsByCat = D('parts.json');
const fullst = D('fullst.json');

console.log('MS:', msData.length, 'parts:', Object.values(partsByCat).reduce((a, b) => a + b.length, 0));

const ms = msData.find(m => m.MS名.startsWith('ペイルライダー')) || msData[msData.length - 1];
const ATTR_KO = { 汎用: '범용', 強襲: '강습', 支援: '지원' };
console.log('\n=== 대상 기체 ===', kMs(ms.MS名), ATTR_KO[ms.属性], '코스트', ms.コスト,
  '슬롯', ms.近スロット, ms.中スロット, ms.遠スロット);

const bare = core.calcStats(ms, [], 6, '拡張スキル無し', partsByCat, fullst);
console.log('강화6단계 소체:',
  core.STAT_KEYS.map(k => `${core.STAT_LABEL[k]}=${bare.total[k]}`).join(' '));

for (const [name, weights] of Object.entries(opt.PRESETS)) {
  const t0 = Date.now();
  const r = opt.optimize(ms, {
    stage: 6, expansion: 'MS戦複合拡張', weights, minimums: {}, restarts: 6, seed: 7
  }, partsByCat, fullst);
  const slots = core.calcSlots(ms, r.parts, 6, fullst);
  console.log(`\n--- ${name} (${Date.now() - t0}ms, ${r.evaluations} eval) score=${r.score.toFixed(2)}`);
  console.log('  파츠:', r.parts.map(p => kPart(p.name)).join(', '));
  console.log(`  슬롯 ${slots.close}/${slots.maxClose} ${slots.mid}/${slots.maxMid} ${slots.long}/${slots.maxLong}`);
  console.log('  결과:', core.STAT_KEYS
    .filter(k => r.stats.total[k] !== bare.total[k])
    .map(k => `${core.STAT_LABEL[k]} ${bare.total[k]}→${r.stats.total[k]}`).join(', '));
}

// 모든 프리셋 결과가 게임 규칙(8개 / 슬롯 / 계열 중복 / 스피드·선회 배타)을 지키는지 검증
let violations = 0;
for (const [name, weights] of Object.entries(opt.PRESETS)) {
  for (const ms2 of [msData[0], ms, msData[Math.floor(msData.length / 2)]]) {
    const r = opt.optimize(ms2, { stage: 6, expansion: '拡張スキル無し', weights, minimums: {}, restarts: 2, seed: 11 },
      partsByCat, fullst);
    if (!opt.isValidSet(ms2, r.parts, 6, fullst)) {
      violations++;
      console.log('  규칙 위반:', name, kMs(ms2.MS名), r.parts.map(p => kPart(p.name)).join(','));
    }
  }
}
console.log(`\n규칙 검증: ${violations === 0 ? 'OK (위반 0건)' : violations + '건 위반'}`);

// 하한 목표 테스트
const r2 = opt.optimize(ms, {
  stage: 6, expansion: '拡張スキル無し',
  weights: { meleeCorrection: 3, hp: 1 },
  minimums: { speed: (bare.total.speed + 10), thruster: bare.total.thruster + 15 },
  restarts: 6, seed: 3
}, partsByCat, fullst);
console.log('\n--- 하한 목표 (스피드 +10, 스러스터 +15) feasible=', r2.feasible);
console.log('  파츠:', r2.parts.map(p => kPart(p.name)).join(', '));
console.log('  스피드', r2.stats.total.speed, '스러스터', r2.stats.total.thruster,
  '격투', r2.stats.total.meleeCorrection, 'HP', r2.stats.total.hp);

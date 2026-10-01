// 자동 구성이 **실효 HP 축**으로 고르는가 — 내성은 선형이 아니다.
//
// 왜 필요한가 — 예전 점수는 Σ w·Δ스탯 이라 내성 1포인트를 어디서 올리든 같게 쳤다.
// 실효 HP 는 HP ÷ (1 − 내성/100) 이라 40→41 보다 49→50 이 훨씬 큰데, 그걸 모르고
// 상한 근처에서 잘못된 파츠를 골랐다. 표본 12기 전부 손해였다(평균 −4,869 실효 HP).
// 점수 계산은 눈에 안 보이는 곳이라, 누군가 선형으로 되돌려도 화면은 멀쩡해 보인다.
// 그래서 **결과의 실효 HP 를 직접** 재서 지킨다.
//
// 브라우저를 띄우지 않는다 — core·optimizer 만으로 끝나는 계산이라 빠르다.
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));
const O = require(path.join(ROOT, 'src', 'optimizer.js'));
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

const byCat = rd('parts.json');
const msAll = rd('msData.json');
const fullst = rd('fullst.json');

// 세 속성을 고르게 본 실효 HP. core 의 공식을 쓴다 — 여기서 베껴 쓰면 둘이 같이 틀린다.
const ARM = ['armorRange', 'armorBeam', 'armorMelee'];
const ehpMix = t => ARM.reduce((s, k) => s + C.durabilityOf(t, k), 0) / ARM.length;

const W = { hp: 3, armorRange: 2, armorBeam: 2, armorMelee: 2 };
const OPT = { stage: 6, restarts: 6, weights: W };

/* 표본 — 상한에 가까운 고코스트 기체라야 비선형이 드러난다. 데이터가 바뀌어도
   같은 기체가 뽑히도록 이름순으로 고정한다(코스트 순은 값이 바뀌면 흔들린다). */
const sample = msAll
  .filter(m => Number(m['コスト']) >= 600)
  .sort((a, b) => String(a.MS名).localeCompare(String(b.MS名)))
  .filter((_, i) => i % 53 === 0)
  .slice(0, 6);

ok('표본 기체를 찾았다 (6기)', sample.length === 6, { 찾음: sample.length });

/* ① 결과가 **실효 HP 축에서 1스왑 최적**인가.
   장착한 것 하나를 빼고 다른 후보를 넣어 더 튼튼해지면, 점수가 그 축을 안 보고 있다는 뜻이다.
   (선형 점수로 되돌리면 내성 상한 근처에서 이 검사가 바로 깨진다.)

   「단순 탐욕보다 낫다」로는 재지 않는다 — 탐욕이 이기는 기체가 있는데, 그건 이 단계가
   아니라 지역 최적 문제이고 빔 서치가 풀 몫이다. 약속하지 않은 것을 재면 안 된다. */
const better = [];
for (const ms of sample) {
  const r = O.optimize(ms, OPT, byCat, fullst);
  const stat = set => C.calcStats(ms, set, 6, '拡張スキル無し', byCat, fullst, null, 'normal').total;
  const cur = ehpMix(stat(r.parts));
  const pool = [].concat(...Object.values(byCat)).filter(p => !C.categoryRestricted(p, ms));
  let found = null;
  for (let i = 0; i < r.parts.length && !found; i++) {
    const rest = r.parts.filter((_, j) => j !== i);
    for (const p of pool) {
      if (r.parts.some(q => q.name === p.name)) continue;
      const cand = rest.concat([p]);
      if (!O.isValidSet(ms, cand, 6, fullst)) continue;
      const v = ehpMix(stat(cand));
      if (v > cur + 1) { found = { 뺀것: r.parts[i].name, 넣은것: p.name, 지금: Math.round(cur), 더나음: Math.round(v) }; break; }
    }
  }
  if (found) better.push({ ms: ms.MS名, ...found });
}
ok('결과가 실효 HP 축에서 1스왑 최적이다', better.length === 0, better.slice(0, 2));

/* ② 내성 가중치를 한쪽으로 몰면 그 속성의 실효 HP 가 가장 높아야 한다.
   축이 살아 있는지 보는 검사다 — 선형으로 되돌리면 이 편향이 사라진다. */
const ms0 = sample[0];
const only = (k) => O.optimize(ms0, { stage: 6, restarts: 6, weights: { hp: 1, [k]: 5 } }, byCat, fullst);
const beamSet = only('armorBeam');
const solidSet = only('armorRange');
const tB = C.calcStats(ms0, beamSet.parts, 6, '拡張スキル無し', byCat, fullst, null, 'normal').total;
const tS = C.calcStats(ms0, solidSet.parts, 6, '拡張スキル無し', byCat, fullst, null, 'normal').total;
ok('내빔에 몰면 내빔 실효 HP 가 더 높다',
  C.durabilityOf(tB, 'armorBeam') > C.durabilityOf(tS, 'armorBeam'),
  { 내빔몰기: C.durabilityOf(tB, 'armorBeam'), 내실탄몰기: C.durabilityOf(tS, 'armorBeam') });
ok('내실탄에 몰면 내실탄 실효 HP 가 더 높다',
  C.durabilityOf(tS, 'armorRange') > C.durabilityOf(tB, 'armorRange'),
  { 내실탄몰기: C.durabilityOf(tS, 'armorRange'), 내빔몰기: C.durabilityOf(tB, 'armorRange') });

/* ③ 공식은 한 곳에만 있어야 한다 — 화면이 제 것을 따로 들고 있으면 언젠가 갈린다. */
const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
ok('화면이 내구 공식을 따로 들고 있지 않다',
  !/durabilityOf\s*=\s*\(total,\s*armorKey\)\s*=>\s*\n?\s*Math\.round\(/.test(ui));

/* ④ 파츠 데이터의 **순서**가 답을 바꾸면 안 된다.
   parts.json 은 생성물이라 갱신 때마다 순서가 달라질 수 있는데, 예전에는 그 순서가
   그대로 답을 갈랐다 — 표본 8기 전부 다른 구성이 나왔고 실효 HP 차이가 최대 1,547 이었다.
   같은 기체·같은 설정이면 어제와 오늘이 같아야 한다. */
const reordered = {
  뒤집음: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.slice().reverse()])),
  // 한 자리씩 민다 — 뒤집기와는 다른 흐트러짐
  한칸밀기: Object.fromEntries(Object.entries(byCat)
    .map(([k, v]) => [k, v.length ? v.slice(1).concat(v[0]) : v])),
};
const namesOf = (parts) => parts.map(p => p.name).sort().join('|');
const orderDiff = [];
for (const ms of sample.slice(0, 3)) {
  const base = namesOf(O.optimize(ms, OPT, byCat, fullst).parts);
  for (const [label, alt] of Object.entries(reordered)) {
    const got = namesOf(O.optimize(ms, OPT, alt, fullst).parts);
    if (got !== base) orderDiff.push({ ms: ms.MS名, 순서: label });
  }
}
ok('파츠 데이터 순서가 바뀌어도 같은 구성을 낸다', orderDiff.length === 0, orderDiff.slice(0, 3));

/* 같은 입력이면 몇 번을 돌려도 같아야 한다(시드 고정). */
const ms1 = sample[0];
const twice = [0, 1].map(() => namesOf(O.optimize(ms1, OPT, byCat, fullst).parts));
ok('같은 입력을 두 번 돌리면 같은 구성이다', twice[0] === twice[1]);

/* ⑤ **단순 탐욕보다 못하면 안 된다.**
   예전에는 못했다 — 한 장씩 가장 좋은 것만 집는 탐욕이 우리 탐색을 이기는 기체가 있었다
   (54,782 vs 56,526). 무작위로 채우고 국소탐색만 하면 「둘이 모여야 효과가 나는 수」를
   놓치기 때문이다(상한만 올려 주는 신형 장갑 넷이 그런 파츠다).
   빔 서치가 그것을 메웠는지 여기서 지킨다 — 되돌리면 바로 깨진다. */
const greedyBuild = (ms) => {
  const pool = [].concat(...Object.values(byCat)).filter(p => !C.categoryRestricted(p, ms));
  const stat = set => C.calcStats(ms, set, 6, '拡張スキル無し', byCat, fullst, null, 'normal').total;
  let sel = [];
  for (let i = 0; i < C.MAX_PARTS; i++) {
    let best = null;
    for (const p of pool) {
      if (sel.some(q => q.name === p.name)) continue;
      const cand = sel.concat([p]);
      if (!O.isValidSet(ms, cand, 6, fullst)) continue;
      const v = ehpMix(stat(cand));
      if (!best || v > best.v) best = { cand, v };
    }
    if (!best) break;
    sel = best.cand;
  }
  return ehpMix(stat(sel));
};

const beaten = [];
for (const ms of sample) {
  const r = O.optimize(ms, OPT, byCat, fullst);
  const mine = ehpMix(C.calcStats(ms, r.parts, 6, '拡張スキル無し', byCat, fullst, null, 'normal').total);
  const greedy = greedyBuild(ms);
  if (mine < greedy - 1) beaten.push({ ms: ms.MS名, 지금: Math.round(mine), 탐욕: Math.round(greedy) });
}
ok('단순 탐욕보다 못한 기체가 없다', beaten.length === 0, beaten.slice(0, 3));

/* ⑥ **피해 % 파츠를 점수가 본다.**
   그 파츠들은 total.shoot 을 바꾸지 않고 무장 쪽에만 걸려서, 예전 점수는 아예 못 봤다 —
   사격 특화 프로그램 같은 것을 고를 이유가 없었다. 표본 12기로 재 보니 실효 배율이
   12기 전부 올랐다(평균 +0.121 ≈ 피해 +7%). 되돌리면 조용히 나빠지므로 여기서 지킨다. */
const D = require(path.join(ROOT, 'src', 'damage.js'));
const PROBE_SOLID = { name: 'マシンガン', type: 'shooting', attr: 'solid', info: {}, levels: {} };
const PROBE_BEAM = { name: 'ビーム・ライフル', type: 'shooting', attr: 'beam', info: {}, levels: {} };
const PROBE_MELEE = { name: 'ヒート・サーベル', type: 'melee', attr: 'melee', info: {}, levels: {} };
const allParts = [].concat(...Object.values(byCat).filter(Array.isArray));

const dmgMapFor = (ms) => {
  const lv = C.msLevel(ms.MS名), attr = ms['属性'];
  const out = {};
  for (const p of allParts) {
    const m = D.weaponModsOf([p], lv, attr, '拡張スキル無し');
    const sp = D.damagePctFor(m, PROBE_SOLID, 'shoot');
    const bp = D.damagePctFor(m, PROBE_BEAM, 'shoot');
    const mp = D.damagePctFor(m, PROBE_MELEE, 'melee');
    if (sp || bp || mp) out[p.name] = { s: sp, b: bp, m: mp };
  }
  return out;
};
// 실효 사격 배율 — 화면과 같은 기준(min(실탄, 빔))
const effMul = (ms, parts, total) => {
  const m = D.weaponModsOf(parts, C.msLevel(ms.MS名), ms['属性'], '拡張スキル無し');
  const pct = Math.min(D.damagePctFor(m, PROBE_SOLID, 'shoot'),
    D.damagePctFor(m, PROBE_BEAM, 'shoot'));
  return (1 + (total.shoot || 0) / 100) * (1 + pct / 100);
};

/* **같은 코드의 두 설정을 견주면 안 된다.** 처음엔 「표를 준 쪽 vs 안 준 쪽」으로 썼는데,
   축을 꺼서 심으니 양쪽이 똑같이 나빠져 검사가 안 물었다(허깨비였다).
   재는 대상 밖의 자로 본다 — **실효 배율에서 1스왑 최적인가.** */
const atkSwap = [];
for (const ms of sample) {
  const r = O.optimize(ms, { stage: 6, restarts: 6, weights: { shoot: 5 },
    partDmgPct: dmgMapFor(ms) }, byCat, fullst);
  const stat = set => C.calcStats(ms, set, 6, '拡張スキル無し', byCat, fullst, null, 'normal').total;
  const cur = effMul(ms, r.parts, stat(r.parts));
  const pool = allParts.filter(p => !C.categoryRestricted(p, ms));
  let found = null;
  for (let i = 0; i < r.parts.length && !found; i++) {
    const rest = r.parts.filter((_, j) => j !== i);
    for (const p of pool) {
      if (r.parts.some(q => q.name === p.name)) continue;
      const cand = rest.concat([p]);
      if (!O.isValidSet(ms, cand, 6, fullst)) continue;
      const v = effMul(ms, cand, stat(cand));
      if (v > cur + 0.004) {
        found = { 뺀것: r.parts[i].name, 넣은것: p.name,
          지금: +cur.toFixed(3), 더나음: +v.toFixed(3) };
        break;
      }
    }
  }
  if (found) atkSwap.push({ ms: ms.MS名, ...found });
}
ok('결과가 실효 사격 배율에서 1스왑 최적이다', atkSwap.length === 0, atkSwap.slice(0, 2));

/* 피해 % 파츠가 실제로 존재해야 이 검사가 뜻을 갖는다(헛돌지 않게). */
const anyPct = Object.keys(dmgMapFor(sample[0])).length;
ok('피해 % 를 주는 파츠가 데이터에 있다', anyPct > 0, { 개수: anyPct });

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

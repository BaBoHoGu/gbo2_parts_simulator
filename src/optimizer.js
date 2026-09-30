(function () {
'use strict';
/* ------------------------------------------------------------------
 * 자동 파츠 구성기
 * 슬롯/중복/8개 제한을 지키면서 사용자가 지정한 목표에 가장 가까운
 * 파츠 조합을 탐색한다. (다중 시작점 + 최급상승 국소탐색)
 * ------------------------------------------------------------------ */

const { STAT_KEYS, MAX_PARTS, EXPANSION_NONE, calcSlots, calcStats, conflictsWithMovement, categoryRestricted, effectConflict,
  durabilityOf } =
  (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./core.js') : window.GBO2Core;

/** 가중치 1.0이 "괜찮은 파츠 한 장 분량"이 되도록 하는 스탯별 환산 단위. */
const UNIT = {
  hp: 250, armorRange: 2.5, armorBeam: 2.5, armorMelee: 2.5,
  shoot: 5, meleeCorrection: 5, speed: 5, highSpeedMovement: 5,
  thruster: 10, turnPerformanceGround: 5, turnPerformanceSpace: 5,
  // 파생 지표(공격 지표=실효 보정, 내구 지표=실효 HP) — 하한/상한 목표용 페널티 환산
  effShoot: 5, effMelee: 5, durSolid: 2, durBeam: 2, durMelee: 2,
  // 실효 HP — 「적 무장 N발 버티기」 목표가 쓰는 축. HP 와 같은 눈금으로 둔다.
  ehpSolid: 250, ehpBeam: 250, ehpMelee: 250
};

/** 프리셋: 자주 쓰는 운용 방향별 가중치. */
const PRESETS = {
  '격투 강습': { meleeCorrection: 3, speed: 2, thruster: 2, hp: 1, armorMelee: 1, highSpeedMovement: 1 },
  '사격 지원': { shoot: 3, armorBeam: 1, armorRange: 1, hp: 1, thruster: 1.5 },
  '탱커 (범용 방어)': { hp: 3, armorRange: 2, armorBeam: 2, armorMelee: 2, thruster: 0.5 },
  '기동형': { speed: 3, thruster: 3, highSpeedMovement: 2, turnPerformanceGround: 1, turnPerformanceSpace: 1 },
  '대빔 방어': { armorBeam: 3, hp: 2, armorRange: 1, armorMelee: 1, thruster: 1 },
  '대실탄 방어': { armorRange: 3, hp: 2, armorBeam: 1, armorMelee: 1, thruster: 1 },
  '밸런스': { hp: 1, armorRange: 1, armorBeam: 1, armorMelee: 1, shoot: 1, meleeCorrection: 1, speed: 1, thruster: 1 }
};

/* ---------- 집합 단위 유효성 ---------- */

/** 슬롯 상한은 기체·강화단계에만 의존하므로 탐색 시작 시 한 번만 구한다. */
const slotCap = (ms, stage, fullstDefs) => calcSlots(ms, [], stage, fullstDefs);

function slotsFit(set, cap) {
  let close = 0, mid = 0, long = 0;
  for (const p of set) {
    close += Number(p.close || 0);
    mid += Number(p.mid || 0);
    long += Number(p.long || 0);
  }
  return close <= cap.maxClose && mid <= cap.maxMid && long <= cap.maxLong;
}

/**
 * 미리 구한 슬롯 상한으로 검사하는 내부용 버전.
 * 탐색 루프에서 수만 번 호출되므로 파츠마다 배열을 새로 만들지 않고
 * `others` 하나를 재사용한다.
 */
function isValidSetWith(ms, set, cap) {
  if (set.length > MAX_PARTS) return false;
  const seen = new Set();
  for (const p of set) {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    if (categoryRestricted(p, ms)) return false;
  }
  const others = [];
  for (let i = 0; i < set.length; i++) {
    others.length = 0;
    for (let j = 0; j < set.length; j++) if (j !== i) others.push(set[j]);
    if (conflictsWithMovement(set[i], others)) return false;
    if (effectConflict(set[i], others)) return false;
  }
  return slotsFit(set, cap);
}

/** 공개 API — 슬롯 상한을 그때그때 계산한다. */
function isValidSet(ms, set, stage, fullstDefs) {
  return isValidSetWith(ms, set, slotCap(ms, stage, fullstDefs));
}

/* ---------- 평가 ---------- */

/* 방어 가중치는 **비선형 축**으로 친다.
   내성은 선형이 아니다 — 실효 HP 는 HP ÷ (1 − 내성/100) 이라, 40→41 보다 49→50 이
   훨씬 크다. 예전 점수는 Σ w·Δ스탯 이라 어디서 올리든 같게 쳐서 **상한 근처에서
   잘못된 파츠를 골랐다.** 표본 12기로 재 보니 실효 HP 를 직접 노린 구성이
   12기 전부 더 튼튼했다(평균 +4,869 · 최대 +11,754 실효 HP).

   값은 core 의 durabilityOf 로 구한다 — 화면과 같은 자를 쓰고, 이미 계산된 total 위의
   산술이라 **공짜다.** (처음엔 화면의 derivedMetrics 훅을 평가마다 불렀는데, 이득은
   그대로이면서 자동 구성이 6.9초 → 12.5초가 됐다. 그 훅은 목표 판정에만 쓴다.)

   공격은 건드리지 않는다 — 실효 보정은 파츠 설명을 훑어야 나와 값이 비싸고,
   이번 측정에서 이득이 확인되지 않았다. 이동계는 선형이 맞다. */
const DEF_WEIGHTS = ['hp', 'armorRange', 'armorBeam', 'armorMelee'];
const DEF_ARMOR = ['armorRange', 'armorBeam', 'armorMelee'];

/** 가중치를 몫(share)으로 — 전부 0 이면 고르게 나눈다. */
function shareOf(weights, keys) {
  const w = keys.map(k => Math.max(0, Number(weights[k]) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = {};
  keys.forEach((k, i) => { out[k] = sum > 0 ? w[i] / sum : 1 / keys.length; });
  return out;
}

/** 세 속성의 실효 HP 를 가중치 몫대로 섞은 값. */
const durMix = (total, share) =>
  DEF_ARMOR.reduce((s, k) => s + share[k] * durabilityOf(total, k), 0);

function makeScorer(ms, opts, partsByCat, fullstDefs) {
  const { stage, expansion, expLevel, weights = {}, minimums, maximums, skill, derived, form, weaponLv } = opts;
  // 스킬을 켠 채로 자동 구성하면 그 보정까지 감안해 최적화한다 (상한에 걸려 파츠 선택이 달라진다)
  // form 도 마찬가지 — 변형 화면을 보며 자동 구성을 돌리면 변형 수치로 최적화해야 한다.
  // (예전엔 늘 통상으로 계산해, 변형 기체 154기에서 화면과 다른 기준으로 파츠를 골랐다)
  // weaponLv 도 화면과 같아야 한다 — 주무장 LV 를 낮춰 둔 채 자동 구성을 돌리면
  // 레벨링크 시스템 파츠는 기본값만 붙는데, 여기서 최대치로 세면 **화면에 없는 이득**을
  // 보고 그 파츠를 고른다(고른 근거와 보이는 수치가 어긋난다).
  const base = calcStats(ms, [], stage, expansion, partsByCat, fullstDefs, expLevel, form, skill, weaponLv).total;

  const wDef = DEF_WEIGHTS.reduce((s, k) => s + (Number(weights[k]) || 0), 0);
  const useDef = wDef > 0;
  // 세 속성을 어떤 몫으로 볼지는 **내성 가중치**가 정한다(HP 가중치는 세 축 모두를 올린다).
  const defShare = shareOf(weights, DEF_ARMOR);
  const baseDefMix = useDef ? durMix(base, defShare) : 0;

  return function score(set) {
    const res = calcStats(ms, set, stage, expansion, partsByCat, fullstDefs, expLevel, form, skill, weaponLv);
    // 파생 지표(공격 지표·내구 지표)는 파츠 효과를 UI 에서 계산해 넘겨준다(있을 때만).
    const dv = derived ? derived(set, res.total) : null;
    const valOf = k => (dv && k in dv) ? dv[k] : res.total[k];
    /* 값을 못 구한 목표(파생 지표인데 derived 훅이 없을 때 등)는 **못 맞춘 것으로 센다.**
       예전에는 undefined 가 그대로 흘러 `target - undefined = NaN` 이 되고,
       `NaN > 0` 이 false 라 페널티가 0 이었다 — 목표가 아무 말 없이 사라지고
       「달성했다(feasible)」고까지 말했다(실측: ehpSolid 하한 999999 에 feasible=true).
       조용히 틀리느니 못 맞췄다고 말하는 쪽이 낫다. */
    const unmet = k => { const v = valOf(k); return typeof v !== 'number' || !isFinite(v); };
    let value = 0;
    for (const k of STAT_KEYS) {
      const w = weights[k];
      if (!w) continue;
      // 실효 HP 축으로 대신 치는 스탯은 여기서 두 번 세지 않는다
      if (useDef && DEF_WEIGHTS.includes(k)) continue;
      value += w * (res.total[k] - base[k]) / UNIT[k];
    }
    if (useDef) value += wDef * (durMix(res.total, defShare) - baseDefMix) / UNIT.ehpSolid;
    // 하한 목표는 강한 페널티로 표현해 탐색이 충족 방향으로 흐르게 한다.
    let penalty = 0;
    for (const [k, target] of Object.entries(minimums || {})) {
      if (!target) continue;
      if (unmet(k)) { penalty += 1000; continue; }       // 잴 수 없다 = 못 맞췄다
      const short = target - valOf(k);
      if (short > 0) penalty += 1000 + 100 * (short / (UNIT[k] || 1));
    }
    // 상한 목표 — 초과하면 하한과 대칭으로 페널티를 준다(그 스탯을 넘기지 않는 구성으로 흐르게).
    for (const [k, target] of Object.entries(maximums || {})) {
      if (target == null || target === '') continue;
      if (unmet(k)) { penalty += 1000; continue; }       // 잴 수 없다 = 못 맞췄다
      const over = valOf(k) - target;
      if (over > 0) penalty += 1000 + 100 * (over / (UNIT[k] || 1));
    }
    return { value: value - penalty, penalty, feasible: penalty === 0, stats: res };
  };
}

/* ---------- 탐색 ---------- */

function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} ms
 * @param {object} opts
 *   stage, expansion, weights, minimums,
 *   locked: string[]   반드시 포함할 파츠명
 *   banned: string[]   제외할 파츠명
 *   restarts: number
 * @param {object} partsByCat
 * @param {object[]} fullstDefs
 */
function optimize(ms, opts, partsByCat, fullstDefs) {
  const stage = opts.stage || 0;
  const expansion = opts.expansion || EXPANSION_NONE;
  const restarts = opts.restarts || 10;
  const maxIter = opts.iters || 60;   // 확장 비교용 스캔은 반복을 줄여 빠르게 돌린다
  const banned = new Set(opts.banned || []);
  const rnd = mulberry32(opts.seed || 12345);

  const every = [].concat(...Object.values(partsByCat));
  const all = every.filter(p => !banned.has(p.name) && !categoryRestricted(p, ms));

  // 잠금("반드시 유지")은 제외("후보에서 빼기")보다 강하다.
  // banned 를 뺀 목록에서 찾으면 잠근 파츠가 조용히 사라지므로 전체 목록에서 찾는다.
  const lockWanted = (opts.locked || [])
    .map(name => every.find(p => p.name === name))
    .filter(p => p && !categoryRestricted(p, ms));
  /* **잠금끼리 충돌하면 그대로 두면 안 된다.** 잠금은 한 번도 검증되지 않았고
     추가할 때만 검증해서, 충돌하는 둘을 잠그면 그 둘이 결과로 그대로 나왔다 —
     장착할 수 없는 구성을 「이게 최적」이라고 내민 셈이다(실측으로 재현).
     앞에 적은 것을 살리고, 함께 둘 수 없는 것은 뺀다. 무엇을 뺐는지 같이 돌려주어
     화면이 「이 둘은 같이 못 답니다」라고 말할 수 있게 한다. */
  const locked = [];
  const droppedLocks = [];
  for (const p of lockWanted) {
    if (isValidSetWith(ms, locked.concat([p]), slotCap(ms, stage, fullstDefs))) locked.push(p);
    else droppedLocks.push(p.name);
  }

  const cap = slotCap(ms, stage, fullstDefs);
  const scorer = makeScorer(ms, { ...opts, stage, expansion, expLevel: opts.expLevel }, partsByCat, fullstDefs);
  const pool = all.filter(p => !locked.some(l => l.name === p.name));

  /* 단독으로도 장착 불가한 파츠는 후보에서 제외 (슬롯 초과 등).
     그리고 **이름순으로 세워 둔다.**

     parts.json 은 생성물이라 갱신 때마다 순서가 달라질 수 있는데, 그 순서가 답을
     바꿨다. 무작위 채우기(shuffled)가 입력 순서를 타고, 동점일 때는 먼저 만난
     후보가 이기기 때문이다. 표본 8기를 원본·뒤집음·섞음으로 돌려 보니
     **8기 전부** 다른 구성이 나왔고 실효 HP 차이가 최대 1,547 이었다 —
     같은 기체·같은 설정인데 어제와 다른 답이 나오는 셈이다.

     localeCompare 는 쓰지 않는다. 환경(ICU)에 따라 결과가 달라져 「기계마다 다른 답」이
     된다. 코드 단위로 곧이곧대로 견준다. */
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const candidates = pool
    .filter(p => isValidSetWith(ms, locked.concat([p]), cap))
    .sort(byName);

  let best = null;
  let evaluations = 0;

  const evaluate = set => { evaluations++; return scorer(set); };

  const lockedNames = new Set(locked.map(l => l.name));
  // inn 을 넣되 슬롯이 부족하면 non-locked 파츠를 (뺐을 때 남는 집합 점수가 가장 높은 순으로) 빼 자리를 만든다.
  // 큰 파츠 1개를 작은 파츠 여럿 자리에 넣는 '다중 축출'을 가능하게 해 지역 최적을 벗어난다.
  const insertWithEviction = (cur, inn) => {
    let s = cur.filter(p => p.name !== inn.name).concat([inn]);
    if (isValidSetWith(ms, s, cap)) return s;
    let guard = 0;
    while (!isValidSetWith(ms, s, cap) && guard++ <= MAX_PARTS + 2) {
      const removable = s.filter(p => p.name !== inn.name && !lockedNames.has(p.name));
      if (!removable.length) return null;
      let pick = null;
      for (const rm of removable) {
        const t = s.filter(p => p.name !== rm.name);
        const v = evaluate(t).value;
        if (!pick || v > pick.v) pick = { t, v };
      }
      s = pick.t;
    }
    return isValidSetWith(ms, s, cap) ? s : null;
  };

  // 하한/상한 목표만 보고 빈 상태에서 쌓아 올려 충족 구성을 직접 만든다.
  // 지역탐색이 못 가는 '좁은 실현영역'(거의 유일한 조합)을 재구성으로 도달한다.
  const feasBuild = () => {
    let cur = locked.slice(), sc = evaluate(cur), guard = 0;
    while (sc.penalty > 0 && guard++ < 50) {
      let bestC = null;
      for (const inn of candidates) {
        if (cur.some(p => p.name === inn.name)) continue;
        const cand = insertWithEviction(cur, inn);
        if (!cand) continue;
        const s = evaluate(cand);
        if (!bestC || s.penalty < bestC.s.penalty || (s.penalty === bestC.s.penalty && s.value > bestC.s.value))
          bestC = { cand, s };
      }
      if (!bestC || (bestC.s.penalty >= sc.penalty && bestC.s.value <= sc.value + 1e-9)) break;   // 진전 없음
      cur = bestC.cand; sc = bestC.s;
    }
    return cur;
  };
  const hasTargets = Object.values(opts.minimums || {}).some(v => v)
    || Object.values(opts.maximums || {}).some(v => v != null && v !== '');

  for (let r = 0; r < restarts; r++) {
    // --- 초기해 ---
    // 목표(하한/상한)가 있으면 앞쪽 재시작은 '충족 우선 구성'에서 출발해 좁은 실현영역을 잡는다.
    // 나머지 재시작은 무작위로 채워 다양성을 준다.
    let cur;
    if (hasTargets && r < Math.max(2, Math.ceil(restarts / 3))) {
      cur = feasBuild();
      for (const p of shuffled(candidates, rnd)) {   // 남는 슬롯을 채워 가치도 확보
        if (cur.length >= MAX_PARTS) break;
        const next = cur.concat([p]);
        if (!cur.some(q => q.name === p.name) && isValidSetWith(ms, next, cap)) cur = next;
      }
    } else {
      cur = locked.slice();
      for (const p of shuffled(candidates, rnd)) {
        if (cur.length >= MAX_PARTS) break;
        const next = cur.concat([p]);
        if (isValidSetWith(ms, next, cap)) cur = next;
      }
    }
    let curScore = evaluate(cur);

    // --- 최급상승 국소탐색: 교체 / 추가 / 제거 ---
    for (let iter = 0; iter < maxIter; iter++) {
      let bestMove = null;
      const swappable = cur.filter(p => !locked.some(l => l.name === p.name));

      for (const out of swappable) {
        const without = cur.filter(p => p.name !== out.name);
        for (const inn of candidates) {
          if (cur.some(p => p.name === inn.name)) continue;
          const next = without.concat([inn]);
          if (!isValidSetWith(ms, next, cap)) continue;
          const s = evaluate(next);
          if (s.value > curScore.value + 1e-9 && (!bestMove || s.value > bestMove.score.value)) {
            bestMove = { set: next, score: s };
          }
        }
        // 제거 자체가 이득인 경우 (하한 페널티 회피 등)
        const s = evaluate(without);
        if (s.value > curScore.value + 1e-9 && (!bestMove || s.value > bestMove.score.value)) {
          bestMove = { set: without, score: s };
        }
      }

      if (cur.length < MAX_PARTS) {
        for (const inn of candidates) {
          if (cur.some(p => p.name === inn.name)) continue;
          const next = cur.concat([inn]);
          if (!isValidSetWith(ms, next, cap)) continue;
          const s = evaluate(next);
          if (s.value > curScore.value + 1e-9 && (!bestMove || s.value > bestMove.score.value)) {
            bestMove = { set: next, score: s };
          }
        }
      }

      // 축출 삽입 — 큰 파츠를 여러 작은 파츠 자리에 넣어 하한/상한(목표)을 충족한다.
      // 비용이 크므로 아직 목표를 못 맞춘(infeasible) 상태에서만 시도한다.
      if (!curScore.feasible) {
        for (const inn of candidates) {
          if (cur.some(p => p.name === inn.name)) continue;
          const cand = insertWithEviction(cur, inn);
          if (!cand) continue;
          const s = evaluate(cand);
          if (s.value > curScore.value + 1e-9 && (!bestMove || s.value > bestMove.score.value)) {
            bestMove = { set: cand, score: s };
          }
        }
      }

      if (!bestMove) break;
      cur = bestMove.set;
      curScore = bestMove.score;
    }

    if (!best || curScore.value > best.score.value) best = { set: cur, score: curScore };
    if (opts.onProgress) opts.onProgress((r + 1) / restarts);
  }

  if (!best) return { parts: [], stats: null, score: 0, feasible: false, evaluations, droppedLocks };
  return {
    parts: best.set,
    stats: best.score.stats,
    score: best.score.value,
    feasible: best.score.feasible,
    evaluations,
    droppedLocks      // 함께 둘 수 없어 뺀 잠금 (없으면 빈 배열)
  };
}

const GBO2Optimizer = { optimize, PRESETS, UNIT, isValidSet };
if (typeof module !== 'undefined' && module.exports) module.exports = GBO2Optimizer;
if (typeof window !== 'undefined') window.GBO2Optimizer = GBO2Optimizer;

})();

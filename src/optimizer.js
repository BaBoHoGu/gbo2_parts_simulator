(function () {
'use strict';
/* ------------------------------------------------------------------
 * 자동 파츠 구성기
 * 슬롯/중복/8개 제한을 지키면서 사용자가 지정한 목표에 가장 가까운
 * 파츠 조합을 탐색한다. (다중 시작점 + 최급상승 국소탐색)
 * ------------------------------------------------------------------ */

const { STAT_KEYS, MAX_PARTS, EXPANSION_NONE, calcSlots, calcStats, conflictsWithMovement, categoryRestricted, effectConflict } =
  (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./core.js') : window.GBO2Core;

/** 가중치 1.0이 "괜찮은 파츠 한 장 분량"이 되도록 하는 스탯별 환산 단위. */
const UNIT = {
  hp: 250, armorRange: 2.5, armorBeam: 2.5, armorMelee: 2.5,
  shoot: 5, meleeCorrection: 5, speed: 5, highSpeedMovement: 5,
  thruster: 10, turnPerformanceGround: 5, turnPerformanceSpace: 5
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

function makeScorer(ms, opts, partsByCat, fullstDefs) {
  const { stage, expansion, expLevel, weights, minimums, skill } = opts;
  // 스킬을 켠 채로 자동 구성하면 그 보정까지 감안해 최적화한다 (상한에 걸려 파츠 선택이 달라진다)
  const base = calcStats(ms, [], stage, expansion, partsByCat, fullstDefs, expLevel, null, skill).total;

  return function score(set) {
    const res = calcStats(ms, set, stage, expansion, partsByCat, fullstDefs, expLevel, null, skill);
    let value = 0;
    for (const k of STAT_KEYS) {
      const w = weights[k];
      if (!w) continue;
      value += w * (res.total[k] - base[k]) / UNIT[k];
    }
    // 하한 목표는 강한 페널티로 표현해 탐색이 충족 방향으로 흐르게 한다.
    let penalty = 0;
    for (const [k, target] of Object.entries(minimums || {})) {
      if (!target) continue;
      const short = target - res.total[k];
      if (short > 0) penalty += 1000 + 100 * (short / UNIT[k]);
    }
    return { value: value - penalty, feasible: penalty === 0, stats: res };
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
  const banned = new Set(opts.banned || []);
  const rnd = mulberry32(opts.seed || 12345);

  const every = [].concat(...Object.values(partsByCat));
  const all = every.filter(p => !banned.has(p.name) && !categoryRestricted(p, ms));

  // 잠금("반드시 유지")은 제외("후보에서 빼기")보다 강하다.
  // banned 를 뺀 목록에서 찾으면 잠근 파츠가 조용히 사라지므로 전체 목록에서 찾는다.
  const locked = (opts.locked || [])
    .map(name => every.find(p => p.name === name))
    .filter(p => p && !categoryRestricted(p, ms));

  const cap = slotCap(ms, stage, fullstDefs);
  const scorer = makeScorer(ms, { ...opts, stage, expansion, expLevel: opts.expLevel }, partsByCat, fullstDefs);
  const pool = all.filter(p => !locked.some(l => l.name === p.name));

  // 단독으로도 장착 불가한 파츠는 후보에서 제외 (슬롯 초과 등)
  const candidates = pool.filter(p => isValidSetWith(ms, locked.concat([p]), cap));

  let best = null;
  let evaluations = 0;

  const evaluate = set => { evaluations++; return scorer(set); };

  for (let r = 0; r < restarts; r++) {
    // --- 초기해: 무작위 순서로 넣을 수 있는 만큼 채운다 ---
    let cur = locked.slice();
    for (const p of shuffled(candidates, rnd)) {
      if (cur.length >= MAX_PARTS) break;
      const next = cur.concat([p]);
      if (isValidSetWith(ms, next, cap)) cur = next;
    }
    let curScore = evaluate(cur);

    // --- 최급상승 국소탐색: 교체 / 추가 / 제거 ---
    for (let iter = 0; iter < 60; iter++) {
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

      if (!bestMove) break;
      cur = bestMove.set;
      curScore = bestMove.score;
    }

    if (!best || curScore.value > best.score.value) best = { set: cur, score: curScore };
    if (opts.onProgress) opts.onProgress((r + 1) / restarts);
  }

  if (!best) return { parts: [], stats: null, score: 0, feasible: false, evaluations };
  return {
    parts: best.set,
    stats: best.score.stats,
    score: best.score.value,
    feasible: best.score.feasible,
    evaluations
  };
}

const GBO2Optimizer = { optimize, PRESETS, UNIT, isValidSet };
if (typeof module !== 'undefined' && module.exports) module.exports = GBO2Optimizer;
if (typeof window !== 'undefined') window.GBO2Optimizer = GBO2Optimizer;

})();

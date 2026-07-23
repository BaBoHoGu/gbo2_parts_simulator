/* ------------------------------------------------------------------
 * 무장 피해량 계산
 *
 * 출처 (2026-07 확인)
 *   방정식 : https://w.atwiki.jp/battle-operation2/pages/83.html 「与ダメージ計算」
 *   구현   : http://wearezaku.web.fc2.com/damagescript/  damage_script_calc.js
 *
 * 원문 기초 방정식
 *   Damage = [[[[[Wp・{Att・ETCa}]・{Def・ETCb}]・CCd]・CCt]・Pr]
 *     [x] = 버림(Floor),  {x} = 소수 2자리 버림(floorDecimalPlaces(x,2))
 *
 * 여기서는 **방어 보정을 무시하고 순수 공격력만** 계산한다.
 * 즉 Def = 1, ETCb = 0 으로 고정하며, 구조는 남겨 두어 나중에 방어를 넣을 수 있게 한다.
 * ------------------------------------------------------------------ */

/** 공격 보정 상한 (보정값 100 = 피해 2배) */
const CAP_A = 100;
const CAP_ATT = 2.0;

/** 속성 간 보정 — 유리 +0.3 / 동일 0 / 불리 -0.2 */
const ATTR_BONUS = { advantage: 0.3, same: 0, disadvantage: -0.2 };

/** 자세·스코프 등 기타 공격 보정 (ETCa 에 더해지는 값) */
const ETC_ATTACK = {
  crouch: 0.05,   // 지상 앉기 / 우주 정지
  prone: 0.10,    // 엎드리기
  scope: 0.05,    // 스코프
  precision: 0.05 // 고정밀 포격
};

/** 소수 n자리 버림 — 원본 floorDecimalPlaces 와 동일 */
const floorTo = (v, n) => {
  const p = Math.pow(10, n);
  return Math.floor(v * p) / p;
};

/**
 * 기체 공격력 배율 Att = 1 + A/100  (상한 2.0)
 * @param {number} correction 사격보정 또는 격투보정 (기체 소수치 + 파츠 합계)
 * @param {number} [extra] EXAM·두부손괴 등 배율로 직접 더해지는 보정
 */
function attackPower(correction, extra = 0) {
  const att = 1 + (Math.min(Number(correction) || 0, CAP_A) / 100 + extra);
  return Math.min(att, CAP_ATT);
}

/**
 * 사격 피해량. (방어 무시)
 * @param {number} wp 무장 위력
 * @param {number} correction 사격 보정 (기체+파츠)
 * @param {object} [opt]
 *   etcA     기타 공격 보정 합 (자세·스코프·고정밀 등, 기본 0)
 *   attr     'advantage' | 'same' | 'disadvantage' (기본 same)
 *   extraAtt EXAM 등 Att 에 직접 더할 배율
 *   region   부위 공격 시 { wpRe, reA, reB } — 부위 위력 배율과 카스파·스킬 보정
 */
function shootingDamage(wp, correction, opt = {}) {
  const att = attackPower(correction, opt.extraAtt || 0);
  const tAtt = floorTo(att * (1 + (opt.etcA || 0)), 2);
  const pr = ATTR_BONUS[opt.attr] ?? 0;
  const r = opt.region;

  // Def·ETCb 는 1 이므로 곱셈 단계를 그대로 둔 채 생략한다.
  let dmg = r
    ? Math.floor(Math.floor(Number(wp) * r.wpRe * tAtt) * (1 + pr))
    : Math.floor(Math.floor(Number(wp) * tAtt) * (1 + pr));
  if (r) dmg = Math.floor(dmg * (r.reA ?? 1) * (r.reB ?? 1));
  return dmg;
}

/**
 * 격투 피해량. 연격은 타격마다 방향보정(CCd)·연격보정(CCt)을 적용해 누적한다.
 * @param {number[]} [opt.ccd] 타격별 방향 보정 (기본 [1])
 * @param {number[]} [opt.cct] 타격별 연격 보정 (기본 전부 1)
 */
function meleeDamage(wp, correction, opt = {}) {
  const att = attackPower(correction, opt.extraAtt || 0);
  const tAtt = floorTo(att * (1 + (opt.etcA || 0)), 2);
  const pr = ATTR_BONUS[opt.attr] ?? 0;
  const r = opt.region;
  const ccd = opt.ccd && opt.ccd.length ? opt.ccd : [1];
  const cct = opt.cct || [];

  const base = r
    ? Math.floor(Number(wp) * r.wpRe * tAtt)
    : Math.floor(Number(wp) * tAtt);

  let total = 0;
  for (let i = 0; i < ccd.length; i++) {
    let hit = Math.floor(Math.floor(Math.floor(base * ccd[i]) * (cct[i] ?? 1)) * (1 + pr));
    if (r) hit = Math.floor(hit * (r.reA ?? 1) * (r.reB ?? 1));
    total += hit;
  }
  return total;
}

/** 무장 표의 「배율」로 집속(풀차지) 위력을 구한다. 예: 900 × 4.223 → 3800 */
const chargedPower = (wp, ratio) => Math.floor(Number(wp) * Number(ratio));

/* ---------- 파츠가 무장에 거는 보정 ---------- */

/**
 * 파츠에는 이 효과의 수치 필드가 없고 설명문에만 적혀 있어 설명문에서 읽는다.
 * (원본 시뮬레이터는 무장을 다루지 않아 대조할 기준이 없다)
 *   집속 시간 단축 — 고정밀 집속 링 3·6·10% / 화기 관제 최적화 시스템 5%
 *   리로드 단축   — 퀵 로더 3·6·10·15% / 커넥팅 시스템[지원Ⅱ형] 10%
 * 같은 파츠의 다른 레벨을 함께 달면 합산한다.
 */
const WEAPON_MOD_RULES = [
  { key: 'chargeTime', re: /集束時間を([\d.]+)%短縮/ },
  { key: 'reloadTime', re: /リロード時間を([\d.]+)%短縮/ },
  // 무장 오버히트 복귀 (보조 제네레이터·커넥팅[지원Ⅰ형]).
  // 스러스터 OH 는 「スラスターオーバーヒート時の回復時間」이라 표현이 달라 걸리지 않는다.
  { key: 'weaponOH', re: /オーバーヒートからの復帰時間を([\d.]+)%短縮/ }
];

/**
 * 오버튠 계열 — 기체 LV 에 비례해 최종 피해량이 늘어난다.
 *   값 = min(기본 + 증가 × (기체LV − 1), 상한)
 * 위키에는 「射撃」LV1 의 증가치만 2%로 적혀 있는데, 나머지 11종이 모두 기체 LV4 에서
 * 정확히 상한에 닿는 규칙과 어긋난다(1 + 2×3 = 7 ≠ 상한 10). 실제 게임값인 3%로 바로잡는다.
 */
const OVERTUNE_RE = /(射撃|格闘)攻撃で与えるダメージが(\d+)%増加。機体LVが1上昇するごとに(\d+)%増加。同一のパーツ効果による最大上昇値は(\d+)%/;
const OVERTUNE_FIX = { 'オーバーチューン[射撃]_LV1': 3 };

/**
 * 장착 파츠에서 무장 보정을 모은다.
 * @param {object[]} equipped 장착 파츠
 * @param {number} [msLv] 기체 레벨 (오버튠 계산에 쓴다)
 * @returns {{chargeTime?:number, reloadTime?:number, weaponOH?:number, shootPct?:number, meleePct?:number}}
 */
function weaponModsOf(equipped, msLv) {
  const out = {};
  const lv = Number(msLv) || 1;
  for (const p of equipped || []) {
    const desc = p.description || '';
    for (const rule of WEAPON_MOD_RULES) {
      const m = rule.re.exec(desc);
      if (m) out[rule.key] = (out[rule.key] || 0) + Number(m[1]);
    }
    const ot = OVERTUNE_RE.exec(desc.replace(/\\n/g, ''));
    if (ot) {
      const inc = OVERTUNE_FIX[p.name] ?? Number(ot[3]);
      const pct = Math.min(Number(ot[2]) + inc * (lv - 1), Number(ot[4]));
      const key = ot[1] === '射撃' ? 'shootPct' : 'meleePct';
      out[key] = (out[key] || 0) + pct;
    }
  }
  return out;
}

/** 최종 피해량에 곱하는 % 보정 (오버튠 등). */
const applyDamagePct = (dmg, pct) => (pct ? Math.floor(dmg * (1 + pct / 100)) : dmg);

/** 시간을 percent 만큼 단축한다. 소수 둘째 자리까지. */
const shortenTime = (sec, pct) =>
  Math.round(Number(sec) * (1 - Number(pct) / 100) * 100) / 100;

/** 「5秒」「17.5秒」처럼 단위가 붙은 표기에 단축을 적용한다. 숫자가 없으면 그대로 둔다. */
function shortenTimeText(text, pct) {
  if (!pct || !text) return text;
  return String(text).replace(/(\d+(?:\.\d+)?)/, n => String(shortenTime(n, pct)));
}

const GBO2Damage = {
  CAP_A, CAP_ATT, ATTR_BONUS, ETC_ATTACK,
  floorTo, attackPower, shootingDamage, meleeDamage, chargedPower,
  weaponModsOf, shortenTime, shortenTimeText, applyDamagePct
};

if (typeof module !== 'undefined' && module.exports) module.exports = GBO2Damage;
if (typeof window !== 'undefined') window.GBO2Damage = GBO2Damage;

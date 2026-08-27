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

/**
 * 공격 보정 "기본" 상한 (보정 100 = 피해 2배). 참고용 상수 — 실제 차단엔 쓰지 않는다.
 * 위키(与ダメージ計算/数値のキャップ): 이 상한은 확장 스킬·커스텀 파츠·기체 스킬의
 * 상한 상승으로 늘어나며, 늘어난 만큼 배율에 그대로 반영된다(예: 사격보정확장 LV5 → 112 → 2.12배).
 * 상한 차단은 calcStats(스탯 계산) 단계에서 이미 이뤄지므로, 여기서는 다시 자르지 않는다.
 */
const CAP_A = 100;

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
 * 기체 공격력 배율 Att = 1 + 보정/100.
 * 보정값은 이미 스탯 계산에서 현재 상한(기본 100, 확장·파츠·스킬로 확장)까지 잘려 들어오므로
 * 여기서 다시 상한을 적용하지 않는다 → 보정 112면 2.12배가 그대로 반영된다.
 * @param {number} correction 사격보정 또는 격투보정 (기체 소수치 + 파츠·확장·스킬 합계, 상한 반영됨)
 * @param {number} [extra] EXAM·두부손괴 등 배율로 직접 더해지는 보정
 */
function attackPower(correction, extra = 0) {
  return 1 + (Number(correction) || 0) / 100 + extra;
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
  // attrBonus: 카테고리 특공 프로그램처럼 상성 배율 자체를 올리는 파츠가 있으면 그 값을 쓴다
  const pr = opt.attrBonus != null ? opt.attrBonus : (ATTR_BONUS[opt.attr] ?? 0);
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
  // attrBonus: 카테고리 특공 프로그램처럼 상성 배율 자체를 올리는 파츠가 있으면 그 값을 쓴다
  const pr = opt.attrBonus != null ? opt.attrBonus : (ATTR_BONUS[opt.attr] ?? 0);
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

/* ---------- 무장 분류 ---------- */

/**
 * 빔(에너지) 무장인가.
 * 위키 표에 속성 열이 없어 두 신호를 조합한다.
 *   ① 이름의 빔 계열 표기 — 「하이·메가·캐논[사격출력 리미터 해제]」처럼
 *      접미사만 보면 오판하는 경우가 있어 이 판정을 가장 먼저 둔다
 *   ② 열식(ヒート率·OH復帰) 이면 에너지 무장으로 본다
 * 열식이지만 빔이 아닌 것은 센서·카메라 건·화염방사기뿐이라 예외로 뺀다.
 */
const BEAM_NAME = /ビーム|ビム|メガ粒子|メガ・粒子|メガ・?ランチャー|メガ・?キャノン|メガ・?カノン|レーザー|メーザー|荷電粒子|B・|B\./;
const NON_BEAM_HEAT = /火炎放射|センサー|カメラ・?ガン|射撃出力リミッター解除/;

const weaponColumns = w => [
  ...Object.keys((w && w.info) || {}),
  ...Object.values((w && w.levels) || {}).flatMap(l => Object.keys((l && l.raw) || {}))
];

/** 열식(진짜 오버히트: 연속 사격 열로 관리되는) 무장인가 — ヒート率 이 있어야 한다. */
const isHeatWeapon = w => weaponColumns(w).some(k => /ヒート率/.test(k));

/**
 * E팩 탄창식 빔인가 — 히트율은 없는데 OH復帰(위키가 붙인 표기일 뿐, 실제로는 탄창 리로드)만 있는 무장.
 * 이런 빔은 OH 가 아니라 리로드로 취급한다(탄수=OHまでの弾数, 시간 단축=리로드 파츠). 사용자 지적:
 * "빔인데 히트율이 없으면 탄창식(E팩식)이며 리로드로 적용". 실드·리로드 표기가 있는 것은 제외.
 */
const isEpackMag = w => {
  const cols = weaponColumns(w);
  return cols.some(k => /OH復帰/.test(k))
    && !cols.some(k => /ヒート率/.test(k))
    && !cols.some(k => /リロード時間/.test(k))
    && !cols.some(k => /シールドHP|サイズ/.test(k));
};

function isBeamWeapon(w) {
  const name = (w && w.name) || '';
  if (BEAM_NAME.test(name)) return true;
  if (NON_BEAM_HEAT.test(name)) return false;
  return weaponColumns(w).some(k => /OH復帰|ヒート率/.test(k));  // 열식·E팩 모두 에너지(빔)로 본다
}

/* ---------- 파츠가 무장에 거는 보정 ---------- */

/**
 * 파츠에는 이 효과의 수치 필드가 없고 설명문에만 적혀 있어 설명문에서 읽는다.
 * (원본 시뮬레이터는 무장을 다루지 않아 대조할 기준이 없다)
 *
 * `scope` 는 효과가 걸리는 무장 범위다.
 *   all  — 무장 종류를 가리지 않음
 *   beam — 빔 무장만
 * 같은 파츠의 다른 레벨을 함께 달면 합산한다.
 */
const WEAPON_MOD_RULES = [
  // 집속 시간 — 고정밀 집속 링 3·6·10% / 화기 관제 최적화 시스템 5% (모두 빔 사격 무장 한정)
  { key: 'chargeTime', scope: 'beam', re: /集束時間を([\d.]+)%短縮/ },
  // 리로드 — 퀵 로더 3·6·10·15% / 커넥팅[지원Ⅱ형] 10%.
  // 설명문은 실탄·빔(잔탄식)으로 적혀 있으나 실제로는 잔탄식이면 종류를 가리지 않는다.
  { key: 'reloadTime', scope: 'all', re: /リロード時間を([\d.]+)%短縮/ },
  // 무장 오버히트 복귀 — 보조 제네레이터·커넥팅[지원Ⅰ형]. 둘 다 빔 무장 한정이다.
  // 스러스터 OH 는 「スラスターオーバーヒート時の回復時間」이라 표현이 달라 걸리지 않는다.
  { key: 'weaponOH', scope: 'beam', re: /オーバーヒートからの復帰時間を([\d.]+)%短縮/ },
  // 대용량 보급 팩 — 리로드와 OH 복귀를 무장 종류와 무관하게 15% 줄인다
  { key: 'reloadTime', scope: 'all', re: /リロード時間、およびオーバーヒートからの回復速度が([\d.]+)%上昇/ },
  { key: 'weaponOH', scope: 'all', re: /リロード時間、およびオーバーヒートからの回復速度が([\d.]+)%上昇/ },
  // 사이코뮤 무장 전용 리로드·OH 단축 (CP 내장 특수 구조재 등). scope 'psycommu' 는 사이코뮤 무장에만 걸린다.
  { key: 'reloadTime', scope: 'psycommu', re: /サイコミュ兵装の[^。]*?リロード時間[^。]*?(\d+)%短縮/ },
  { key: 'weaponOH', scope: 'psycommu', re: /サイコミュ兵装の[^。]*?オーバーヒート時間[^。]*?(\d+)%短縮/ }
];

/**
 * 커넥팅[지원Ⅰ형]의 집속 단축은 「集束時間**が**10%短縮」이라 위 정규식에 걸리지 않고,
 * 「支援カテゴリに装備させると」라는 조건도 붙어 있어 따로 처리한다.
 */
const CONNECT_SUPPORT1_CHARGE = {
  re: /支援カテゴリに装備させると、ビーム射撃兵装の集束時間が([\d.]+)%短縮/,
  attr: '支援'
};

/**
 * 피해량 % 파츠.
 * `kind` 는 사격/격투 중 어디에 걸리는지, `scope` 는 무장 종류다.
 * 특수 연소제(소이 피해 25%)는 무장 표에 소이 여부가 없어 반영하지 않는다.
 */
const DAMAGE_PCT_RULES = [
  // 사격/격투 특화 프로그램 — 한쪽을 올리고 반대쪽을 내린다
  { kind: 'shoot', scope: 'all', sign: +1, re: /射撃攻撃による敵に与えるダメージが(\d+)%増加/ },
  { kind: 'melee', scope: 'all', sign: +1, re: /格闘攻撃による敵に与えるダメージが(\d+)%増加/ },
  { kind: 'shoot', scope: 'all', sign: -1, re: /射撃攻撃による敵に与えるダメージが(\d+)%減少/ },
  { kind: 'melee', scope: 'all', sign: -1, re: /格闘攻撃による敵に与えるダメージが(\d+)%減少/ },
  // 교육형 컴퓨터 — 작전 4분 경과 시 더 오르지만 기본값만 반영한다
  { kind: 'any', scope: 'all', sign: +1, re: /敵に与えるダメージを(\d+)%増加/ },
  // CP내장특수구조재 등 — 「敵機に与えるダメージが N%増加」(전 무장). 文頭·구두점 뒤로 한정해
  // 「ビーム射撃兵装で敵機に…」(커넥팅)·「射撃攻撃による敵に…」(특화)와 이중계산되지 않게 한다.
  { kind: 'any', scope: 'all', sign: +1, re: /(?:^|[。、])\s*敵機に与えるダメージが(\d+)%増加/ },
  { kind: 'shoot', scope: 'all', sign: +1, re: /敵に与える射撃ダメージを(\d+)%増加/ },
  { kind: 'melee', scope: 'all', sign: +1, re: /敵に与える格闘ダメージを(\d+)%増加/ },
  // 화기 관제 최적화 시스템
  { kind: 'any', scope: 'all', sign: +1, re: /敵へ与えるダメージを(\d+)%増加/ },
  // 커넥팅[지원Ⅰ/Ⅱ형] — 무장 종류가 한정된다
  { kind: 'shoot', scope: 'beam', sign: +1, re: /ビーム射撃兵装で敵機に与えるダメージが(\d+)%増加/ },
  { kind: 'shoot', scope: 'solid', sign: +1, re: /実弾射撃兵装で敵機に与えるダメージが(\d+)%増加/ }
];

/**
 * 오버튠 계열 — 기체 LV 에 비례해 최종 피해량이 늘어난다.
 *   값 = min(기본 + 증가 × (기체LV − 1), 상한)
 * 위키에는 「射撃」LV1 의 증가치만 2%로 적혀 있는데, 나머지 11종이 모두 기체 LV4 에서
 * 정확히 상한에 닿는 규칙과 어긋난다(1 + 2×3 = 7 ≠ 상한 10). 실제 게임값인 3%로 바로잡는다.
 */
const OVERTUNE_RE = /(射撃|格闘)攻撃で与えるダメージが(\d+)%増加。機体LVが1上昇するごとに(\d+)%増加。同一のパーツ効果による最大上昇値は(\d+)%/;
const OVERTUNE_FIX = { 'オーバーチューン[射撃]_LV1': 3 };

/** 실드 HP 를 올려 주는 파츠 (실드 보강재, 커넥팅[범용Ⅱ형]). */
const SHIELD_HP_RE = /シールドHPが(\d+)増加/;

/**
 * 장착 파츠에서 무장 보정을 모은다.
 * 시간 단축·피해 % 는 무장 종류별로 값이 달라, 합계 대신 `scope` 별 버킷으로 담는다.
 * 무장 하나에 적용할 값은 `modFor` 로 뽑아 쓴다.
 *
 * @param {object[]} equipped 장착 파츠
 * @param {number} [msLv] 기체 레벨 (오버튠 계산에 쓴다)
 * @param {string} [msAttr] 기체 속성 (커넥팅[지원Ⅰ형]의 조건부 효과에 쓴다)
 */
function weaponModsOf(equipped, msLv, msAttr) {
  const time = { chargeTime: {}, reloadTime: {}, weaponOH: {} };
  const damage = [];
  let shieldHp = 0;
  const lv = Number(msLv) || 1;

  const addTime = (key, scope, v) => { time[key][scope] = (time[key][scope] || 0) + v; };

  for (const p of equipped || []) {
    // 일부 신규 파츠 설명은 전각 ％(U+FF05) 를 쓴다 — 규칙(반각 %)이 매칭되도록 정규화한다
    const desc = (p.description || '').replace(/\\n/g, '').replace(/／/g, '/').replace(/％/g, '%');

    for (const rule of WEAPON_MOD_RULES) {
      const m = rule.re.exec(desc);
      if (m) addTime(rule.key, rule.scope, Number(m[1]));
    }
    const cs = CONNECT_SUPPORT1_CHARGE.re.exec(desc);
    if (cs && msAttr === CONNECT_SUPPORT1_CHARGE.attr) addTime('chargeTime', 'beam', Number(cs[1]));

    for (const rule of DAMAGE_PCT_RULES) {
      const m = rule.re.exec(desc);
      if (m) damage.push({ kind: rule.kind, scope: rule.scope, pct: rule.sign * Number(m[1]) });
    }
    const ot = OVERTUNE_RE.exec(desc);
    if (ot) {
      const inc = OVERTUNE_FIX[p.name] ?? Number(ot[3]);
      const pct = Math.min(Number(ot[2]) + inc * (lv - 1), Number(ot[4]));
      damage.push({ kind: ot[1] === '射撃' ? 'shoot' : 'melee', scope: 'all', pct });
    }

    const sh = SHIELD_HP_RE.exec(desc);
    if (sh) shieldHp += Number(sh[1]);
  }
  return { time, damage, shieldHp };
}

/** 무장이 어느 `scope` 에 해당하는지. 사이코뮤 무장은 'psycommu' scope 도 받는다. */
const weaponScopes = w => {
  const s = ['all', isBeamWeapon(w) ? 'beam' : 'solid'];
  if (w && w.psycommu) s.push('psycommu');
  return s;
};

/**
 * 시간이 절댓값으로 고정돼 파츠 단축을 안 받는 무장. 備考에 명시돼 있다.
 *   리로드 — 「リロード短縮系の効果なし」 (GN 소드Ⅱ[R 소드] 등)
 *   OH 복귀 — 「OH短縮系の効果なし」 (ZERO 시스템 기동 등)
 * 대용량 보급 팩·퀵 로더·보조 제네레이터 등 어떤 파츠로도 줄지 않는다.
 */
const NO_CUT_NOTE = {
  reloadTime: /リロード短縮系の効果なし/,
  weaponOH: /OH短縮系の効果なし|オーバーヒート[^\/]{0,8}短縮系の効果なし/
};

/** 이 무장에 실제로 걸리는 시간 단축 %. */
function timeCutFor(mods, key, w) {
  const note = (w && w.info && w.info['備考']) || '';
  if (NO_CUT_NOTE[key] && NO_CUT_NOTE[key].test(note)) return 0;
  const bucket = (mods && mods.time && mods.time[key]) || {};
  return weaponScopes(w).reduce((s, sc) => s + (bucket[sc] || 0), 0);
}

/**
 * 이 무장에 실제로 걸리는 피해 % 합계.
 * @param {'shoot'|'melee'} kind 무장의 공격 종류
 */
function damagePctFor(mods, w, kind) {
  const scopes = weaponScopes(w);
  return ((mods && mods.damage) || [])
    .filter(d => (d.kind === 'any' || d.kind === kind) && scopes.includes(d.scope))
    .reduce((s, d) => s + d.pct, 0);
}

/**
 * 최종 피해량에 % 보정을 적용한다 (오버튠·특화 프로그램·스킬 등). 감소도 받는다.
 * 배열을 주면 각 % 를 "곱연산"으로 순차 적용한다 — 스킬 피해 증가(최대출력·레이즈 카운터 등)는
 * 파츠 % 와 합산되지 않고 별도 배율로 곱해지므로, 스킬 몫은 별도 원소로 넣는다.
 * 단계마다 버림(게임 계산 관례).
 */
/**
 * 무장의 실드 보정 — 備考의 「シールド補正：1.5倍（1.35倍）」.
 * 위키 83: 「シールドへのダメージは、補正がかかった後のダメージ」 즉
 *   실드 피해 = 기체에 줄 피해 × 실드 보정.
 * 괄호는 집속(차지) 시 값. 「？倍」는 위키 미확인이라 null 로 둔다 —
 * 1.0 으로 가정하면 123 종에 근거 없는 숫자가 퍼진다.
 * 표기 자체가 없으면(2,666 종) null 을 준다.
 */
function shieldMultOf(w) {
  const note = (w && w.info && w.info['備考']) || '';
  if (!/シールド補正/.test(note)) return null;            // 표기 없음
  // 콜론이 빠진 표기(16종)도 받는다
  const m = note.match(/シールド補正\s*[：:]?\s*([\d.]+|？|\?)\s*倍\s*(?:（\s*([\d.]+|？|\?)\s*倍\s*）)?/);
  if (!m) return null;
  const num = v => (v == null || /[？?]/.test(v)) ? null : Number(v);
  const nc = num(m[1]);
  const ch = m[2] != null ? num(m[2]) : nc;               // 괄호 없으면 두 모드 같다
  return { nc, ch, unknown: nc == null && ch == null };
}

function applyDamagePct(dmg, pct) {
  const arr = Array.isArray(pct) ? pct : [pct];
  return arr.reduce((d, p) => (p ? Math.max(0, Math.floor(d * (1 + p / 100))) : d), dmg);
}

/** 시간을 percent 만큼 단축한다. 소수 둘째 자리까지. */
const shortenTime = (sec, pct) =>
  Math.round(Number(sec) * (1 - Number(pct) / 100) * 100) / 100;

/** 「5秒」「17.5秒」처럼 단위가 붙은 표기에 단축을 적용한다. 숫자가 없으면 그대로 둔다. */
function shortenTimeText(text, pct) {
  if (!pct || !text) return text;
  return String(text).replace(/(\d+(?:\.\d+)?)/, n => String(shortenTime(n, pct)));
}

const GBO2Damage = {
  CAP_A, ATTR_BONUS, ETC_ATTACK,
  floorTo, attackPower, shootingDamage, meleeDamage, chargedPower,
  weaponModsOf, timeCutFor, damagePctFor, isBeamWeapon, isHeatWeapon, isEpackMag, ATTR_BONUS,
  shortenTime, shortenTimeText, applyDamagePct, shieldMultOf
};

if (typeof module !== 'undefined' && module.exports) module.exports = GBO2Damage;
if (typeof window !== 'undefined') window.GBO2Damage = GBO2Damage;

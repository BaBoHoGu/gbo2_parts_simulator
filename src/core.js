/* ------------------------------------------------------------------
 * GBO2 커스텀 파츠 시뮬레이터 — 계산 엔진
 * gbo2.jp 번들에서 추출한 계산 규칙을 그대로 이식한 것.
 * ------------------------------------------------------------------ */

const STAT_KEYS = [
  'hp', 'armorRange', 'armorBeam', 'armorMelee', 'shoot', 'meleeCorrection',
  'speed', 'highSpeedMovement', 'thruster', 'turnPerformanceGround', 'turnPerformanceSpace'
];

const STAT_LABEL = {
  hp: 'HP',
  armorRange: '내실탄 보정',
  armorBeam: '내빔 보정',
  armorMelee: '내격투 보정',
  shoot: '사격 보정',
  meleeCorrection: '격투 보정',
  speed: '스피드',
  highSpeedMovement: '고속이동',
  thruster: '스러스터',
  turnPerformanceGround: '선회(지상)',
  turnPerformanceSpace: '선회(우주)'
};

const DEFAULT_LIMITS = {
  hp: Infinity, armorRange: 50, armorBeam: 50, armorMelee: 50,
  shoot: 100, meleeCorrection: 100, speed: 200,
  highSpeedMovement: Infinity, thruster: 100,
  turnPerformanceGround: Infinity, turnPerformanceSpace: Infinity
};

// MS 데이터의 상한 오버라이드 필드명
const LIMIT_FIELD = {
  hp: 'HP上限', armorRange: '耐実弾補正上限', armorBeam: '耐ビーム補正上限',
  armorMelee: '耐格闘補正上限', shoot: '射撃補正上限', meleeCorrection: '格闘補正上限',
  speed: 'スピード上限', highSpeedMovement: '高速移動上限', thruster: 'スラスター上限',
  turnPerformanceGround: '旋回_地上_通常時上限', turnPerformanceSpace: '旋回_宇宙_通常時上限'
};

// 파츠의 `<stat>ByLevel` 배열 필드명
const BY_LEVEL_FIELD = {
  hp: 'hpByLevel', shoot: 'shootByLevel', meleeCorrection: 'meleeCorrectionByLevel',
  armorRange: 'armorRangeByLevel', armorBeam: 'armorBeamByLevel', armorMelee: 'armorMeleeByLevel',
  thruster: 'thrusterByLevel', speed: 'speedByLevel', highSpeedMovement: 'highSpeedMovementByLevel',
  turnPerformanceGround: 'turnPerformanceGroundByLevel', turnPerformanceSpace: 'turnPerformanceSpaceByLevel'
};

// 강화리스트 effects 키 -> 스탯 키
const FULLST_EFFECT_MAP = {
  HP: 'hp', armor_range: 'armorRange', armor_beam: 'armorBeam', armor_melee: 'armorMelee',
  shoot: 'shoot', melee: 'meleeCorrection', speed: 'speed',
  highSpeedMovement: 'highSpeedMovement', thruster: 'thruster',
  turnPerformanceGround: 'turnPerformanceGround', turnPerformanceSpace: 'turnPerformanceSpace'
};

const PERCENT_FIELD = {
  hp: 'hp_percent', shoot: 'shoot_percent', meleeCorrection: 'meleeCorrection_percent',
  armorRange: 'armorRange_percent', armorBeam: 'armorBeam_percent', armorMelee: 'armorMelee_percent'
};

const ATTRIBUTES = ['汎用', '強襲', '支援'];
const CATEGORIES = ['防御', '攻撃', '移動', '補助', '特殊'];
const CATEGORY_ALL = '全て';            // 파츠 탭 "전체"
const EXPANSION_NONE = '拡張スキル無し'; // 확장 스킬 미선택
const CATEGORY_LABEL = { 防御: '방어', 攻撃: '공격', 移動: '이동', 補助: '보조', 特殊: '특수' };

const EXPANSION_SKILLS = [
  EXPANSION_NONE, '射撃補正拡張', '格闘補正拡張', '耐実弾補正拡張', '耐ビーム補正拡張',
  '耐格闘補正拡張', 'スラスター拡張', 'パーツ拡張[HP]', 'パーツ拡張[攻撃]',
  'パーツ拡張[装甲]', 'パーツ拡張[スラスター]', 'カスタムパーツ複合拡張α', 'MS戦複合拡張'
];

const EXPANSION_LABEL = {
  [EXPANSION_NONE]: '확장 스킬 없음',
  '射撃補正拡張': '사격보정 확장 (사격·상한 증가)',
  '格闘補正拡張': '격투보정 확장 (격투·상한 증가)',
  '耐実弾補正拡張': '내실탄 확장 (내실탄·상한 증가)',
  '耐ビーム補正拡張': '내빔 확장 (내빔·상한 증가)',
  '耐格闘補正拡張': '내격투 확장 (내격투·상한 증가)',
  'スラスター拡張': '스러스터 확장 (스러스터·고속이동·상한 증가)',
  'パーツ拡張[HP]': '파츠확장[HP] (방어/공격/특수 1개당 HP)',
  'パーツ拡張[攻撃]': '파츠확장[공격] (이동 1개당 사격·격투)',
  'パーツ拡張[装甲]': '파츠확장[장갑] (보조 1개당 내성)',
  'パーツ拡張[スラスター]': '파츠확장[스러스터] (방어/보조/특수 1개당 스러·고속)',
  'カスタムパーツ複合拡張α': '복합확장α (공격 1개당 HP·스러·고속)',
  'MS戦複合拡張': 'MS전 복합확장 (전 보정·상한 증가)'
};

const MAX_EXPANSION_LEVEL = 5;

/**
 * 확장 스킬 LV1~LV5 효과 (atwiki「拡張スキル一覧表」기준).
 *   add   : 스탯 가산
 *   limit : 상한 증가
 *   per   : 해당 카테고리 파츠 1개당 가산
 * 시트에 없는 효과(실드HP, 리로드 단축, 리페어툴 회복량)는 수치 계산에 반영하지 않는다.
 */
const EXPANSION_LEVELS = {
  '射撃補正拡張': [4, 5, 7, 9, 12].map(v => ({ add: { shoot: v }, limit: { shoot: v } })),
  '格闘補正拡張': [5, 7, 9, 12, 15].map(v => ({ add: { meleeCorrection: v }, limit: { meleeCorrection: v } })),
  '耐実弾補正拡張': [[2, 2], [3, 3], [4, 4], [8, 6], [12, 10]]
    .map(([a, l]) => ({ add: { armorRange: a }, limit: { armorRange: l } })),
  '耐ビーム補正拡張': [[2, 2], [3, 3], [4, 4], [8, 6], [12, 10]]
    .map(([a, l]) => ({ add: { armorBeam: a }, limit: { armorBeam: l } })),
  '耐格闘補正拡張': [[2, 2], [3, 3], [4, 4], [8, 6], [12, 10]]
    .map(([a, l]) => ({ add: { armorMelee: a }, limit: { armorMelee: l } })),
  'スラスター拡張': [[4, 1], [6, 2], [8, 3], [12, 4], [20, 5]]
    .map(([t, h]) => ({ add: { thruster: t, highSpeedMovement: h }, limit: { thruster: t, highSpeedMovement: h } })),
  'MS戦複合拡張': [1, 2, 3, 4, 5].map(v => ({
    add: { armorRange: v, armorBeam: v, armorMelee: v, shoot: v, meleeCorrection: v },
    limit: { armorRange: v, armorBeam: v, armorMelee: v, shoot: v, meleeCorrection: v }
  })),
  'パーツ拡張[HP]': [50, 100, 200, 300, 400]
    .map(v => ({ per: { cats: ['攻撃', '防御', '特殊'], add: { hp: v } } })),
  'パーツ拡張[攻撃]': [[1, 1], [2, 1], [2, 2], [3, 3], [4, 4]]
    .map(([m, s]) => ({ per: { cats: ['移動'], add: { meleeCorrection: m, shoot: s } } })),
  'パーツ拡張[装甲]': [[1, 1, 1], [2, 1, 1], [2, 1, 2], [2, 2, 2], [3, 3, 3]]
    .map(([r, b, m]) => ({ per: { cats: ['補助'], add: { armorRange: r, armorBeam: b, armorMelee: m } } })),
  'パーツ拡張[スラスター]': [[1, 1], [2, 1], [3, 1], [4, 1], [5, 2]]
    .map(([t, h]) => ({ per: { cats: ['防御', '補助', '特殊'], add: { thruster: t, highSpeedMovement: h } } })),
  'カスタムパーツ複合拡張α': [[50, 1, 1], [100, 1, 1], [150, 1, 1], [200, 2, 1], [250, 2, 2]]
    .map(([hp, t, h]) => ({ per: { cats: ['攻撃'], add: { hp, thruster: t, highSpeedMovement: h } } }))
};

const MAX_PARTS = 8;

/* ------------------------------------------------------------------
 * 특수 파츠 규칙
 * 이름·설명문으로 분기하는 예외 규칙을 한곳에 모아 둔다.
 * (원본 번들 raw/app.js 의 판정식을 그대로 옮긴 것)
 * ------------------------------------------------------------------ */

/** 파츠·기체 이름에서 `_LVn` 접미사를 뗀 기본 이름. */
const partBase = name => (name || '').replace(/_LV\d+$/i, '').trim();

const hasText = (s, subs) => !!s && subs.some(x => s.includes(x));

/** 스피드·선회 상승 파츠와 배타인 파츠. */
const SPEED_TURN_EXCLUSIVE = ['運動性能強化機構', 'コンポジットモーター'];

/** `カテゴリ特攻プログラム_<속성>` — 이름의 속성과 기체 속성이 같아야 장착 가능. */
const CATEGORY_PROGRAM = /^カテゴリ特攻プログラム_(.+)$/;

/**
 * 커넥팅 시스템 종류를 `<속성><로마숫자>` 로 정규화한다. (예: '強襲I', '支援II')
 * 데이터에 Ⅰ/I·Ⅱ/II 표기가 섞여 있어 한 번에 흡수한다.
 */
const connectingKind = name => {
  if (!name || !name.includes('コネクティングシステム')) return null;
  const m = name.replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').match(/\[(汎用|強襲|支援)(I{1,2})型\]/);
  return m ? m[1] + m[2] : null;
};

/** 스피드를 올리는 커넥팅 시스템 (수치가 아닌 이름으로 판정). */
const CONNECT_RAISES_SPEED = ['強襲I', '汎用I'];

/** 레벨링크 시스템: 기체 LV에 비례해 스탯이 오른다. `stats` 는 스탯키→파츠필드. */
const LEVEL_LINK_RULES = {
  '格闘': { stats: { meleeCorrection: 'melee' }, bonus: lv => lv * 2 + 1 },
  '射撃': { stats: { shoot: 'shoot' }, bonus: lv => lv * 2 + 1 },
  '装甲': {
    stats: { armorRange: 'armor_range', armorBeam: 'armor_beam', armorMelee: 'armor_melee' },
    bonus: lv => [4, 5, 6, 7, 8][Math.min(lv - 1, 4)]
  }
};

/** 효과 중복 배타 판정에 쓰는 설명문 키워드. */
const RELOAD_TEXT = ['リロード', '兵装のオーバーヒート'];
const ASL_TEXT = ['ASL', '兵装の集束時間'];
const CONNECT_SUPPORT1 = 'コネクティングシステム[支援Ⅰ型]_LV1';

/* ---------- 기본 유틸 ---------- */

const zeroStats = () => STAT_KEYS.reduce((o, k) => (o[k] = 0, o), {});

function msLevel(name) {
  const m = name && name.match(/_LV(\d+)/i);
  return m ? Number(m[1]) : 1;
}

/**
 * 변형/변신 시에만 쓰는 소체 값. 절대값이라 통상치를 대체한다.
 * 원본 시뮬레이터는 이 필드를 읽지 않아 대조할 기준이 없다 — 위키 수치표를 근거로 한다.
 * 파츠·강화·확장 보정은 통상시와 똑같이 이 값 위에 얹힌다.
 */
const TRANSFORM_FIELD = {
  speed: 'スピード_変形時',
  highSpeedMovement: '高速移動_変形時',
  turnPerformanceGround: '旋回_地上_変形時',
  turnPerformanceSpace: '旋回_宇宙_変形時',
  shoot: '射撃補正_変身時',
  meleeCorrection: '格闘補正_変身時'
};

/** 변형 시 수치가 따로 있는 기체인가. */
const hasTransform = ms =>
  !!ms && (Object.values(TRANSFORM_FIELD).some(f => ms[f] != null) || ms['旋回_変形時'] != null);

function getBaseStats(ms, form) {
  if (!ms) return zeroStats();
  const base = baseStatsNormal(ms);
  if (form !== 'transform') return base;

  // 지상·우주 구분 없이 하나로 주는 기체가 있어 먼저 깔고, 개별 값이 있으면 덮어쓴다
  if (ms['旋回_変形時'] != null) {
    const v = Number(ms['旋回_変形時']);
    base.turnPerformanceGround = v;
    base.turnPerformanceSpace = v;
  }
  for (const [key, field] of Object.entries(TRANSFORM_FIELD)) {
    if (ms[field] != null) base[key] = Number(ms[field]);
  }
  return base;
}

function baseStatsNormal(ms) {
  return {
    hp: Number(ms.HP || 0),
    armorRange: Number(ms.耐実弾補正 || 0),
    armorBeam: Number(ms.耐ビーム補正 || 0),
    armorMelee: Number(ms.耐格闘補正 || 0),
    shoot: Number(ms.射撃補正 || 0),
    meleeCorrection: Number(ms.格闘補正 || 0),
    speed: Number(ms.スピード || 0),
    highSpeedMovement: Number(ms.高速移動 || 0),
    thruster: Number(ms.スラスター || 0),
    turnPerformanceGround: Number(ms.旋回_地上_通常時 || 0),
    turnPerformanceSpace: Number(ms.旋回_宇宙_通常時 || 0)
  };
}

function initializeLimits(ms) {
  const limits = { ...DEFAULT_LIMITS };
  const flags = {};
  for (const key of STAT_KEYS) {
    const field = LIMIT_FIELD[key];
    const raw = ms[field];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (!isNaN(n)) { limits[key] = n; flags[key] = true; }
  }
  return { currentLimits: limits, limitChangedFlags: flags };
}

/** 강화리스트 단계에 따라 실제로 적용되는 항목만 남긴다. */
function activeFullst(ms, stage) {
  if (!stage || !Array.isArray(ms.fullst)) return [];
  return stage === 4 ? ms.fullst.slice(0, 4) : ms.fullst;
}

/* ---------- 슬롯 ---------- */

function calcSlots(ms, equipped, stage, fullstDefs) {
  if (!ms) return { close: 0, mid: 0, long: 0, maxClose: 0, maxMid: 0, maxLong: 0 };
  let close = 0, mid = 0, long = 0;
  for (const p of equipped) {
    close += Number(p.close || 0);
    mid += Number(p.mid || 0);
    long += Number(p.long || 0);
  }
  const baseClose = Number(ms.近スロット || 0);
  const baseMid = Number(ms.中スロット || 0);
  const baseLong = Number(ms.遠スロット || 0);

  // 원본(gbo2.jp)은 슬롯 보너스만은 단계(4/6)와 무관하게 강화리스트 "전체"를 더한다.
  // (스탯은 4단계에서 앞 4개만 — activeFullst) 그래서 슬롯 강화가 5·6번째 항목에 들어간
  // ギャプランTR-5_LV4·バウンド・ドック_LV2 는 4단계에서도 파츠칸이 늘어난다.
  const add = { close: 0, mid: 0, long: 0 };
  const slotEntries = stage && Array.isArray(ms.fullst) ? ms.fullst : [];
  for (const entry of slotEntries) {
    const def = fullstDefs.find(d => d.name === entry.name);
    // calcStats 와 동일하게 숫자로 비교한다(문자열 레벨이 섞여도 어긋나지 않게).
    const eff = def && def.levels.find(l => Number(l.level) === Number(entry.level))?.effects;
    if (!eff) continue;
    if (typeof eff.近スロット === 'number') add.close += eff.近スロット;
    if (typeof eff.中スロット === 'number') add.mid += eff.中スロット;
    if (typeof eff.遠スロット === 'number') add.long += eff.遠スロット;
  }
  return {
    close, mid, long,
    baseClose, baseMid, baseLong,
    maxClose: baseClose + add.close,
    maxMid: baseMid + add.mid,
    maxLong: baseLong + add.long,
    additionalSlots: add
  };
}

/* ---------- 스탯 계산 ---------- */

/**
 * @param {object} ms          기체
 * @param {object[]} equipped  장착 파츠
 * @param {0|4|6} stage        강화리스트 단계
 * @param {string} expansion   확장 스킬명
 * @param {object} partsByCat  { 防御:[], 攻撃:[], ... }
 * @param {object[]} fullstDefs 강화리스트 정의
 * @param {number} [expLevel]  확장 스킬 레벨 1~5 (생략 시 최대치)
 * @param {'normal'|'transform'} [form] 변형 시 수치로 볼지 (기본 통상)
 * @param {object} [skill] 기체 스킬 발동분 { shoot, meleeCorrection, ... } — 상한은 그대로 적용된다
 */
function calcStats(ms, equipped, stage, expansion, partsByCat, fullstDefs, expLevel, form, skill) {
  if (!ms) {
    const z = zeroStats();
    return {
      base: z, partBonus: { ...z }, fullStrengthenBonus: { ...z }, expansionBonus: { ...z },
      skillBonus: { ...z }, total: { ...z }, rawTotal: { ...z },
      currentLimits: { ...DEFAULT_LIMITS, flags: {} },
      fullStrengthenSlotBonus: { close: 0, medium: 0, long: 0 }, isModified: { ...z }
    };
  }

  const base = getBaseStats(ms, form);
  const partBonus = zeroStats();
  const fullStrengthenBonus = zeroStats();
  const expansionBonus = zeroStats();
  // 기체 스킬(바이오센서·사이코프레임 공진 등) 발동분. 파츠·확장과 같이 상한 안에서 더한다.
  // 단 ZERO 시스템처럼 스킬이 상한 자체를 올리기도 해(skill.limit), 그 경우는 상한을 함께 올린다.
  const skillBonus = zeroStats();
  for (const [k, v] of Object.entries(skill || {})) {
    if (skillBonus.hasOwnProperty(k) && typeof v === 'number') skillBonus[k] += v;
  }
  const partLimitBonus = zeroStats();
  const slotBonus = { close: 0, medium: 0, long: 0 };
  const { currentLimits: limits, limitChangedFlags: flags } = initializeLimits(ms);
  if (skill && skill.limit) {
    for (const [k, v] of Object.entries(skill.limit)) {
      if (limits.hasOwnProperty(k) && typeof v === 'number' && !isNaN(v)) { limits[k] += v; flags[k] = true; }
    }
  }
  const level = msLevel(ms.MS名);
  const attribute = ms.属性 || ms.カテゴリ || ms.category;

  /* --- 파츠 보너스 --- */
  for (const p of equipped) {
    // 코넥팅 시스템 [강습Ⅰ/Ⅱ형]: 속성이 강습일 때만 붙는 추가 효과가 있다
    const connect = connectingKind(p.name);
    if (connect === '強襲I') {
      partBonus.meleeCorrection += p.melee || 0;
      partBonus.armorMelee += p.armor_melee || 0;
      if (attribute === '強襲') partBonus.speed += p.speed || 0;
      continue;
    }
    if (connect === '強襲II') {
      partBonus.shoot += p.shoot || 0;
      partBonus.armorRange += p.armor_range || p.rangeDefense || 0;
      partBonus.armorBeam += p.armor_beam || p.beamDefense || 0;
      if (attribute === '強襲') partBonus.highSpeedMovement += p.highSpeedMovement || 0;
      continue;
    }

    // 레벨링크 시스템: 기체 LV에 비례한 보너스가 파츠 고유값에 더해진다
    const link = p.name.match(/^レベルリンクシステム\[(.+)\]_LV1$/);
    const linkRule = link && LEVEL_LINK_RULES[link[1]];
    if (linkRule) {
      const bonus = linkRule.bonus(level || 1);
      for (const [key, field] of Object.entries(linkRule.stats)) {
        partBonus[key] += (typeof p[field] === 'number' ? p[field] : 0) + bonus;
      }
      continue;
    }

    // 기체 LV 스케일 파츠
    for (const [key, field] of Object.entries(BY_LEVEL_FIELD)) {
      if (Array.isArray(p[field])) {
        const v = p[field][Math.min(level, p[field].length) - 1];
        if (typeof v === 'number') partBonus[key] += v;
      }
    }

    // 강화 단계별 효과값 (_4 / _full).
    // 반환값 true = 처리 완료(또는 ByLevel 파츠라 건너뜀), false = 대체 필드로 넘어감.
    const staged = (key, plain, k4, kFull) => {
      if (Array.isArray(p[BY_LEVEL_FIELD[key]])) return true;
      if (stage === 6 && typeof p[kFull] === 'number') partBonus[key] += p[kFull];
      else if (stage === 4 && typeof p[k4] === 'number') partBonus[key] += p[k4];
      else if (typeof p[plain] === 'number') partBonus[key] += p[plain];
      else return false;
      return true;
    };
    staged('hp', 'hp', 'hp_4', 'hp_full');
    staged('shoot', 'shoot', 'shoot_4', 'shoot_full');
    staged('meleeCorrection', 'melee', 'melee_4', 'melee_full');
    if (!staged('armorRange', 'armor_range', 'armor_range_4', 'armor_range_full')
      && typeof p.shootDefense === 'number') partBonus.armorRange += p.shootDefense;
    if (!staged('armorBeam', 'armor_beam', 'armor_beam_4', 'armor_beam_full')
      && typeof p.beamDefense === 'number') partBonus.armorBeam += p.beamDefense;
    if (!staged('armorMelee', 'armor_melee', 'armor_melee_4', 'armor_melee_full')
      && typeof p.meleeDefense === 'number') partBonus.armorMelee += p.meleeDefense;

    if (!Array.isArray(p.thrusterByLevel) && typeof p.thruster === 'number') partBonus.thruster += p.thruster;
    if (!Array.isArray(p.speedByLevel) && typeof p.speed === 'number') partBonus.speed += p.speed;
    if (!Array.isArray(p.highSpeedMovementByLevel) && typeof p.highSpeedMovement === 'number') {
      partBonus.highSpeedMovement += p.highSpeedMovement;
    }
    if (typeof p.turnPerformanceGround === 'number') partBonus.turnPerformanceGround += p.turnPerformanceGround;
    if (typeof p.turnPerformanceSpace === 'number') partBonus.turnPerformanceSpace += p.turnPerformanceSpace;

    if (p.limitIncreases && typeof p.limitIncreases === 'object') {
      for (const k of Object.keys(p.limitIncreases)) {
        const v = p.limitIncreases[k];
        if (partLimitBonus.hasOwnProperty(k) && typeof v === 'number' && !isNaN(v)) partLimitBonus[k] += v;
      }
    }
  }

  for (const k of STAT_KEYS) {
    if (partLimitBonus[k] > 0) { limits[k] += partLimitBonus[k]; flags[k] = true; }
  }

  /* --- 강화리스트 --- */
  for (const entry of activeFullst(ms, stage)) {
    const def = fullstDefs.find(d => d.name === entry.name);
    if (!def || !Array.isArray(def.levels)) continue;
    const lv = def.levels.find(l => Number(l.level) === Number(entry.level));
    if (!lv) continue;
    for (const [effKey, raw] of Object.entries(lv.effects)) {
      if (typeof raw !== 'number' || isNaN(raw)) continue;
      if (effKey === '近スロット') { slotBonus.close += raw; continue; }
      if (effKey === '中スロット') { slotBonus.medium += raw; continue; }
      if (effKey === '遠スロット') { slotBonus.long += raw; continue; }
      const key = FULLST_EFFECT_MAP[effKey];
      if (key) fullStrengthenBonus[key] += raw;
    }
    if (lv.effects.limitIncreases && typeof lv.effects.limitIncreases === 'object') {
      for (const [k, v] of Object.entries(lv.effects.limitIncreases)) {
        if (limits.hasOwnProperty(k) && typeof v === 'number' && !isNaN(v)) { limits[k] += v; flags[k] = true; }
      }
    }
  }

  /* --- 확장 스킬 --- */
  const countIn = (...cats) => {
    const pool = cats.flatMap(c => partsByCat[c] || []);
    return equipped.filter(e => pool.some(p => p.name === e.name)).length;
  };
  const expDef = EXPANSION_LEVELS[expansion];
  if (expDef) {
    const lv = Math.min(Math.max(Number(expLevel) || MAX_EXPANSION_LEVEL, 1), expDef.length);
    const e = expDef[lv - 1];
    if (e.add) {
      for (const [k, v] of Object.entries(e.add)) expansionBonus[k] += v;
    }
    if (e.limit) {
      for (const [k, v] of Object.entries(e.limit)) { limits[k] += v; flags[k] = true; }
    }
    if (e.per) {
      const n = countIn(...e.per.cats);
      for (const [k, v] of Object.entries(e.per.add)) expansionBonus[k] += n * v;
    }
  }

  /* --- 합산 및 상한 적용 --- */
  const total = {}, rawTotal = {}, isModified = {};
  for (const k of STAT_KEYS) {
    const raw = (base[k] || 0) + (partBonus[k] || 0) + (fullStrengthenBonus[k] || 0)
      + (expansionBonus[k] || 0) + (skillBonus[k] || 0);
    rawTotal[k] = raw;
    const cap = limits[k] == null ? Infinity : limits[k];
    total[k] = cap !== Infinity ? Math.min(raw, cap) : raw;
    isModified[k] = base[k] !== total[k] || partBonus[k] !== 0 || fullStrengthenBonus[k] !== 0
      || expansionBonus[k] !== 0 || skillBonus[k] !== 0;
    if (total[k] === 0 && partBonus[k] === 0 && fullStrengthenBonus[k] === 0 && expansionBonus[k] === 0) {
      isModified[k] = false;
    }
  }

  // % 증가 파츠는 상한 적용 전 합계에 곱해진 뒤 다시 상한을 적용한다.
  for (const [key, field] of Object.entries(PERCENT_FIELD)) {
    const pct = equipped.reduce((s, p) => s + (typeof p[field] === 'number' ? p[field] : 0), 0);
    if (pct <= 0) continue;
    const before = rawTotal[key];
    const after = Math.floor(before * (1 + pct / 100));
    partBonus[key] += after - before;
    rawTotal[key] = after;
    total[key] = Math.min(after, limits[key] ?? Infinity);
    isModified[key] = true;
  }

  limits.flags = flags;
  return {
    base, partBonus, fullStrengthenBonus, fullStrengthenSlotBonus: slotBonus,
    currentLimits: limits, expansionBonus, skillBonus, rawTotal, total, isModified, partLimitBonus
  };
}

/* ---------- 장착 가능 판정 ---------- */

/**
 * 효과 중복으로 동시 장착이 불가한 파츠 판정 (원본 번들의 판정식을 그대로 이식).
 * 파츠 목록을 박아두지 않고 원본과 같이 "설명문에 특정 효과가 적혀 있는가"로 판정한다.
 *   大容量補給パック      ↔ 설명에 リロード / 兵装のオーバーヒート 가 있는 파츠
 *   火器管制最適化システム ↔ 설명에 ASL / 兵装の集束時間 가 있는 파츠
 *   コネクティングシステム[支援Ⅰ型] ↔ 위 두 파츠 (문구가 달라 이름으로 예외 처리)
 * @returns {string|null} 충돌하는 장착 파츠명, 없으면 null
 */
function effectConflict(part, equipped) {
  const name = (part && part.name) || '';
  const desc = (part && part.description) || '';

  const isSupply = name.includes('大容量補給パック');
  const isFCS = name.includes('火器管制最適化システム');
  const isConn1 = name.includes(CONNECT_SUPPORT1);
  const carriesReload = hasText(desc, RELOAD_TEXT);
  const carriesAsl = hasText(desc, ASL_TEXT);

  // 대부분의 파츠는 어느 규칙에도 걸리지 않는다 — 장착 목록을 훑기 전에 끝낸다.
  // (탐색 루프에서 수만 번 호출되므로 이 조기 반환이 비용을 좌우한다)
  if (!isSupply && !isFCS && !isConn1 && !carriesReload && !carriesAsl) return null;

  const list = Array.isArray(equipped) ? equipped : [];
  const find = fn => list.find(fn) || null;
  const bySupply = p => p.name && p.name.includes('大容量補給パック');
  const byFCS = p => p.name && p.name.includes('火器管制最適化システム');

  if (isFCS) { const x = find(p => hasText(p.description, ASL_TEXT)); if (x) return x.name; }
  if (carriesAsl) { const x = find(byFCS); if (x) return x.name; }
  if (isSupply) { const x = find(p => hasText(p.description, RELOAD_TEXT)); if (x) return x.name; }
  if (carriesReload) { const x = find(bySupply); if (x) return x.name; }
  if (isConn1) { const x = find(bySupply) || find(byFCS); if (x) return x.name; }
  if (isSupply || isFCS) { const x = find(p => p.name && p.name.includes(CONNECT_SUPPORT1)); if (x) return x.name; }
  return null;
}

const isExclusiveMover = p => !!(p && p.name && SPEED_TURN_EXCLUSIVE.some(n => p.name.includes(n)));

const raisesSpeed = p => {
  if (CONNECT_RAISES_SPEED.includes(connectingKind(p.name))) return true;
  return typeof p.speed === 'number' && p.speed > 0;
};

const raisesTurn = p =>
  (typeof p.turnPerformanceGround === 'number' && p.turnPerformanceGround > 0) ||
  (typeof p.turnPerformanceSpace === 'number' && p.turnPerformanceSpace > 0) ||
  (Array.isArray(p.turnPerformanceGroundByLevel) && p.turnPerformanceGroundByLevel.some(v => typeof v === 'number' && v > 0)) ||
  (Array.isArray(p.turnPerformanceSpaceByLevel) && p.turnPerformanceSpaceByLevel.some(v => typeof v === 'number' && v > 0));

/** 스피드/선회 상승 파츠끼리의 동시 장착 제한. */
function conflictsWithMovement(part, equipped) {
  if (equipped.some(e => e.name === part.name)) return true;
  const selfExclusive = isExclusiveMover(part);
  const selfSpeed = raisesSpeed(part);
  const selfTurn = raisesTurn(part);
  const hasExclusive = equipped.some(isExclusiveMover);
  const hasSpeed = equipped.some(e => raisesSpeed(e) && !isExclusiveMover(e));
  const hasTurn = equipped.some(e => raisesTurn(e) && !isExclusiveMover(e));
  const hasOtherExclusive = equipped.some(e => isExclusiveMover(e) && e.name !== part.name);
  const sameKind = part.kind && equipped.some(e => e.kind === part.kind && e.name !== part.name);
  return !!(
    (selfSpeed && hasSpeed) ||
    ((selfSpeed || selfTurn) && hasExclusive && !selfExclusive) ||
    (selfExclusive && (hasSpeed || hasTurn)) ||
    (selfExclusive && hasOtherExclusive) ||
    sameKind
  );
}

/** 카테고리 특공 프로그램은 해당 속성 기체에만 장착 가능. */
function categoryRestricted(part, ms) {
  const base = part.name ? part.name.replace(/_LV\d+$/, '') : '';
  if (!ms) return false;
  const m = base.match(CATEGORY_PROGRAM);
  return !!m && ATTRIBUTES.includes(m[1]) && ms.属性 !== m[1];
}

/**
 * 장착 가능 여부와 불가 사유를 함께 돌려준다.
 * `param` 은 원본 일본어(속성명·계열명)이므로 표시할 때 번역해서 쓴다.
 * @returns {{ok: boolean, code: string|null, param: string|null}}
 */
function checkEquip(part, ms, equipped, slots) {
  const no = (code, param = null) => ({ ok: false, code, param });
  if (equipped.some(e => e.name === part.name)) return no('equipped');
  if (equipped.length >= MAX_PARTS) return no('full');
  if (categoryRestricted(part, ms)) return no('category', ms.属性);
  if (part.kind && equipped.some(e => e.kind === part.kind)) return no('kind', part.kind);
  const clash = effectConflict(part, equipped);
  if (clash) return no('effect', clash);
  if (conflictsWithMovement(part, equipped)) return no('movement');
  if (slots) {
    if (slots.close + Number(part.close || 0) > slots.maxClose) return no('slotClose');
    if (slots.mid + Number(part.mid || 0) > slots.maxMid) return no('slotMid');
    if (slots.long + Number(part.long || 0) > slots.maxLong) return no('slotLong');
  }
  return { ok: true, code: null, param: null };
}

/* ---------- 내보내기 ---------- */

const GBO2Core = {
  STAT_KEYS, STAT_LABEL, DEFAULT_LIMITS, ATTRIBUTES, CATEGORIES, CATEGORY_LABEL,
  EXPANSION_SKILLS, EXPANSION_LABEL, EXPANSION_LEVELS, MAX_EXPANSION_LEVEL, MAX_PARTS,
  CATEGORY_ALL, EXPANSION_NONE,
  zeroStats, msLevel, getBaseStats, initializeLimits, hasTransform, TRANSFORM_FIELD,
  calcSlots, calcStats, checkEquip, conflictsWithMovement, categoryRestricted,
  effectConflict, partBase
};

if (typeof module !== 'undefined' && module.exports) module.exports = GBO2Core;
if (typeof window !== 'undefined') window.GBO2Core = GBO2Core;

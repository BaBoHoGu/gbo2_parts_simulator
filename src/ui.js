/* ------------------------------------------------------------------
 * 오프라인 UI
 * 데이터(GBO2_DATA)와 사전(GBO2_I18N)은 빌드 시 이 파일 앞에 인라인된다.
 * 이미지는 HTML 옆의 images/ 폴더를 상대 경로로 참조한다.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  const C = window.GBO2Core;
  const O = window.GBO2Optimizer;
  const T = window.GBO2i18n;
  const D = window.GBO2Damage;
  const weaponData = window.GBO2_WEAPONS || {};
  const skillData = window.GBO2_SKILLS || {};
  const { msData, parts: partsByCat, fullst, msSkills: msSkillsData = {} } = window.GBO2_DATA;
  const skillText = (window.GBO2_I18N && window.GBO2_I18N.skillText) || {};

  const allParts = [].concat(...C.CATEGORIES.map(c => partsByCat[c]));
  const partByName = new Map(allParts.map(p => [p.name, p]));

  /* ---------- 이미지 ---------- */

  const baseName = C.partBase;
  // 이미지는 빌드 때 data URI 로 HTML 에 인라인된다(window.GBO2_IMAGES). 키는 '<dir>/<NFC이름>.webp'.
  // data URI 라 file:// 에서도 캔버스 오염 없이 PNG 카드에 그릴 수 있다. 없으면 _default 로 폴백.
  // 파일명은 NFC로 통일돼 있다(원본에 결합문자 NFD 이름이 섞여 있어 정규화 필요).
  const IMG_MAP = window.GBO2_IMAGES || {};
  const imgUrl = key => IMG_MAP[key] || IMG_MAP[key.replace(/\/[^/]+$/, '/_default.webp')] || '';
  const msImg = name => imgUrl(`ms/${baseName(name).normalize('NFC')}.webp`);
  const partImg = name => imgUrl(`parts/${name.normalize('NFC')}.webp`);
  const defaultImg = dir => imgUrl(`${dir}/_default.webp`);

  /** 이미지가 없으면 기본 이미지로 한 번만 대체한다. */
  function img(src, fallbackDir, alt) {
    const node = document.createElement('img');
    node.loading = 'lazy';
    node.alt = alt || '';
    node.src = src;
    node.onerror = () => {
      node.onerror = null;
      node.src = defaultImg(fallbackDir);
    };
    return node;
  }

  /* ---------- 상태 ---------- */

  // 코스트 필터: 전체 · 750~300(정확히 일치) · ~250(이하) — 높은 코스트부터
  const COST_CHIPS = [
    { label: '전체', v: 'all' },
    ...[750, 700, 650, 600, 550, 500, 450, 400, 350, 300].map(c => ({ label: String(c), v: c })),
    { label: '~250', v: 'low' }
  ];
  // 레벨 필터
  const LEVEL_CHIPS = [
    { label: '전체', v: 'all' },
    { label: 'LV1', v: 1 }, { label: 'LV2', v: 2 }, { label: 'LV3', v: 3 }, { label: 'LV4+', v: '4+' }
  ];
  // 등급 필터(레어리티 = 별 개수, 표시는 'N성') — 높은 등급부터
  const RARITY_CHIPS = [
    { label: '전체', v: 'all' },
    ...[5, 4, 3, 2, 1].map(n => ({ label: n + '성', v: n }))
  ];
  // 속성 정렬 우선순위 — 강습 → 범용 → 지원
  const ATTR_ORDER = { '強襲': 0, '汎用': 1, '支援': 2 };

  const msLevel = m => C.msLevel(m.MS名);
  const msRarity = m => (m.レアリティ || '').length;   // ☆ 개수
  /** 표시용 LV 추출 — 접미사가 없는 파츠(이레귤러DBL 등)는 undefined. */
  const lvOf = name => (name.match(/_LV(\d+)/) || [])[1];

  // 무장 유형(속성) 표시 — 위키 무장표 컨테이너에서 뽑은 attr(solid/beam/melee/shield/other).
  // attr 이 없으면(옛 데이터·실드 등) 종류·빔 판정으로 보완한다.
  const ATTR_LABEL = { solid: '실탄', beam: '빔', melee: '격투', shield: '실드', other: '기타' };
  const weaponAttr = w => w.attr
    || (w.type === 'shield' ? 'shield' : w.type === 'melee' ? 'melee' : D.isBeamWeapon(w) ? 'beam' : 'solid');

  // 내구 지표 = HP / (1 - 내성/100) — 피해 종류별 실효 HP. 원본 번들(of 함수)과 동일 공식.
  // HP·내성은 상한 반영된 total 값을 넣는다.
  const durabilityOf = (total, armorKey) =>
    Math.round((total.hp || 0) / (1 - Math.min(total[armorKey] || 0, 99) / 100));

  /* ---------- 누적치(스태거) 스킬 ---------- */
  // 방어측 스킬의 누적치 영향을 파싱한다. 두 패턴이 핵심:
  //   「よろけ値を N%かつ小数点以下切り捨て で計算」 → 받는 누적치 ×(N/100) (감소)
  //   「蓄積よろけまでの値が N% になる」           → 다운 임계 100→N% (상승)
  // 더불어 피해 경감(被ダメージ －N%)도 속성별로 읽어 격파 계산에 쓴다.
  // 발동 조건을 짧은 라벨로 — 동시 발동 가능 여부는 기체마다 복잡(정지+활공 가능, 이동+정지 불가 등)해
  // 자동 배타 대신 라벨만 보여 주고 사용자가 양립 가능한 것만 고르게 한다.
  function staggerCond(blob) {
    if (/機体HPへのダメージと[^。]*への負荷/.test(blob)) return '부위피격';   // 脚部/頭部… 특수완충재(그 부위 피격 시)
    if (/[^、。/]{2,12}へ攻撃を受けた際/.test(blob)) return '부위피격';        // 「A・アーマーDEへ攻撃を受けた際」 등 부위 피격형
    if (/動作開始|判定発生|格闘攻撃中/.test(blob)) return '격투중';   // 헤비어택 등 — 「空中で使用可」 언급보다 우선
    if (/静止|停止/.test(blob)) return '정지중';
    if (/空中|落下|滑空|ジャンプ/.test(blob)) return '공중';
    if (/高速移動中|ブースト移動中/.test(blob)) return '이동중';
    if (/変形|フライトモード/.test(blob)) return '변형중';
    // 실제 HP 조건은 「HP…以下」(예: 機体HPが 50%以下). 「機体HPへのダメージ」「HP回復」 같은
    // 단순 HP 언급을 HP조건으로 오판하지 않도록 「以下」를 요구한다 (다목적 대형 바인더 등).
    if (/HP[^。]{0,10}以下/.test(blob)) return 'HP조건';
    if (/発動中|使用中|モード中|効果中|ハイパーモード/.test(blob)) return '발동중';
    if (/能力UP|NT-D|覚醒/.test(blob)) return '발동중';   // 「NT-D」·「覚醒」 상태 한정 효과
    return '상시';
  }

  function parseStaggerSkill(sk) {
    const blob = (sk.eff || '') + ' / ' + (sk.desc || '');
    // 한 스킬에 단계별로 여러 값이 있을 수 있다(예: 헤비어택改 動作開始 35% / 判定発生 70%).
    // 상시 가정하는 값이 아니므로, 감소가 가장 약한(값이 큰) 쪽을 보수적으로 쓴다.
    // 「%?かつ」 처럼 % 뒤 물음표(원본 OCR 잡음)도 허용해 누적치 배수를 놓치지 않는다.
    const mults = [...blob.matchAll(/よろけ値を\s*(\d+)\s*[%％]?[?？\s]*かつ小数点以下切り捨て/g)].map(m => Number(m[1]));
    const tm = blob.match(/蓄積よろけまでの値が\s*(\d+)\s*%/);
    // 피해 경감(被ダメージ －N%) — 속성별. 내구 지표 상승·격파 계산에 쓴다.
    // 표기 변형 허용: 実弾属性/実弾射撃/実弾攻撃 등. 「射撃」은 실탄+빔 공통(shoot).
    const cuts = [];
    const cut = (re, scope) => { const m = blob.match(re); if (m) cuts.push({ scope, pct: Number(m[1]) }); };
    cut(/実弾(?:属性|射撃|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'solid');
    cut(/ビーム(?:属性|射撃|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'beam');
    cut(/格闘(?:属性|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'melee');
    cut(/(?<![実弾ビーム弾ム])射撃(?:属性|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'shoot');
    // 받는 공격의 속성·종류로 일반 경감의 범위를 좁힌다.
    // (예: 다목적 대형 바인더 '射撃攻撃を受けた際' → 사격 한정 / 빔 교란 실드 'ビーム属性' → 빔 한정)
    const scopeOf = txt => {
      const beam = /ビーム属性/.test(txt), solid = /実弾属性/.test(txt);
      if (beam && !solid) return 'beam';
      if (solid && !beam) return 'solid';
      const rs = /(?:射撃|実弾|ビーム)[^。]{0,4}攻撃を受け|射撃属性/.test(txt), rm = /格闘[^。]{0,4}攻撃を受け/.test(txt);
      if (rs && !rm) return 'shoot';
      if (rm && !rs) return 'melee';
      return 'all';
    };
    // 「기본 경감 + 조건부 속성 경감」을 함께 가진 스킬(밴시 노른 A·아머 DE: 부위 피격 50%,
    // NT-D/각성 중 빔 30% 추가)은 조건이 서로 달라 한 항목으로 합칠 수 없다 → extra 로 분리한다.
    // 기본값의 범위는 그 문장만 보고 판정한다(조건부 쪽의 「ビーム属性」에 끌려가지 않게).
    // 「追加で」 를 요구하는 게 핵심 — 초밤 아머·사이코 필드처럼 EFF 산문과 DESC 항목이
    // '같은 경감'을 두 번 적은 스킬을 둘로 쪼개 이중 계산하는 것을 막는다.
    let extra = null;
    const GEN_BASE = /(?:機体HPへのダメージ|ダメージ)[がを]\s*(\d+)\s*[%％]\s*軽減/;
    if (cuts.length && /追加で/.test(blob)) {
      const seg = blob.split(/ \/ |。/).find(t => GEN_BASE.test(t));
      const gm = seg && seg.match(GEN_BASE);
      if (gm) {
        const attrTxt = /(?:実弾|ビーム|格闘|射撃)(?:属性|射撃|攻撃)*被ダメージ/.test(sk.desc || '') ? (sk.desc || '') : (sk.eff || '');
        extra = { cuts: cuts.slice(), cond: staggerCond(attrTxt) };   // 조건부(속성) 몫
        cuts.length = 0;
        cuts.push({ scope: scopeOf(seg), pct: Number(gm[1]) });       // 기본 몫
      }
    }
    // 속성 표기 없는 일반 被ダメージ / ダメージが N%軽減
    if (!cuts.length) {
      const gm = blob.match(/被ダメージ\s*[－-]\s*(\d+)\s*[%％]/) || blob.match(/ダメージ[がを]\s*(\d+)\s*[%％]\s*軽減/)
        || blob.match(/機体HPへのダメージと[^。]{0,24}?(\d+)\s*[%％]\s*軽減/);   // 부위 특수완충재(機体HPへのダメージと〇〇HPへの負荷を N%軽減)
      if (gm) cuts.push({ scope: scopeOf(blob), pct: Number(gm[1]) });
    }
    // 누적치 감소·임계 또는 피해 경감 중 하나라도 있으면 방어 스킬로 본다.
    // (「リアクションを軽減」만 있는 기본 마뉴버아머처럼 수치 없는 것은 제외.)
    if (!mults.length && !tm && !cuts.length) return null;
    const mult = mults.length ? Math.max(...mults) / 100 : 1;
    return { mult, threshold: tm ? Number(tm[1]) : null, cuts, cond: staggerCond(blob), extra };
  }

  const isAltSkillMode = mo => !!(mo && mo.mode && mo.mode !== '通常時');

  /** 현재 모드(통상/변형·변신)에 해당하는 스킬 모드만 고른다.
   *  각 모드는 그 상태의 '완결된' 스킬 목록이라, 섞지 않고 한쪽만 쓰는 게 맞다.
   *  (NT-D 계열은 같은 스킬의 수치가 모드마다 다르다 — 밴시 노른 A·아머 DE 40%↔50%) */
  function skillModesFor(modes, form) {
    if (modes.length < 2) return modes;
    const alt = modes.filter(isAltSkillMode), norm = modes.filter(mo => !isAltSkillMode(mo));
    if ((form || state.form) === 'transform' && alt.length) return alt;
    return norm.length ? norm : modes;
  }

  /** 이 기체가 그 LV 에서 가진, 누적치에 영향 주는 스킬 목록.
   *  같은 이름이 LV 구간별로 여러 개면(예: 데미지컨트롤 LV1=130·LV2~=160) 현재 LV 에 맞는 최상위를 쓴다. */
  function staggerSkillsOf(ms, lv, form) {
    if (!ms) return [];
    const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || [], form);
    const byName = new Map();
    // 스킬명별로 구간을 모아 현재 LV 에 맞는 것 하나만 고른다(폴백 규칙은 스킬 패널과 동일).
    const groups = new Map();
    for (const mode of modes) for (const sk of (mode.skills || [])) {
      if (!groups.has(sk.name)) groups.set(sk.name, []);
      groups.get(sk.name).push(sk);
    }
    for (const cands of groups.values()) {
      const sk = pickByMsLv(cands, lv);
      if (!sk) continue;
      const p = parseStaggerSkill(sk);
      if (!p) continue;
      const from = msLvFrom(sk.msLv);
      const prev = byName.get(sk.name);
      if (!prev || from > prev.from) byName.set(sk.name, { name: sk.name, ko: skTr(sk.name), mult: p.mult, threshold: p.threshold, cuts: p.cuts, cond: p.cond, from });
      // 조건부 추가 경감(예: A·아머 DE — NT-D/각성 중 빔 −30%)은 기본 경감과 발동 조건이 달라
      // 별도 항목으로 넣는다. 사용자가 상황에 맞는 것만 체크한다.
      if (p.extra) {
        const xn = sk.name + '(추가)';
        const xp = byName.get(xn);
        if (!xp || from > xp.from) byName.set(xn, { name: xn, ko: skTr(sk.name) + ' (추가)', mult: 1, threshold: null, cuts: p.extra.cuts, cond: p.extra.cond, from });
      }
    }
    // 부여 스킬 — 하이퍼모드 등이 「ハイ・マニューバーアーマー LVn」을 付与하는데 직접 항목이 없어 놓친다.
    // 하이마뉴버는 값이 일정(×0.5·피해−40%)하므로 부여를 감지해 별도 항목으로 넣는다.
    if (!byName.has('ハイ・マニューバーアーマー')) {
      let granted = false;
      for (const mode of modes) for (const sk of (mode.skills || [])) {
        if (!msLvHit(sk.msLv, lv) || sk.name === 'ハイ・マニューバーアーマー') continue;
        if (/ハイ[・･]?マニューバーアーマー\s*LV\d/.test((sk.eff || '') + ' ' + (sk.desc || ''))) { granted = true; break; }
      }
      if (granted) byName.set('ハイ・マニューバーアーマー(부여)',
        { name: 'ハイ・マニューバーアーマー(부여)', ko: '하이 마뉴버아머(부여)', mult: 0.5, threshold: null, cuts: [{ scope: 'all', pct: 40 }], cond: '이동중', from: 1 });
    }
    return [...byName.values()];
  }

  /** 상대 무장의 성질에 따라서만 걸리는 파츠 경감 — 내구 지표(무장을 특정하지 않음)에는
   *  넣을 수 없고, 무장을 하나 고르는 피탄 시뮬에서만 조건을 확인해 적용한다.
   *    관통 경감 장갑 — 「사이코뮤 제외 + 관통 성능을 가진 사격 무장」에서 받는 피해
   *    폭풍 경감 장갑 — 「兵装による爆風ダメージ」 (「爆風なし」 명시 무장은 제외)
   *  @param {{note:string, psycommu:boolean, attr:string}} w 고른 상대 무장 */
  function conditionalPartCuts(equipped, w) {
    const out = [];
    if (!w) return out;
    const note = String(w.note || '');
    const isShoot = w.attr === 'solid' || w.attr === 'beam' || w.attr === 'shoot';
    const pierces = /ユニット貫通/.test(note) && !w.psycommu && isShoot;
    const blasts = /爆風/.test(note) && !/爆風なし/.test(note);
    for (const p of equipped || []) {
      const d = String(p.description || '');
      if (pierces) {
        const m = d.match(/貫通性能を備えた射撃兵装からの被ダメージを\s*(\d+)\s*[%％]\s*軽減/);
        if (m) out.push({ scope: 'all', pct: Number(m[1]), label: '관통 경감' });
      }
      if (blasts) {
        const m = d.match(/爆風ダメージを\s*(\d+)\s*[%％]\s*軽減/);
        if (m) out.push({ scope: 'all', pct: Number(m[1]), label: '폭풍 경감' });
      }
    }
    return out;
  }

  /** 완충재계 스킬의 '기체HP 피해 경감량'을 올려 주는 파츠(신형 완충재)의 강화 %.
   *  「緩衝材系スキルの効果である機体HPへのダメージ軽減効果をさらに N%強化」 */
  function bufferBoostOf(equipped) {
    let n = 0;
    for (const p of equipped || []) {
      const m = String(p.description || '').match(/緩衝材系スキル[^。]*?(\d+)\s*[%％]\s*強化/);
      if (m) n += Number(m[1]);
    }
    return n;
  }

  /** 완충재계 스킬 몫의 경감량에 강화분을 더한다(퍼센트포인트 가산).
   *  대상은 「◯◯特殊緩衝材」 뿐 — 「特殊防御機構」·「特殊装甲材」 등에는 효과가 없다.
   *  국부(부위) HP 경감은 원래 지표에 안 넣으므로 자연히 제외된다. */
  function boostBufferCuts(cuts, equipped) {
    const boost = bufferBoostOf(equipped);
    if (!boost) return cuts;
    return cuts.map(c => (c.from && /緩衝材/.test(c.from) && !/防御機構/.test(c.from))
      ? { ...c, pct: Math.min(99, c.pct + boost) } : c);
  }

  /** 켜 둔 스킬만 적용한 누적치 상태 — mult(받는 누적 배수) · threshold(임계) · cuts(피해 경감).
   *  누적치 감소(마뉴버·정지사격·헤비어택·활공 등)는 발동 상황이 배타적이라 동시에 못 쓴다
   *  → 하나만 적용(여럿 켜졌으면 감소가 가장 약한=값이 큰 쪽 보수적). 임계형(데미지컨트롤)은 상시. */
  // 체크한 스킬만 적용. 동시 발동 가능 여부는 사용자가 조건 라벨을 보고 판단(양립 불가한 건 안 켬).
  function activeStaggerMods(ms, lv, sel, form) {
    const on = sel || state.staggerOn;
    const skills = staggerSkillsOf(ms, lv, form);
    let mult = 1, threshold = 100; const cuts = [], mults = [];
    for (const s of skills) {
      if (!on.has(s.name)) continue;
      if (s.mult < 1) { mult *= s.mult; mults.push(s.mult); }   // 감소 배수
      if (s.threshold != null) threshold = Math.max(threshold, s.threshold);
      cuts.push(...s.cuts.map(c => ({ ...c, from: s.name })));   // 어느 스킬 몫인지 남긴다(완충재 강화 판정용)
    }
    mults.sort((a, b) => a - b);   // 감소가 큰(배수가 작은) 스킬부터 순서대로 적용
    return { skills, mult, mults, threshold, cuts };
  }

  /** 받는 누적치(よろけ値) — 스킬 배수를 감소 큰 순으로 하나씩 곱하고 매번 소수점 이하 내림. */
  function staggerPerHit(base, mults) {
    let v = base;
    for (const m of mults) v = Math.floor(v * m);
    return v;
  }

  /** 장착 파츠의 % 피해 경감(被ダメージ軽減) — 내구 지표·피탄에 반영. 오버튠은 LV 스케일·상한 반영. */
  function partDamageCuts(equipped, msLv) {
    const cuts = [];
    const ATTR = { '実弾': 'solid', 'ビーム': 'beam', '格闘': 'melee', '射撃': 'shoot' };
    for (const p of equipped) {
      const d = String(p.description || '');
      for (const [ja, scope] of Object.entries(ATTR)) {
        const m = d.match(new RegExp(ja + '属性から受けるダメージ[をが]\\s*(\\d+)\\s*[%％]\\s*軽減'));
        if (!m) continue;
        let pct = Number(m[1]);
        const per = d.match(/機体LVが1上昇するごとに(?:さらに)?\s*(\d+)\s*[%％]/);   // 오버튠 LV 스케일
        const max = d.match(/最大上昇値は\s*(\d+)\s*[%％]/);
        if (per && max) pct = Math.min(pct + (Math.max(1, msLv) - 1) * Number(per[1]), Number(max[1]));
        if (pct > 0) cuts.push({ scope, pct });
      }
      // 조건 없는 전체 경감 (교육형 컴퓨터[특방]·신형완충재·사이코프레임 등)
      // 「機体HP[の/に]受けるダメージを N%軽減」·「敵から受けるダメージを N%軽減」.
      // (부위장갑 「機体HPへのダメージを」는 「受ける」가 없어 안 걸림 — 국부라 제외가 맞음)
      const all = d.match(/敵から受けるダメージを\s*(\d+)\s*[%％]\s*軽減/)
        || d.match(/機体HP[のに]受けるダメージを\s*(\d+)\s*[%％]\s*軽減/);
      if (all) cuts.push({ scope: 'all', pct: Number(all[1]) });
    }
    return cuts;
  }

  // 공격 지표용 '대표 무장' — 실탄·빔·격투 각각에 어떤 % 가 걸리는지 재 보는 데만 쓴다.
  // damage.js 의 빔 판정은 attr 이 아니라 '무장 이름'을 보므로, 빔 쪽 대표는 이름을 빔으로 준다.
  const PROBE_SOLID = { name: 'マシンガン', type: 'shooting', attr: 'solid', info: {}, levels: {} };
  const PROBE_BEAM = { name: 'ビーム・ライフル', type: 'shooting', attr: 'beam', info: {}, levels: {} };
  const PROBE_MELEE = { name: 'ヒート・サーベル', type: 'melee', attr: 'melee', info: {}, levels: {} };

  /** 장착 파츠의 '전 사격/격투' 与ダメージ% (오버튠·특화 프로그램·교육형 컴퓨터 등).
   *  무장 피해와 같은 규칙을 쓰려고 damage.js 의 파싱을 그대로 재사용한다 — 따로 정규식을
   *  두었더니 「敵に与えるダメージを3%増加」처럼 속성 접두가 없는 표기를 놓쳐, 무장 피해는
   *  오르는데 공격 지표만 그대로인 불일치가 났다(교육형 컴퓨터·화기관제·CP내장 등 5종).
   *  속성 한정(빔 전용 코넥팅 등)은 실탄·빔 중 한쪽만 오르므로 min 으로 자연히 빠진다. */
  function partAttackBonus(equipped, msLv) {
    const mods = D.weaponModsOf(equipped, msLv, state.ms && state.ms.属性, state.expansion);
    return {
      shoot: Math.min(D.damagePctFor(mods, PROBE_SOLID, 'shoot'), D.damagePctFor(mods, PROBE_BEAM, 'shoot')),
      melee: D.damagePctFor(mods, PROBE_MELEE, 'melee')
    };
  }

  /** 무장 속성(solid/beam/melee)에 실제로 걸리는 피해 경감 배수. */
  function staggerDmgFactor(cuts, attr) {
    const kind = attr === 'melee' ? 'melee' : 'shoot';
    let f = 1;
    for (const c of cuts) if (c.scope === 'all' || c.scope === kind || c.scope === attr) f *= (1 - c.pct / 100);
    return f;
  }

  /** 누적치 스킬 체크박스 묶음 (내구 지표·피탄 시뮬 공통). onChange 는 상태 반영 후 콜백.
   *  각 스킬의 발동 조건을 라벨로 보여 주고, 동시 발동 가능한 것만 사용자가 자유롭게 체크한다. */
  function staggerCheckList(ms, lv, onChange, sel, form) {
    const on = sel || state.staggerOn;            // 적 방어 스킬은 별도 Set 을 넘겨 같은 UI 를 쓴다
    const wrap = el('div', 'stagger-skills');
    const skills = staggerSkillsOf(ms, lv, form);
    if (skills.length > 1) wrap.append(el('span', 'stg-hint', '※ 동시에 발동 가능한 조건만 체크하세요'));
    for (const s of skills) {
      const lab = el('label', 'stg-chk' + (on.has(s.name) ? ' on' : ''));
      lab.title = s.cond + ' 발동';
      const box = el('input'); box.type = 'checkbox'; box.checked = on.has(s.name);
      box.onchange = () => { box.checked ? on.add(s.name) : on.delete(s.name); onChange(); };
      const tags = [];
      if (s.threshold != null) tags.push(`임계 ${s.threshold}%`);
      if (s.mult < 1) tags.push(`누적 ×${+s.mult.toFixed(3)}`);
      if (s.cuts.length) tags.push(`피해 -${Math.max(...s.cuts.map(c => c.pct))}%`);
      lab.append(box, el('span', 'stg-nm', s.ko),
        el('span', 'stg-tag', tags.join(' · ')),
        el('span', 'stg-cond', s.cond));
      wrap.append(lab);
    }
    return { wrap, count: skills.length };
  }

  // 요약 카드(자동 구성 결과·저장 목록)에 공통으로 보여 주는 핵심 스탯 — 선회는 지상만
  const SUMMARY_STAT_KEYS = ['hp', 'armorRange', 'armorBeam', 'armorMelee', 'shoot',
    'meleeCorrection', 'speed', 'highSpeedMovement', 'thruster', 'turnPerformanceGround'];

  // 같은 기체의 레벨 변형 묶음 (base 이름 → 레벨 오름차순 목록)
  const msByBase = new Map();
  for (const m of msData) {
    const b = baseName(m.MS名);
    if (!msByBase.has(b)) msByBase.set(b, []);
    msByBase.get(b).push(m);
  }
  for (const arr of msByBase.values()) arr.sort((a, b) => msLevel(a) - msLevel(b));

  const state = {
    view: 'select',        // 'select'(기체 선택) | 'build'(파츠 적용)
    ms: null,
    equipped: [],
    locked: new Set(),
    banned: new Set(),      // 기본 제외한 파츠 — 영구 저장, 우클릭·모달로 토글, 모든 기체 공통
    staggerOn: new Set(),   // 켜 둔 누적치(스태거) 스킬 이름 — 내구 지표·피탄 시뮬 공통
    stage: 6,
    expansion: C.EXPANSION_NONE,
    expLevel: C.MAX_EXPANSION_LEVEL,   // 확장 스킬 레벨 (LV1~LV5)
    msQuery: '',
    msAttr: '',
    msCost: 'all',
    msLv: 'all',
    msRarity: 'all',
    msView: 'all',          // 'all' | 'fav'(즐겨찾기) | 'recent'(최근 사용)
    favorites: new Set(),   // 즐겨찾기한 기체 MS名 — 영구 저장
    recent: [],             // 최근 고른 기체 MS名 (최신 우선, 최대 12) — 영구 저장
    msLimit: 80,
    form: 'normal',        // 'normal' | 'transform' — 성능표를 어느 형태로 볼지
    detailPart: null,      // 상세 미리보기에 고정된 파츠
    openWeapon: null,      // 펼쳐 둔 무장 이름 — 파츠를 갈아 끼워도 닫히지 않게 유지한다
    skillPicks: new Set(), // 발동시킨 기체 스킬의 인덱스 (여러 개를 겹칠 수 있다)
    posture: 'stand',      // 사격 자세 'stand'|'crouch'|'prone' — 무장 피해에 자세 보정을 얹는다
    scope: false,          // 스코프 조준 (자세와 별개로 얹힌다)
    weaponSort: 'default', // 무장 정렬 'default'|'power'|'dps'|'stagger'
    partTab: C.CATEGORY_ALL,
    partQuery: '',
    weights: { ...O.PRESETS['밸런스'] },
    minimums: {},
    maximums: {},           // 상한 목표 (초과 시 페널티)
    weightsTouched: false,  // 사용자가 가중치·하한·상한·프리셋을 직접 만졌는가
    running: false,
    autoCandidates: null,  // 자동 구성 후보 (최대 10개, 사용자가 고른다)
    autoExpansion: false,  // 자동 구성이 확장 스킬까지 골랐는가
    autoShown: 3,          // 결과 모달에서 지금 보여 주는 후보 수 (더보기로 늘린다)
    autoApplied: 0         // 지금 적용해 강조 중인 후보 인덱스
  };

  /** 기체가 바뀌면 이전 자동 구성 후보는 무효라 지운다. */
  function clearAutoResults() {
    state.autoCandidates = null;
    state.autoExpansion = false;
    state.autoShown = 3;
    const box = document.getElementById('autoResults');
    if (box) box.innerHTML = '';
    const diag = document.getElementById('autoDiag');
    if (diag) { diag.hidden = true; diag.innerHTML = ''; }
    const note = document.getElementById('autoNote');
    if (note) note.textContent = '';
    openResultModal(false);
  }

  /**
   * 자동 구성 결과를 '커스텀 파츠와 무장 사이' 전체폭 밴드로 토글한다 (모달 오버레이가 아니라
   * 다른 패널을 가리지 않는다). 후보는 초기화(clearAutoResults) 전까지 유지되고, '닫기'는 지우지
   * 않고 밴드만 접을 뿐 — 파츠 상세 헤더의 '⚡ 자동 결과'로 다시 편다.
   */
  function openResultModal(open) {
    const panel = document.getElementById('autoResultPanel');
    const reopen = document.getElementById('autoResultShow');
    const has = !!(state.autoCandidates && state.autoCandidates.length);
    const showResult = open && has;
    if (panel) panel.hidden = !showResult;
    if (reopen) reopen.hidden = !(has && !showResult);   // 결과가 남아 있고 밴드가 접혀 있으면 재열기 버튼
  }

  const SAVE_KEY = 'gbo2-offline-build';
  const OWNED_KEY = 'gbo2-offline-unowned';    // 기본 제외한 파츠 목록 (영구 저장)
  const FAV_KEY = 'gbo2-offline-fav';          // 즐겨찾기 기체
  const RECENT_KEY = 'gbo2-offline-recent';    // 최근 고른 기체
  const RECENT_MAX = 12;

  /** 즐겨찾기·최근 목록을 불러온다 — 사전에 없는(구버전) 기체명은 조용히 버린다. */
  function loadFavRecent() {
    const known = n => msData.some(m => m.MS名 === n);
    try { state.favorites = new Set((JSON.parse(localStorage.getItem(FAV_KEY)) || []).filter(known)); } catch { state.favorites = new Set(); }
    try { state.recent = (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).filter(known).slice(0, RECENT_MAX); } catch { state.recent = []; }
  }
  function saveFav() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites])); } catch { /* 무시 */ } }
  function saveRecent() { try { localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent)); } catch { /* 무시 */ } }
  /** 기체를 최근 목록 맨 앞으로 올린다(중복 제거·상한 유지). */
  function pushRecent(name) {
    if (!name) return;
    state.recent = [name, ...state.recent.filter(n => n !== name)].slice(0, RECENT_MAX);
    saveRecent();
  }
  function toggleFavorite(name) {
    if (state.favorites.has(name)) state.favorites.delete(name); else state.favorites.add(name);
    saveFav();
  }

  /** 기본 제외 목록을 불러온다 — 사전에 없는(구버전) 이름은 조용히 버린다. */
  function loadBanned() {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(OWNED_KEY)) || []; } catch { arr = []; }
    state.banned = new Set(arr.filter(n => partByName.has(n)));
  }
  function saveBanned() {
    try { localStorage.setItem(OWNED_KEY, JSON.stringify([...state.banned])); } catch { /* 저장 실패는 무시 */ }
  }

  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let toastTimer = null;
  function toast(msg, action) {
    const t = $('#toast');
    t.replaceChildren(el('span', 'toast-msg', msg));
    if (action) {                       // 되돌리기처럼 토스트에서 바로 누르는 동작
      const b = el('button', 'toast-act', action.label);
      b.onclick = () => { t.classList.remove('show'); action.run(); };
      t.append(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2200);
  }

  /** 파츠 구성 되돌리기 — 장착/해제/전체 해제 직전 상태로 한 번 되돌린다. */
  function snapshotEquip() {
    return { equipped: state.equipped.slice(), locked: new Set(state.locked) };
  }
  function restoreEquip(snap) {
    state.equipped = snap.equipped.slice();
    state.locked = new Set(snap.locked);
    renderAll();
    toast('되돌렸습니다');
  }
  const undoToast = (msg, snap) => toast(msg, { label: '되돌리기', run: () => restoreEquip(snap) });

  /* ---------- 검색 색인 ---------- */

  const msSearchText = new Map(msData.map(m =>
    [m, T.norm(T.msName(m.MS名) + ' ' + m.MS名).toLowerCase()]));
  const partSearchText = new Map(allParts.map(p => [p,
    T.norm(T.partName(p.name) + ' ' + p.name + ' ' + T.partDesc(p.name, p.description)).toLowerCase()]));

  const EQUIP_REASON = {
    equipped: () => '이미 장착됨',
    full: () => '슬롯 8개 가득 참',
    category: attr => `${T.attrName(attr)} 전용`,
    kind: kind => `${T.kindName(kind)} 계열 중복`,
    banned: () => '기본 제외',
    effect: name => `${T.partName(name)} 효과 중복`,
    movement: () => '스피드/선회 중복',
    slotClose: () => '근접 슬롯 부족',
    slotMid: () => '중거리 슬롯 부족',
    slotLong: () => '원거리 슬롯 부족'
  };
  const reasonText = chk => (chk.code ? EQUIP_REASON[chk.code](chk.param) : '');

  /** 파츠 표시용 파생값 — 상세 패널과 목록 타일이 같은 규칙을 쓰도록 한곳에 둔다. */
  function partView(p) {
    const lv = lvOf(p.name);
    const fullNm = T.partName(p.name);
    return {
      lv,
      fullNm,
      shortNm: lv ? fullNm.replace(/\s*LV\d+\s*$/i, '') : fullNm,
      desc: T.partDesc(p.name, p.description),
      cat: C.CATEGORY_LABEL[p.category] || '',
      slotTxt: [['근', p.close], ['중', p.mid], ['원', p.long]]
        .filter(([, v]) => v).map(([l, v]) => l + v).join(' ') || '슬롯 0'
    };
  }

  /* ---------- 파생값 ---------- */

  const slots = () => C.calcSlots(state.ms, state.equipped, state.stage, fullst);

  /* ---------- 기체 스킬 ---------- */

  /** 현재 기체가 가진 버프 스킬 목록. */
  const msBuffSkills = () => (state.ms && skillData[baseName(state.ms.MS名)]) || [];

  /** 지금 발동시킨 스킬들. */
  function activeSkills() {
    const list = msBuffSkills();
    return [...state.skillPicks].sort((a, b) => a - b).map(i => list[i]).filter(Boolean);
  }

  /**
   * 스킬 수치는 기체 LV 구간마다 다르다 (「LV1～」「LV4～」).
   * 지금 기체 LV 이 들어가는 구간 중 가장 높은 것을 쓴다.
   */
  function skillLevel(sk) {
    if (!sk || !sk.levels.length) return null;
    const lv = state.ms ? msLevel(state.ms) : 1;
    const fit = sk.levels.filter(l => lv >= l.from && (l.to == null || lv <= l.to));
    // 기체 LV 이 스킬 요구 LV 에 못 미치면 그 스킬은 아직 못 쓴다 (예: 백식 LV1 의 LV4 스킬)
    return fit.length ? fit[fit.length - 1] : null;
  }

  /** 지금 기체 LV 에서 실제로 쓸 수 있는 스킬만 (인덱스와 함께). */
  const availableSkills = () =>
    msBuffSkills().map((sk, i) => ({ sk, i })).filter(x => skillLevel(x.sk) != null);

  /**
   * 발동시킨 스킬들의 효과 합계. 아무것도 안 골랐으면 null.
   * 피해 % 는 걸리는 대상이 갈린다 — `any` 는 사격·격투 모두에 얹는다.
   */
  function skillEffect() {
    const list = activeSkills();
    if (!list.length) return null;
    const sum = { shoot: 0, melee: 0, shootPct: 0, meleePct: 0, crouchPct: 0, limitUp: 0,
      dmgAny: 0, dmgShoot: 0, dmgMelee: 0,
      armorRange: 0, armorBeam: 0, armorMelee: 0, speed: 0, hispeed: 0, thruster: 0, turn: 0, hpUp: 0,
      count: list.length };
    for (const sk of list) {
      const e = skillLevel(sk);
      if (!e) continue;
      sum.shoot += e.shoot;
      sum.melee += e.melee;
      sum.shootPct += e.shootPct;
      sum.meleePct += e.meleePct;
      sum.crouchPct += e.crouchPct || 0;
      sum.limitUp += e.limitUp || 0;
      sum.dmgAny += e.dmgAny;
      sum.dmgShoot += e.dmgShoot;
      sum.dmgMelee += e.dmgMelee;
      sum.armorRange += e.armorRange || 0;
      sum.armorBeam += e.armorBeam || 0;
      sum.armorMelee += e.armorMelee || 0;
      sum.speed += e.speed || 0;
      sum.hispeed += e.hispeed || 0;
      sum.thruster += e.thruster || 0;
      sum.turn += e.turn || 0;
      sum.hpUp += e.hpUp || 0;
    }
    return sum;
  }

  /**
   * 발동한 스킬들의 피해 % 를 "스킬별로" 돌려준다 (곱연산용).
   * 최대출력·레이즈 카운터 등 여러 스킬의 피해 증가는 서로 합산이 아니라 각각 곱해진다.
   */
  function skillDmgPctList(kind) {
    return activeSkills().map(sk => {
      const e = skillLevel(sk) || {};
      return (e.dmgAny || 0) + (kind === 'melee' ? (e.dmgMelee || 0) : (e.dmgShoot || 0));
    }).filter(p => p);
  }

  /**
   * calcStats 에 넘길 스탯 가산분. 피해 % 는 스탯이 아니라 무장 쪽에서 쓴다.
   * 사격/격투 보정 % (ZERO 시스템)는 스킬을 뺀 총보정에 곱해 정수로 더한다.
   * (ZERO 는 상한도 올리지만 그 폭이 위키에 없어, 여기서는 통상 상한을 그대로 둔다)
   */
  function skillStatBonus() {
    const e = skillEffect();
    if (!e) return null;
    let shoot = e.shoot, melee = e.melee;
    if (e.shootPct || e.meleePct) {
      const bare = stats(null).total;
      shoot += Math.round(bare.shoot * e.shootPct / 100);
      melee += Math.round(bare.meleeCorrection * e.meleePct / 100);
    }
    // 방어·기동·HP 발동 버프 (바이오센서 등) — 해당 스탯에 그대로 더한다(상한은 calcStats 가 적용).
    const out = {};
    if (shoot) out.shoot = shoot;
    if (melee) out.meleeCorrection = melee;
    if (e.armorRange) out.armorRange = e.armorRange;
    if (e.armorBeam) out.armorBeam = e.armorBeam;
    if (e.armorMelee) out.armorMelee = e.armorMelee;
    if (e.speed) out.speed = e.speed;
    if (e.hispeed) out.highSpeedMovement = e.hispeed;
    if (e.thruster) out.thruster = e.thruster;
    if (e.turn) { out.turnPerformanceGround = e.turn; out.turnPerformanceSpace = e.turn; }
    if (e.hpUp) out.hp = e.hpUp;
    if (!Object.keys(out).length) return null;
    // ZERO 시스템은 발동 중 사격·격투 상한도 올린다 (파츠로 상한 근처까지 올린 구성에서 차이가 난다)
    if (e.limitUp) out.limit = { shoot: e.limitUp, meleeCorrection: e.limitUp };
    return out;
  }

  /** 스킬 몫을 칠할 클래스 — 하나면 보라, 겹쳐 발동하면 청록. */
  const skillCls = () => (state.skillPicks.size > 1 ? ' multi' : '');

  const stats = (skill = skillStatBonus()) =>
    C.calcStats(state.ms, state.equipped, state.stage, state.expansion, partsByCat, fullst,
      state.expLevel, state.form, skill);

  /* ---------- 기체 목록 ---------- */

  function filteredMs() {
    const q = state.msQuery.trim().toLowerCase();
    let list = msData;

    // 보기 모드: 즐겨찾기 / 최근 — 최근은 사용 순서를 그대로 유지하려고 먼저 처리한다.
    if (state.msView === 'fav') list = list.filter(m => state.favorites.has(m.MS名));
    else if (state.msView === 'recent') {
      const order = new Map(state.recent.map((n, i) => [n, i]));
      list = list.filter(m => order.has(m.MS名)).sort((a, b) => order.get(a.MS名) - order.get(b.MS名));
    }

    if (state.msAttr) list = list.filter(m => m.属性 === state.msAttr);

    if (state.msCost === 'low') list = list.filter(m => m.コスト <= 250);
    else if (state.msCost !== 'all') list = list.filter(m => m.コスト === state.msCost);

    if (state.msLv === '4+') list = list.filter(m => msLevel(m) >= 4);
    else if (state.msLv !== 'all') list = list.filter(m => msLevel(m) === state.msLv);

    if (state.msRarity !== 'all') list = list.filter(m => msRarity(m) === state.msRarity);

    if (q) list = list.filter(m => msSearchText.get(m).includes(q));

    // 최근 보기는 사용 순서를 유지한다 (아래 표준 정렬을 건너뛴다)
    if (state.msView === 'recent') return list;

    // 정렬: ① 코스트 높은 순(750→) → ② 속성(강습→범용→지원) → ③ 등급 높은 순
    //       → ④ 레벨 LV1부터 → ⑤ 이름 순
    return list.slice().sort((a, b) => {
      if (a.コスト !== b.コスト) return b.コスト - a.コスト;   // 750 → 100
      const oa = ATTR_ORDER[a.属性] ?? 9, ob = ATTR_ORDER[b.属性] ?? 9;
      if (oa !== ob) return oa - ob;                        // 강습 → 범용 → 지원
      const ra = msRarity(a), rb = msRarity(b);
      if (ra !== rb) return rb - ra;                        // 높은 등급 먼저
      const la = msLevel(a), lb = msLevel(b);
      if (la !== lb) return la - lb;                        // LV1부터
      return T.msName(a.MS名).localeCompare(T.msName(b.MS名), 'ko');
    });
  }

  /** 보기 칩(전체 / 즐겨찾기 / 최근)을 개수 배지와 함께 그린다. */
  function renderViewChips() {
    const box = document.getElementById('viewChips');
    if (!box) return;
    box.innerHTML = '';
    const items = [
      { v: 'all', label: '전체' },
      { v: 'fav', label: `★ 즐겨찾기${state.favorites.size ? ' ' + state.favorites.size : ''}` },
      { v: 'recent', label: `🕐 최근${state.recent.length ? ' ' + state.recent.length : ''}` }
    ];
    for (const it of items) {
      const chip = el('button', 'chip' + (state.msView === it.v ? ' on' : ''), it.label);
      chip.onclick = () => {
        state.msView = it.v;
        state.msLimit = 80;
        renderViewChips();
        renderMsList();
      };
      box.append(chip);
    }
  }

  /** 번들 데이터 신선도 배지 — 빌드일과 총량. */
  function renderDataFresh() {
    const box = document.getElementById('dataFresh');
    const b = (typeof window !== 'undefined' && window.GBO2_BUILD) || null;
    if (!box || !b) return;
    box.textContent = `데이터 ${b.date} · 기체 ${b.ms.toLocaleString()} · 파츠 ${b.parts} · 무장 ${b.weapons.toLocaleString()}`;
  }

  function renderMsList() {
    const box = $('#msList');
    box.innerHTML = '';
    const list = filteredMs();

    if (!list.length) {
      const msg = state.msView === 'fav' ? '즐겨찾기한 기체가 없습니다. 카드의 ☆를 눌러 추가하세요.'
        : state.msView === 'recent' ? '최근 고른 기체가 없습니다.'
        : '조건에 맞는 기체가 없습니다.';
      box.append(el('div', 'empty-state', msg));
      $('#msCount').textContent = '0기';
      return;
    }

    for (const m of list.slice(0, state.msLimit)) {
      const card = el('div', 'ms-card' + (state.ms === m ? ' sel' : ''));
      card.append(img(msImg(m.MS名), 'ms', m.MS名));

      // 즐겨찾기 별 — 카드 선택과 별개로 토글한다
      const fav = state.favorites.has(m.MS名);
      const star = el('button', 'ms-fav' + (fav ? ' on' : ''), fav ? '★' : '☆');
      star.title = fav ? '즐겨찾기 해제' : '즐겨찾기 추가';
      star.onclick = ev => {
        ev.stopPropagation();
        toggleFavorite(m.MS名);
        renderMsList();
        renderViewChips();   // 개수 배지 갱신
      };
      card.append(star);

      const info = el('div', 'info');
      const nm = el('div', 'nm', T.msName(m.MS名));
      nm.title = m.MS名;
      info.append(nm);

      const meta = el('div', 'meta');
      meta.append(el('span', 'dot ' + (m.属性 || '')));
      meta.append(el('span', '', T.attrName(m.属性) || '-'));
      meta.append(el('span', 'cost-badge', m.コスト));
      const r = msRarity(m);
      if (r) meta.append(el('span', 'stars', '★'.repeat(r)));
      info.append(meta);

      card.append(info);
      card.onclick = () => selectMs(m);
      box.append(card);
    }

    if (list.length > state.msLimit) {
      const more = el('button', 'more', `더 보기 (${list.length - state.msLimit}기 남음)`);
      more.onclick = () => { state.msLimit += 120; renderMsList(); };
      box.append(more);
    }
    $('#msCount').textContent = `${list.length}기`;
  }

  /* ---------- 화면 전환 ---------- */

  function setView(view) {
    const changed = state.view !== view;
    state.view = view;
    // 선택 화면으로 "돌아올 때"만 목록을 갱신 (초기 렌더와 중복 실행하지 않는다)
    // 최근/즐겨찾기 칩의 개수 배지도 함께 갱신한다(방금 고른 기체가 최근에 반영되도록).
    if (view === 'select' && changed) { renderMsList(); renderViewChips(); }
    document.body.classList.toggle('view-select', view === 'select');
    document.body.classList.toggle('view-build', view === 'build');
    [...$('#stepper').querySelectorAll('li[data-step]')].forEach(li =>
      li.classList.toggle('on', li.dataset.step === view));
    // 화면 전환 시 스크롤을 위로 되돌린다
    const scr = view === 'build' ? $('#screenBuild') : $('#screenSelect');
    if (scr) scr.scrollTop = 0;
    window.scrollTo(0, 0);
    // 숨겨진 동안에는 크기를 잴 수 없으므로, 보이게 된 뒤 줄 맞춤을 다시 한다
    if (view === 'build') fitWholeRows($('#partList'));
  }

  function selectMs(m) {
    state.ms = m;
    pushRecent(m.MS名);         // 최근 사용 목록 갱신
    state.form = 'normal';      // 새 기체는 통상 모드부터
    state.equipped = [];
    state.locked.clear();
    state.detailPart = null;
    state.skillPicks.clear();
    // 방어 스킬 체크는 스킬 "이름"으로 저장돼 있어, 안 지우면 이름이 같은 스킬(데미지 컨트롤·
    // 마뉴버아머 등)이 다른 기체에서 저절로 켜진 채로 내구 지표·피탄 수치를 바꿔 버린다.
    state.staggerOn.clear();
    clearAutoResults();
    resetEnhance();             // 다른 기체를 고르면 확장·강화 설정을 초기값으로 되돌린다
    renderAll();
    setView('build');           // 기체를 고르면 곧바로 파츠 적용 단계로
  }

  /** 확장 스킬·강화 단계를 초기 상태로 되돌리고 컨트롤도 맞춘다. (기체를 새로 고를 때) */
  function resetEnhance() {
    state.expansion = C.EXPANSION_NONE;
    state.expLevel = C.MAX_EXPANSION_LEVEL;
    const exp = $('#expansion');
    if (exp) exp.value = C.EXPANSION_NONE;
    const expLv = $('#expLevel');
    if (expLv) { expLv.value = String(state.expLevel); expLv.disabled = true; }
  }

  /* ---------- 장착 ---------- */

  function equip(part) {
    // 기본 제외한 파츠는 자동 구성뿐 아니라 직접 장착도 막는다 (우클릭으로 해제)
    if (state.banned.has(part.name)) {
      toast('기본 제외한 파츠입니다 — 우클릭(폰은 길게 누르기)으로 해제하세요');
      return;
    }
    const chk = C.checkEquip(part, state.ms, state.equipped, slots());
    if (!chk.ok) { toast(reasonText(chk) + ' — 장착할 수 없습니다'); return; }
    const snap = snapshotEquip();
    state.equipped.push(part);
    renderAll();
    undoToast(T.partName(part.name) + ' 장착', snap);
  }

  /** 기본 제외 토글 (영구). 이미 장착 중인 파츠를 제외하면 함께 해제해 상태를 어긋나지 않게 한다. */
  function toggleBan(part) {
    if (state.banned.has(part.name)) {
      state.banned.delete(part.name);
    } else {
      state.banned.add(part.name);
      if (state.equipped.some(e => e.name === part.name)) {
        state.equipped = state.equipped.filter(e => e.name !== part.name);
        state.locked.delete(part.name);
        toast(T.partName(part.name) + ' — 제외하면서 장착도 해제했습니다');
      }
    }
    saveBanned();
    renderAll();
  }

  function unequip(name) {
    const snap = snapshotEquip();
    state.equipped = state.equipped.filter(p => p.name !== name);
    state.locked.delete(name);
    renderAll();
    undoToast(T.partName(name) + ' 해제', snap);
  }

  function renderEquipped() {
    const box = $('#equipped');
    box.innerHTML = '';
    $('#equipCount').textContent = `${state.equipped.length} / ${C.MAX_PARTS}`;

    for (let i = 0; i < C.MAX_PARTS; i++) {
      const p = state.equipped[i];
      if (!p) {
        box.append(el('div', 'eq empty', '+'));
        continue;
      }

      const tile = el('div', 'eq' + (state.locked.has(p.name) ? ' locked' : ''));
      tile.title = p.name + '\n\n' + T.partDesc(p.name, p.description);
      // 장착된 파츠도 목록 타일과 똑같이 상세 패널에 띄운다
      tile.onmouseenter = () => { state.detailPart = p; renderDetail(p); };

      const lock = el('span', 'lock' + (state.locked.has(p.name) ? ' on' : ''), '🔒');
      lock.title = '자동 구성 시 이 파츠 고정';
      lock.onclick = ev => {
        ev.stopPropagation();
        state.locked.has(p.name) ? state.locked.delete(p.name) : state.locked.add(p.name);
        renderEquipped();
      };
      tile.append(lock);
      tile.append(el('span', 'rm', '✕'));
      tile.append(img(partImg(p.name), 'parts', p.name));
      tile.append(el('div', 'nm', T.partName(p.name)));

      // 0 인 슬롯은 숨겨서 실제로 소비하는 슬롯만 눈에 들어오게 한다.
      const cost = el('div', 'cost');
      for (const [cls, label, v] of [['cost-c', '근', p.close], ['cost-m', '중', p.mid], ['cost-l', '원', p.long]]) {
        if (v) cost.append(el('span', cls, label + v));
      }
      if (!cost.children.length) cost.append(el('span', 'note', '슬롯 0'));
      tile.append(cost);

      tile.onclick = () => unequip(p.name);
      box.append(tile);
    }
  }

  function renderSlots() {
    const s = slots();
    const box = $('#slotBars');
    box.innerHTML = '';
    const defs = [
      ['close', '근접', s.close, s.maxClose],
      ['mid', '중거리', s.mid, s.maxMid],
      ['long', '원거리', s.long, s.maxLong]
    ];

    for (const [key, label, used, max] of defs) {
      const bar = el('div', 'slot-bar ' + key + (used >= max && max > 0 ? ' full' : ''));
      const top = el('div', 'top');
      top.append(el('span', 'k', label));
      top.append(el('span', 'v', `${used} / ${max}`));
      bar.append(top);

      // 칸 수가 많으면 눈에 안 들어오므로 최대 20칸으로 압축해 보여준다.
      const track = el('div', 'track');
      const cells = Math.min(Math.max(max, used, 1), 20);
      const scale = cells / Math.max(max, used, 1);
      const filled = Math.round(used * scale);
      for (let i = 0; i < cells; i++) {
        const cell = el('i');
        if (i < filled) cell.className = used > max ? 'over' : 'on';
        track.append(cell);
      }
      bar.append(track);
      box.append(bar);
    }
  }

  /* ---------- 파츠 상세 미리보기 ---------- */

  function renderDetail(part) {
    const box = $('#detailBody');
    const panel = $('#detailPanel');
    box.innerHTML = '';
    // 비어 있는 동안은 폰에서 200px 넘는 빈 칸이라 파츠 목록을 그만큼 아래로 민다.
    if (panel) panel.classList.toggle('is-empty', !part);
    if (!part) {
      const e = el('div', 'detail-empty');
      e.innerHTML = '파츠를 길게 눌러(PC 는 마우스를 올려)<br>상세 정보를 볼 수 있습니다';
      box.append(e);
      return;
    }

    const { lv, fullNm, desc, cat } = partView(part);
    const isEquipped = state.equipped.some(e => e.name === part.name);
    const chk = state.banned.has(part.name) ? { ok: false, code: 'banned', param: null }
      : state.ms ? C.checkEquip(part, state.ms, state.equipped, slots()) : { ok: false, code: null };

    const head = el('div', 'd-head');
    const thumb = el('div', 'd-thumb');
    thumb.append(img(partImg(part.name), 'parts', part.name));
    if (lv) thumb.append(el('span', 'pt-lv', 'LV' + lv));
    head.append(thumb);
    const htext = el('div', 'd-htext');
    htext.append(el('div', 'd-name', fullNm));
    htext.append(el('div', 'd-cat', cat));
    head.append(htext);
    box.append(head);

    let cls = 'ok', txt = '장비 가능 — 눌러서 장착';
    if (isEquipped) { cls = 'on'; txt = '장착됨 — 눌러서 해제'; }
    else if (!chk.ok) { cls = 'bad'; txt = (reasonText(chk) || '장착 불가') + ' — 장착 불가'; }
    const status = el('div', 'd-status ' + cls + (chk.ok || isEquipped ? ' clickable' : ''), txt);
    // 상세 카드에서 바로 장착/해제 (하단 목록 타일과 동일 동작)
    status.onclick = () => {
      state.detailPart = part;
      if (isEquipped) unequip(part.name);
      else if (chk.ok) equip(part);
      else toast(reasonText(chk) + ' — 장착할 수 없습니다');
    };
    box.append(status);

    const slotRow = el('div', 'd-slots');
    for (const [c, label, v] of [['cost-c', '가까운', part.close], ['cost-m', '중간', part.mid], ['cost-l', '원거리', part.long]]) {
      const cell = el('div', 'd-slot');
      cell.append(el('span', 'k', label));
      cell.append(el('span', 'v ' + c, String(v || 0)));
      slotRow.append(cell);
    }
    box.append(slotRow);

    if (desc) {
      const eff = el('div', 'd-eff');
      eff.append(el('div', 'd-eff-lb', '특성'));
      eff.append(el('div', 'd-eff-tx', desc));
      box.append(eff);
    }
  }

  /* ---------- 무장 ---------- */

  /** 표에서 그대로 가져온 표기를 한글로 바꾼다. (「即2発 フル1+即1」 같은 값까지) */
  const JA_UNIT = [
    ['発/分', '발/분'], ['フル', '풀'], ['ノン', '논'], ['即', '즉'],
    ['連続', '연속'], ['連', '연'], ['消費', '소비'], ['単発', '단발'],
    ['秒', '초'], ['発', '발'], ['射', '발'], ['分', '분'], ['時', '시'], ['回', '회']
  ];
  // 전각 괄호·중점은 그대로 두면 표에서 일본어처럼 보여 반각으로 맞춘다.
  const jaUnits = s => JA_UNIT.reduce((t, [ja, ko]) => t.split(ja).join(ko), String(s))
    .replace(/（/g, '(').replace(/）/g, ')').replace(/・/g, '·').replace(/：/g, ':')
    .replace(/＋/g, '+').replace(/－/g, '-').replace(/％/g, '%').replace(/×/g, 'x');

  /** 표 열 이름에 공백 표기가 섞여 있어(OH復帰時間 / OH復帰 時間) 공백을 무시하고 찾는다. */
  function infoOf(info, ...names) {
    const flat = s => s.replace(/\s+/g, '');
    for (const n of names) {
      const key = Object.keys(info || {}).find(k => flat(k) === flat(n));
      const v = key && info[key];
      if (v && v !== '-') return v;
    }
    return null;
  }

  /**
   * 무장 항목 조회.
   * 추출 단계에서 레벨마다 값이 같으면 info(무장 공통), 다르면 levels[N].raw 로 나뉜다.
   * (예: 사거리가 레벨마다 늘어나는 무장은 raw 에 있다)
   * 어느 쪽에 있는지는 무장마다 다르므로 레벨값을 먼저 보고 없으면 공통값을 본다.
   */
  const wField = (lvl, info, ...names) =>
    infoOf(lvl && lvl.raw, ...names) || infoOf(info, ...names);

  /** 현재 기체의 무장 목록 (위키 페이지 ID 로 찾는다). */
  const weaponsOfMs = ms => {
    const id = ms && (String(ms.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
    const page = id && weaponData[id];
    return page ? page.weapons : [];
  };
  function msWeapons() { return state.ms ? weaponsOfMs(state.ms) : []; }

  /**
   * 무장 레벨은 기체 레벨을 따라간다.
   * 기체 LV 보다 높은 무장 LV 는 쓰지 않고, 그보다 낮으면 가진 것 중 가장 높은 레벨을 쓴다.
   * (무장이 기체보다 적은 레벨만 가진 경우가 있다)
   */
  function weaponLevel(w) {
    const lvs = Object.keys(w.levels).map(Number).sort((a, b) => a - b);
    if (!lvs.length) return null;
    const want = state.ms ? msLevel(state.ms) : lvs[0];
    const fit = lvs.filter(l => l <= want);
    return String(fit.length ? fit[fit.length - 1] : lvs[0]);
  }

  /* ---------- 스러스터 지표 ---------- */
  // 위키 83(전투 시스템) 실측표. 초기소비·소비속도는 % 가 아니라 '스라값 그 자체'(절대값)다.
  //   「初期消費量はスラスター値そのもの（固定値）」「回復速度は全機固定で約5/s」
  // 열은 표준/강습/적성 셋뿐이라, 적성이 있으면 적성 · 없고 강습이면 강습 · 그 외 표준을 쓴다
  // (강습이면서 적성인 조합은 위키에 값이 없다).
  const THRUSTER_TBL = {
    ground: { init: { std: 20, assault: 15, adapt: 19 }, rate: { std: 8, assault: 8, adapt: 7.6 } },
    space: { init: { std: 15, assault: 16, adapt: 12 }, rate: { std: 6.4, assault: 6.4, adapt: 4.0 } }
  };
  const THR_RECOVER = 5;                 // 스라값/초 — 전 기체 공통
  const OH_SEC = 7, OH_SEC_GROUND_ADAPT = 6.3;   // 지상적성만 10% 짧다(우주적성은 효과 없음)
  // 부스트 계열 스킬은 '효과가 끝나면' 스러스터 OH 복귀가 21초로 늘어난다(기본의 3배).
  // 스킬 설명에 「効果終了時のOH回復時間は21秒」 로 못박혀 있는 셋만 잡는다 — 합쳐 38기.
  // 발동 중에만 걸리는 값이라 지표를 갈아치우지 않고, 옆에 따로 적어 준다.
  const OH_LONG_SKILLS = ['EXブースト', 'オーバーブースト', 'シューティングブースト'];
  const OH_LONG_SEC = 21;
  const isTankMs = ms => /タンク|ヒルドルブ/.test(String(ms && ms.MS名 || ''));

  /** 이 기체 LV 에서 쓸 수 있는 '부스트 후 OH 21초' 스킬 이름(한글). 없으면 null. */
  function ohLongSkillOf(ms, lv) {
    if (!ms) return null;
    const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || []);
    const byName = new Map();
    for (const mo of modes) for (const sk of (mo.skills || [])) {
      if (!OH_LONG_SKILLS.includes(sk.name)) continue;
      if (!byName.has(sk.name)) byName.set(sk.name, []);
      byName.get(sk.name).push(sk);
    }
    for (const [name, cands] of byName) if (pickByMsLv(cands, lv)) return skTr(name);
    return null;
  }

  /** 스러스터 관련 파츠 효과 — 회복속도%·OH단축%·소비경감%(초기/이동중). 모두 가산 중복. */
  function thrusterPartFx(equipped) {
    let recover = 0, oh = 0, cutInit = 0, cutRate = 0;
    for (const p of equipped || []) {
      const d = String(p.description || '').replace(/\\n/g, ' ');
      let m = d.match(/スラスターの回復速度が\s*(\d+)\s*[%％]\s*上昇/);
      if (m) recover += Number(m[1]);
      m = d.match(/スラスターオーバーヒート時の回復時間が\s*(\d+)\s*[%％]\s*短縮/);
      if (m) oh += Number(m[1]);
      // 「高速移動開始時と…消費量を N%軽減」은 초기소비까지, 「高速移動中の…」은 이동 중만
      m = d.match(/高速移動開始時[^。]*?スラスター消費量を\s*(\d+)\s*[%％]\s*軽減/);
      if (m) { cutInit += Number(m[1]); cutRate += Number(m[1]); }
      else {
        m = d.match(/高速移動中の[^。]*?スラスター消費量を\s*(\d+)\s*[%％]\s*軽減/);
        if (m) cutRate += Number(m[1]);
      }
    }
    return { recover, oh, cutInit, cutRate };
  }

  /**
   * 환경(지상/우주)별 스러스터 지표.
   *   부스트 지속 = (스라값 − 초기소비) ÷ 소비속도
   *   완충 시간   = 스라값 ÷ 회복속도
   *   OH 복귀     = 기준초 × (1 − 단축%)
   * 소비속도는 2족 기준이라 탱크는 지속 시간을 내지 않는다(위키도 값에 ? 를 달아 뒀다).
   */
  function thrusterMetrics(ms, thrusterVal, equipped, env) {
    if (!ms || !thrusterVal) return null;
    const t = THRUSTER_TBL[env];
    const adapt = env === 'ground' ? ms['環境適正_地上'] : ms['環境適正_宇宙'];
    const col = adapt ? 'adapt' : (ms['属性'] === '強襲' ? 'assault' : 'std');
    const fx = thrusterPartFx(equipped);
    const init = t.init[col] * (1 - fx.cutInit / 100);
    const rate = t.rate[col] * (1 - fx.cutRate / 100);
    const boost = (!isTankMs(ms) && thrusterVal > init && rate > 0)
      ? (thrusterVal - init) / rate : null;
    const full = thrusterVal / (THR_RECOVER * (1 + fx.recover / 100));
    const ohBase = (env === 'ground' && ms['環境適正_地上']) ? OH_SEC_GROUND_ADAPT : OH_SEC;
    return {
      boost, full, oh: ohBase * (1 - fx.oh / 100), col, fx,
      base: { boost: (!isTankMs(ms) && thrusterVal > t.init[col]) ? (thrusterVal - t.init[col]) / t.rate[col] : null,
        full: thrusterVal / THR_RECOVER, oh: ohBase }
    };
  }

  // 조사·산탄·동시발사 무장은 무장 표의 위력이 1히트/1발당 값이라, 備考의 배수를 읽어
  // 전탄(전히트) 명중 시 총 피해를 함께 보여 준다. (격투는 방향/연격으로 따로 표기)
  const CJK_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cjkNum = s => (CJK_NUM[s] ?? Number(s));
  /** 한 번에 나가는 발수 — 「6発同時発射」「4発連続発射」「二発同時発射」. 없으면 1. */
  function shotCountOf(note) {
    const m = String(note).match(/([一二三四五六七八九十]|\d+)\s*発?\s*(?:同時|連続)発射/);
    return m ? Math.max(1, cjkNum(m[1])) : 1;
  }
  /** 연사 횟수 — 「2発同時発射 x2回攻撃」의 x2. 발사 표기가 있는 조각 안에서만 찾는다
   *  (「よろけ値：… x2射」에도 같은 꼴이 있어 note 전체에서 찾으면 오인한다). */
  function volleyCountOf(note) {
    const seg = String(note).split(' / ').find(s => /(?:同時|連続)発射/.test(s));
    const m = seg && seg.match(/[x×ｘ]\s*(\d+)\s*(?:回攻撃|射)/);
    return m ? Math.max(1, Number(m[1])) : 1;
  }
  // 동시발사(산탄) 배수를 모드별로 읽는다. 「非集束時N…」은 논차지만, 「集束時N…」은 풀차지만,
  // 접두가 없으면 두 모드 공통. (非集束時 이 集束時 를 부분포함하므로 非 를 먼저 가른다.)
  function fireMult(w) {
    const empty = { nc: null, ch: null };
    if (!w || w.type === 'melee') return empty;
    const note = (w.info && w.info['備考']) || '';
    // 조사(照射)·지속 폭발: 최대 N 히트 — 지속이라 두 칸 공통.
    // 히트 수만 읽고 끝내면 여러 발을 쏘는 무장의 몫이 통째로 빠진다(펀넬x6 조사 = 6발 × 5히트).
    // 발수는 두 가지로 적히는데 **같은 뜻**이라 하나만 센다:
    //   「最大5HIT x4」 — 괄호 안에 배수가 붙는 형(대함대공 미사일x4)
    //   「最大5ヒット」 + 다른 조각의 「6発同時発射」(펀넬x6 조사)
    // 둘 다 있는 무장은 앞의 배수가 곧 뒤의 발수라, 겹쳐 곱하면 4배로 부풀려진다.
    // 모드별로 히트 수가 다른 무장도 있다(「非集束時最大5ヒット / 集束時最大10ヒット」)
    // → 조각마다 접두를 보고 논차지/집속에 나눠 담는다. 접두가 없으면 두 모드 공통.
    {
      const shots = shotCountOf(note), volleys = volleyCountOf(note);
      let a = null, b = null, common = null;
      for (const seg of note.split(' / ')) {
        const m = seg.match(/最大\s*(\d+)\s*(?:ヒット|HIT)\s*(?:[x×ｘ]\s*(\d+))?/i);
        if (!m) continue;
        const hits = Number(m[1]);
        if (hits <= 0) continue;
        const mul = (m[2] ? Number(m[2]) : shots) * volleys;
        const n = hits * mul;
        if (n <= 1) continue;
        const cell = { n, label: mul > 1 ? mul + '발 ×' + hits + '히트' : '최대 ' + hits + '히트' };
        if (/非集束時/.test(seg)) a = cell;
        else if (/集束時/.test(seg)) b = cell;
        else common = cell;
      }
      if (common) { a = a || common; b = b || common; }
      if (a || b) return { nc: a, ch: b };
    }
    // 지속 조사의 범위 표기 「3～20ヒット」(G-바드 등) — 풀 지속 시 최대 타수를 쓴다
    const rg = /照射/.test(note) && note.match(/(\d+)\s*[～~]\s*(\d+)\s*(?:ヒット|HIT)/i);
    if (rg && Number(rg[2]) > 1) { const x = { n: Number(rg[2]), label: rg[1] + '~' + rg[2] + '히트' }; return { nc: x, ch: x }; }
    let nc = null, ch = null, both = null;
    for (const b of note.split(' / ')) {
      const m = b.match(/([一二三四五六七八九十]|\d+)発?同時発射/);  // 바르길은 「7同時発射」로 発 이 빠져 있다
      if (!m) continue;
      const proj = cjkNum(m[1]);
      const rep = b.match(/[x×]\s*(\d+)\s*(?:回攻撃|射)/);           // 같은 불릿 안의 「x3回攻撃」「x3射」 연사만
      const r = rep ? Number(rep[1]) : 1;
      const n = proj * r;
      if (n <= 1) continue;
      const cell = { n, label: rep ? proj + '발 ×' + r + '연사' : proj + '발 동시' };
      if (/非集束時/.test(b)) nc = cell;
      else if (/集束時/.test(b)) ch = cell;
      else both = cell;
    }
    if (both) { nc = nc || both; ch = ch || both; }   // 접두 없는 표기는 두 모드에 공통 적용
    return { nc, ch };
  }

  /**
   * 고정 피해 — 소이(焼夷) 계열이 명중 후 따로 넣는 피해. 「2700固定ダメージ(450x6HIT)」
   * 무장 표의 위력과는 **별개로 더해진다**(43종 중 34종은 위력과 1틱 값이 아예 다르다).
   * 이름 그대로 固定 이라 사격·격투 보정을 받지 않으므로, 위키 값을 그대로 쓴다.
   */
  function fixedDamageOf(w) {
    const note = (w && w.info && w.info['備考']) || '';
    const m = note.match(/(\d+)\s*固定ダメージ\s*[（(]\s*(\d+)\s*[x×ｘ]\s*(\d+)\s*HIT/i);
    if (!m) return null;
    return { total: Number(m[1]), per: Number(m[2]), hits: Number(m[3]) };
  }

  /**
   * 소이(焼夷) 효과를 키우는 파츠 — 고정 피해에 반영한다.
   *   특수 연소제      1틱 피해 +25% · 지속시간 +10%
   *   이레귤러 DBL 계열 지속시간 +10% (피해는 그대로)
   * 위키 5891 의 실측 34행으로 맞춰 본 결과 —
   *   1틱 피해 floor(×1.25) 32/34 일치(예외 2건은 ×1.10 로 측정돼 편차로 본다)
   *   히트 수 round(×지속배수) 46/56 일치. 위키도 「같은 지속시간이라도 늘기도 안 늘기도
   *   한다. 要検証」이라 적어 둔 부분이라, 늘어난 히트는 툴팁에서 불확실하다고 밝힌다.
   */
  function burnBoostOf(equipped) {
    let dmg = 1, dur = 1;
    for (const p of equipped || []) {
      const d = String(p.description || '');
      const m = d.match(/焼夷効果によって当てるダメージを\s*(\d+)\s*[%％]\s*増加/);
      if (m) dmg *= 1 + Number(m[1]) / 100;
      const t = d.match(/焼夷効果の継続時間を\s*(\d+)\s*[%％]\s*増加/)
        || d.match(/状態異常の継続時間を\s*(\d+)\s*[%％]\s*増加/);
      if (t) dur *= 1 + Number(t[1]) / 100;
    }
    return { dmg, dur };
  }

  /** 파츠를 반영한 고정 피해. base 가 없으면 null. */
  function fixedDamageWithParts(w, equipped) {
    const fx = fixedDamageOf(w);
    if (!fx) return null;
    const b = burnBoostOf(equipped);
    const per = Math.floor(fx.per * b.dmg);
    const hits = Math.round(fx.hits * b.dur);
    return { base: fx, per, hits, total: per * hits, boosted: per !== fx.per || hits !== fx.hits };
  }

  /**
   * 상성(카테고리) 배율 — 카테고리 특공 프로그램은 우위일 때만 이 배율 자체를 올린다.
   * 위키 7000: 「数値はカテゴリ補正の130%に＋10%され、140%になる。実ダメージでいうと＋7～8%」
   * 우리 기본값이 advantage 0.3(=130%)이라 +0.1 하면 140% 가 된다.
   * 불리·동일 상성에는 효과가 없다(설명이 '有利カテゴリの敵機에' 로 한정).
   */
  function attrBonusOf(equipped, attr) {
    const base = D.ATTR_BONUS[attr] ?? 0;
    if (attr !== 'advantage') return base;
    const has = (equipped || []).some(p => /有利カテゴリの敵機に与えるダメージを増加/.test(String(p.description || '')));
    return has ? base + 0.1 : base;
  }

  /** 무장이 거는 디버프 — 계산엔 안 쓰고 표시만 한다(효과량이 위키에 수치로 없다). */
  const DEBUFF_RULES = [
    [/炎上/, '연소'],
    [/速度デバフ|移動速度低下|速度低下/, '속도↓'],
    [/スラスター消費量増加/, '스러스터↑'],
    [/スラスターOH時間増加/, 'OH↑'],
    [/射撃補正低下/, '사격↓'],
    [/格闘補正低下/, '격투↓'],
    [/スタン/, '스턴']
  ];
  function debuffsOf(w) {
    const note = (w && w.info && w.info['備考']) || '';
    const out = [];
    for (const [re, label] of DEBUFF_RULES) if (re.test(note)) out.push(label);
    // 종류를 못 밝힌 「デバフ付与」 만 있는 경우 — 있다는 사실만 알린다
    if (!out.length && /デバフ/.test(note)) out.push('디버프');
    return out;
  }

  /* ---------- DPS(지속 화력) ---------- */
  // 위력 칸 아래에 초당 피해를 보여 준다. 기본 위력 기준(파츠·스킬 미반영)의 무장 비교용.
  //   순간 DPS = 1트리거 피해 ÷ 발사간격,  지속 DPS = 탄창분 피해 ÷ (탄창 소진 + 리로드/OH복귀)

  /** 발사간격(초/발). 「N秒」 또는 「N発/分」(RPM), 없으면 쿨타임. 못 읽으면 0. */
  function shotInterval(w, d) {
    const info = w.info || {}, raw = (d && d.raw) || {};
    const src = raw['発射間隔'] || info['発射間隔'] || info['発射 間隔'] || info['発射速度'] || info['クールタイム'] || '';
    const rpm = String(src).match(/([\d.]+)\s*発\s*[\/／]\s*分/);
    if (rpm && Number(rpm[1])) return 60 / Number(rpm[1]);
    const sec = String(src).match(/([\d.]+)\s*秒/);
    return sec ? Number(sec[1]) : 0;
  }
  /** 탄창(연속 발사 가능 수) — 실탄 弾数, 없으면 E팩/OH 의 「N発OH」. */
  function magazineOf(w, d) {
    const a = (d && d.raw && d.raw['弾数']) || (w.info && w.info['弾数']);
    let m = a && String(a).match(/(\d+)/);
    if (m) return Number(m[1]);
    const oh = w.info && w.info['OHまでの弾数'];
    m = oh && String(oh).match(/(\d+)\s*発/);
    return m ? Number(m[1]) : 0;
  }
  /** 리로드/OH복귀 초. */
  function reloadSecOf(w, d) {
    const r = (d && d.raw && d.raw['リロード時間'])
      || (w.info && (w.info['リロード時間'] || w.info['OH復帰時間'] || w.info['OH復帰速度']));
    const m = r && String(r).match(/([\d.]+)\s*秒/);
    return m ? Number(m[1]) : 0;
  }
  /** 위력 칸에 DPS 서브라인을 붙인다. 사격 무장만(격투 연격·실드·조사는 제외). */
  function appendDps(cell, w, d, m) {
    if (!d || !d.power) return;                 // 위력 0(센서·연막 등 유틸)은 DPS 없음
    if (w.type === 'shield' || w.type === 'melee' || w.attr === 'melee') return;
    if (/最大\s*\d+\s*ヒット|照射/.test((w.info && w.info['備考']) || '')) return;   // 조사류 제외
    const t = shotInterval(w, d);
    if (!t) return;
    const hits = m ? m.n : 1;
    const per = d.power * hits;                 // 1트리거(전탄) 피해
    const burst = per / t;
    const mag = magazineOf(w, d), reload = reloadSecOf(w, d);
    const sustained = (mag && reload) ? (per * mag) / (mag * t + reload) : burst;
    const sub = el('span', 'w-sub w-dps', '⚡DPS ' + Math.round(sustained).toLocaleString());
    sub.title = `순간 ${Math.round(burst).toLocaleString()} · 지속 ${Math.round(sustained).toLocaleString()}`
      + (mag && reload ? ` (탄창 ${mag}발 · ${+t.toFixed(2)}초/발 · 리로드 ${reload}초)` : ` (${+t.toFixed(2)}초/발)`)
      + ' · 기본 위력 기준(파츠·스킬 미반영)';
    cell.append(sub);
  }

  /** 무장 정렬 키 — 위력(전탄)·지속DPS·누적치. 값이 클수록 앞에 온다. (기본 위력·기본 계산 기준) */
  function weaponSortKey(w, metric) {
    const lv = weaponLevel(w), d = lv ? w.levels[lv] : null;
    if (!d) return -1;
    const mult = fireMult(w);
    const pellets = (mult.nc && mult.nc.n) || (mult.ch && mult.ch.n) || 1;
    if (metric === 'stagger') { const s = parseStagger(w); return (s.pct || 0) * (s.pellets || 1); }
    const power = Math.max(d.power || 0, d.powerCharged || 0) * pellets;
    if (metric === 'power') return power;
    if (metric === 'dps') {
      if (w.type === 'shield' || w.type === 'melee' || w.attr === 'melee') return 0;
      const t = shotInterval(w, d);
      if (!t) return 0;
      const per = (d.power || 0) * pellets;
      const mag = magazineOf(w, d), reload = reloadSecOf(w, d);
      return (mag && reload) ? (per * mag) / (mag * t + reload) : per / t;
    }
    return 0;
  }

  /* ---------- 모드(변형·시스템발동 등) ---------- */
  // 変形(msData 변형 스탯)뿐 아니라, 変形 스탯이 없는 트랜잠(システム発動中) 기체도
  // override 의 _altMode(그 모드 스탯 절대값)로 통상/그 모드를 전환한다. 무장은 나누지 않는다.
  function altModeOf(ms) {
    if (!ms) return null;
    // 스킬 데이터에 통상 외 모드가 있으면 그 이름을 라벨로 쓴다(NT-D 계열은 '변신'이라 '변형'이 어색).
    const alt = (msSkillsData[baseName(ms.MS名)] || []).find(isAltSkillMode);
    if (C.hasTransform(ms)) return { key: (alt && alt.mode) || '変形時', label: (alt && SKILL_MODE_KO[alt.mode]) || '변형' };
    if (ms._altMode) return { key: ms._altMode.mode, label: ms._altMode.label };
    return null;
  }

  function renderWeapons() {
    const box = $('#weaponList');
    box.innerHTML = '';
    let list = msWeapons();       // 무장은 모드로 나누지 않고 전부 보여 준다(보기 편하게)
    if (state.weaponSort && state.weaponSort !== 'default')   // 선택한 기준으로 내림차순 랭킹
      list = [...list].sort((a, b) => weaponSortKey(b, state.weaponSort) - weaponSortKey(a, state.weaponSort));
    $('#weaponCount').textContent = list.length ? `${list.length}종` : '';

    if (!list.length) {
      box.append(el('div', 'empty-state', '이 기체의 무장 정보가 없습니다.'));
      return;
    }

    const r = stats();
    // 사격 무기는 사격 보정, 격투 무기는 격투 보정을 쓴다.
    // 단 부메랑·인컴·투척 소드처럼 "격투 판정" 사격무장(attr==melee)은 위력이 격투 보정을 받는다.
    const corr = { shooting: r.total.shoot, melee: r.total.meleeCorrection };
    const dmgKey = w => (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shooting';
    // 스킬을 뺀 값도 함께 구해, 스킬로 늘어난 위력만 따로 보여 준다
    const sk = skillEffect();
    const bare = sk ? stats(null) : null;
    const corrBare = bare ? { shooting: bare.total.shoot, melee: bare.total.meleeCorrection } : corr;
    const sCls = skillCls();
    // 무장에 붙는 파츠 보정 (집속·리로드·OH·피해 %·실드 HP).
    // 효과마다 걸리는 무장 범위가 달라 무장별로 다시 뽑아 쓴다.
    const wm = D.weaponModsOf(state.equipped, state.ms ? msLevel(state.ms) : 1,
      state.ms && state.ms.属性, state.expansion);

    // 자세·스코프 보정 — 사격 판정 무장에만 (격투 판정이면 attr==melee 라 제외), (1+etcA) 로 곱해진다
    const postureEtcA = w => {
      if (dmgKey(w) === 'melee') return 0;
      let e = 0;
      if (state.posture === 'crouch') e += D.ETC_ATTACK.crouch;
      else if (state.posture === 'prone') e += D.ETC_ATTACK.prone;
      if (state.scope) e += D.ETC_ATTACK.scope;
      return e;
    };
    // 고정밀 포격 스킬 — 앉기·정지에서만 사격 피해 +N% (스킬 몫이라 보라로 나온다)
    const skEtcOf = w => (dmgKey(w) === 'shooting' && sk && sk.crouchPct && state.posture === 'crouch')
      ? sk.crouchPct / 100 : 0;

    for (const w of list) {
      const lv = weaponLevel(w);
      const d = lv ? w.levels[lv] : null;
      if (!d) continue;

      const info = w.info || {};
      const mods = w.mods || {};
      const note = info['備考'] || '';
      const f = (...names) => wField(d, info, ...names);
      const a = corr[dmgKey(w)] || 0;
      const aBare = corrBare[dmgKey(w)] || 0;

      // 집속 링·화기 관제는 「ビーム射撃兵装」만 줄여 준다 — 격투 무장의 집속은 절댓값이다
      const chargeCut = mods.chargeTime && w.type === 'shooting' ? D.timeCutFor(wm, 'chargeTime', w) : 0;
      const chargeSec = mods.chargeTime ? D.shortenTime(mods.chargeTime, chargeCut) + '초' : '';
      const mustCharge = /集束必須/.test(note);

      const row = el('div', 'weapon');
      row.dataset.name = w.name;

      // ① 구분
      row.append(el('span', 'w-sec' + (w.section === '主兵装' ? ' main' : ''),
        w.type === 'shield' ? '실드'
          : w.section === '主兵装' ? '주무장' : w.section === '副兵装' ? '부무장' : '기타'));

      // ② 이름 (격투/사격 점으로 구분)
      const mult = fireMult(w);              // 조사·산탄·동시발사 배수 (모드별)
      const nm = el('span', 'w-nm');
      nm.append(el('i', 'w-dot ' + w.type));
      nm.append(document.createTextNode(T.weaponName(w.name)));
      // 이름 옆 칩: 두 모드가 같으면 하나, 다르면 있는 쪽 (각 칸의 '전탄'이 정확히 보여 준다)
      const chip = (mult.nc && mult.ch && mult.nc.n === mult.ch.n) ? mult.nc : (mult.nc || mult.ch);
      if (chip) nm.append(el('span', 'w-mult', chip.label));
      // 고정 피해(소이 등) — 위력과 별개로 더해지는 몫이라 안 보여 주면 무장이 실제보다 약해 보인다
      const fx = fixedDamageWithParts(w, state.equipped);
      if (fx) {
        // 소이는 한 방에 들어가지 않고 1틱씩 나눠 들어간다. 합계만 적으면 한 번에
        // 그만큼 맞는 것처럼 읽혀서, 1틱 피해와 히트 수를 앞에 세운다(450×6 = 2,700).
        const c = el('span', 'w-fixed', fx.hits > 1
          ? '고정 ' + fx.per.toLocaleString() + '×' + fx.hits + ' = ' + fx.total.toLocaleString()
          : '고정 ' + fx.total.toLocaleString());
        if (fx.boosted) c.append(el('i', 'w-fixed-up', ' +' + (fx.total - fx.base.total).toLocaleString()));
        c.title = `명중 후 고정 피해 ${fx.total.toLocaleString()} (${fx.per}×${fx.hits}히트)\n`
          + '보정을 받지 않는 고정값이라 위력 칸과 별도로 들어간다.'
          + (fx.boosted ? `\n\n파츠 미장착 시 ${fx.base.total.toLocaleString()} (${fx.base.per}×${fx.base.hits}히트)` : '')
          + (fx.hits !== fx.base.hits
            ? `\n※ 히트 수는 지속시간에 따라 늘기도 안 늘기도 한다(위키도 要検証).`
              + `\n   안 늘면 ${(fx.per * fx.base.hits).toLocaleString()} (${fx.per}×${fx.base.hits}히트).`
            : '');
        nm.append(c);
      }
      for (const d of debuffsOf(w)) {
        const c = el('span', 'w-debuff', d);
        c.title = '이 무장이 거는 디버프 — 효과량이 위키에 수치로 없어 표시만 한다.';
        nm.append(c);
      }
      // 실드 보정 — 피탄 시뮬의 「실드로 막음」 을 켰을 때만 붙인다.
      // 표기가 아예 없는 무장(2,666종)엔 칩을 안 붙여 목록이 지저분해지지 않게 한다.
      if (pietanShield) {
        const sm = D.shieldMultOf(w);
        if (sm) {
          const txt = sm.unknown ? '?' : (sm.nc === sm.ch ? sm.nc : sm.nc + '→' + sm.ch) + '배';
          const lvl = sm.unknown ? '' : (sm.nc >= 1.2 ? ' hi' : sm.nc < 1 ? ' lo' : '');
          const c = el('span', 'w-shield' + lvl, '🛡' + txt);
          c.title = sm.unknown
            ? '실드 보정이 위키 미확인(？倍)이라 실드 계산을 하지 않는다.'
            : '실드에 맞았을 때 배율 — 실드 피해 = 기체에 줄 피해 × ' + sm.nc + '배'
              + (sm.nc !== sm.ch ? '\n집속 시 ' + sm.ch + '배' : '')
              + '\n실드로 받은 공격은 기체 HP 피해를 막는다(위키 83).';
          nm.append(c);
        }
      }
      nm.title = w.name;
      row.append(nm);

      // ②-b 무장 유형 (실탄/빔/격투/실드/기타) — 위키 무장표 속성과 동일
      const at = weaponAttr(w);
      row.append(el('span', 'w-type type-' + at, ATTR_LABEL[at]));

      /** 위력 한 칸 — 기본값 · 파츠 보정분(초록) · 스킬 발동분(보라). m: 이 칸(논차지/풀차지)의 동시발사 배수 */
      const dmgCell = (base, m) => {
        const cell = el('span', 'w-dmg');
        if (base == null) { cell.textContent = '—'; cell.classList.add('w-none'); return cell; }
        // 실드(태클 등)의 피해는 고정피해 — 격투·사격 보정을 받지 않는다
        if (w.attr === 'shield' || w.type === 'shield') {
          cell.textContent = base.toLocaleString();
          return cell;
        }
        const kind = dmgKey(w) === 'melee' ? 'melee' : 'shoot';   // 격투 판정이면 격투 피해 % 적용
        const pct = D.damagePctFor(wm, w, kind);   // 파츠 피해 % (한 배율로 합산)
        const skPcts = skillDmgPctList(kind);      // 스킬 피해 % — 스킬별 별도 곱연산 배율
        const baseEtc = postureEtcA(w);         // 자세·스코프 (스킬과 무관, 초록에 포함)
        const skEtc = skEtcOf(w);               // 고정밀 포격 (스킬 몫)
        const raw = (corrOf, etc) => (w.type === 'melee'
          ? D.meleeDamage(base, corrOf, { etcA: etc })
          : D.shootingDamage(base, corrOf, { etcA: etc }));
        // 파츠 %는 한 배율, 스킬 %는 각각 곱연산으로 얹는다
        const withoutSkill = D.applyDamagePct(raw(aBare, baseEtc), pct);
        const withSkill = D.applyDamagePct(raw(a, baseEtc + skEtc), [pct, ...skPcts]);
        const gain = withoutSkill - base;
        const skillGain = withSkill - withoutSkill;

        cell.append(document.createTextNode(base.toLocaleString()));
        // 특화 프로그램은 반대쪽 무장을 깎으므로 감소분도 보여 준다
        if (gain) cell.append(el('span', gain > 0 ? 'w-gain' : 'w-loss',
          ' (' + (gain > 0 ? '+' : '') + gain.toLocaleString() + ')'));
        if (skillGain) cell.append(el('span', 's-gain' + sCls,
          ' (' + (skillGain > 0 ? '+' : '') + skillGain.toLocaleString() + ')'));
        // 조사·산탄·동시발사: 전탄(전히트) 명중 시 총 피해 = 1발 피해 × 배수.
        // 1발 칸과 같은 방식으로 — 기본×배수 · 파츠분(초록) · 스킬분(보라) 을 각각 표기한다.
        if (m) {
          const n = m.n;
          const sub = el('span', 'w-sub');
          sub.append(document.createTextNode('전탄 ' + (base * n).toLocaleString() + ' (×' + n + ')'));
          if (gain) sub.append(el('span', gain > 0 ? 'w-gain' : 'w-loss',
            ' (' + (gain > 0 ? '+' : '') + (gain * n).toLocaleString() + ')'));
          if (skillGain) sub.append(el('span', 's-gain' + sCls,
            ' (' + (skillGain > 0 ? '+' : '') + (skillGain * n).toLocaleString() + ')'));
          cell.append(sub);
        }
        return cell;
      };

      // ③ 논차지 · ④ 풀차지 (집속이 없으면 논차지 칸만 채운다) — 칸별 배수를 따로 준다
      const ncCell = dmgCell(d.power, mult.nc);
      appendDps(ncCell, w, d, mult.nc);          // 논차지 위력 아래 DPS 서브라인
      row.append(ncCell);
      const full = dmgCell(d.powerCharged, mult.ch);
      if (d.powerCharged != null && chargeSec) {
        full.append(el('span', 'w-sub', (mustCharge ? '필수 ' : '') + chargeSec
          + (chargeCut ? ' (-' + chargeCut + '%)' : '')));
      }
      row.append(full);

      // ⑤ 쿨타임 — 격투는 クールタイム, 사격은 같은 자리에 발사 간격을 보여 준다
      //    (위키가 「発射 間隔」처럼 공백을 넣기도 해 표기 변형을 모두 받는다)
      //    조사(照射) 무장은 두 항목이 다 없어 조사 시간으로 대신한다
      row.append(el('span', 'w-col',
        jaUnits(f('クールタイム') || f('発射間隔', '発射速度', '発射間', '照射時間') || '—')));

      // ⑥ 탄 / 히트율 — 실탄은 탄수, 열무기는 히트율, 실드는 HP·크기
      // E팩 탄창식 빔(히트율 없이 OH復帰만)은 OHまでの弾数 가 곧 탄창 크기다.
      const ammo = f('弾数');
      const heat = f('ヒート率', 'ヒート率/フル', 'ヒート率/ノン');
      const ohShots = f('OHまでの弾数');
      const isEpack = D.isEpackMag(w);
      const shieldHp = f('シールドHP', 'HP'), shieldSize = f('サイズ');
      const ammoCell = el('span', 'w-col');
      if (shieldHp || shieldSize) {                       // 실드는 HP·크기가 핵심이다
        // 실드 보강재·커넥팅[범용Ⅱ형]은 실드 HP 를 올려 준다
        const base = Number(shieldHp) || 0;
        const bonus = shieldHp ? (wm.shieldHp || 0) : 0;
        ammoCell.append(document.createTextNode(shieldHp ? 'HP ' + (base + bonus).toLocaleString() : '—'));
        if (bonus) ammoCell.append(el('span', 'w-gain', ' (+' + bonus.toLocaleString() + ')'));
        if (shieldSize) ammoCell.append(el('span', 'w-sub', '크기 ' + shieldSize));
      } else if (ammo) ammoCell.append(document.createTextNode(jaUnits(ammo)));
      else if (isEpack && ohShots) {                      // E팩 탄창: 「6発OH」→ 탄수 6발
        const mag = String(ohShots).match(/(\d+)\s*発/);
        ammoCell.append(document.createTextNode(mag ? mag[1] + '발' : jaUnits(ohShots)));
      } else if (heat) {
        ammoCell.append(document.createTextNode(heat));
        if (ohShots) ammoCell.append(el('span', 'w-sub', jaUnits(ohShots)));
      } else ammoCell.textContent = '—';
      row.append(ammoCell);

      // ⑥ 누적치 (よろけ値)
      row.append(el('span', 'w-col', mods.stagger ? jaUnits(mods.stagger) : '—'));

      // ⑦ 사거리
      row.append(el('span', 'w-col', f('射程') || '—'));

      // ⑧ 리로드 / OH복귀 — 파츠로 줄어드는 만큼을 함께 보여 준다
      const reload = f('リロード時間');
      const ohBack = f('OH復帰時間', 'OH復帰速度');
      const last = el('span', 'w-col');
      if (reload) {
        // 퀵 로더·대용량 보급 팩은 무장 종류를 가리지 않는다
        const cut = D.timeCutFor(wm, 'reloadTime', w);
        last.append(document.createTextNode(jaUnits(D.shortenTimeText(reload, cut))));
        if (cut) last.append(el('span', 'w-gain', ' (-' + cut + '%)'));
      } else if (ohBack) {
        // E팩 탄창식 빔은 OH 가 아니라 리로드 — 리로드 파츠(퀵로더 등)로 줄고 '리로드'로 표기한다.
        // 진짜 열무기만: 보조 제네레이터(빔)·대용량 보급 팩(전 무장)이 OH 복귀를 줄인다(스러스터 OH 와 별개).
        const cut = D.timeCutFor(wm, isEpack ? 'reloadTime' : 'weaponOH', w);
        last.append(document.createTextNode(jaUnits(D.shortenTimeText(ohBack, cut))));
        if (cut) last.append(el('span', 'w-gain', ' (-' + cut + '%)'));
        last.append(el('span', 'w-sub', isEpack ? '리로드' : 'OH복귀'));
      } else last.textContent = '—';
      row.append(last);

      // 누르면 위키 설명 전체를 펼친다
      row.onclick = () => toggleWeaponDetail(row, w, d, lv);
      box.append(row);
      // 파츠를 갈아 끼우면 목록을 다시 그리므로, 펼쳐 둔 무장은 여기서 되살린다
      if (state.openWeapon === w.name) openWeaponDetail(row, w, d, lv);
    }
  }

  /** 무장 표의 열 이름을 한글로. 없는 이름은 원문을 그대로 쓴다. */
  const WCOL_LABEL = {
    '射程': '사거리', '弾数': '탄수', 'リロード時間': '리로드 시간', 'クールタイム': '쿨타임',
    'ヒート率': '히트율', 'ヒート率/ノン': '히트율(논차지)', 'ヒート率/フル': '히트율(풀차지)',
    'OHまでの弾数': 'OH까지 발수', 'OH復帰時間': 'OH 복귀 시간', 'OH復帰速度': 'OH 복귀 속도',
    '発射間隔': '발사 간격', '発射速度': '발사 속도', '切替時間': '전환 시간', '武装切替': '무장 전환',
    'DPS': 'DPS', 'HP': 'HP', 'シールドHP': '실드 HP', 'サイズ': '크기', 'リペア': '리페어(회복)'
  };
  const wcol = k => WCOL_LABEL[String(k).replace(/\s+/g, '')] || k;

  /**
   * 위키 설명문에 자주 나오는 표현을 한글로 바꾼다.
   * 사전에 없는 표현은 원문 그대로 두어 정보가 사라지지 않게 한다.
   */
  const NOTE_TERM = [
    // 사격 조건
    ['ジャンプ射撃可', '점프사격 가능'], ['ブースト射撃可', '부스트사격 가능'],
    ['空中射撃可', '공중사격 가능'], ['伏せ射撃可', '엎드려사격 가능'],
    ['移動射撃可能', '이동사격 가능'], ['移動射撃可', '이동사격 가능'],
    ['射撃時静止', '사격 시 정지'], ['水中時使用不可', '수중에서 사용 불가'],
    ['空中格闘制御', '공중격투 제어'], ['連撃不可', '연격 불가'], ['射出可', '사출 가능'],
    ['使用可', '사용 가능'], ['使用不可', '사용 불가'],
    // 집속
    ['集束時よろけ有', '집속 시 비틀 있음'], ['集束時ユニット貫通効果付与', '집속 시 유닛관통 부여'],
    ['集束中移動可', '집속 중 이동 가능'], ['集束必須', '집속 필수'], ['集束可', '집속 가능'],
    ['非集束時', '비집속 시'], ['集束時間', '집속 시간'], ['集束時', '집속 시'],
    // 상태 이상·효과
    ['大よろけ有', '대비틀 있음'], ['よろけ有', '비틀 있음'], ['ひるみ有', '움찔 있음'],
    ['ユニット貫通効果有', '유닛관통 있음'], ['爆風範囲有', '폭풍범위 있음'],
    ['照射攻撃', '조사공격'], ['妨害効果付与', '방해효과 부여'], ['照準誘導効果有', '조준유도 있음'],
    ['よろけ値', '누적치'], ['非集束', '비집속'],
    // 발사 방식
    ['二発同時発射', '2발 동시발사'], ['発同時発射', '발 동시발사'],
    ['発連続発射', '발 연속발사'], ['左右交互発射', '좌우 교대발사'],
    ['即撃ち', '즉시발사'], ['秒間', '초간'], ['回攻撃', '회 공격'],
    ['パック式弾数所持', '팩식 탄수 보유'], ['秒長押しでロックオン', '초 길게 눌러 록온'],
    ['高速移動中にロックオン', '고속이동 중 록온'], ['命中後', '명중 후'],
    // 보정
    ['局部補正', '국부 보정'], ['シールド補正', '실드 보정'], ['拠点補正', '거점 보정'],
    ['頭部・背部補正', '두부·배부 보정'], ['脚部・背部補正', '각부·배부 보정'],
    ['頭部補正', '두부 보정'], ['脚部補正', '각부 보정'], ['背部補正', '배부 보정'],
    ['耐ビーム補正', '내빔 보정'], ['耐実弾補正', '내실탄 보정'], ['耐格闘補正', '내격투 보정'],
    ['自動照準補正', '자동조준보정'],

    // 위키 備考 상용구
    ['格闘方向に関わらず強制ダウン', '격투 방향에 관계없이 강제 다운'],
    ['格闘方向によらず強制ダウン', '격투 방향에 관계없이 강제 다운'],
    ['かつ小数点以下切り捨てで計算', '이며 소수점 이하 버림으로 계산'],
    ['小数点以下切り捨て', '소수점 이하 버림'], ['自身のみが視認', '자신만 시인'],
    ['命中対象に炎上デバフ', '명중 대상에 화상 디버프'], ['炎上デバフ', '화상 디버프'],
    ['吹き飛ばしダウン', '날려버림 다운'], ['強制ダウン', '강제 다운'],
    ['ボタン押下で', '버튼을 눌러'], ['ボタンで任意解除', '버튼으로 임의 해제'],
    ['任意解除', '임의 해제'], ['使用後', '사용 후'], ['無効化', '무효화'],
    ['特殊緩衝材', '특수완충재'], ['特殊偽装', '특수위장'], ['阿頼耶識', '아라야식'],
    ['高速移動', '고속이동'], ['ブースト移動', '부스트 이동'], ['連動射撃', '연동사격'],
    ['高速機動射撃', '고속기동사격'], ['格闘優先度', '격투 우선도'], ['連撃補正', '연격 보정'],
    ['防御力上昇', '방어력 상승'], ['スピード低下', '스피드 저하'],
    ['レーダー阻害', '레이더 저해'], ['レーダー障害', '레이더 장애'],
    ['ビーム属性', '빔 속성'], ['実弾属性', '실탄 속성'], ['射撃属性', '사격 속성'],
    ['伏せ撃ち', '엎드려 사격'], ['振り回し', '휘두르기'], ['機体後方', '기체 후방'],
    ['着弾点', '착탄점'], ['着弾', '착탄'], ['射出直後', '사출 직후'], ['射出', '사출'],
    ['与ダメージ', '주는 피해'], ['与ダメ', '주는 피해'], ['被ダメ', '받는 피해'],
    ['以上の場合', '이상인 경우'], ['場合', '경우'], ['以上', '이상'], ['以下', '이하'],
    // 외래어
    ['マシンガン', '머신건'], ['ライフル', '라이플'], ['バズーカ', '바주카'],
    ['レーダー', '레이더'], ['スコープ', '스코프'], ['ステルス', '스텔스'],
    ['スポット', '스팟'], ['バースト', '버스트'], ['リアクション', '리액션'],
    ['カウンター', '카운터'], ['バリア', '배리어'], ['デバフ', '디버프'],
    ['ボタン', '버튼'], ['ヘビー', '헤비'], ['ダウン', '다운'], ['リロード', '리로드'],
    // 일반어
    ['不可能', '불가능'], ['不可', '불가'], ['可能', '가능'],
    ['攻撃', '공격'], ['発生', '발생'], ['曲射', '곡사'], ['単発', '단발'],
    ['弾数', '탄수'], ['消費', '소비'], ['持続', '지속'], ['射程', '사거리'],
    ['低減', '저감'], ['出力', '출력'], ['能力', '능력'], ['段階', '단계'],
    ['下格', '하격'], ['横格', '횡격'], ['連続', '연속'], ['維持', '유지'],
    ['累計', '누계'], ['飛行', '비행'], ['味方', '아군'], ['展開', '전개'],
    ['散弾', '산탄'], ['無視', '무시'], ['固定', '고정'], ['共通', '공통'],
    ['時間', '시간'], ['上昇', '상승'], ['追加', '추가'], ['阻害', '저해'],
    ['障害', '장애'], ['押下', '누름'], ['最長', '최장'], ['約', '약'],
    ['直後', '직후'], ['命中', '명중'], ['対象', '대상'], ['計算', '계산'],
    ['自身', '자신'], ['視認', '시인'], ['解除', '해제'], ['使用', '사용'],
    ['移動', '이동'], ['防御', '방어'], ['属性', '속성'], ['優先', '우선'],
    ['補正', '보정'], ['方向', '방향'], ['機体', '기체'], ['後方', '후방'],
    ['無効', '무효'], ['偽装', '위장'], ['緩衝材', '완충재'],
    ['能', '능'], ['改', '카이'], ['強', '강'], ['単', '단'], ['回', '회'],
    ['中', '중'], ['後', '후'], ['前', '전'], ['時', '시'], ['内', '내'],
    ['等', '등'], ['用', '용'], ['非', '비'], ['分', '분'], ['減', '감'],
    ['爆', '폭'], ['腕', '팔'], ['格', '격'], ['射', '사'], ['動', '동'],
    ['生', '생'], ['与', '주는'], ['無', '없음'],
    // 조사 — 남겨 두면 문장이 일본어로 보인다
    ['からの', '으로부터'], ['まで', '까지'], ['から', '부터'], ['ごと', '마다'],
    ['かつ', '이며'], ['など', '등'], ['ため', '위해'],
    ['を', '을'], ['が', '이'], ['は', '는'], ['の', '의'], ['に', '에'],
    ['で', '로'], ['と', '와'], ['や', '나'], ['も', '도'], ['り', ''], ['な', ''],

    ['狙撃', '저격'], ['砲撃', '포격'], ['迎撃', '요격'], ['爆撃', '폭격'],
    ['集束', '집속'], ['ジャンプ', '점프'], ['リミッター', '리미터'],
    ['敵機', '적기'], ['受けた', '받은'], ['入った', '들어간'], ['ずつ', '씩'],
    ['撃', '격'], ['系', '계'], ['点', '점'], ['闘', '투'], ['風', '풍'],
    ['自', '자'], ['空', '공'], ['同', '동'], ['行', '행'],
    // 기타
    ['スキル発動中', '스킬 발동 중'], ['スキル', '스킬'], ['武装', '무장'],
    ['通常時', '통상 시'], ['変形時', '변형 시'], ['変身時', '변신 시'],
    ['は機体', '는 기체'], ['依存', '의존'], ['に付属', '에 부속'], ['対応', '대응'],
    ['ダメージ計算', '피해 계산'], ['対象の', '대상의'], ['付与', '부여'],
    ['装備中', '장비 중'], ['シールドへの被ダメージ', '실드에 받는 피해'],
    ['被ダメージ', '받는 피해'], ['シールド', '실드'], ['ダメージ', '피해'],
    ['ヒット', '히트'], ['アタック', '어택'], ['ロックオン', '록온'],
    ['頭部', '두부'], ['脚部', '각부'], ['背部', '배부'], ['腕部', '완부'],
    ['最大', '최대'], ['倍率', '배율'], ['連射', '연사'], ['貫通', '관통'],
    ['拡張', '확장'], ['短縮', '단축'], ['増加', '증가'], ['軽減', '경감'],
    ['効果', '효과'], ['範囲', '범위'], ['威力', '위력'], ['装備', '장비'],
    ['倍', '배'], ['発', '발'], ['秒', '초'], ['有', '있음'], ['可', '가능']
  ];
  // 짧은 항목이 긴 말을 잘라먹지 않도록 항상 긴 표기부터 치환한다 (「不可」가 「不가능」이 되던 문제)
  const NOTE_SORTED = NOTE_TERM.slice().sort((a, b) => b[0].length - a[0].length);

  // 구두점·기호를 읽기 좋게 정리한다 (MT 결과·하드코딩 폴백 공통).
  // 남은 단위·카운터(초·배·발·회·분·연사·탄)는 한 글자라 안전하게 마지막에 옮긴다.
  const normNote = t => String(t)
    .replace(/秒/g, '초').replace(/倍/g, '배').replace(/発/g, '발').replace(/回/g, '회')
    .replace(/分/g, '분').replace(/射/g, '사').replace(/弾/g, '탄')
    .replace(/・/g, '·').replace(/：/g, ': ').replace(/、/g, ', ')
    .replace(/（/g, ' (').replace(/）/g, ') ')
    .replace(/［/g, ' [').replace(/］/g, '] ')
    .replace(/[「『]/g, ' “').replace(/[」』]/g, '” ')
    .replace(/＋/g, '+').replace(/－/g, '-').replace(/％/g, '%')
    .replace(/\s+/g, ' ')
    .replace(/\s+([),\]:;%·”])/g, '$1')
    .replace(/([(\[“])\s+/g, '$1')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();

  // 온라인 MT 로 번역해 둔 備考 사전 (빌드 시 인라인). 없으면 아래 하드코딩 사전으로 폴백.
  const NOTE_MT = (window.GBO2_I18N && window.GBO2_I18N.weaponNote) || {};
  /** 하드코딩 사전 폴백 — MT 캐시에 없는 備考(오프라인 미번역분)용. */
  const noteFallback = s => {
    let t = String(s).replace(/可能/g, '可');   // 「〜可」와 「〜可能」을 한 표기로 모은다
    for (const [ja, ko] of NOTE_SORTED) t = t.split(ja).join(ja.length > 1 ? ' ' + ko + ' ' : ko);
    return T.weaponTerms(t);
  };
  /** 위키 備考를 한국어로. MT 번역 사전 우선, 없으면 하드코딩 폴백. */
  const noteText = s => (s ? normNote(NOTE_MT[s] != null ? NOTE_MT[s] : noteFallback(s)) : '');

  /** 누를 때마다 펼치거나 접는다. 열어 둔 무장은 state 에 남겨 다시 그려도 유지한다. */
  function toggleWeaponDetail(row, w, d, lv) {
    const open = row.nextElementSibling && row.nextElementSibling.classList.contains('weapon-detail');
    // 한 번에 하나만 열어 둔다
    for (const e of [...row.parentNode.querySelectorAll('.weapon-detail')]) e.remove();
    for (const e of [...row.parentNode.querySelectorAll('.weapon.open')]) e.classList.remove('open');
    state.openWeapon = open ? null : w.name;
    if (open) return;
    openWeaponDetail(row, w, d, lv);
  }

  /** 무장 행 아래에 위키의 설명과 표 값을 그대로 펼친다. */
  function openWeaponDetail(row, w, d, lv) {
    row.classList.add('open');
    const box = el('div', 'weapon-detail');

    const head = el('div', 'wd-head');
    head.append(el('b', '', T.weaponName(w.name)));
    head.append(el('span', 'wd-ja', w.name));
    head.append(el('span', 'wd-tag', 'LV' + lv + ' · '
      + (w.type === 'shield' ? '실드 · 방어'
        : (w.section === '主兵装' ? '주무장' : '부무장') + ' · ' + (w.type === 'melee' ? '격투' : '사격'))));
    box.append(head);

    // 성격별로 묶어 보여 준다 — 한 덩어리로 나열하면 읽기 어렵다
    const groups = [
      ['위력', ['논차지 위력', '풀차지 위력', '집속 시간', '집속 배율', '누적치']],
      ['운용', ['쿨타임', '무장 전환', '전환 시간', '발사 간격', '발사 속도', 'DPS']],
      ['탄약·열', ['탄수', '리로드 시간', '히트율', '히트율(논차지)', '히트율(풀차지)',
        'OH까지 발수', 'OH 복귀 시간', 'OH 복귀 속도']],
      ['방어·보정', ['실드 HP', 'HP', '크기', '사거리', '국부 보정', '실드 보정']]
    ];

    // 표시할 값을 한곳에 모은 뒤 그룹으로 나눈다
    const vals = new Map();
    const set = (k, v) => { if (v != null && v !== '' && v !== '-') vals.set(k, jaUnits(String(v))); };
    set('논차지 위력', d.power != null ? d.power.toLocaleString() : null);
    set('풀차지 위력', d.powerCharged != null ? d.powerCharged.toLocaleString() : null);
    for (const [k, v] of Object.entries(d.raw || {})) set(wcol(k), v);
    for (const [k, v] of Object.entries(w.info || {})) if (k !== '備考') set(wcol(k), v);
    const m = w.mods || {};
    set('집속 시간', m.chargeTime ? m.chargeTime + '초' : null);
    set('집속 배율', m.chargeRatio ? m.chargeRatio + '배' : null);
    set('누적치', m.stagger);
    set('국부 보정', m.partMod ? m.partMod + '배' : null);
    set('실드 보정', m.shieldMod ? m.shieldMod + '배' : null);

    for (const [title, keys] of groups) {
      const rows = keys.filter(k => vals.has(k));
      if (!rows.length) continue;
      const sec = el('div', 'wd-sec');
      sec.append(el('div', 'wd-sec-lb', title));
      const grid = el('div', 'wd-grid');
      for (const k of rows) {
        const line = el('div', 'wd-row');
        line.append(el('span', 'wd-k', k));
        line.append(el('span', 'wd-v', vals.get(k)));
        grid.append(line);
        vals.delete(k);
      }
      sec.append(grid);
      box.append(sec);
    }
    // 어느 묶음에도 안 들어간 값은 마지막에 모아 둔다
    if (vals.size) {
      const sec = el('div', 'wd-sec');
      sec.append(el('div', 'wd-sec-lb', '기타'));
      const grid = el('div', 'wd-grid');
      for (const [k, v] of vals) {
        const line = el('div', 'wd-row');
        line.append(el('span', 'wd-k', k));
        line.append(el('span', 'wd-v', v));
        grid.append(line);
      }
      sec.append(grid);
      box.append(sec);
    }

    // 격투 무장: 방향별 피해 + 연격 보정 (격투보정·파츠·스킬 반영)
    if (w.type === 'melee' && w.melee && d.power != null) box.append(meleeSection(w, d.power));

    // 위키 설명 원문 (계산에 안 들어가는 부가 효과까지 전부)
    if (w.info && w.info['備考']) {
      const note = el('div', 'wd-sec');
      note.append(el('div', 'wd-sec-lb', '위키 설명'));
      note.append(el('div', 'wd-note-tx', noteText(w.info['備考'])));
      box.append(note);
    }
    row.after(box);
  }

  const MELEE_LABEL = {
    'N格': 'N격', '横格': '횡격', '下格': '하격', '特殊格闘': '특수격투', 'BD格': 'BD격',
    '1撃目': '1격', '2撃目': '2격', '3撃目': '3격', '4撃目': '4격', '5撃目': '5격'
  };
  const mLabel = s => MELEE_LABEL[s] || s;

  /**
   * 격투 무장의 방향별 피해와 연격 보정을 보여 준다.
   * 방향 피해 = 격투 피해(격투보정·파츠·스킬 반영)에 방향 배율(연타는 히트별)을 곱한 합.
   * 상태(기본/헤비어택/최대출력 등)가 여러 개면 각각 소제목을 달아 나눠 보여 준다.
   */
  function meleeSection(w, power) {
    const r = stats();
    const corr = r.total.meleeCorrection;
    const sk = skillEffect();
    const corrBare = sk ? stats(null).total.meleeCorrection : corr;
    const pct = D.damagePctFor(wm0(), w, 'melee');   // 파츠 피해 % (특화 프로그램 등, 한 배율)
    const skPcts = skillDmgPctList('melee');         // 스킬 피해 % — 스킬별 별도 곱연산

    const sec = el('div', 'wd-sec');
    sec.append(el('div', 'wd-sec-lb', '격투 방향별 피해'));

    const variants = w.melee.variants || [];
    const multi = variants.length > 1;
    for (const v of variants) {
      if (multi) sec.append(el('div', 'wd-var-lb', v.label));   // 상태 소제목
      const grid = el('div', 'wd-grid');
      for (const dir of v.direction) {
        const line = el('div', 'wd-row');
        line.append(el('span', 'wd-k', mLabel(dir.label) + '  ' + jaUnits(dir.raw)));
        // 히트별로 방향 배율을 적용해 합산 (하격 240%(120%x2) = 2히트)
        // 파츠 %는 한 배율, 스킬 %는 각각 곱연산으로 얹는다
        const withSkill = D.applyDamagePct(D.meleeDamage(power, corr, { ccd: dir.hits }), [pct, ...skPcts]);
        const without = sk ? D.applyDamagePct(D.meleeDamage(power, corrBare, { ccd: dir.hits }), pct) : withSkill;
        const cell = el('span', 'wd-v');
        cell.append(document.createTextNode(without.toLocaleString()));
        if (withSkill !== without) cell.append(el('span', 's-gain' + skillCls(),
          ' (+' + (withSkill - without).toLocaleString() + ')'));
        line.append(cell);
        grid.append(line);
      }
      sec.append(grid);
    }

    if (w.melee.combo) {
      const cb = el('div', 'wd-combo');
      cb.append(el('span', 'wd-k', '연격 보정'));
      cb.append(el('span', '', w.melee.combo.map(c => mLabel(c.label) + ' ' + jaUnits(c.raw)).join(' · ')));
      sec.append(cb);
    }
    return sec;
  }

  /** 현재 장착 기준 파츠 무장 보정 (상세 패널에서도 쓴다). */
  const wm0 = () => D.weaponModsOf(state.equipped, state.ms ? msLevel(state.ms) : 1, state.ms && state.ms.属性, state.expansion);

  /* ---------- 스탯 ---------- */

  function renderStats() {
    const body = $('#statBody');
    body.innerHTML = '';
    if (!state.ms) return;

    const r = stats();
    // 스킬 몫은 상한에 걸려 잘릴 수 있으므로, 스킬을 뺀 결과와 비교해 실제로 늘어난 만큼만 센다
    const bare = skillStatBonus() ? stats(null) : null;

    for (const k of C.STAT_KEYS) {
      const limit = r.currentLimits[k];
      const raw = r.rawTotal[k], tot = r.total[k], soche = r.base[k];
      const skillGain = bare ? tot - bare.total[k] : 0;
      const over = limit !== Infinity && raw > limit ? raw - limit : 0;   // 상한 때문에 버려진 양
      const atCap = limit !== Infinity && tot >= limit;
      const gain = tot - soche;                                          // 강화+확장+파츠로 인한 증가분

      const row = el('div', 'stat-row' + (atCap ? ' capped' : '') + (over ? ' over' : ''));
      row.append(el('span', 'label', C.STAT_LABEL[k]));

      const totalCell = el('span', 'total');
      totalCell.append(document.createTextNode(tot.toLocaleString()));
      if (over) totalCell.append(el('span', 'over-warn', '+' + over));    // ⚠ 초과분
      row.append(totalCell);

      // 증가 폭: 강화·확장·파츠는 초록, 스킬 발동분은 보라로 나눠 보여 준다
      const base = gain - skillGain;
      const delta = el('span', 'delta' + (base > 0 ? ' up' : base < 0 ? ' down' : ''));
      delta.textContent = base === 0 && skillGain ? '' : (base === 0 ? '·' : (base > 0 ? '+' : '') + base.toLocaleString());
      if (skillGain) delta.append(el('span', 's-gain' + skillCls(), (base === 0 ? '' : ' ') + '+' + skillGain.toLocaleString()));
      row.append(delta);

      // 소체분(회색) 위에 증가분(초록)을 겹쳐 보이고, 상한 초과는 OVER 로 표시
      const meter = el('div', 'meter');
      const scale = limit === Infinity ? Math.max(tot, soche, 1) * 1.15 : limit;
      const baseW = Math.min(100, (Math.min(soche, tot) / scale) * 100);
      const gainW = Math.min(100 - baseW, (Math.max(base, 0) / scale) * 100);
      const skillW = Math.min(100 - baseW - gainW, (Math.max(skillGain, 0) / scale) * 100);
      const basePart = el('i', 'base');
      basePart.style.width = baseW + '%';
      const gainPart = el('i', 'gain' + (atCap ? ' capped' : '') + (over ? ' over' : ''));
      gainPart.style.width = gainW + '%';
      meter.append(basePart, gainPart);
      if (skillW > 0) {                       // 스킬 몫은 게이지에서도 색으로 구분한다
        const skillPart = el('i', 'skill' + skillCls());
        skillPart.style.width = skillW + '%';
        meter.append(skillPart);
      }

      const graph = el('div', 'graph');
      graph.append(meter);
      if (over) graph.append(el('span', 'over-badge', 'OVER'));
      row.append(graph);

      row.append(el('span', 'cap', limit === Infinity ? '—' : limit.toLocaleString()));
      body.append(row);
    }

    const lv = msLevel(state.ms);

    // 공격 지표 — 내구가 HP에 내성을 접듯, 피해%(파츠·발동 스킬)를 보정에 접은 '실효 보정'.
    //   피해 = 무장위력 × (1+보정/100) × (1+피해%)  →  실효보정 = ((1+보정/100)(1+피해%/100) − 1)×100
    // 보정 상한(100)을 넘는 피해% 파츠의 실제 가치까지 드러난다.
    const atkBonus = partAttackBonus(state.equipped, lv);
    const totalDmgPct = (partPct, kind) => {   // 파츠(합산) × 스킬(곱연산) 최종 피해 증가율
      const skills = skillDmgPctList(kind);
      const mult = (1 + partPct / 100) * skills.reduce((m, p) => m * (1 + p / 100), 1);
      return Math.round((mult - 1) * 100);
    };
    const atk = el('div', 'dura-row');
    atk.append(el('span', 'dura-lb', '공격 지표'));
    for (const [key, label, corr] of [['shoot', '사격', r.total.shoot], ['melee', '격투', r.total.meleeCorrection]]) {
      const pct = totalDmgPct(atkBonus[key], key);
      const eff = Math.round(((1 + corr / 100) * (1 + pct / 100) - 1) * 100);
      const cell = el('span', 'dura-cell');
      cell.append(el('span', 'dura-k', label));
      cell.append(el('span', 'dura-v', eff.toLocaleString()));
      if (pct !== 0) {
        const tag = el('span', 'dura-up' + (pct < 0 ? ' down' : ''), '피해 ' + (pct > 0 ? '+' : '') + pct + '%');
        tag.title = `보정 ${corr} + 피해 ${pct >= 0 ? '+' : ''}${pct}% → 실효 보정 ${eff}`;
        cell.append(tag);
      }
      atk.append(cell);
    }
    body.append(atk);

    // 내구 지표 — 스탯 행들과 같은 흐름(마지막 행). 체크한 방어 스킬(피해경감)만큼 실효 HP 가 오른다.
    const stg = activeStaggerMods(state.ms, lv);
    const partCuts = partDamageCuts(state.equipped, lv);   // 장착 파츠의 % 피해경감(항상 적용)
    const du = el('div', 'dura-row');
    du.append(el('span', 'dura-lb', '내구 지표'));
    for (const [k, label, dattr] of [['armorRange', '내실탄', 'solid'], ['armorBeam', '내빔', 'beam'], ['armorMelee', '내격투', 'melee']]) {
      const base = durabilityOf(r.total, k), f = staggerDmgFactor([...partCuts, ...boostBufferCuts(stg.cuts, state.equipped)], dattr);
      const cell = el('span', 'dura-cell');
      cell.append(el('span', 'dura-k', label));
      if (f < 1) {
        const cellV = el('span', 'dura-v', Math.round(base / f).toLocaleString());
        cell.append(cellV);
        // 태그는 실효HP 상승률이 아니라 '피해 감소율'(파츠·스킬의 실제 경감)을 보여 준다.
        const cut = el('span', 'dura-up', '피해 -' + Math.round((1 - f) * 100) + '%');
        cut.title = `실효 HP ×${(1 / f).toFixed(3)} (피해 ${Math.round((1 - f) * 100)}% 경감)`;
        cell.append(cut);
      } else {
        cell.append(el('span', 'dura-v', base.toLocaleString()));
      }
      du.append(cell);
    }
    body.append(du);

    // 누적치(스태거) — 임계·감소 스킬을 반영한 실효 내성. 무장별 다운은 '피탄 시뮬'에서.
    const sr = el('div', 'dura-row stagger-row');
    sr.append(el('span', 'dura-lb', '누적치'));
    const scell = el('span', 'dura-cell');
    scell.append(el('span', 'dura-k', '내성'));
    scell.append(el('span', 'dura-v', Math.round(stg.threshold / stg.mult) + '%'));
    sr.append(scell);
    sr.append(el('span', 'stagger-detail',
      `임계 ${stg.threshold}%` + (stg.mult < 1 ? ` · 받는 누적 ×${+stg.mult.toFixed(3)}` : '')));
    body.append(sr);

    // 스러스터 지표 — 부스트 지속 · 완충 · OH 복귀. 지상/우주 각각(환경적성·강습 보정이 다르다).
    {
      const thr = r.total.thruster || 0;
      // 소수 한 자리로 통일한다 — 16.2 와 15.6 이 둘 다 '16초' 로 보이면 변화가 가려진다
      const sec = v => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '초';
      for (const [env, label] of [['ground', '지상'], ['space', '우주']]) {
        if (env === 'ground' && state.ms['出撃_地上可'] === false) continue;
        if (env === 'space' && state.ms['出撃_宇宙可'] === false) continue;
        const m = thrusterMetrics(state.ms, thr, state.equipped, env);
        if (!m) continue;
        const row = el('div', 'dura-row thr-row');
        row.append(el('span', 'dura-lb', '스러스터 ' + label));
        const cell = (k, v, base) => {
          const c = el('span', 'dura-cell');
          c.append(el('span', 'dura-k', k));
          c.append(el('span', 'dura-v', sec(v)));
          if (v != null && base != null && Math.abs(v - base) > 0.05) {
            const better = k === '풀회복' || k === 'OH복귀' ? v < base : v > base;
            c.append(el('span', better ? 'dura-up' : 'dura-down', (v > base ? '+' : '') + (Math.round((v - base) * 10) / 10) + '초'));
          }
          return c;
        };
        row.append(cell('부스트', m.boost, m.base.boost));
        row.append(cell('풀회복', m.full, m.base.full));
        row.append(cell('OH복귀', m.oh, m.base.oh));
        const ohLong = ohLongSkillOf(state.ms, lv);
        if (ohLong) row.append(el('span', 'thr-ohlong', ohLong + ' 후 ' + OH_LONG_SEC + '초'));
        const colKo = m.col === 'adapt' ? '환경적성' : m.col === 'assault' ? '강습 보정' : '표준';
        row.title = '위키 실측 기준(' + colKo + ')\n'
          + '· 부스트 지속 = (스러스터 ' + thr + ' − 초기소비) ÷ 소비속도\n'
          + '· 풀회복 = 게이지 0 → 가득 (스러스터 ÷ 5/초, 회복 파츠 반영)\n'
          + '· OH 복귀 = ' + m.base.oh + '초 × (1 − 단축 파츠)'
          + (ohLong ? '\n※ ' + ohLong + ' 효과가 끝난 뒤에는 OH 복귀가 ' + OH_LONG_SEC
              + '초 (스킬 설명에 명시된 고정값 — 위 단축 파츠와 별개).' : '')
          + (isTankMs(state.ms) ? '\n※ 탱크형은 소비속도가 위키 미확정이라 부스트 지속을 내지 않는다.' : '');
        body.append(row);
      }
    }

    // 방어 스킬 체크박스 — 체크 시 위 내구 지표·누적치에 반영된다.
    const cl = staggerCheckList(state.ms, lv, () => renderAll());
    if (cl.count) {
      const head = el('div', 'dura-row stg-head');
      head.append(el('span', 'dura-lb', '방어 스킬'));
      head.append(el('span', 'stagger-detail', '체크 시 내구·누적치 반영'));
      body.append(head);
      body.append(cl.wrap);
    }
  }

  /** 상세 PNG용 무장 피해 목록 — renderWeapons 의 dmgCell 최종값(파츠·스킬·자세 반영)과 동일 계산. */
  function weaponDamageList() {
    const list = msWeapons();
    if (!list.length) return [];
    const r = stats();
    const corr = { shooting: r.total.shoot, melee: r.total.meleeCorrection };
    const dmgKey = w => (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shooting';
    const wm = D.weaponModsOf(state.equipped, state.ms ? msLevel(state.ms) : 1, state.ms && state.ms.属性, state.expansion);
    const sk = skillEffect();
    const postureEtc = w => {
      if (dmgKey(w) === 'melee') return 0;
      let e = 0;
      if (state.posture === 'crouch') e += D.ETC_ATTACK.crouch;
      else if (state.posture === 'prone') e += D.ETC_ATTACK.prone;
      if (state.scope) e += D.ETC_ATTACK.scope;
      return e;
    };
    const skEtc = w => (dmgKey(w) === 'shooting' && sk && sk.crouchPct && state.posture === 'crouch') ? sk.crouchPct / 100 : 0;
    const out = [];
    for (const w of list) {
      const lv = weaponLevel(w), d = lv ? w.levels[lv] : null;
      if (!d) continue;
      const info = w.info || {}, mods = w.mods || {};
      const f = (...names) => wField(d, info, ...names);
      const mult = fireMult(w);
      const fin = (base, m) => {
        if (base == null) return null;
        const n = m ? m.n : 1;
        if (w.attr === 'shield' || w.type === 'shield') return { one: base, n, total: base * n };
        const kind = dmgKey(w) === 'melee' ? 'melee' : 'shoot';
        const raw = w.type === 'melee'
          ? D.meleeDamage(base, corr[dmgKey(w)] || 0, { etcA: postureEtc(w) + skEtc(w) })
          : D.shootingDamage(base, corr[dmgKey(w)] || 0, { etcA: postureEtc(w) + skEtc(w) });
        const one = D.applyDamagePct(raw, [D.damagePctFor(wm, w, kind), ...skillDmgPctList(kind)]);
        return { one, n, total: one * n };
      };
      // ⑤ 쿨타임 / 발사간격
      const cool = f('クールタイム') || f('発射間隔', '発射速度', '発射間', '照射時間');
      // ⑥ 탄 / 히트율 (renderWeapons 와 동일 규칙)
      const ammo = f('弾数'), heat = f('ヒート率', 'ヒート率/フル', 'ヒート率/ノン'), ohShots = f('OHまでの弾数');
      const isEpack = D.isEpackMag(w), shieldHp = f('シールドHP', 'HP'), shieldSize = f('サイズ');
      let ammoStr;
      if (shieldHp || shieldSize) {
        const base = Number(shieldHp) || 0, bonus = shieldHp ? (wm.shieldHp || 0) : 0;
        ammoStr = shieldHp ? 'HP ' + (base + bonus).toLocaleString() : (shieldSize ? '크기 ' + shieldSize : '—');
      } else if (ammo) ammoStr = jaUnits(ammo);
      else if (isEpack && ohShots) { const mag = String(ohShots).match(/(\d+)\s*発/); ammoStr = mag ? mag[1] + '발' : jaUnits(ohShots); }
      else if (heat) ammoStr = heat;
      else ammoStr = '—';
      // ⑧ 리로드 / OH복귀
      const reload = f('リロード時間'), ohBack = f('OH復帰時間', 'OH復帰速度');
      let reloadStr;
      if (reload) reloadStr = jaUnits(D.shortenTimeText(reload, D.timeCutFor(wm, 'reloadTime', w)));
      else if (ohBack) reloadStr = jaUnits(D.shortenTimeText(ohBack, D.timeCutFor(wm, isEpack ? 'reloadTime' : 'weaponOH', w))) + (isEpack ? ' 리로드' : ' OH');
      else reloadStr = '—';

      out.push({
        name: T.weaponName(w.name), type: w.type, attr: weaponAttr(w),
        sec: w.type === 'shield' ? '실드' : w.section === '主兵装' ? '주무장' : w.section === '副兵装' ? '부무장' : '기타',
        // 유형은 '사용 방식'(type)이 아니라 '속성'(attr)이다 — 무장 표와 같은 기준을 쓴다.
        // 던지는 격투 무장처럼 type=shooting·attr=melee 인 것이 있어 둘이 갈린다.
        kind: ATTR_LABEL[weaponAttr(w)] || '기타',
        nc: fin(d.power, mult.nc), ch: fin(d.powerCharged, mult.ch),
        cool: cool ? jaUnits(cool) : '—',
        ammo: ammoStr,
        stagger: mods.stagger ? jaUnits(mods.stagger) : '—',
        range: f('射程') || '—',
        reload: reloadStr,
        // 고정 피해(소이)는 위력 칸과 별개로 들어가는 몫이라 카드에도 함께 실어야 오해가 없다
        fx: fixedDamageWithParts(w, state.equipped),
        debuffs: debuffsOf(w)
      });
    }
    return out;
  }

  /* ---------- PNG 이미지 배출 (현재 성능·구성 카드) ---------- */
  // 이미지는 data URI 로 인라인돼 있어(GBO2_IMAGES) file:// 에서도 캔버스 오염 없이 그릴 수 있다.
  // 좌: 기체 이미지 + 장착 파츠(썸네일) / 우: 성능표·내구·누적치·발동 스킬.
  async function exportPng(mode) {
    if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
    const m = state.ms, lv = msLevel(m);
    const r = stats();
    const bare = skillStatBonus() ? stats(null) : null;

    const cv = n => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim();
    const CO = {
      bg: cv('--bg') || '#0f1013', panel: cv('--panel') || '#17191f', panel2: cv('--panel-2') || '#1e2129',
      line: cv('--line') || '#2e323d', text: cv('--text') || '#e8eaef', muted: cv('--muted') || '#8a91a0',
      dim: cv('--dim') || '#5a6070', ok: cv('--ok') || '#4ec97f', skill: cv('--skill') || '#c08bff',
      skill2: cv('--skill2') || '#2ee6d6', bad: cv('--bad') || '#ff6b6b', accent: cv('--accent') || '#ffc93c',
      info: cv('--info') || '#4aa3ff', close: cv('--close') || '#ff8a5b',
      mid: cv('--mid') || '#5bc0ff', long: cv('--long') || '#b78bff'
    };
    // 막대·수치 색은 현재 앱 성능표와 동일하게 — 소체=회색, 파츠증가=초록, 스킬=보라/청록, 초과=빨강, 상한근접=노랑
    const track = CO.panel2, slotOn = CO.info || '#4aa3ff';
    const ATTR_C = { '汎用': '#4aa3ff', '強襲': '#ff7a7a', '支援': '#6bd98a' };
    const attrC = ATTR_C[m.属性] || CO.muted;
    const F = "'Malgun Gothic', 'Segoe UI', system-ui, sans-serif";
    const skillCol = state.skillPicks.size > 1 ? CO.skill2 : CO.skill;

    // 상세 모드: 무장 피해 표. 컬럼이 많아 카드 폭을 넓힌다.
    const detail = mode === 'detail';
    const weapons = detail ? weaponDamageList() : [];
    const showW = detail && weapons.length > 0;
    if (detail && !weapons.length) toast('무장 정보가 없어 요약으로 저장합니다');

    const PAD = 24, IP = 20, GAP = 20, DPR = 2;
    const W = showW ? 1200 : 1040;
    const leftX = PAD, leftW = 396, rightX = PAD + leftW + GAP, rightW = W - PAD - rightX, panelTop = PAD;

    // 이미지 미리 로드 (data URI → onload 즉시지만 비동기라 await)
    const load = src => new Promise(res => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    const heroImg = await load(msImg(m.MS名));
    const partItems = await Promise.all(state.equipped.map(async p => ({
      im: await load(partImg(p.name)), name: T.partName(p.name),
      lv: (String(p.name).match(/LV\s*(\d+)/i) || [])[1] || ''
    })));

    const skills = activeSkills().map(s => s.nameKo);
    const alt = altModeOf(m);
    const stg = activeStaggerMods(m, lv);
    const sl = slots();
    const slotRows = [['근', sl.close, sl.maxClose], ['중', sl.mid, sl.maxMid], ['원', sl.long, sl.maxLong]];
    const expLabel = state.expansion === C.EXPANSION_NONE ? '없음'
      : (C.EXPANSION_LABEL[state.expansion] || state.expansion) + ' LV' + state.expLevel;
    const formLabel = (state.form !== 'normal' && alt) ? alt.label : null;

    const wrapLines = (ctx, text, font, maxW) => {
      ctx.font = font;
      const out = []; let line = '';
      for (const word of String(text).split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      }
      if (line) out.push(line);
      return out.length ? out : [''];
    };
    const clip = (ctx, t, maxW, font) => { ctx.font = font; if (ctx.measureText(t).width <= maxW) return t; let s = t; while (s && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; };

    let leftBottom = 0, rightBottom = 0;

    // 좌·우 패널 '내용'만 그린다(패널 배경은 오케스트레이터가 먼저 그림). draw=false 면 높이만 잰다.
    function content(ctx, draw) {
      const lt = (t, x, y, font, color, align) => { if (draw) { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(t, x, y); ctx.textAlign = 'left'; } };
      const rt = (t, xR, y, font, color) => lt(t, xR, y, font, color, 'right');
      const rule = (y, x0, x1) => { if (draw) { ctx.strokeStyle = CO.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke(); } };
      const rrect = (x, y, w, h, rad) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h); };
      const box = (x, y, w, h, rad) => { if (draw) { ctx.fillStyle = CO.panel2; rrect(x, y, w, h, rad); ctx.fill(); ctx.strokeStyle = CO.line; ctx.lineWidth = 1; rrect(x + 0.5, y + 0.5, w, h, rad); ctx.stroke(); } };
      const fit = (im, x, y, w, h) => { if (!im || !draw) return; const s = Math.min(w / im.width, h / im.height); ctx.drawImage(im, x + (w - im.width * s) / 2, y + (h - im.height * s) / 2, im.width * s, im.height * s); };

      /* ═══ 좌측 패널 ═══ */
      const lx = leftX + IP, lR = leftX + leftW - IP;
      let ly = panelTop + IP;
      // 헤더: 썸네일 + 이름 + ★ + 코스트 뱃지
      const TH = 60;
      box(lx, ly, TH, TH, 8);
      fit(heroImg, lx + 2, ly + 2, TH - 4, TH - 4);
      const nx = lx + TH + 14;
      lt(clip(ctx, T.msName(m.MS名), lR - nx, '700 17px ' + F), nx, ly + 21, '700 17px ' + F, CO.text);
      lt('★'.repeat(msRarity(m)) || '', nx, ly + 44, '13px ' + F, CO.accent);
      if (draw) {
        ctx.font = '13px ' + F; const sw = ctx.measureText('★'.repeat(msRarity(m)) || '').width;
        const bt = T.attrName(m.属性) + ' ' + m.コスト;
        ctx.font = '700 12px ' + F; const bw = ctx.measureText(bt).width + 18;
        const bx = nx + sw + (sw ? 10 : 0), byy = ly + 33;
        ctx.fillStyle = attrC; rrect(bx, byy, bw, 20, 10); ctx.fill();
        ctx.fillStyle = '#10151c'; ctx.textAlign = 'left'; ctx.fillText(bt, bx + 9, byy + 14);
      }
      ly += TH + 14;
      lt('강화 ' + STAGE_LABEL[state.stage] + '    확장 ' + expLabel + (formLabel ? '    ' + formLabel : ''),
        lx, ly + 4, '12px ' + F, CO.muted);
      ly += 16; rule(ly, lx, lR); ly += 14;

      // 파츠 슬롯 게이지 (근/중/원)
      lt('파츠 슬롯', lx, ly + 2, '700 12px ' + F, CO.muted); ly += 16;
      for (const [lb, used, max] of slotRows) {
        const rowY = ly;
        lt(lb, lx, rowY + 13, '13px ' + F, CO.text);
        lt(used + ' / ' + max, lx + 26, rowY + 13, '13px ' + F, used > max ? CO.bad : CO.muted);
        const bX = lx + 92, bW = lR - bX, bh = 12, bY = rowY + 2;
        const cells = Math.min(Math.max(max, used, 1), 20);
        const scale = cells / Math.max(max, used, 1);
        const filled = Math.round(used * scale), over = used > max;
        const cg = 2, cw = (bW - (cells - 1) * cg) / cells;
        if (draw) for (let i = 0; i < cells; i++) {
          ctx.fillStyle = i < filled ? (over ? CO.bad : slotOn) : track;
          ctx.fillRect(bX + i * (cw + cg), bY, cw, bh);
        }
        ly += 26;
      }
      ly += 4; rule(ly, lx, lR); ly += 12;

      // 장착 파츠 썸네일 그리드 (4열, LV 뱃지)
      lt('장착 파츠 ' + partItems.length, lx, ly + 2, '700 12px ' + F, CO.muted); ly += 16;
      if (!partItems.length) { lt('없음', lx, ly + 6, '13px ' + F, CO.dim); ly += 22; }
      else {
        const cols = 4, cg = 8, cw = (lR - lx - (cols - 1) * cg) / cols;
        const rows = Math.ceil(partItems.length / cols);
        partItems.forEach((it, i) => {
          const cx = lx + (i % cols) * (cw + cg), cy = ly + Math.floor(i / cols) * (cw + cg);
          box(cx, cy, cw, cw, 7);
          fit(it.im, cx + 3, cy + 3, cw - 6, cw - 6);
          if (it.lv && draw) {   // LV 뱃지 (우하단)
            ctx.font = '700 10px ' + F; const t = 'LV' + it.lv, w2 = ctx.measureText(t).width + 8;
            ctx.fillStyle = 'rgba(6,9,14,.82)'; rrect(cx + cw - w2 - 3, cy + cw - 17, w2, 14, 4); ctx.fill();
            ctx.fillStyle = CO.text; ctx.textAlign = 'left'; ctx.fillText(t, cx + cw - w2 + 1, cy + cw - 6);
          }
        });
        ly += rows * (cw + cg) - cg + 4;
      }
      leftBottom = ly;

      /* ═══ 우측 패널: 성능표 ═══ */
      const rxi = rightX + IP, rR = rightX + rightW - IP;
      let ry = panelTop + IP;
      const xTotalR = rxi + 150, xGainR = rxi + 236, barX = rxi + 250, barR = rR - 46, barW = barR - barX, xCapR = rR;
      lt('항목', rxi, ry + 11, '11px ' + F, CO.dim);
      rt('합계', xTotalR, ry + 11, '11px ' + F, CO.dim);
      rt('보정', xGainR, ry + 11, '11px ' + F, CO.dim);
      lt('그래프', barX, ry + 11, '11px ' + F, CO.dim);
      rt('상한', xCapR, ry + 11, '11px ' + F, CO.dim);
      ry += 18; rule(ry, rxi, rR); ry += 2;

      for (const k of C.STAT_KEYS) {
        const limit = r.currentLimits[k], raw = r.rawTotal[k], tot = r.total[k], soche = r.base[k];
        const skillGain = bare ? tot - bare.total[k] : 0;
        const gain = tot - soche, base = gain - skillGain;
        const over = limit !== Infinity && raw > limit ? raw - limit : 0;
        const scale = limit === Infinity ? Math.max(tot, soche, 1) * 1.15 : limit;
        const pct = v => Math.max(0, Math.min(1, v / scale));
        const baseW = pct(Math.min(soche, tot));
        const gainW = Math.min(1 - baseW, pct(Math.max(base, 0)));
        const skillW = Math.min(1 - baseW - gainW, pct(Math.max(skillGain, 0)));
        const atCap = limit !== Infinity && tot >= limit;
        const rowY = ry + 19;

        lt(C.STAT_LABEL[k], rxi, rowY, '13px ' + F, CO.text);
        rt((over ? '⚠ ' : '') + tot.toLocaleString(), xTotalR, rowY, '700 15px ' + F,
          over ? CO.close : atCap ? CO.accent : CO.text);
        if (draw) {   // 보정: 파츠(초록)+스킬(보라)
          ctx.textAlign = 'right'; let dx = xGainR;
          if (skillGain) { ctx.font = '700 13px ' + F; ctx.fillStyle = skillCol; ctx.fillText('+' + skillGain, dx, rowY); dx -= ctx.measureText('+' + skillGain).width + 5; }
          if (base !== 0) { ctx.font = '700 13px ' + F; ctx.fillStyle = base > 0 ? CO.ok : CO.bad; ctx.fillText((base > 0 ? '+' : '') + base.toLocaleString(), dx, rowY); }
          else if (!skillGain) { ctx.font = '13px ' + F; ctx.fillStyle = CO.dim; ctx.fillText('·', dx, rowY); }
          ctx.textAlign = 'left';
          // 막대: 회색 소체 + 초록 증가 + 보라 스킬, 트랙 위 (앱 성능표와 동일)
          const by = ry + 11, bh = 11;
          ctx.fillStyle = track; rrect(barX, by, barW, bh, 3); ctx.fill();
          let bx = barX; const seg = (w, c) => { if (w > 0.0005) { ctx.fillStyle = c; ctx.fillRect(bx, by, barW * w, bh); bx += barW * w; } };
          ctx.save(); rrect(barX, by, barW, bh, 3); ctx.clip();
          seg(baseW, CO.dim); seg(gainW, over ? CO.close : atCap ? CO.accent : CO.ok); seg(skillW, skillCol);
          ctx.restore();
          if (over) { ctx.font = '700 10px ' + F; ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText('OVER', barR - 4, by + 9); ctx.textAlign = 'left'; }
        }
        rt(limit === Infinity ? '—' : limit.toLocaleString(), xCapR, rowY, '13px ' + F, CO.dim);
        ry += 30;
      }

      ry += 2; rule(ry, rxi, rR); ry += 10;

      // 공격 지표 — 화면 성능표와 같은 '실효 보정'(보정에 피해% 를 접은 값).
      // 카드에 이 행이 아예 없어서, 파츠·스킬의 공격 % 효과가 이미지로는 보이지 않았다.
      {
        const ab = partAttackBonus(state.equipped, lv);
        lt('공격 지표', rxi, ry + 4, '700 12px ' + F, CO.muted);
        let ax = rxi + 78;
        for (const [key, lb, corr] of [['shoot', '사격', r.total.shoot], ['melee', '격투', r.total.meleeCorrection]]) {
          const mult = (1 + ab[key] / 100) * skillDmgPctList(key).reduce((s2, q) => s2 * (1 + q / 100), 1);
          const pct = Math.round((mult - 1) * 100);
          const eff = Math.round(((1 + corr / 100) * (1 + pct / 100) - 1) * 100);
          lt(lb, ax, ry + 4, '12px ' + F, CO.muted); ax += ctx.measureText(lb).width + 5;
          const v = eff.toLocaleString();
          lt(v, ax, ry + 4, '700 13px ' + F, CO.info); ax += (draw ? ctx.measureText(v).width : 40) + 5;
          if (pct !== 0) {
            const tg = '피해 ' + (pct > 0 ? '+' : '') + pct + '%';
            lt(tg, ax, ry + 4, '700 11px ' + F, pct < 0 ? CO.bad : CO.ok);
            ax += (draw ? ctx.measureText(tg).width : 52) + 14;
          } else ax += 14;
        }
        ry += 24;
      }

      lt('내구 지표', rxi, ry + 4, '700 12px ' + F, CO.muted);
      let dx = rxi + 78;
      // 화면과 같이 피해경감(파츠 % · 체크한 방어 스킬)을 실효 HP 에 접는다.
      // 이게 빠져 있어서 경감 파츠를 껴도 카드의 내구 지표가 경감 전 값으로 나갔다.
      const pngCuts = [...partDamageCuts(state.equipped, lv), ...boostBufferCuts(stg.cuts, state.equipped)];
      for (const [k, lb, dattr] of [['armorRange', '내실탄', 'solid'], ['armorBeam', '내빔', 'beam'], ['armorMelee', '내격투', 'melee']]) {
        lt(lb, dx, ry + 4, '12px ' + F, CO.muted); dx += ctx.measureText(lb).width + 5;
        const f = staggerDmgFactor(pngCuts, dattr);
        const v = Math.round(durabilityOf(r.total, k) / f).toLocaleString();
        lt(v, dx, ry + 4, '700 13px ' + F, CO.info); dx += (draw ? ctx.measureText(v).width : 48) + 5;
        if (f < 1) {
          const tg = '피해 -' + Math.round((1 - f) * 100) + '%';
          lt(tg, dx, ry + 4, '700 11px ' + F, CO.ok);
          dx += (draw ? ctx.measureText(tg).width : 52) + 9;
        } else dx += 13;
      }
      ry += 24;
      lt('누적치', rxi, ry + 4, '700 12px ' + F, CO.muted);
      lt('내성 ' + Math.round(stg.threshold / stg.mult) + '%    임계 ' + stg.threshold + '%'
        + (stg.mult < 1 ? '    받는 누적 ×' + (+stg.mult.toFixed(3)) : ''), rxi + 78, ry + 4, '13px ' + F, CO.text);
      ry += 20;
      // 스러스터 지표 — 성능표와 같은 값(부스트·풀회복·OH). 출격 가능한 환경만.
      {
        const thrV = r.total.thruster || 0;
        const sec1 = v => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '초';
        for (const [env, lb] of [['ground', '지상'], ['space', '우주']]) {
          if (env === 'ground' && m['出撃_地上可'] === false) continue;
          if (env === 'space' && m['出撃_宇宙可'] === false) continue;
          const tm = thrusterMetrics(m, thrV, state.equipped, env);
          if (!tm) continue;
          lt('스러스터 ' + lb, rxi, ry + 4, '700 12px ' + F, CO.muted);
          lt('부스트 ' + sec1(tm.boost) + '    풀회복 ' + sec1(tm.full) + '    OH ' + sec1(tm.oh),
            rxi + 96, ry + 4, '13px ' + F, CO.text);   // '스러스터 지상' 이 길어 78 이면 값과 붙는다
          ry += 20;
        }
      }
      if (skills.length) {
        ry += 8; rule(ry, rxi, rR); ry += 12;
        lt('발동 스킬', rxi, ry + 4, '700 12px ' + F, skillCol);
        const lines = wrapLines(ctx, skills.join('  ·  '), '13px ' + F, rR - (rxi + 78));
        lines.forEach((ln, i) => lt(ln, rxi + 78, ry + 4 + i * 19, '13px ' + F, CO.text));
        ry += Math.max(16, lines.length * 19);
      }
      rightBottom = ry;
    }

    // 1패스: 내용 높이 측정 (무장 패널은 전체 폭, 두 패널 아래)
    const measure = document.createElement('canvas').getContext('2d');
    content(measure, false);
    const panelH = Math.max(leftBottom, rightBottom) - panelTop + IP;
    const wpTop = panelTop + panelH + GAP;
    const wpRowH = 25, wpH = showW ? IP + 26 + 22 + weapons.length * wpRowH + IP - 8 : 0;
    const contentBottom = showW ? wpTop + wpH : panelTop + panelH;
    const footerY = contentBottom + 22;
    const H = Math.ceil(footerY + PAD - 6);

    // 2패스: 실제 렌더 (레티나 2배)
    const cvs = document.createElement('canvas');
    cvs.width = W * DPR; cvs.height = H * DPR;
    const ctx = cvs.getContext('2d');
    ctx.scale(DPR, DPR);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = CO.bg; ctx.fillRect(0, 0, W, H);
    // 패널 배경(둥근 모서리) 먼저
    const panelBg = (px, py, pw, ph) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 14); else ctx.rect(px, py, pw, ph);
      ctx.fillStyle = CO.panel; ctx.fill();
      ctx.strokeStyle = CO.line; ctx.lineWidth = 1; ctx.stroke();
    };
    panelBg(leftX, panelTop, leftW, panelH);
    panelBg(rightX, panelTop, rightW, panelH);
    if (showW) panelBg(PAD, wpTop, W - 2 * PAD, wpH);
    content(ctx, true);

    // 무장 피해 표 — 파츠 적용 무장표의 전체 컬럼
    if (showW) {
      const dtext = (t, x, y, font, color, align) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(t, x, y); ctx.textAlign = 'left'; };
      const dclip = (t, maxW, font) => { ctx.font = font; if (ctx.measureText(t).width <= maxW) return t; let s = t; while (s && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; };
      const wx0 = PAD + IP, wR = W - PAD - IP;
      // 컬럼 x (좌측정렬: 구분·이름·유형 / 우측정렬: 나머지)
      const cSec = wx0, dotX = wx0 + 52, cName = wx0 + 62, cType = wx0 + 300;
      const cNC = wx0 + 430, cCH = wx0 + 520, cCool = wx0 + 660, cAmmo = wx0 + 790, cStg = wx0 + 872, cRange = wx0 + 972, cRel = wR;
      let wy = wpTop + IP + 4;
      dtext('무장 내역', wx0, wy + 8, '700 13px ' + F, CO.text);
      dtext('(피해량은 파츠·스킬·자세 반영)', wx0 + 82, wy + 8, '11px ' + F, CO.dim);
      wy += 24;
      const hf = '11px ' + F;
      dtext('구분', cSec, wy + 8, hf, CO.dim);
      dtext('이름', cName, wy + 8, hf, CO.dim);
      dtext('유형', cType, wy + 8, hf, CO.dim);
      dtext('논차지', cNC, wy + 8, hf, CO.dim, 'right');
      dtext('풀차지', cCH, wy + 8, hf, CO.dim, 'right');
      dtext('쿨/발사', cCool, wy + 8, hf, CO.dim, 'right');
      dtext('탄/히트', cAmmo, wy + 8, hf, CO.dim, 'right');
      dtext('누적치', cStg, wy + 8, hf, CO.dim, 'right');
      dtext('사거리', cRange, wy + 8, hf, CO.dim, 'right');
      dtext('리로드/OH', cRel, wy + 8, hf, CO.dim, 'right');
      wy += 8; ctx.strokeStyle = CO.line; ctx.beginPath(); ctx.moveTo(wx0, wy + 0.5); ctx.lineTo(wR, wy + 0.5); ctx.stroke();
      wy += 4;
      const vf = '12px ' + F, vfb = '700 12px ' + F;
      weapons.forEach((wp, i) => {
        const ry = wy + 16 + i * wpRowH;
        const tc = wp.attr === 'melee' ? CO.close : wp.attr === 'beam' ? CO.info
          : wp.attr === 'shield' ? CO.long : wp.attr === 'solid' ? CO.accent : CO.mid;
        dtext(wp.sec, cSec, ry, '11px ' + F, CO.muted);
        ctx.fillStyle = tc; ctx.beginPath(); ctx.arc(dotX, ry - 4, 3.5, 0, 7); ctx.fill();
        // 고정 피해·디버프는 이름 뒤에 작은 태그로. 태그 폭만큼 이름을 먼저 줄인다.
        // 카드는 폭이 빠듯해 합계까지 넣으면 무장 이름이 잘린다.
        // 나눠 들어간다는 사실이 핵심이라 1틱×히트만 싣는다(무장 표에는 합계도 함께 나온다).
        const fxTag = wp.fx
          ? (wp.fx.hits > 1
            ? '고정 ' + wp.fx.per.toLocaleString() + '×' + wp.fx.hits
            : '고정 ' + wp.fx.total.toLocaleString())
          : '';
        const tag = [fxTag, ...(wp.debuffs || [])]
          .filter(Boolean).join(' · ');
        ctx.font = '10px ' + F;
        const tagW = tag ? ctx.measureText(tag).width + 6 : 0;
        const nmTxt = dclip(wp.name, cType - cName - 10 - tagW, vf);
        dtext(nmTxt, cName, ry, vf, CO.text);
        if (tag) {
          ctx.font = vf;
          dtext(tag, cName + ctx.measureText(nmTxt).width + 6, ry, '10px ' + F, CO.close);
        }
        dtext(wp.kind, cType, ry, vf, tc);
        dtext(wp.nc ? wp.nc.one.toLocaleString() : '—', cNC, ry, vfb, wp.nc ? CO.text : CO.dim, 'right');
        dtext(wp.ch ? wp.ch.one.toLocaleString() : '—', cCH, ry, vf, wp.ch ? CO.text : CO.dim, 'right');
        dtext(wp.cool, cCool, ry, vf, wp.cool === '—' ? CO.dim : CO.muted, 'right');
        dtext(wp.ammo, cAmmo, ry, vf, wp.ammo === '—' ? CO.dim : CO.muted, 'right');
        dtext(wp.stagger, cStg, ry, vf, wp.stagger === '—' ? CO.dim : CO.muted, 'right');
        dtext(wp.range, cRange, ry, vf, wp.range === '—' ? CO.dim : CO.muted, 'right');
        dtext(wp.reload, cRel, ry, vf, wp.reload === '—' ? CO.dim : CO.muted, 'right');
      });
    }

    // 푸터
    ctx.fillStyle = CO.dim; ctx.font = '11px ' + F;
    ctx.textAlign = 'left'; ctx.fillText('GBO2 커스텀 파츠 시뮬레이터', PAD, footerY);
    ctx.textAlign = 'right'; ctx.fillText(new Date().toISOString().slice(0, 10), W - PAD, footerY);
    ctx.textAlign = 'left';

    // T.msName 은 이미 「… LV2」 로 끝난다 — 그대로 붙이면 「문 건담 LV2_LV2」 가 된다.
    const safe = T.msName(m.MS名).replace(/\s*LV\d+$/, '').replace(/[\\/:*?"<>|]/g, '')
      + '_LV' + lv + (showW ? '_상세' : '');
    // 안드로이드 앱(WebView)은 blob 다운로드가 동작하지 않아 파일이 저장되지 않는다.
    // → 네이티브 브리지로 base64 를 넘겨 기기 Download 폴더에 직접 저장한다(성공/실패 토스트는 네이티브가).
    // 예전엔 곧바로 내려받아, 어떤 카드가 나왔는지 파일을 열어 봐야 알 수 있었다.
    // 먼저 보여 주고 저장/복사를 고르게 한다.
    openPngPreview(cvs, safe);
  }

  /* ---------- 이미지 미리보기 ---------- */
  let pngShot = null;                       // { canvas, name }

  function openPngModal(open) {
    const m = document.getElementById('pngModal'), b = document.getElementById('pngModalBack');
    if (m) m.hidden = !open;
    if (b) b.hidden = !open;
    if (!open) { const box = document.getElementById('pngPreview'); if (box) box.innerHTML = ''; pngShot = null; }
  }

  function openPngPreview(cvs, name) {
    pngShot = { cvs, name };
    const box = $('#pngPreview');
    box.innerHTML = '';
    const img = el('img');
    img.src = cvs.toDataURL('image/png');
    img.alt = name;
    box.append(img);
    $('#pngNote').textContent = name + '.png · ' + cvs.width + '×' + cvs.height;
    $('#pngCopy').hidden = !(navigator.clipboard && window.ClipboardItem);
    openPngModal(true);
  }

  /** 캔버스를 파일로 저장 — 안드로이드는 앱 브리지로 다운로드 폴더에 넣는다. */
  function savePngShot() {
    if (!pngShot) return;
    const { cvs, name } = pngShot;
    if (window.AndroidBridge && typeof window.AndroidBridge.saveImage === 'function') {
      try { window.AndroidBridge.saveImage(cvs.toDataURL('image/png'), name + '.png'); }
      catch (e) { toast('이미지 저장에 실패했습니다'); }
      return;
    }
    cvs.toBlob(blob => {
      if (!blob) { toast('이미지 생성에 실패했습니다'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name + '.png';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('이미지를 저장했습니다: ' + name + '.png');
    }, 'image/png');
  }

  /** 클립보드로 — 채팅창에 바로 붙여넣을 수 있다. 지원 안 하면 버튼 자체를 숨긴다. */
  function copyPngShot() {
    if (!pngShot || !navigator.clipboard || !window.ClipboardItem) return;
    pngShot.cvs.toBlob(async blob => {
      if (!blob) { toast('이미지 생성에 실패했습니다'); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('이미지를 복사했습니다 — 붙여넣기로 바로 쓸 수 있습니다');
      } catch (e) {
        toast('복사가 막혀 있습니다 — 저장 후 쓰세요');
      }
    }, 'image/png');
  }

  /* ---------- 파츠 목록 ---------- */

  /**
   * 화면에 뿌릴 파츠와 그 장착 판정을 함께 돌려준다.
   * 판정은 정렬과 렌더 양쪽에서 쓰이므로 여기서 한 번만 계산한다.
   */
  // 필터(탭·검색·기체)별로 순서를 '한 번만' 고정한다. 장착/해제해도 타일이 안 움직여야
  // 모바일에서 연속 탭 시 손가락 밑 타일이 바뀌어 엉뚱한 파츠가 장착되는 일이 없다.
  let partOrderKey = null, partOrder = [];
  function visibleParts() {
    const q = state.partQuery.trim().toLowerCase();
    let list = state.partTab === C.CATEGORY_ALL ? allParts : partsByCat[state.partTab];
    if (q) list = list.filter(p => partSearchText.get(p).includes(q));

    const s = slots();
    const rowOf = p => {
      const isEquipped = state.equipped.some(e => e.name === p.name);
      const banned = state.banned.has(p.name);
      // 기본 제외한 파츠는 장착 불가로 취급한다 (사유도 그렇게 보여 준다)
      const chk = banned ? { ok: false, code: 'banned', param: null }
        : state.ms ? C.checkEquip(p, state.ms, state.equipped, s) : { ok: false, code: null };
      return { p, isEquipped, chk, banned, blocked: !isEquipped && !chk.ok };
    };

    const key = state.partTab + ' ' + q + ' ' + (state.ms ? state.ms.MS名 : '');
    if (key !== partOrderKey) {
      // 필터/기체가 바뀔 때만 '장착 가능→장착 중→불가' 로 정렬해 순서를 고정한다.
      const rank = r => (r.isEquipped ? 1 : r.chk.ok ? 0 : 2);
      partOrder = list.map(rowOf).sort((a, b) => rank(a) - rank(b)).map(r => r.p);
      partOrderKey = key;
    } else {
      // 같은 필터 안에서는 순서 유지(빠진 건 제거, 새로 든 건 뒤에).
      const set = new Set(list), have = new Set(partOrder);
      partOrder = partOrder.filter(p => set.has(p));
      for (const p of list) if (!have.has(p)) partOrder.push(p);
    }
    return partOrder.map(rowOf);
  }

  // 파츠 타일은 159개로 고정이라 한 번 만들어 두고 상태만 갱신한다.
  // (매 장착마다 DOM·이미지를 새로 만들지 않아 깜빡임과 재로딩이 없다)
  const tileCache = new Map();

  function createTile(p) {
    const v = partView(p);
    const tile = el('div', 'part-tile');
    tile.title = `${v.fullNm}\n${v.cat} · ${v.slotTxt}\n\n${v.desc}`;

    const thumb = el('div', 'pt-thumb');
    thumb.append(img(partImg(p.name), 'parts', p.name));
    if (v.lv) thumb.append(el('span', 'pt-lv', 'LV' + v.lv));
    const hint = el('span', 'pt-hint');
    thumb.append(hint);
    tile.append(thumb);
    tile.append(el('div', 'pt-nm', v.shortNm));
    const why = el('div', 'pt-why');
    tile.append(why);

    // 핸들러는 만들 때 한 번만 붙이고, 판정은 그때그때 최신 상태에서 읽는다.
    tile.onmouseenter = () => { state.detailPart = p; renderDetail(p); };
    tile.onclick = ev => {
      const fired = entryLp.get(tile);
      if (fired && fired()) return;              // 길게 눌러 메뉴를 연 것 — 장착까지 하지 않는다
      if (ev.shiftKey) { toast(v.fullNm + ' — ' + (v.desc || '설명 없음')); return; }
      state.detailPart = p;
      if (state.equipped.some(e => e.name === p.name)) unequip(p.name);
      else equip(p);
    };
    tile.oncontextmenu = ev => {
      ev.preventDefault();
      state.detailPart = p;
      toggleBan(p);
    };
    // 폰엔 우클릭도 hover 도 없어 '기본 제외'와 '장착 없이 상세만 보기'에 닿을 길이 없었다.
    // 길게 누르기(0.5초, 손가락이 10px 넘게 움직이면 취소)로 같은 것을 연다.
    let lpTimer = null, lpFired = false, lpXY = null;
    const lpCancel = () => { clearTimeout(lpTimer); lpTimer = null; };
    tile.addEventListener('touchstart', ev => {
      const t = ev.touches[0]; lpXY = [t.clientX, t.clientY]; lpFired = false;
      lpTimer = setTimeout(() => {
        lpFired = true;
        if (navigator.vibrate) navigator.vibrate(12);
        openTileMenu(p, v, lpXY);
      }, 500);
    }, { passive: true });
    tile.addEventListener('touchmove', ev => {
      if (!lpTimer) return;
      const t = ev.touches[0];
      if (Math.abs(t.clientX - lpXY[0]) > 10 || Math.abs(t.clientY - lpXY[1]) > 10) lpCancel();
    }, { passive: true });
    tile.addEventListener('touchend', lpCancel, { passive: true });
    tile.addEventListener('touchcancel', lpCancel, { passive: true });
    tile.dataset.lp = '1';
    entryLp.set(tile, () => lpFired);

    const entry = { tile, hint, why };
    tileCache.set(p, entry);
    return entry;
  }

  const entryLp = new WeakMap();     // 타일 → '방금 길게 눌렀는가' 판정
  /** 파츠 타일 길게 누르기 메뉴 — 데스크톱 우클릭과 같은 것을 폰에서 연다. */
  function openTileMenu(p, v, xy) {
    document.querySelectorAll('.png-menu').forEach(m => m.remove());
    const menu = el('div', 'png-menu tile-menu');
    const mk = (t, sub, fn) => {
      const b = el('button', 'png-menu-item');
      b.append(el('span', 'pm-t', t));
      if (sub) b.append(el('span', 'pm-s', sub));
      b.onclick = () => { menu.remove(); fn(); };
      return b;
    };
    menu.append(el('div', 'tile-menu-hd', v.fullNm));
    menu.append(mk('상세 보기', v.cat + ' · ' + v.slotTxt, () => {
      state.detailPart = p; renderDetail(p);
      const d = $('#detailPanel'); if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }));
    const banned = state.banned.has(p.name);
    menu.append(mk(banned ? '기본 제외 해제' : '기본 제외',
      banned ? '목록·자동 구성에 다시 넣는다' : '자동 구성·장착에서 빼 둔다', () => toggleBan(p)));
    document.body.append(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(6, Math.min(xy[0] - mw / 2, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.max(safeTop() + 6, Math.min(xy[1] + 10, window.innerHeight - mh - 8)) + 'px';
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
    }), 0);
  }

  function renderPartList() {
    const box = $('#partList');
    const keepScroll = box.scrollTop;      // 장착/해제 후에도 보던 위치를 유지
    const rows = visibleParts();

    if (!rows.length) {
      box.replaceChildren(el('div', 'empty-state', '검색 결과가 없습니다.'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const { p, isEquipped, chk, blocked, banned } of rows) {
      const t = tileCache.get(p) || createTile(p);
      t.tile.className = 'part-tile'
        + (isEquipped ? ' on' : '')
        + (blocked ? ' blocked' : '')
        + (banned ? ' banned' : '');
      // 호버 힌트: 장착 가능/해제일 때만 (불가면 비워 둔다)
      t.hint.className = 'pt-hint' + (isEquipped ? ' rm' : '') + (blocked ? ' off' : '');
      t.hint.textContent = blocked ? '' : (isEquipped ? '해제' : '장비 가능');
      t.why.textContent = blocked && chk.code ? reasonText(chk) : '';
      frag.append(t.tile);              // 기존 노드를 옮길 뿐, 새로 만들지 않는다
    }
    box.replaceChildren(frag);
    fitWholeRows(box);
    box.scrollTop = keepScroll;
  }

  /**
   * 목록 높이를 줄 경계에 맞춘다 — 마지막 줄이 반쯤 잘려 보이지 않게.
   * 타일 높이가 제각각(장착 불가 사유가 붙으면 더 커진다)이라 고정 계산이 아니라
   * 실제 배치된 위치를 읽어 "예산(max-height) 안에 온전히 들어가는 마지막 줄"을 찾는다.
   */
  function fitWholeRows(box) {
    box.style.height = '';                       // 예산을 다시 재려면 먼저 비운다
    // 화면이 숨겨져 있으면 좌표가 전부 0이라 계산할 수 없다 (보이게 된 뒤 다시 부른다)
    if (!box.offsetParent) return;
    const cs = getComputedStyle(box);
    const budget = parseFloat(cs.maxHeight);
    if (!isFinite(budget)) return;
    const padBottom = parseFloat(cs.paddingBottom) || 0;

    // 같은 줄에 놓인 타일끼리 묶어 줄마다 가장 아래 지점을 구한다
    const rowBottom = new Map();
    for (const t of box.children) {
      const top = t.offsetTop;
      rowBottom.set(top, Math.max(rowBottom.get(top) || 0, top + t.offsetHeight));
    }

    let fit = 0, nextTop = null, rows = 0;
    const MAX_ROWS = 3;   // 파츠 목록은 최대 3행만 보이고, 그 이상은 스크롤
    for (const [top, bottom] of [...rowBottom].sort((a, b) => a[0] - b[0])) {
      if (rows >= MAX_ROWS || bottom + padBottom > budget) { nextTop = top; break; }   // 2행 넘거나 예산 초과면 끊는다
      fit = bottom; rows++;
    }
    if (!fit) return;
    // 아래 여백이 줄 간격보다 넓으면 다음 줄 윗머리가 비어져 나오므로 그 앞에서 끊는다
    const h = nextTop == null ? fit + padBottom : Math.min(fit + padBottom, nextTop);
    box.style.height = h + 'px';
  }

  function renderBannedCount() {
    const n = state.banned.size;
    updateOwnedUi();   // 우클릭·초기화 등 어떤 경로로 바뀌어도 버튼 배지를 맞춘다
    const box = $('#bannedCount');
    box.innerHTML = '';
    if (!n) return;
    box.append(el('span', 'note', `기본 제외 ${n}개`));
    const btn = el('button', 'btn-ghost', '초기화');
    btn.style.padding = '1px 7px';
    btn.style.fontSize = '11px';
    btn.onclick = () => { state.banned.clear(); saveBanned(); renderAll(); };
    box.append(btn);
  }

  /* ---------- 자동 구성 ---------- */

  // 파생 지표 목표 — 공격=실효 보정, 내구=실효 내성(armor 단위). % 파츠를 반영한 "체감 스탯"을 원시 스탯과 같은 단위로 목표 지정.
  const DERIVED_KEYS = ['effShoot', 'effMelee', 'durSolid', 'durBeam', 'durMelee'];
  const DERIVED_LABEL = { effShoot: '공격 사격', effMelee: '공격 격투', durSolid: '내구 실탄', durBeam: '내구 빔', durMelee: '내구 격투' };

  /** 파츠 집합의 파생 지표(공격 지표·내구 지표) — 성능표와 동일 계산. */
  function derivedMetrics(equipped, total) {
    const lv = msLevel(state.ms);
    const atkB = partAttackBonus(equipped, lv);
    const eff = (corr, key) => {
      const mul = (1 + atkB[key] / 100) * skillDmgPctList(key).reduce((m, p) => m * (1 + p / 100), 1);
      return Math.round(((1 + corr / 100) * mul - 1) * 100);
    };
    const cuts = [...partDamageCuts(equipped, lv), ...boostBufferCuts(activeStaggerMods(state.ms, lv).cuts, equipped)];
    // 내구 지표 = 실효 내성(armor 단위). 내성값과 피해경감 %를 합쳐 "체감 내성"으로 환산한다.
    // 예: armor 40 + 피해경감 10% → 100×(1 − 0.6×0.9) = 46. 목표 '50'을 armor처럼 지정.
    const dur = (key, dattr) => {
      const a = Math.min(total[key] || 0, 99);
      return Math.round(100 * (1 - (1 - a / 100) * staggerDmgFactor(cuts, dattr)));
    };
    return {
      effShoot: eff(total.shoot, 'shoot'), effMelee: eff(total.meleeCorrection, 'melee'),
      durSolid: dur('armorRange', 'solid'), durBeam: dur('armorBeam', 'beam'), durMelee: dur('armorMelee', 'melee')
    };
  }

  function renderAutoGrid() {
    const box = $('#autoGrid');
    box.innerHTML = '';
    box.append(el('div', 'hd', '스탯'), el('div', 'hd', '가중치'), el('div', 'hd', '하한 목표'), el('div', 'hd', '상한 목표'));

    // 하한·상한 목표 입력 한 칸을 만든다 (store = state.minimums / state.maximums)
    const targetInput = (store, k) => {
      const m = el('input');
      m.type = 'number'; m.placeholder = '—';
      m.value = store[k] ?? '';
      m.oninput = () => {
        const v = Number(m.value);
        if (m.value === '' || isNaN(v)) delete store[k];
        else store[k] = v;
        state.weightsTouched = true;
      };
      return m;
    };

    for (const k of C.STAT_KEYS) {
      box.append(el('div', 'lb', C.STAT_LABEL[k]));

      const w = el('input');
      w.type = 'number'; w.step = '0.5'; w.min = '0';
      w.value = state.weights[k] ?? 0;
      // 0 보다 큰 항목에 테두리 강조 — 어떤 스탯을 노리는지 한눈에 보이게
      const mark = () => w.classList.toggle('active', Number(w.value) > 0);
      mark();
      w.oninput = () => { state.weights[k] = Number(w.value) || 0; state.weightsTouched = true; mark(); };
      box.append(w);

      box.append(targetInput(state.minimums, k));
      box.append(targetInput(state.maximums, k));
    }

    // 파생 지표 목표 (가중치 없음, 하한/상한만) — 공격 지표(실효 보정)·내구 지표(실효 HP)
    box.append(el('div', 'auto-sep', '실효 지표 목표 — 공격=실효 보정 · 내구=실효 내성 (% 파츠 반영, 스탯과 같은 단위)'));
    for (const k of DERIVED_KEYS) {
      box.append(el('div', 'lb', DERIVED_LABEL[k]));
      box.append(el('div', 'lb dim', '—'));               // 가중치 없음
      box.append(targetInput(state.minimums, k));
      box.append(targetInput(state.maximums, k));
    }
  }

  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

  async function runAuto() {
    if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
    if (state.running) return;

    state.running = true;
    const btn = $('#runAuto');
    btn.disabled = true;
    const rounds = Number($('#effort').value);
    const bar = $('#progressBar');
    $('#autoNote').textContent = '탐색 중…';

    try {
    const opts = {
      stage: state.stage,
      expansion: state.expansion,
      expLevel: state.expLevel,
      weights: state.weights,
      minimums: state.minimums,
      maximums: state.maximums,
      locked: [...state.locked],
      banned: [...state.banned],   // 기본 제외한 파츠는 자동 구성에서도 빠진다
      skill: skillStatBonus(),      // 스킬을 켠 상태면 그 보정까지 감안해 구성한다
      restarts: 1
    };
    // 파생 지표(공격 지표·내구 지표) 목표가 하나라도 있으면 계산 훅을 넘긴다 (없으면 오버헤드 0).
    if ([...Object.keys(state.minimums), ...Object.keys(state.maximums)].some(k => DERIVED_KEYS.includes(k)))
      opts.derived = (set, total) => derivedMetrics(set, total);

    // 후보를 "상충 축"으로 나눠 대표 빌드를 함께 낸다(공격형/내구형/균형).
    //  - 가중치를 안 만졌으면 프로필 3종(밸런스·공격·방어)을 그대로 목표로.
    //  - 만졌으면 내 가중치를 1순위 목표로 두되, 공격·방어 축 프로필을 곁들여 트레이드오프 선택지를 보장한다.
    const objectives = state.weightsTouched
      ? [{ name: '내 가중치', weights: state.weights }, ...autoProfiles(state.ms).filter(p => p.name !== '밸런스')]
      : autoProfiles(state.ms);
    // 확장 스킬을 사용자가 안 정했으면(확장 없음) 확장별로 실제 구성을 만들어 비교해 고른다.
    // (최적화 점수는 "파츠 증가분"만 재서 확장의 고정 보너스를 못 보므로, 절대 가중총점으로 비교한다)
    const autoExp = state.expansion === C.EXPANSION_NONE;
    state.autoExpansion = autoExp;
    const expList = autoExp
      ? Object.keys(C.EXPANSION_LEVELS).concat([C.EXPANSION_NONE])
      : [state.expansion];
    const expLevel = autoExp ? C.MAX_EXPANSION_LEVEL : state.expLevel;

    // 절대 가중총점 — 확장의 고정 보너스까지 반영된다
    const absScore = (tot, w) => C.STAT_KEYS.reduce((s, k) => s + (w[k] || 0) * (tot[k] || 0) / (O.UNIT[k] || 1), 0);

    // 확장을 고르는 방식:
    //   고정형(사격보정 확장 등)은 파츠 선택을 바꾸지 않으므로 기준 셋에 얹어(calcStats) 싸게 평가.
    //   파츠당(per: 파츠확장[HP]·[장갑] 등)은 그 확장에 맞는 파츠(특히 보조)를 끌어와야 이득이 나므로
    //   따로 재최적화해서 공정하게 비교한다. 안 그러면 보조 계열 확장이 늘 과소평가된다.
    const isPer = e => C.EXPANSION_LEVELS[e] && C.EXPANSION_LEVELS[e][C.EXPANSION_LEVELS[e].length - 1].per;
    const perExps = autoExp ? expList.filter(isPer) : [];
    // 최대 10개까지 뽑으려면 후보 풀을 넉넉히 만든다.
    // 지정 목표: 그 가중치로 여러 번 재시작 / 임의 목표: 프로필당 상위 몇 개씩
    const optRounds = Math.max(3, Math.ceil(rounds / 3));
    const total = objectives.length * (1 + perExps.length + optRounds);
    let evals = 0, step = 0;
    const cands = [];
    const opt = (weights, exp, seed, iters) => {
      const r = O.optimize(state.ms, { ...opts, weights, expansion: exp, expLevel, seed, iters }, partsByCat, fullst);
      evals += r.evaluations || 0;
      // usedWeights: '왜 이 파츠?' 기여도 계산에 그 후보를 만든 가중치를 쓴다.
      if (r.parts.length || r.feasible) { r.expansion = exp; r.expLevel = expLevel; r.usedWeights = weights; r.abs = absScore(r.stats.total, weights); }
      return r;
    };
    const yieldMaybe = async () => { bar.style.width = (++step / total * 100) + '%'; if (step % 3 === 0) await nextFrame(); };

    for (const obj of objectives) {
      // 1) 기준 셋 (확장 없이) — 고정형 확장 평가의 바탕. 스캔이라 반복을 줄여 빠르게.
      const base = opt(obj.weights, C.EXPANSION_NONE, 7919, 25);
      await yieldMaybe();

      let exp = state.expansion;
      if (autoExp && base.parts.length) {
        // 고정형: 기준 셋에 얹어 절대총점 비교 (파츠 선택을 안 바꾸므로 재최적화 불필요)
        let bestAbs = -1e9;
        for (const e of expList) {
          if (isPer(e)) continue;
          const st = C.calcStats(state.ms, base.parts, state.stage, e, partsByCat, fullst, expLevel, null, opts.skill);
          const a = absScore(st.total, obj.weights);
          if (a > bestAbs) { bestAbs = a; exp = e; }
        }
        // 파츠당: 각각 재최적화(빠른 스캔)해서 비교 — 보조 계열 파츠를 끌어와야 이득이 난다
        for (const e of perExps) {
          const r = opt(obj.weights, e, 7919 * 2, 25);
          await yieldMaybe();
          if ((r.parts.length || r.feasible) && r.abs > bestAbs) { bestAbs = r.abs; exp = e; }
        }
      }

      // 2) 고른 확장으로 제대로 다시 최적화 (풀 반복)
      const results = [];
      for (let i = 0; i < optRounds; i++) {
        const r = opt(obj.weights, exp, (i + 3) * 7919);
        if (r.parts.length || r.feasible) results.push(r);
        await yieldMaybe();
      }
      // 각 목표(축)의 최고 후보에 라벨을 달아 대표 빌드로 보이게 하고, 변형 몇 개를 함께 담는다.
      const top = topCandidates(results, 4);
      top.forEach((c, idx) => { if (idx === 0 && obj.name) c.label = obj.name; });
      cands.push(...top);
    }

    // 같은 구성은 하나만. 프로필 대표(라벨)를 앞에, 그다음 변형. 최대 10개.
    const seen = new Set();
    const key = c => c.parts.map(p => p.name).slice().sort().join('|');
    const dedup = arr => arr.filter(c => { const s = key(c); if (seen.has(s)) return false; seen.add(s); return true; });
    const picks = dedup([...cands.filter(c => c.label), ...cands.filter(c => !c.label)]).slice(0, 10);

    state.autoCandidates = picks;
    state.autoShown = Math.min(3, picks.length);   // 처음엔 3개, 더보기로 최대 10개
    state.autoApplied = 0;
    const note = $('#autoNote');
    if (!picks.length) { note.className = 'note mt'; note.textContent = '구성을 찾지 못했습니다.'; return; }
    note.className = 'note mt';
    note.textContent = `후보 ${picks.length}개를 찾았습니다.`;
    $('#autoModalNote').textContent = `후보 ${picks.length}개 · 평가 ${evals.toLocaleString()}회 — 원하는 구성을 고르세요`;
    renderAutoDiag(picks);
    renderAutoResults(picks);
    applyCandidate(0);   // 가장 좋은 후보를 우선 적용해 두고, 다른 것도 고를 수 있게 한다
    openDrawer(false);   // 결과는 화면 중앙 모달로 보여 준다
    openResultModal(true);
    } finally {          // 예외가 나도 버튼이 영구 비활성으로 남지 않게 한다
      state.running = false;
      btn.disabled = false;
      bar.style.width = '0';
    }
  }

  /**
   * 가중치를 안 정했을 때 쓸 3가지 목표. 기체 성향(사격/격투)에 맞춰 공격 방향을 정한다.
   */
  function autoProfiles(ms) {
    const melee = Number(ms && ms.格闘補正 || 0) >= Number(ms && ms.射撃補正 || 0);
    // 공격 프로필은 HP 가중치를 빼야 공격 보정·확장이 뽑힌다 (HP 는 절대치가 커서 총점을 지배한다)
    return [
      { name: '밸런스', weights: O.PRESETS['밸런스'] },
      melee
        ? { name: '격투 중심', weights: { meleeCorrection: 4, speed: 1.5, thruster: 1.5, highSpeedMovement: 1 } }
        : { name: '사격 중심', weights: { shoot: 4, thruster: 1, armorBeam: 0.5, armorRange: 0.5 } },
      { name: '방어형', weights: { hp: 3, armorRange: 2, armorBeam: 2, armorMelee: 2, thruster: 0.5 } }
    ];
  }

  /** 결과에서 서로 겹치지 않는 상위 후보를 고른다 (파츠가 1개 이하만 다르면 같은 구성으로 본다). */
  function topCandidates(results, n) {
    const rank = r => (r.abs != null ? r.abs : r.score);   // 확장 비교엔 절대 총점, 없으면 점수
    const sig = r => r.parts.map(p => p.name).slice().sort().join('|');
    const seen = new Set();
    const uniq = results.slice().sort((a, b) => rank(b) - rank(a))
      .filter(r => { const s = sig(r); if (seen.has(s)) return false; seen.add(s); return true; });

    const picks = [];
    const differs = (a, b) => {
      const A = new Set(a.parts.map(p => p.name));
      let common = 0;
      for (const p of b.parts) if (A.has(p.name)) common++;
      return Math.max(a.parts.length, b.parts.length) - common >= 2;   // 2개 이상 달라야 다른 구성
    };
    for (const r of uniq) {
      if (picks.length >= n) break;
      if (picks.every(p => differs(p, r))) picks.push(r);
    }
    for (const r of uniq) { if (picks.length >= n) break; if (!picks.includes(r)) picks.push(r); }
    return picks;
  }

  /** 후보의 목표 지표 값 — 원시 스탯은 total, 파생 지표는 derivedMetrics 로 (후보에 캐시). */
  // 파생값은 현재 상태(스킬·누적치)에 의존하므로 캐시하지 않고 그때그때 계산한다
  // (후보 수가 적어 비용이 무시할 만하고, 상태 변경 시 값이 낡지 않는다).
  function candValue(c, key) {
    if (DERIVED_KEYS.includes(key)) return derivedMetrics(c.parts, c.stats.total)[key];
    return c.stats.total[key] ?? 0;
  }

  /** 후보의 공격·내구 축 요약값 (트레이드오프를 카드에 보이기 위한 대표 수치). */
  function axisSummary(c) {
    const dv = derivedMetrics(c.parts, c.stats.total);
    return {
      atk: Math.max(dv.effShoot, dv.effMelee),
      def: Math.round((dv.durSolid + dv.durBeam + dv.durMelee) / 3)
    };
  }

  /** 목표 진단 — 어떤 후보로도 못 미치는 목표를 "달성 가능한 최댓값"과 함께 알려 준다. */
  function renderAutoDiag(picks) {
    const box = document.getElementById('autoDiag');
    if (!box) return;
    const label = k => DERIVED_KEYS.includes(k) ? DERIVED_LABEL[k] : C.STAT_LABEL[k];
    const targets = [
      ...Object.entries(state.minimums).filter(([, v]) => v).map(([k, v]) => ({ k, v, kind: 'min' })),
      ...Object.entries(state.maximums).filter(([, v]) => v != null && v !== '').map(([k, v]) => ({ k, v, kind: 'max' }))
    ];
    box.innerHTML = '';
    if (!targets.length || !picks.length) { box.hidden = true; return; }
    const rows = [];
    for (const t of targets) {
      const vals = picks.map(c => candValue(c, t.k));
      const ok = t.kind === 'min' ? vals.some(v => v >= t.v) : vals.some(v => v <= t.v);
      if (ok) continue;
      rows.push({ t, best: t.kind === 'min' ? Math.max(...vals) : Math.min(...vals) });
    }
    box.hidden = false;
    if (!rows.length) { box.append(el('div', 'diag-ok', '✓ 지정한 목표를 만족하는 후보를 찾았습니다.')); return; }
    box.append(el('div', 'diag-head', '⚠ 아래 목표는 어떤 구성으로도 달성하지 못했습니다 — 도달 가능한 최댓값:'));
    for (const { t, best } of rows) {
      const row = el('div', 'diag-row');
      row.append(el('span', 'diag-k', label(t.k)));
      row.append(el('span', 'diag-msg', `목표 ${t.v} ${t.kind === 'min' ? '이상' : '이하'} → 최대 ${best.toLocaleString()} 까지 (가용 파츠·이 기체 상한 한계)`));
      box.append(row);
    }
  }

  /** '왜 이 파츠?' — 각 파츠를 뺐을 때의 가중총점 하락(기여도)과 주요 상승 스탯. */
  // 스탯 → 역할군 (막대색·태그용)
  const CONTRIB_ROLE = {
    hp: 'def', armorRange: 'def', armorBeam: 'def', armorMelee: 'def',
    shoot: 'atk', meleeCorrection: 'atk',
    speed: 'mob', highSpeedMovement: 'mob', thruster: 'mob',
    turnPerformanceGround: 'mob', turnPerformanceSpace: 'mob'
  };
  const ROLE_LABEL = { def: '내구', atk: '공격', mob: '기동' };

  function partContributions(c) {
    const w = c.usedWeights || state.weights;
    const exp = c.expansion || state.expansion;
    const expLv = c.expLevel || state.expLevel;
    const skill = skillStatBonus();
    const full = c.stats.total;
    const fullDv = derivedMetrics(c.parts, full);   // 전체 구성의 실효 지표 (한 번만)
    // 가중치를 하나도 안 준 경우엔 모든 스탯을 동일 가중(1)으로 본다.
    const anyW = C.STAT_KEYS.some(k => (w[k] || 0) > 0);
    const wScore = tot => C.STAT_KEYS.reduce((s, k) => s + (anyW ? (w[k] || 0) : 1) * (tot[k] || 0) / (O.UNIT[k] || 1), 0);
    const fullScore = wScore(full);
    // 지정한 목표들 (파츠별 '목표 필수' 판정용)
    const targets = [
      ...Object.entries(state.minimums).filter(([, v]) => v).map(([k, v]) => ({ k, v: +v, kind: 'min' })),
      ...Object.entries(state.maximums).filter(([, v]) => v != null && v !== '').map(([k, v]) => ({ k, v: +v, kind: 'max' }))
    ];
    const tLabel = k => DERIVED_KEYS.includes(k) ? DERIVED_LABEL[k] : C.STAT_LABEL[k];
    const effShort = k => DERIVED_LABEL[k].replace(/^(공격|내구)\s*/, '');   // '내구 빔'→'빔'

    const out = c.parts.map(p => {
      const without = c.parts.filter(q => q.name !== p.name);
      const st = C.calcStats(state.ms, without, state.stage, exp, partsByCat, fullst, expLv, null, skill).total;
      const woDv = derivedMetrics(without, st);
      // 원시 스탯 상승분
      const rawDiffs = C.STAT_KEYS.map(k => ({ k, d: (full[k] || 0) - (st[k] || 0) })).filter(x => x.d > 0).sort((a, b) => b.d - a.d);
      // 실효 지표 상승분 (피해경감·피해% 파츠는 원시 스탯이 안 올라도 여기서 드러난다)
      const effDiffs = DERIVED_KEYS.map(k => ({ k, d: fullDv[k] - woDv[k] })).filter(x => x.d >= 1).sort((a, b) => b.d - a.d);
      // 역할: 정규화 기여가 가장 큰 군 (원시 없으면 실효로 판정)
      const roleScore = {};
      for (const { k, d } of rawDiffs) { const r = CONTRIB_ROLE[k]; if (r) roleScore[r] = (roleScore[r] || 0) + d / (O.UNIT[k] || 1); }
      if (!rawDiffs.length) for (const { k, d } of effDiffs) { const r = k.indexOf('dur') === 0 ? 'def' : 'atk'; roleScore[r] = (roleScore[r] || 0) + d; }
      let roleCls = null, best = 0;
      for (const r in roleScore) if (roleScore[r] > best) { best = roleScore[r]; roleCls = r; }
      // 목표 필수: 이 파츠를 빼면 (전체는 만족하던) 목표가 미달로 뒤집히는가
      const criticalFor = [];
      for (const t of targets) {
        const vFull = DERIVED_KEYS.includes(t.k) ? fullDv[t.k] : (full[t.k] || 0);
        const vWo = DERIVED_KEYS.includes(t.k) ? woDv[t.k] : (st[t.k] || 0);
        const fullOk = t.kind === 'min' ? vFull >= t.v : vFull <= t.v;
        const woOk = t.kind === 'min' ? vWo >= t.v : vWo <= t.v;
        if (fullOk && !woOk) criticalFor.push(tLabel(t.k));
      }
      // 순위 점수 = 원시 가중 기여 + 실효 지표 기여 (피해경감 파츠도 정당하게 순위에 오르게)
      const rank = (fullScore - wScore(st)) + DERIVED_KEYS.reduce((s, k) => s + Math.max(0, fullDv[k] - woDv[k]) / (O.UNIT[k] || 1), 0);
      const stats = rawDiffs.length
        ? rawDiffs.slice(0, 3).map(d => C.STAT_LABEL[d.k] + ' +' + Math.round(d.d))
        : effDiffs.slice(0, 2).map(d => '실효 ' + effShort(d.k) + ' +' + Math.round(d.d));
      return { part: p, rank, roleCls, roleLabel: ROLE_LABEL[roleCls] || null, criticalFor, stats };
    });
    const maxR = Math.max(1e-6, ...out.map(o => o.rank));
    out.forEach(o => o.share = Math.max(0, o.rank) / maxR);
    // 목표 필수 파츠를 먼저, 그다음 기여 큰 순 — "왜 약한 파츠가 있나?" 를 바로 답한다
    out.sort((a, b) => (b.criticalFor.length - a.criticalFor.length) || (b.rank - a.rank));
    return out;
  }

  /** 자동 구성 후보 카드를 그린다. 클릭하면 그 구성을 장착한다. (처음 autoShown 개만, 나머지는 더보기) */
  function renderAutoResults(cands) {
    const box = $('#autoResults');
    box.innerHTML = '';
    const keys = SUMMARY_STAT_KEYS;   // 저장 목록 요약과 같은 핵심 스탯

    const shown = Math.min(state.autoShown || 3, cands.length);
    cands.slice(0, shown).forEach((c, i) => {
      const card = el('div', 'auto-cand');
      card.dataset.i = String(i);
      const head = el('div', 'ac-head');
      head.append(el('span', 'ac-rank', c.label || '구성 ' + (i + 1)));
      head.append(el('span', 'ac-parts', `파츠 ${c.parts.length}개`));
      card.append(head);

      // 파츠를 아이콘으로 보여 준다 — 어떤 파츠가 들어갔는지 한눈에 비교
      const thumbs = el('div', 'ac-thumbs');
      for (const part of c.parts) {
        const th = el('div', 'ac-thumb');
        th.append(img(partImg(part.name), 'parts', part.name));
        const lv = lvOf(part.name);
        if (lv) th.append(el('span', 'ac-lv', lv));
        th.title = T.partName(part.name);
        thumbs.append(th);
      }
      card.append(thumbs);

      const stats = el('div', 'ac-stats');
      for (const k of keys) {
        const cell = el('span', 'ac-stat');
        cell.append(el('span', 'ac-k', C.STAT_LABEL[k]));
        cell.append(el('span', 'ac-v', (c.stats.total[k] ?? 0).toLocaleString()));
        stats.append(cell);
      }
      card.append(stats);

      // 상충 축 요약 — 공격/내구를 나란히 보여 트레이드오프를 한눈에 (Pareto 선택 보조)
      const ax = axisSummary(c);
      const axis = el('div', 'ac-axis');
      axis.append(el('span', 'axb atk', `공격 ${ax.atk}`));
      axis.append(el('span', 'axb def', `내구 ${ax.def}`));
      card.append(axis);

      // 자동으로 고른 확장 스킬 (사용자가 지정했으면 표시 안 함)
      if (state.autoExpansion && c.expansion && c.expansion !== C.EXPANSION_NONE) {
        const expName = (C.EXPANSION_LABEL[c.expansion] || c.expansion).replace(/\s*\(.*\)$/, '');
        card.append(el('div', 'ac-exp', '확장: ' + expName));
      }

      // 하한 미달 · 상한 초과 표시 (원시 스탯·파생 지표 공통)
      const tLabel = k => DERIVED_KEYS.includes(k) ? DERIVED_LABEL[k] : C.STAT_LABEL[k];
      const unmet = Object.entries(state.minimums)
        .filter(([k, v]) => v && candValue(c, k) < v)
        .map(([k, v]) => `${tLabel(k)} ${candValue(c, k).toLocaleString()}/${v}`);
      if (unmet.length) card.append(el('div', 'ac-warn', '하한 미달: ' + unmet.join(', ')));
      const over = Object.entries(state.maximums)
        .filter(([k, v]) => v != null && v !== '' && candValue(c, k) > v)
        .map(([k, v]) => `${tLabel(k)} ${candValue(c, k).toLocaleString()}/${v}`);
      if (over.length) card.append(el('div', 'ac-warn', '상한 초과: ' + over.join(', ')));

      // '왜 이 파츠?' — 파츠별 기여도(가중 점수 하락)와 주요 상승 스탯을 펼쳐 본다
      const why = el('button', 'ac-why', '왜 이 파츠?');
      const whyBody = el('div', 'ac-why-body'); whyBody.hidden = true;
      why.onclick = ev => {
        ev.stopPropagation();
        if (whyBody.dataset.built !== '1') {
          whyBody.append(el('div', 'why-cap', '막대=기여도 · 태그=역할 · 🎯=목표 필수 · 실효=피해경감/피해% 반영'));
          for (const o of partContributions(c)) {
            const row = el('div', 'why-row');
            const barWrap = el('div', 'why-bar');
            const bar = el('div', 'why-bar-fill' + (o.roleCls ? ' rb-' + o.roleCls : ''));
            bar.style.width = Math.round(o.share * 100) + '%';
            barWrap.append(bar);
            const main = el('div', 'why-main');
            main.append(el('span', 'why-ptn', T.partName(o.part.name)));
            if (o.roleLabel) main.append(el('span', 'why-role r-' + o.roleCls, o.roleLabel));
            if (o.criticalFor.length) main.append(el('span', 'why-crit', '🎯 ' + o.criticalFor.join('·') + ' 필수'));
            row.append(barWrap, main, el('div', 'why-stats', o.stats.join(' · ') || '—'));
            whyBody.append(row);
          }
          whyBody.dataset.built = '1';
        }
        whyBody.hidden = !whyBody.hidden;
        why.classList.toggle('on', !whyBody.hidden);
      };
      card.append(why, whyBody);

      card.title = c.parts.map(p => T.partName(p.name)).join(', ');
      card.onclick = () => applyCandidate(i);
      box.append(card);
    });

    // 지금 적용된 후보 강조 유지 (더보기로 다시 그려도)
    [...box.children].forEach(el => el.classList.toggle('on', Number(el.dataset.i) === state.autoApplied));

    // 더보기 — 아직 안 보여준 후보가 있으면 노출
    const moreWrap = document.getElementById('autoMoreWrap');
    if (moreWrap) {
      const remaining = cands.length - shown;
      moreWrap.hidden = remaining <= 0;
      const btn = document.getElementById('autoMore');
      if (btn) btn.textContent = `더보기 (${remaining}개 더)`;
    }
  }

  function applyCandidate(i) {
    const cands = state.autoCandidates || [];
    const c = cands[i];
    if (!c) return;
    state.autoApplied = i;
    state.equipped = c.parts.slice();
    // 확장 스킬을 자동으로 골랐으면 그 값도 함께 적용한다 (후보를 갈아탈 때마다).
    // NONE 후보로 갈아탈 수도 있으므로 확장이 NONE 이어도 반드시 맞춘다.
    if (state.autoExpansion && c.expansion) {
      state.expansion = c.expansion;
      state.expLevel = c.expLevel || C.MAX_EXPANSION_LEVEL;
      $('#expansion').value = state.expansion;
      const expLv = $('#expLevel');
      expLv.value = String(state.expLevel);
      expLv.disabled = state.expansion === C.EXPANSION_NONE;
    }
    [...$('#autoResults').children].forEach(el => el.classList.toggle('on', Number(el.dataset.i) === i));
    renderAll();
    toast(`${c.label || '구성 ' + (i + 1)} 적용 — 파츠 ${c.parts.length}개`);
  }

  function openDrawer(open) {
    $('#autoDrawer').classList.toggle('open', open);
    $('#drawerBack').classList.toggle('open', open);
    // 폰 하단 액션바(z-index 47)가 드로어(41) 위라 「실행」 버튼을 가렸다 — 열려 있는 동안 감춘다.
    document.body.classList.toggle('drawer-open', open);
  }

  /* ---------- 저장 / 불러오기 ---------- */

  const serialize = () => ({
    ms: state.ms ? state.ms.MS名 : null,
    parts: state.equipped.map(p => p.name),
    stage: state.stage,
    expansion: state.expansion,
    expLevel: state.expLevel
  });

  /* ---------- 공유 코드 (짧은 문자열로 인코딩) ---------- */
  // 유니코드(한글·일본어 파츠명) 안전 base64url. 붙여넣기 쉽게 한 줄 토큰으로 만든다.
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }
  const SHARE_PREFIX = 'GBO2-';
  /** 현재(또는 주어진) 구성을 짧은 공유 코드로 만든다. */
  function encodeShare(obj) {
    const o = obj || serialize();
    // 짧은 키로 압축: m=기체, p=파츠, s=강화, e=확장, l=확장레벨
    const compact = { m: o.ms, p: o.parts, s: o.stage, e: o.expansion, l: o.expLevel };
    return SHARE_PREFIX + b64urlEncode(JSON.stringify(compact));
  }
  /** 공유 코드 또는 예전 JSON을 구성 객체(serialize 형태)로 되돌린다. 실패 시 null. */
  function decodeShare(text) {
    const t = (text || '').trim();
    if (!t) return null;
    // 예전 JSON 형식도 그대로 받는다 (하위 호환)
    if (t[0] === '{') { try { return JSON.parse(t); } catch { return null; } }
    const code = t.startsWith(SHARE_PREFIX) ? t.slice(SHARE_PREFIX.length) : t;
    try {
      const c = JSON.parse(b64urlDecode(code));
      return { ms: c.m, parts: c.p || [], stage: c.s, expansion: c.e, expLevel: c.l };
    } catch { return null; }
  }

  /* ---------- 저장한 구성(이름 지정·다중) ---------- */

  const BUILDS_KEY = 'gbo2-offline-builds';
  // 시간이 같아도 겹치지 않는 고유 id (Date.now() 만 쓰면 연속 저장 시 충돌해 삭제가 꼬인다)
  const uid = () => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  function loadBuilds() {
    let list;
    try { list = JSON.parse(localStorage.getItem(BUILDS_KEY)) || []; } catch { list = []; }
    // 예전 단일 저장 슬롯이 남아 있으면 "한 번만" 목록으로 옮기고 슬롯을 지운다.
    // (지우지 않으면 목록을 비울 때마다 되살아나 삭제되지 않는다)
    let legacy = null;
    try { legacy = localStorage.getItem(SAVE_KEY); } catch { /* 무시 */ }
    if (legacy != null) {
      try { const o = JSON.parse(legacy); if (o && o.ms) list.push({ id: uid(), name: '이전 저장', ...o, ts: Date.now() }); } catch { /* 손상된 슬롯도 아래서 제거 */ }
      try { localStorage.removeItem(SAVE_KEY); } catch { /* 무시 */ }
      writeBuilds(list);
    }
    return list;
  }
  function writeBuilds(list) {
    try { localStorage.setItem(BUILDS_KEY, JSON.stringify(list)); return true; } catch { return false; }
  }

  const expShort = e => (C.EXPANSION_LABEL[e] || e).replace(/\s*\(.*\)$/, '');

  /** 현재 구성을 이름을 지정해 목록에 저장한다. */
  function saveCurrentBuild() {
    if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
    const name = (prompt('구성 이름을 지정하세요', T.msName(state.ms.MS名) + ' 구성') || '').trim();
    if (!name) return;
    const list = loadBuilds();
    list.unshift({ id: uid(), name, ...serialize(), ts: Date.now() });
    if (!writeBuilds(list)) { toast('저장에 실패했습니다 (브라우저 저장 공간 제한)'); return; }
    toast('「' + name + '」 저장했습니다');
  }

  function openSavedModal(open) {
    const m = document.getElementById('savedModal'), b = document.getElementById('savedModalBack');
    if (m) m.hidden = !open;
    if (b) b.hidden = !open;
    if (open) renderSavedBuilds();
  }

  /* ---------- 빌드 A/B 비교 ---------- */
  // 저장한 구성(또는 현재 구성)의 스탯을 상태를 건드리지 않고 계산한다.
  function statsForBuild(bld) {
    if (!bld || !bld.ms) return null;
    const ms = msData.find(m => m.MS名 === bld.ms);
    if (!ms) return null;
    const stage = [0, 4, 6].includes(Number(bld.stage)) ? Number(bld.stage) : 6;
    const equipped = [];
    for (const n of (bld.parts || [])) {           // deserialize 와 같은 규칙으로 실제 장착분만
      const p = partByName.get(n);
      if (p && C.checkEquip(p, ms, equipped, C.calcSlots(ms, equipped, stage, fullst)).ok) equipped.push(p);
    }
    const expansion = C.EXPANSION_SKILLS.includes(bld.expansion) ? bld.expansion : C.EXPANSION_NONE;
    const expLevel = Number(bld.expLevel) || C.MAX_EXPANSION_LEVEL;
    const r = C.calcStats(ms, equipped, stage, expansion, partsByCat, fullst, expLevel, null, null);
    // wanted: 저장된 파츠 수. equipped 보다 많으면 슬롯 초과·규칙 위반으로 빠진 것이 있다는 뜻
    // (불러오기와 달리 비교는 조용히 빠지면 "저장이 반영 안 됐다"로 보이므로 헤더에 알린다)
    return { ms, equipped, stage, expansion, expLevel, r, wanted: (bld.parts || []).length };
  }

  /** 빌드의 무장별 1히트 위력(논차지·집속)·리로드. 파츠·사격/격투 보정·피해% 반영(자세·스킬 미반영). */
  function buildWeaponDamage(bs) {
    if (!bs) return [];
    const msLv = C.msLevel(bs.ms.MS名);
    const corr = { shooting: bs.r.total.shoot, melee: bs.r.total.meleeCorrection };
    const wm = D.weaponModsOf(bs.equipped, msLv, bs.ms.属性, bs.expansion);
    const out = [];
    for (const w of weaponsOfMs(bs.ms)) {
      if (w.type === 'shield') continue;
      const lvs = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
      const fit = lvs.filter(l => l <= msLv);
      const d = w.levels[String(fit.length ? fit[fit.length - 1] : (lvs[0] || ''))];
      if (!d) continue;
      const info = w.info || {};
      const kind = (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shoot';
      const fin = base => {
        if (base == null) return null;
        if (w.attr === 'shield') return base;
        const raw = w.type === 'melee' ? D.meleeDamage(base, corr.melee, {}) : D.shootingDamage(base, corr.shooting, {});
        return D.applyDamagePct(raw, [D.damagePctFor(wm, w, kind)]);
      };
      const nc = fin(d.power);
      const ch = (d.powerCharged != null && d.powerCharged !== d.power) ? fin(d.powerCharged) : null;
      if (nc == null && ch == null) continue;
      // 리로드 / OH복귀 — 파츠 단축 반영(초 단위)
      const secOf = (raw, key) => { const m = raw && String(raw).match(/([\d.]+)/); return m ? D.shortenTime(Number(m[1]), D.timeCutFor(wm, key, w)) : null; };
      const reloadRaw = wField(d, info, 'リロード時間'), ohRaw = wField(d, info, 'OH復帰時間', 'OH復帰速度');
      let reload = null, reloadKind = '';
      if (reloadRaw) { reload = secOf(reloadRaw, 'reloadTime'); reloadKind = '리로드'; }
      else if (ohRaw) { const ep = D.isEpackMag(w); reload = secOf(ohRaw, ep ? 'reloadTime' : 'weaponOH'); reloadKind = ep ? '리로드' : 'OH'; }
      out.push({ name: w.name, ko: T.weaponName(w.name), attr: weaponAttr(w), nc, ch, reload, reloadKind });
    }
    return out;
  }

  let compareOpts = [];   // [{id, label, bld}]
  const compareOptions = () => {
    const opts = [];
    if (state.ms) opts.push({ id: '__current__', label: '● 현재 구성 — ' + T.msName(state.ms.MS名), bld: serialize() });
    for (const b of loadBuilds()) opts.push({ id: b.id, label: b.name + ' — ' + T.msName(b.ms), bld: b });
    return opts;
  };

  function renderCompare() {
    const box = $('#compareBody'); if (!box) return;
    box.innerHTML = '';
    const bldOf = id => (compareOpts.find(o => o.id === id) || {}).bld;
    const A = statsForBuild(bldOf($('#cmpA').value)), B = statsForBuild(bldOf($('#cmpB').value));
    if (!A || !B) { box.append(el('div', 'pietan-empty', '비교할 두 구성을 선택하세요.')); return; }

    // 헤더 — 각 빌드의 기체·코스트·강화·확장
    const idcell = (s, cls) => {
      const c = el('div', 'cmp-id ' + cls);
      c.append(el('b', '', T.msName(s.ms.MS名)));
      const dropped = s.wanted - s.equipped.length;
      const sub = el('span', 'cmp-sub', `${T.attrName(s.ms.属性)} · 코스트 ${s.ms.コスト} · ${STAGE_LABEL[s.stage]}`
        + (s.expansion !== C.EXPANSION_NONE ? ' · ' + expShort(s.expansion) + ' LV' + s.expLevel : '')
        + ` · 파츠 ${s.equipped.length}` + (dropped > 0 ? `/${s.wanted}` : ''));
      c.append(sub);
      if (dropped > 0) {
        const w = el('span', 'cmp-warn', `⚠ ${dropped}개 제외됨 (슬롯 초과·중복 등)`);
        w.title = '저장된 파츠 중 이 기체·강화 단계에서 장착 규칙을 통과하지 못한 파츠가 있습니다.';
        c.append(w);
      }
      return c;
    };
    const head = el('div', 'cmp-head');
    head.append(el('span', 'cmp-lb', ''));
    head.append(idcell(A, 'a')); head.append(idcell(B, 'b')); head.append(el('span', 'cmp-d', 'Δ(B−A)'));
    box.append(head);

    const table = el('div', 'cmp-table');
    // opt.fmt: 값 포맷, opt.lowerBetter: 낮을수록 개선(리로드 등)
    const mkRow = (label, av, bv, opt = {}) => {
      const fmt = opt.fmt || (v => v.toLocaleString());
      const row = el('div', 'cmp-row' + (opt.cls ? ' ' + opt.cls : ''));
      row.append(el('span', 'cmp-lb', label));
      const show = v => v == null ? '—' : fmt(v);
      row.append(el('span', 'cmp-a', show(av)));
      row.append(el('span', 'cmp-b', show(bv)));
      const d = (av != null && bv != null) ? Math.round((bv - av) * 100) / 100 : null;
      const good = d == null ? 0 : (opt.lowerBetter ? -d : d);
      row.append(el('span', 'cmp-d' + (good > 0 ? ' up' : good < 0 ? ' down' : ''),
        d == null ? '' : d === 0 ? '·' : (d > 0 ? '+' : '') + fmt(d)));
      table.append(row);
    };
    for (const k of C.STAT_KEYS) mkRow(C.STAT_LABEL[k], A.r.total[k], B.r.total[k]);

    // 공격 지표 (실효 보정 = 보정에 피해% 접음)
    table.append(el('div', 'cmp-sec', '공격 지표 (실효 보정)'));
    const effCorr = (s, key) => {
      const corr = key === 'shoot' ? s.r.total.shoot : s.r.total.meleeCorrection;
      const pct = partAttackBonus(s.equipped, C.msLevel(s.ms.MS名))[key];   // 빌드엔 스킬 없음 → 파츠만
      return Math.round(((1 + corr / 100) * (1 + pct / 100) - 1) * 100);
    };
    mkRow('사격', effCorr(A, 'shoot'), effCorr(B, 'shoot'));
    mkRow('격투', effCorr(A, 'melee'), effCorr(B, 'melee'));

    // 내구 지표 — 성능표와 같은 계산: 실효 HP 에 파츠 피해경감(신형완충재·오버튠 등)까지 접는다.
    // (이걸 빼면 피해경감 파츠를 넣은 구성이 안 넣은 구성과 같은 값으로 나온다)
    const dura = (s, k, dattr) => {
      const cuts = partDamageCuts(s.equipped, C.msLevel(s.ms.MS名));   // 빌드엔 스킬 체크 없음 → 파츠만
      return Math.round(durabilityOf(s.r.total, k) / staggerDmgFactor(cuts, dattr));
    };
    const duraCut = (s, dattr) => {
      const f = staggerDmgFactor(partDamageCuts(s.equipped, C.msLevel(s.ms.MS名)), dattr);
      return f < 1 ? Math.round((1 - f) * 100) : 0;
    };
    table.append(el('div', 'cmp-sec', '내구 지표 (실효 HP · 파츠 피해경감 반영)'));
    for (const [k, lb, dattr] of [['armorRange', '내실탄', 'solid'], ['armorBeam', '내빔', 'beam'], ['armorMelee', '내격투', 'melee']]) {
      const ca = duraCut(A, dattr), cb = duraCut(B, dattr);
      const tag = (ca || cb) ? ` (피해 -${ca}% / -${cb}%)` : '';
      mkRow(lb + tag, dura(A, k, dattr), dura(B, k, dattr));
    }

    // 무장 (파츠·보정 반영). 이름으로 맞춰 논차지·집속·리로드/OH 비교(다른 기체면 대부분 —).
    const wA = buildWeaponDamage(A), wB = buildWeaponDamage(B);
    if (wA.length || wB.length) {
      table.append(el('div', 'cmp-sec', '무장 위력 (1히트 · 파츠 반영)'));
      const mapA = new Map(wA.map(x => [x.name, x])), mapB = new Map(wB.map(x => [x.name, x]));
      const names = [...wA.map(x => x.name), ...wB.filter(x => !mapA.has(x.name)).map(x => x.name)];
      const sec = v => v == null ? '—' : v + '초';
      for (const nm of names) {
        const a = mapA.get(nm), b = mapB.get(nm), w = a || b;
        mkRow(w.ko, a ? a.nc : null, b ? b.nc : null, { cls: 'cmp-wstart' });        // 논차지 (무장 시작)
        if ((a && a.ch != null) || (b && b.ch != null))
          mkRow('└ 집속', a ? a.ch : null, b ? b.ch : null, { cls: 'cmp-wsub' });
        if ((a && a.reload != null) || (b && b.reload != null))
          mkRow('└ ' + ((a && a.reloadKind) || (b && b.reloadKind) || '리로드'),
            a ? a.reload : null, b ? b.reload : null, { fmt: sec, lowerBetter: true, cls: 'cmp-wsub' });
      }
    }
    box.append(table);
  }

  function openCompareModal(open) {
    const m = $('#compareModal'), b = $('#compareModalBack');
    if (m) m.hidden = !open;
    if (b) b.hidden = !open;
    if (!open) return;
    compareOpts = compareOptions();
    const fill = sel => { sel.innerHTML = ''; for (const o of compareOpts) { const op = el('option', '', o.label); op.value = o.id; sel.append(op); } };
    fill($('#cmpA')); fill($('#cmpB'));
    if (compareOpts.length) {
      $('#cmpA').value = compareOpts[0].id;
      $('#cmpB').value = (compareOpts[1] || compareOpts[0]).id;
    }
    renderCompare();
  }

  /* ---------- 기본 파츠 설정 (기본 제외 파츠 관리) ---------- */
  const PART_CAT_KO = { '防御': '방어', '攻撃': '공격', '移動': '이동', '補助': '보조', '特殊': '특수' };

  function updateOwnedUi() {
    const n = state.banned.size;
    const note = $('#ownedNote');
    if (note) note.textContent = n ? `기본 제외 ${n}개` : '제외한 파츠 없음';
    const btn = $('#ownedBtn');
    if (btn) btn.textContent = '기본 파츠 설정' + (n ? ` (${n})` : '');
  }

  /** 기본 제외 체크 토글 — 제외로 바꾸면 장착·잠금에서도 즉시 뺀다. */
  function toggleExcluded(name, on) {
    if (on) {
      state.banned.add(name);
      state.equipped = state.equipped.filter(e => e.name !== name);
      state.locked.delete(name);
    } else {
      state.banned.delete(name);
    }
    saveBanned();
    updateOwnedUi();
  }

  function renderOwnedList() {
    const box = $('#ownedList');
    if (!box) return;
    const q = ($('#ownedQuery').value || '').trim().toLowerCase();
    box.innerHTML = '';
    for (const cat of C.CATEGORIES) {
      let list = partsByCat[cat] || [];
      if (q) list = list.filter(p => partSearchText.get(p).includes(q));
      if (!list.length) continue;
      box.append(el('div', 'owned-cat', PART_CAT_KO[cat] || cat));
      const grid = el('div', 'owned-tiles');
      for (const p of list) grid.append(ownedTile(p));
      box.append(grid);
    }
    if (!box.children.length) box.append(el('div', 'empty-state', '검색 결과가 없습니다.'));
  }

  /** 기본 파츠 설정용 파츠 타일 — 파츠 적용 화면과 같은 모양. 클릭으로 제외 토글. */
  function ownedTile(p) {
    const v = partView(p);
    const off = state.banned.has(p.name);
    const tile = el('div', 'part-tile owned-tile' + (off ? ' banned' : ''));
    tile.title = `${v.fullNm}\n${v.cat} · ${v.slotTxt}\n\n${v.desc}`;
    const thumb = el('div', 'pt-thumb');
    thumb.append(img(partImg(p.name), 'parts', p.name));
    if (v.lv) thumb.append(el('span', 'pt-lv', 'LV' + v.lv));
    tile.append(thumb);
    tile.append(el('div', 'pt-nm', v.shortNm));
    const mark = el('div', 'owned-mark', off ? '제외됨' : '');
    tile.append(mark);
    tile.onclick = () => {
      const now = !state.banned.has(p.name);
      toggleExcluded(p.name, now);            // 세트 갱신·장착해제·저장·배지
      tile.classList.toggle('banned', now);
      mark.textContent = now ? '제외됨' : '';
    };
    return tile;
  }

  function openOwnedModal(open) {
    const m = $('#ownedModal'), b = $('#ownedModalBack');
    if (m) m.hidden = !open;
    if (b) b.hidden = !open;
    if (open) { $('#ownedQuery').value = ''; renderOwnedList(); updateOwnedUi(); }
    else renderAll();   // 닫을 때 빌드 화면(회색·자동구성 후보)에 반영
  }

  /* ---------- 피탄 시뮬레이터 (받는 피해 / 경직 저항) ---------- */
  // 내구 지표(실효 HP)를 실전 감각으로 확장 — 적 무장 하나를 골라
  //   격파까지 = 실효HP[속성] ÷ 무장 위력,  경직까지 = 임계 ÷ よろけ値
  // 를 보여 준다. (1히트 근사 — 국부보정·경직값 시간 감쇠는 미반영)
  const PIETAN_ARMOR = { solid: 'armorRange', beam: 'armorBeam', melee: 'armorMelee', shield: 'armorMelee' };
  let pietanMs = null;           // 선택한 적 기체 (LV 엔트리)
  let pietanMsBase = '';         // 그 기체의 base 이름
  let pietanMsLv = 1;            // 선택한 적 기체 LV
  let pietanPick = null;         // 선택한 적 무장 (그 LV 기준 위력)
  let pietanCorr = 0;            // 적 공격보정 (기체에서 자동, 수정 가능)
  let pietanCorrTouched = false; // 사용자가 공격보정을 직접 만졌는가 — 그러면 무장 바꿔도 고정
  let pietanAttr = 'same';       // 적의 속성 상성 (same|advantage|disadvantage)
  let pietanAttrTouched = false; // 상성 수동 변경 여부 (그러면 기체 바꿔도 유지)
  let pietanEnemySkills = new Set();  // 체크한 적 공격 스킬 이름들 (여러 개 조합 가능)
  let pietanEnemyDef = new Set();     // 체크한 적 방어 스킬 이름들 — 내 무장의 피해를 깎는다
  let pietanShield = false;           // 「실드로 막음」 — 실드 HP 로 받는 계산을 함께 보여 준다
  let pietanBuild = null;        // 적이 저장 빌드일 때 그 빌드(파츠 포함), 아니면 null
  let pietanVariant = 0;         // 선택한 격투 변형 인덱스 (기본/헤비어택…)
  let pietanDir = 0;             // 선택한 격투 방향 인덱스 (N격/횡격/하격…)

  // 속성 상성 사이클: 범용(汎用) > 강습(強襲) > 지원(支援) > 범용
  const ATTR_BEATS = { '汎用': '強襲', '強襲': '支援', '支援': '汎用' };
  const pietanMatchup = (atkAttr, defAttr) =>       // 공격자→방어자 상성
    ATTR_BEATS[atkAttr] === defAttr ? 'advantage' : ATTR_BEATS[defAttr] === atkAttr ? 'disadvantage' : 'same';
  function syncPietanAttrSeg() {
    const seg = $('#pietanAttr');
    if (seg) [...seg.children].forEach(c => c.classList.toggle('on', c.dataset.a === pietanAttr));
  }
  function pietanAutoAttr() {                        // 적→나 상성 자동 (수동 변경 전까지)
    if (pietanAttrTouched || !pietanMs || !state.ms) return;
    pietanAttr = pietanMatchup(pietanMs.属性, state.ms.属性);
    syncPietanAttrSeg();
  }

  /** 무장의 누적치(よろけ値) — 히트당 %와 1트리거 다발수(x7 등)를 읽는다. */
  function parseStagger(w) {
    let s = (w.mods && w.mods.stagger) || '';
    if (!s) { const note = (w.info && w.info['備考']) || ''; s = (note.match(/よろけ値[：:]\s*([^/]+)/) || [])[1] || ''; }
    const pm = String(s).match(/(\d+(?:\.\d+)?)\s*%/);
    const xm = String(s).match(/[x×]\s*(\d+)/);
    return { pct: pm ? Number(pm[1]) : 0, pellets: xm ? Number(xm[1]) : 1 };
  }

  const pietanPageId = ms => (String(ms && ms.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];

  /** 무장 레벨을 적 기체 LV 에 맞춘다 (그보다 높은 레벨은 안 쓰고, 없으면 가진 최저). */
  function pietanWeaponLv(w, msLv) {
    const lvs = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
    if (!lvs.length) return null;
    const fit = lvs.filter(l => l <= msLv);
    return String(fit.length ? fit[fit.length - 1] : lvs[0]);
  }

  /** 적 기체가 그 LV 에서 실제로 쓰는 무장 목록 (위력·누적치를 그 레벨로). */
  /** 이 기체가 든 실드 — 그 LV 의 シールドHP + 실드 보강재·커넥팅 파츠. 실드가 없으면 null.
   *  실드 HP 자체는 무장 표에서 이미 쓰던 계산(D.weaponModsOf().shieldHp)을 그대로 쓴다. */
  function shieldOf(ms, msLv, equipped) {
    const id = pietanPageId(ms), page = id && weaponData[id];
    if (!page) return null;
    const sh = (page.weapons || []).find(w => w.type === 'shield'
      && Object.values(w.levels || {}).some(d => d && d.raw && d.raw['シールドHP']));
    if (!sh) return null;
    const lvk = pietanWeaponLv(sh, msLv);
    const d = lvk && sh.levels[lvk];
    const base = Number(d && d.raw && d.raw['シールドHP']) || 0;
    if (!base) return null;
    const bonus = D.weaponModsOf(equipped || [], msLv, ms['属性']).shieldHp || 0;
    return { hp: base + bonus, base, bonus, name: T.weaponName(sh.name) };
  }

  /** 무장 하나가 실드에 주는 1히트 피해. 보정이 없거나 「？倍」면 null(계산 안 함).
   *  pct 는 공격하는 쪽 파츠의 「실드에 주는 피해 +N%」(탄약 강화 키트 등). */
  function shieldHit(dmg, sm, charged, pct) {
    if (!sm || sm.unknown) return null;
    const mult = charged ? sm.ch : sm.nc;
    if (mult == null) return null;
    return Math.floor(dmg * mult * (1 + (pct || 0) / 100));
  }

  function enemyWeaponsOfMs(ms, msLv) {
    const id = pietanPageId(ms), page = id && weaponData[id];
    if (!page) return [];
    const out = [];
    for (const w of page.weapons || []) {
      if (w.type === 'shield') continue;
      const lvk = pietanWeaponLv(w, msLv);
      const dd = lvk && w.levels[lvk];
      const power = Number(dd && dd.power) || 0;
      const charged = Number(dd && dd.powerCharged) || 0;
      if (!power && !charged) continue;
      const st = parseStagger(w);
      const note = (w.info && w.info['備考']) || '';
      const sTxt = String((w.mods && w.mods.stagger) || '') + ' ' + note;
      // 강경직 = 大よろけ / 強よろけ 유발 무장 (위키 표기). 일반 경직은 よろけ.
      const react = /大よろけ|強よろけ/.test(sTxt) ? '강경직'
        : /よろけ有|ひるみ有|転倒|ダウン/.test(sTxt) ? '경직' : null;
      // 격투 변형(기본/헤비어택 등)·방향별 배율(N격/횡격/하격…) — meleeDamage 의 ccd 로 적용
      const variants = (w.melee && w.melee.variants && w.melee.variants.length) ? w.melee.variants : null;
      // note·psycommu·type 은 조건부 파츠 경감(관통 경감 장갑·폭풍 경감 장갑) 판정에 쓴다.
      out.push({ name: w.name, attr: weaponAttr(w), power, charged, stagger: st.pct, pellets: st.pellets, react, variants,
        note, psycommu: !!w.psycommu, type: w.type });
    }
    return out;
  }

  /** 적 기체의 기본 공격보정(파츠 없음·강화6) — 무장 종류에 맞는 값을 공격보정에 자동 채운다. */
  /** 적 총 스탯 — 저장 빌드면 그 파츠 반영, 아니면 기본(파츠 없음·강화6). */
  function enemyStatsTotal() {
    const bs = enemyBuildStats(); if (bs) return bs.r.total;
    return C.calcStats(pietanMs, [], 6, C.EXPANSION_NONE, partsByCat, fullst, C.MAX_EXPANSION_LEVEL, null, null).total;
  }
  /** 적 저장 빌드의 계산 결과(파츠 포함). 렌더마다 calcStats 를 다시 돌리지 않게 캐시한다. */
  let pietanBuildStats = null;
  function enemyBuildStats() {
    if (!pietanBuild) return null;
    if (!pietanBuildStats || pietanBuildStats.bld !== pietanBuild)
      pietanBuildStats = { bld: pietanBuild, bs: statsForBuild(pietanBuild) };
    return pietanBuildStats.bs;
  }
  /** 적이 낀 파츠 — 기본 기체(저장 구성이 아님)면 빈 배열. */
  function enemyEquipped() {
    const bs = enemyBuildStats();
    return (bs && bs.equipped) || [];
  }
  function enemyBaseCorr() {
    const t = enemyStatsTotal();
    return { shoot: Math.round(t.shoot || 0), melee: Math.round(t.meleeCorrection || 0) };
  }

  /** 적 기체의 공격 버프 스킬 목록 (적 LV 기준, 공격 효과가 있는 것만). */
  function enemyAttackSkillList() {
    if (!pietanMs) return [];
    const list = skillData[baseName(pietanMs.MS名)] || [];
    const out = [];
    for (const sk of list) {
      const fit = (sk.levels || []).filter(l => pietanMsLv >= l.from && (l.to == null || pietanMsLv <= l.to));
      const e = fit.length ? fit[fit.length - 1] : null;
      if (!e) continue;
      if (e.shoot || e.melee || e.shootPct || e.meleePct || e.dmgAny || e.dmgShoot || e.dmgMelee)
        out.push({ name: sk.name, nameKo: sk.nameKo, e });
    }
    return out;
  }

  /** 체크한 적 공격 스킬들의 합산 효과 (그 무장 종류). 보정은 합, 피해%는 곱연산. */
  function enemyAttackEffect(kind) {
    const base = enemyBaseCorr(), baseC = kind === 'melee' ? base.melee : base.shoot;
    const flat = kind === 'melee' ? 'melee' : 'shoot', pctKey = kind === 'melee' ? 'meleePct' : 'shootPct';
    let corr = 0, mul = 1; const names = [];
    for (const sk of enemyAttackSkillList()) {
      if (!pietanEnemySkills.has(sk.name)) continue;
      const e = sk.e;
      corr += (e[flat] || 0) + Math.round(baseC * (e[pctKey] || 0) / 100);
      const dp = (e.dmgAny || 0) + (kind === 'melee' ? (e.dmgMelee || 0) : (e.dmgShoot || 0));
      if (dp) mul *= (1 + dp / 100);
      names.push(sk.nameKo);
    }
    return { corr, mul, names };
  }

  /** 적 공격 스킬 체크박스 (방어 스킬과 같은 UI). 여러 개 조합 가능. */
  function renderPietanEnemySkills(box) {
    const list = enemyAttackSkillList();
    if (!list.length) return;
    const wrap = el('div', 'stagger-skills pietan-eskills');
    wrap.append(el('span', 'pietan-ctrl-lb', '적 공격 스킬'));
    for (const sk of list) {
      const e = sk.e, tags = [];
      if (e.shoot) tags.push('사격+' + e.shoot);
      if (e.melee) tags.push('격투+' + e.melee);
      if (e.shootPct) tags.push('사격+' + e.shootPct + '%');
      if (e.meleePct) tags.push('격투+' + e.meleePct + '%');
      if (e.dmgAny) tags.push('피해+' + e.dmgAny + '%');
      else if (e.dmgShoot) tags.push('사격피해+' + e.dmgShoot + '%');
      else if (e.dmgMelee) tags.push('격투피해+' + e.dmgMelee + '%');
      const lab = el('label', 'stg-chk' + (pietanEnemySkills.has(sk.name) ? ' on' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = pietanEnemySkills.has(sk.name);
      cb.onchange = () => { cb.checked ? pietanEnemySkills.add(sk.name) : pietanEnemySkills.delete(sk.name); renderPietanResult(); };
      lab.append(cb, el('span', 'stg-nm', sk.nameKo), el('span', 'stg-tag', tags.join(' · ')));
      wrap.append(lab);
    }
    box.append(wrap);
  }
  function pietanAutoCorr() {
    if (!pietanMs || !pietanPick) return;
    if (pietanCorrTouched) return;    // 사용자가 값을 만졌으면 무장 바꿔도 고정
    const c = enemyBaseCorr();
    pietanCorr = pietanPick.attr === 'melee' ? c.melee : c.shoot;
    const inp = $('#pietanCorr'); if (inp) inp.value = pietanCorr;
  }

  function renderPietanDura() {
    const box = $('#pietanDura'); if (!box) return;
    const r = stats();
    box.innerHTML = '';
    box.append(el('span', 'pietan-dura-lb', '내구 지표 (실효 HP)'));
    for (const [lb, key] of [['실탄', 'armorRange'], ['빔', 'armorBeam'], ['격투', 'armorMelee']]) {
      const cell = el('span', 'pietan-dura-cell');
      cell.append(el('i', 'pietan-dot ' + key));
      cell.append(el('span', 'pietan-dura-t', lb));
      cell.append(el('span', 'pietan-dura-v', durabilityOf(r.total, key).toLocaleString()));
      box.append(cell);
    }
  }

  function selectPietanMs(base) {
    const arr = msByBase.get(base) || [];
    pietanMsBase = base;
    pietanMs = arr[arr.length - 1] || null;      // 기본은 최고 LV
    pietanMsLv = pietanMs ? msLevel(pietanMs) : 1;
    pietanPick = null;
    pietanBuild = null;                           // 기본 기체(파츠 없음)
    pietanCorrTouched = false;                    // 새 기체는 공격보정 다시 자동
    pietanAttrTouched = false; pietanAutoAttr();  // 상성도 다시 자동
    pietanEnemySkills.clear(); pietanEnemyDef.clear();
    pietanVariant = 0; pietanDir = 0;
    renderPietanChecks(); renderPietanLeft(); renderPietanResult();
  }

  /** 적을 내 저장 빌드(파츠 적용)로 선택. */
  function selectPietanBuild(bld) {
    const ms = msData.find(m => m.MS名 === bld.ms);
    if (!ms) { toast('이 구성의 기체를 찾을 수 없습니다'); return; }
    pietanMs = ms; pietanMsBase = baseName(ms.MS名); pietanMsLv = msLevel(ms);
    pietanBuild = bld; pietanPick = null;
    pietanCorrTouched = false; pietanAttrTouched = false; pietanAutoAttr();
    pietanEnemySkills.clear(); pietanEnemyDef.clear();
    pietanVariant = 0; pietanDir = 0;
    renderPietanChecks(); renderPietanLeft(); renderPietanResult();
  }

  function renderPietanLeft() {
    const box = $('#pietanList'); if (!box) return;
    const qEl = $('#pietanQuery');
    box.innerHTML = '';

    if (!pietanMs) {                              // ── 적 기체 고르기 ──
      qEl.hidden = false;
      const q = (qEl.value || '').trim().toLowerCase();
      // 내 저장 구성(파츠 반영) — 검색어 없을 때 상단에 먼저
      const builds = !q ? loadBuilds() : [];
      if (builds.length) {
        box.append(el('div', 'pietan-sec-lb', '내 저장 구성 (파츠 반영)'));
        for (const bld of builds) {
          const ms = msData.find(m => m.MS名 === bld.ms); if (!ms) continue;
          const row = el('div', 'pietan-row');
          row.append(img(msImg(ms.MS名), 'ms', bld.ms));
          row.append(el('span', 'pietan-wn', bld.name + ' — ' + T.msName(ms.MS名).replace(/\s*LV\d+$/, '')));
          row.onclick = () => selectPietanBuild(bld);
          box.append(row);
        }
        box.append(el('div', 'pietan-sec-lb', '전체 기체'));
      }
      let rows = [...msByBase.entries()].map(([base, arr]) => ({ base, rep: arr[arr.length - 1] }));
      if (q) rows = rows.filter(r => (T.msName(r.rep.MS名) + ' ' + r.rep.MS名).toLowerCase().includes(q));
      const CAP = 140;
      for (const r of rows.slice(0, CAP)) {
        const row = el('div', 'pietan-row');
        row.append(img(msImg(r.rep.MS名), 'ms', r.base));
        row.append(el('span', 'pietan-wn', T.msName(r.rep.MS名).replace(/\s*LV\d+$/, '')));
        row.onclick = () => selectPietanMs(r.base);
        box.append(row);
      }
      if (!rows.length) box.append(el('div', 'empty-state', '검색 결과가 없습니다.'));
      else if (rows.length > CAP) box.append(el('div', 'pietan-more', `+${rows.length - CAP}기 — 검색으로 좁히세요`));
      return;
    }

    // ── 고른 기체: 뒤로 + LV + 그 기체의 무장 ──
    qEl.hidden = true;
    const hd = el('div', 'pietan-mshead');
    const back = el('button', 'pietan-back', '‹ 다른 기체');
    back.onclick = () => { pietanMs = null; pietanPick = null; renderPietanLeft(); renderPietanResult(); };
    hd.append(back);
    hd.append(el('b', 'pietan-msnm', T.msName(pietanMs.MS名).replace(/\s*LV\d+$/, '')));
    box.append(hd);

    const arr = msByBase.get(pietanMsBase) || [pietanMs];
    if (arr.length > 1) {
      const seg = el('div', 'seg pietan-lvseg');
      for (const m of arr) {
        const lv = msLevel(m);
        const b = el('button', 'seg-btn' + (m === pietanMs ? ' on' : ''), 'LV' + lv);
        b.onclick = () => { pietanMs = m; pietanMsLv = lv; pietanPick = null; pietanEnemyDef.clear();
          renderPietanChecks(); renderPietanLeft(); renderPietanResult(); };
        seg.append(b);
      }
      box.append(seg);
    }

    const wl = enemyWeaponsOfMs(pietanMs, pietanMsLv);
    for (const w of wl) {
      const row = el('div', 'pietan-row' + (pietanPick && pietanPick.name === w.name ? ' on' : ''));
      row.append(el('span', 'w-type type-' + w.attr, ATTR_LABEL[w.attr]));
      row.append(el('span', 'pietan-wn', T.weaponName(w.name)));
      row.append(el('span', 'pietan-wp', (w.power || w.charged).toLocaleString()));
      row.onclick = () => { pietanPick = w; pietanVariant = 0; pietanDir = 0; pietanAutoCorr(); renderPietanLeft(); renderPietanResult(); };
      box.append(row);
    }
    if (!wl.length) box.append(el('div', 'empty-state', '이 기체의 무장 정보가 없습니다.'));
  }

  function renderPietanChecks() {
    const box = $('#pietanStagger'); if (!box) return;
    box.innerHTML = '';
    const redraw = () => { renderPietanChecks(); renderPietanResult(); };
    const grp = (cls, label, cl) => {
      if (!cl.count) return;
      const g = el('div', 'pietan-skgrp' + (cls ? ' ' + cls : ''));
      g.append(el('span', 'pietan-ctrl-lb', label), cl.wrap);
      box.append(g);
    };
    // 적 방어 스킬이 위 — 내 무장 피해를 깎는다. 내 방어 스킬은 아래(받는 피해).
    if (pietanMs) grp('enemy', '적 방어 스킬', staggerCheckList(pietanMs, pietanMsLv, redraw, pietanEnemyDef, 'normal'));
    if (state.ms) grp('', '내 방어 스킬', staggerCheckList(state.ms, msLevel(state.ms), redraw));
  }

  function renderPietanResult() {
    const box = $('#pietanResult'); if (!box) return;
    box.innerHTML = '';
    if (pietanMs) renderPietanEnemySkills(box);                      // 적 공격 스킬 체크(조합)
    if (pietanPick) renderPietanIncoming(box);                       // 상대 무장 → 나
    else box.append(el('div', 'pietan-empty', pietanMs ? '왼쪽에서 적 무장을 선택하세요.' : '왼쪽에서 적 기체를 선택하세요.'));
    if (pietanMs && state.ms) renderPietanOutgoing(box);             // 내 무장 → 상대 (TTK 역방향)
  }

  /** 상대 무장 → 나 (받는 피해·격파·경직). */
  function renderPietanIncoming(box) {
    const w = pietanPick, r = stats();
    const key = PIETAN_ARMOR[w.attr] || 'armorRange';
    const eff = durabilityOf(r.total, key);                        // 실효 HP (방어 = Def 반영)
    const stg = activeStaggerMods(state.ms, state.ms ? msLevel(state.ms) : 1);   // 내 누적치 스킬
    const condCuts = conditionalPartCuts(state.equipped, w);   // 이 무장에만 걸리는 파츠 경감(관통·폭풍)
    const dmgFactor = staggerDmgFactor([...partDamageCuts(state.equipped, msLevel(state.ms)), ...condCuts,
      ...boostBufferCuts(stg.cuts, state.equipped)], w.attr);   // 파츠+조건부 파츠+방어 스킬 피해 경감
    const isMelee = w.attr === 'melee';
    // 격투 변형(기본/헤비어택)·방향(N격/횡격/하격) — 무장 데이터의 방향별 배율(ccd)을 적용한다.
    const variants = isMelee && w.variants && w.variants.length ? w.variants : null;
    if (variants && pietanVariant >= variants.length) pietanVariant = 0;
    const dirs = variants ? variants[pietanVariant].direction : null;
    if (dirs && pietanDir >= dirs.length) pietanDir = 0;
    const meleeCcd = dirs && dirs[pietanDir] ? dirs[pietanDir].hits : [1];
    // 체크한 적 공격 스킬 반영 — 보정 합·피해% 곱
    const eatk = enemyAttackEffect(isMelee ? 'melee' : 'shoot');
    const eCorr = pietanCorr + eatk.corr;
    const eMul = eatk.mul;
    // 적이 낀 파츠 — 상성 우위 배율(카테고리 특공)과 与ダメージ% 는 내 파츠와 같은 규칙으로 건다.
    const eEq = enemyEquipped();
    const eKind = isMelee ? 'melee' : 'shoot';
    const eAttrBonus = attrBonusOf(eEq, pietanAttr);
    const ePartPct = pietanMs ? D.damagePctFor(D.weaponModsOf(eEq, pietanMsLv, pietanMs.属性), w, eKind) : 0;
    // 1히트 피해 = 공격 항 [Wp・{Att・ETCa}・(CCd)・Pr] × 피해% × 방어 스킬 피해 경감 (방어보정은 실효 HP).
    const perHit = (base, ccd) => base > 0
      ? Math.floor(D.applyDamagePct(isMelee
        ? D.meleeDamage(base, eCorr, { attr: pietanAttr, attrBonus: eAttrBonus, ccd: ccd || [1] })
        : D.shootingDamage(base, eCorr, { attr: pietanAttr, attrBonus: eAttrBonus }), ePartPct) * eMul * dmgFactor)
      : 0;
    const dmg = perHit(w.power || w.charged, meleeCcd);
    const hits = dmg > 0 ? Math.ceil(eff / dmg) : null;
    // 사격의 powerCharged = 집속 (멜리 헤비어택은 위 변형으로 처리)
    const chgDmg = (!isMelee && w.charged && w.charged !== w.power) ? perHit(w.charged, [1]) : 0;
    const chgHits = chgDmg > 0 ? Math.ceil(eff / chgDmg) : null;
    // 경직 = 임계 ÷ 히트당 누적치. 감소 스킬은 감소 큰 순으로 하나씩 곱하고 매번 소수점 이하 내림.
    const perHitStagger = w.stagger > 0 ? staggerPerHit(w.stagger, stg.mults) : 0;
    const stagN = perHitStagger > 0 ? Math.ceil(stg.threshold / perHitStagger) : null;

    const hd = el('div', 'pietan-rhd');
    hd.append(el('span', 'w-type type-' + w.attr, ATTR_LABEL[w.attr]));
    hd.append(el('b', 'pietan-rnm', T.weaponName(w.name)));
    if (w.react) hd.append(el('span', 'pietan-react' + (w.react === '강경직' ? ' strong' : ''), w.react));
    // 상대 무장의 고정 피해·디버프 — 직격 피해와 별개라 격파 수만 봐서는 놓친다
    const inFx = fixedDamageOf({ info: { '備考': w.note } });
    if (inFx) {
      const c = el('span', 'w-fixed', '고정 ' + inFx.total.toLocaleString());
      c.title = `직격과 별도로 고정 피해 ${inFx.total.toLocaleString()} (${inFx.per}×${inFx.hits}히트)\n보정을 받지 않아 아래 격파 수에는 포함돼 있지 않다.`;
      hd.append(c);
    }
    for (const d of debuffsOf({ info: { '備考': w.note } })) hd.append(el('span', 'w-debuff', d));
    box.append(hd);
    if (pietanMs) box.append(el('div', 'pietan-msctx',
      `${T.msName(pietanMs.MS名).replace(/\s*LV\d+$/, '')} · LV${pietanMsLv}`
      + (pietanBuild ? ' · 내 구성(파츠)' : '')
      + (eAttrBonus !== (D.ATTR_BONUS[pietanAttr] || 0) ? ' · 적 카테고리 특공' : '')
      + (ePartPct ? ` · 적 파츠 피해 +${ePartPct}%` : '')
      + ` · 공격보정 ${eCorr}`
      + (eatk.names.length ? ` (적 스킬 ${eatk.names.length}개${eatk.mul > 1 ? ` · 피해 ×${+eatk.mul.toFixed(3)}` : ''})` : '')));
    box.append(el('div', 'pietan-sub',
      `위력 ${(w.power || w.charged).toLocaleString()}${chgDmg ? ` · 집속 ${w.charged.toLocaleString()}` : ''}`
      + ` · 누적 ${w.stagger ? w.stagger + '%' : '—'}${w.pellets > 1 ? ` ×${w.pellets}` : ''}`));

    // 격투 변형(기본/헤비어택) · 방향(N격/횡격/하격) 선택 (멜리 무장)
    const segCtrl = (label, items, cur, onPick) => {
      const wrap = el('div', 'pietan-dir');
      wrap.append(el('span', 'pietan-ctrl-lb', label));
      const seg = el('div', 'seg pietan-dirseg');
      items.forEach((it, i) => {
        const b = el('button', 'seg-btn' + (i === cur ? ' on' : ''), it.text);
        if (it.title) b.title = it.title;
        b.onclick = () => onPick(i);
        seg.append(b);
      });
      wrap.append(seg);
      box.append(wrap);
    };
    if (variants && variants.length > 1) {
      segCtrl('격투 종류', variants.map(v => ({ text: v.label })), pietanVariant,
        i => { pietanVariant = i; pietanDir = 0; renderPietanResult(); });
    }
    if (dirs && dirs.length > 1) {
      segCtrl('격투 방향', dirs.map(d => ({ text: mLabel(d.label), title: '방향 배율 ' + d.raw })), pietanDir,
        i => { pietanDir = i; renderPietanResult(); });
    }

    const metric = (lb, val, note, cls) => {
      const m = el('div', 'pietan-metric' + (cls ? ' ' + cls : ''));
      m.append(el('span', 'pietan-mlb', lb));
      m.append(el('span', 'pietan-mv', val));
      m.append(el('span', 'pietan-mnote', note));
      return m;
    };
    // 조건부 파츠 경감은 이 무장이라서 걸린 것이라 따로 이름을 밝혀 준다
    const condTxt = condCuts.length ? ' · ' + [...new Set(condCuts.map(c => c.label + ' -' + c.pct + '%'))].join(' · ') : '';
    const cutTxt = dmgFactor < 1 ? ` · 경감 ×${+dmgFactor.toFixed(3)}${condTxt}` : '';
    const varTxt = variants && variants.length > 1 ? `${variants[pietanVariant].label} ` : '';
    const dirTxt = dirs ? ` · ${varTxt}${mLabel(dirs[pietanDir].label)} ${dirs[pietanDir].raw}` : '';
    box.append(metric('격파까지', hits != null ? hits + '발' : '—',
      `${ATTR_LABEL[w.attr]} 내구 ${eff.toLocaleString()} ÷ 1히트 ${dmg.toLocaleString()}${dirTxt}${cutTxt}`));
    if (chgHits != null) box.append(metric('집속 시', chgHits + '발', `÷ ${chgDmg.toLocaleString()}`, 'sub'));
    // 감소 스킬을 감소 큰 순으로 하나씩 곱하며 매번 내림한 과정 표기 (6% ×0.8 ×0.5 내림)
    const stepTxt = stg.mults.length ? ` (${w.stagger}%${stg.mults.map(m => ' ×' + m).join('')} 내림)` : '';
    // stagN==null 은 "정보 없음"이 아니라 경직이 안 되는 경우다 — 무장 누적치 0% 이거나 스킬 감소로 0.
    const stagVal = stagN != null ? stagN + '히트' : (w.stagger > 0 ? '경직 안 됨' : '—');
    const stagNote = stagN != null
      ? `임계 ${stg.threshold}% ÷ 히트당 ${perHitStagger}%${stepTxt}` + (w.pellets > 1 ? ` · 1발=${w.pellets}히트 → 약 ${Math.ceil(stagN / w.pellets)}발` : '')
      : (w.stagger > 0 ? `누적치 ${w.stagger}%${stepTxt} → 0 — 이 무장으론 경직 안 됨` : '누적치 0% (경직값 없음)');
    box.append(metric('경직까지', stagVal, stagNote));
    // 실드로 받으면 기체 HP 피해를 막고 실드 HP 가 대신 깎인다(위키 83).
    if (pietanShield) {
      const mine = shieldOf(state.ms, msLevel(state.ms), state.equipped);
      const sm = D.shieldMultOf({ info: { '備考': w.note || '' } });
      const eShPct = D.shieldDmgPctOf(eEq, w.attr);  // 실드 피해 증가는 때리는 쪽(적) 파츠 몫
      const sHit = mine && shieldHit(dmg, sm, false, eShPct);
      if (!mine) box.append(metric('실드로 막으면', '—', '내 기체엔 실드가 없다', 'sub'));
      else if (sHit == null) box.append(metric('실드로 막으면', '—',
        sm && sm.unknown ? '이 무장의 실드 보정이 위키 미확인(？倍)' : '이 무장엔 실드 보정 표기가 없다', 'sub'));
      else box.append(metric('실드로 막으면', Math.ceil(mine.hp / sHit) + '발',
        `${mine.name} HP ${mine.hp.toLocaleString()}` + (mine.bonus ? ` (+${mine.bonus.toLocaleString()})` : '')
        + ` ÷ 1히트 ${sHit.toLocaleString()} (피해 ${dmg.toLocaleString()} × 보정 ${sm.nc}배`        + (eShPct ? ` × 적 파츠 +${eShPct}%` : '') + ')', 'sub'));
    }
    box.append(el('div', 'pietan-foot',
      '※ 공격 항 실피해식[Wp·Att·(방향)·Pr] + 방어 스킬 경감. 방어보정은 내구 지표(Def). 蓄積 경직은 일반 경직 기준(국부·시간 감쇠 미반영).'
      + (w.react === '강경직' ? ' 이 무장은 직격 시 강경직(大よろけ).' : '')));
  }

  /** 내 무장 → 상대 격파까지 발수 (TTK 역방향). 상대의 파츠·체크한 방어 스킬로 피해가 깎인다. */
  function renderPietanOutgoing(box) {
    const enemyTot = enemyStatsTotal();
    const outAttr = pietanMatchup(state.ms.属性, pietanMs.属性);   // 내→적 상성 (자동)
    const r = stats();
    const corr = { shooting: r.total.shoot, melee: r.total.meleeCorrection };
    const wm = D.weaponModsOf(state.equipped, msLevel(state.ms), state.ms.属性, state.expansion);
    const eEq = enemyEquipped();                                   // 적이 낀 파츠
    const eStg = activeStaggerMods(pietanMs, pietanMsLv, pietanEnemyDef, 'normal');   // 체크한 적 방어 스킬
    const eShield = pietanShield ? shieldOf(pietanMs, pietanMsLv, eEq) : null;

    const eCuts = [...partDamageCuts(eEq, pietanMsLv),             // 적 파츠의 % 피해 경감
      ...boostBufferCuts(eStg.cuts, eEq)];                         // 적 방어 스킬(신형 완충재 강화 포함)
    const rows = [];
    for (const w of msWeapons()) {
      if (w.type === 'shield') continue;
      const lv = weaponLevel(w), d = lv ? w.levels[lv] : null;
      if (!d || !d.power) continue;
      const attr = weaponAttr(w);
      const enemyEff = durabilityOf(enemyTot, PIETAN_ARMOR[attr] || 'armorRange');
      // 조건부 파츠 경감(관통·폭풍)은 무장의 備考 를 보므로 피탄 쪽과 같은 모양으로 맞춰 넘긴다.
      const wc = { name: w.name, attr, type: w.type, psycommu: !!w.psycommu, note: (w.info && w.info['備考']) || '' };
      const eFactor = staggerDmgFactor([...eCuts, ...conditionalPartCuts(eEq, wc)], attr);
      const kind = (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shoot';
      const a = kind === 'melee' ? corr.melee : corr.shooting;
      // 카테고리 특공 프로그램은 상성 우위 배율 자체를 130%→140% 로 올린다
      const aBonus = attrBonusOf(state.equipped, outAttr);
      const raw = w.type === 'melee'
        ? D.meleeDamage(d.power, a, { attr: outAttr, attrBonus: aBonus })
        : D.shootingDamage(d.power, a, { attr: outAttr, attrBonus: aBonus });
      const dmg = Math.floor(D.applyDamagePct(raw, [D.damagePctFor(wm, w, kind), ...skillDmgPctList(kind)]) * eFactor);
      const mult = fireMult(w);
      const n = (mult.nc && mult.nc.n) || 1;
      const per = dmg * n;                          // 전탄(동시발사) 1트리거 피해
      // 실드로 막는 상대라면 실드부터 깨야 한다 — 같은 무장이라도 실드 보정이 5배까지 갈린다.
      let shHits = undefined, shNote = '';
      if (pietanShield && eShield) {
        const sm = D.shieldMultOf(w);
        const sHit = shieldHit(dmg, sm, false, D.shieldDmgPctOf(state.equipped, attr));
        // 같은 이름 무장이라도 기체마다 표기가 있고 없고가 갈린다 — 남의 값을 빌려오지 않는다.
        if (sHit == null) { shHits = null; shNote = sm && sm.unknown ? '보정 불명' : '표기 없음'; }
        else shHits = Math.ceil(eShield.hp / (sHit * n));
      }
      rows.push({ name: T.weaponName(w.name), attr, per, n, shHits, shNote,
        hits: per > 0 ? Math.ceil(enemyEff / per) : null });
    }
    if (!rows.length) return;
    rows.sort((x, y) => (x.hits || 1e9) - (y.hits || 1e9));

    box.append(el('div', 'pietan-out-lb', '내 무장 → ' + T.msName(pietanMs.MS名).replace(/\s*LV\d+$/, '') + ' 격파'
      + (eShield ? ` (실드 ${eShield.name} HP ${eShield.hp.toLocaleString()})` : '')));
    const tbl = el('div', 'pietan-out' + (eShield ? ' has-shield' : ''));
    for (const w of rows) {
      const row = el('div', 'pietan-out-row');
      row.append(el('span', 'w-type type-' + w.attr, ATTR_LABEL[w.attr]));
      row.append(el('span', 'pietan-out-nm', w.name));
      row.append(el('span', 'pietan-out-dmg', w.per.toLocaleString() + (w.n > 1 ? ' (×' + w.n + ')' : '')));
      if (w.shHits !== undefined) {
        row.append(el('span', 'pietan-out-sh', w.shHits != null ? '실드 ' + w.shHits + '발' : w.shNote));
      }
      row.append(el('span', 'pietan-out-hits', w.hits != null ? w.hits + '발' : '—'));
      tbl.append(row);
    }
    box.append(tbl);
    box.append(el('div', 'pietan-foot',
      (pietanBuild
        ? '※ 상대는 그 구성의 파츠를 양방향 반영(내구·공격보정·피해경감·특공). '
        : '※ 상대는 기본(파츠 없음·강화6) 내구 기준. ')
      + '체크한 적 방어 스킬만큼 내 피해가 깎인다. '
      + '내 위력은 파츠·스킬·상성 반영(국부보정 미반영). 전탄 명중 가정.'));
  }

  function openPietan(open) {
    if (open && !state.ms) { toast('먼저 기체를 선택하세요'); return; }
    const m = $('#pietanModal'), b = $('#pietanBack');
    if (m) m.hidden = !open;
    if (b) b.hidden = !open;
    if (open) {
      $('#pietanMsName').textContent = T.msName(state.ms.MS名);
      $('#pietanCorr').value = pietanCorr;
      pietanAutoAttr();                 // 내 기체 기준 상성 재계산(수동 변경 전까지)
      syncPietanAttrSeg();
      renderPietanDura(); renderPietanChecks(); renderPietanLeft(); renderPietanResult();
    }
  }

  /* ---------- 기체 스킬 목록 (무장 헤더 '스킬' 버튼) ---------- */
  const SKILL_MODE_KO = { '通常時': '통상', '変形時': '변형', '変身時': '변신', 'システム発動中': '시스템 발동중', '飛行時': '비행', '': '통상' };
  const SKILL_CAT_KO = { '足回り': '기동', '攻撃': '공격', '防御': '방어', 'その他': '기타', '移動': '이동', '格闘': '격투', '射撃': '사격', '': '기타' };
  const skTr = s => (s ? (skillText[s] || s) : '');            // 스킬 텍스트 번역 (없으면 원문)
  // 활성 모드 탭은 따로 두지 않고 state.form(성능의 통상/변신 토글)에서 파생한다.
  // 따로 두면 성능은 변신인데 스킬 패널만 통상이 되어 같은 화면이 서로 다른 값을 보여 준다.
  const mskillModeIdx = modes => {
    if (modes.length < 2) return 0;
    const i = state.form === 'transform'
      ? modes.findIndex(isAltSkillMode)
      : modes.findIndex(m => !isAltSkillMode(m));
    return i >= 0 ? i : 0;
  };

  // 「LV1～3」「LV4～」「LV3」에 현재 기체 LV 이 드는지.
  // 물결(～) 유무가 중요하다 — 「LV3」은 **그 레벨 전용**이고 「LV3～」이 LV3 이상이다.
  // 둘을 같게 보면 리바우 LV2 처럼 「LV1」짜리 구간이 상위 LV 까지 따라와 낮은 스킬이 표시된다.
  // 다만 위키가 마지막 구간의 물결을 빼먹은 경우가 있어(10건), 어디에도 안 맞으면
  // 호출부에서 '가장 높은 구간'으로 폴백한다.
  function msLvHit(msLvStr, lv) {
    const m = String(msLvStr || '').match(/LV\s*(\d+)\s*([～~\-])?\s*(?:LV)?\s*(\d+)?/i);
    if (!m) return true;
    const from = Number(m[1]);
    if (!m[2]) return lv === from;                       // 물결 없음 = 그 레벨만
    return lv >= from && lv <= (m[3] ? Number(m[3]) : 99);
  }
  /** msLv 표기의 시작 레벨. */
  const msLvFrom = v => Number((String(v || '').match(/LV\s*(\d+)/i) || [])[1]) || 1;
  /** 이름별 후보 중 현재 LV 에 맞는 구간 하나. 없으면 가장 높은 구간으로 폴백(습득 전이면 null).
   *  구간이 겹칠 때는 **높은 쪽**을 쓴다 — 위키가 「LV1～」과 「LV2～」를 함께 적어 두면
   *  앞의 것은 사실상 다음 구간 전까지라는 뜻이라, 먼저 찾은 것을 쓰면 낮은 스킬이 잡힌다
   *  (리크 돔Ⅱ 다리 특수 완충재 LV2 = 15% 인데 10% 로 나오던 자리). */
  /** 스킬 자체의 LV(「LV3」) — 없으면 0. */
  const skillLvNum = v => Number((String(v || '').match(/LV\s*(\d+)/i) || [])[1]) || 0;
  /** 겹칠 때의 우선순위 — ① 스킬 LV 이 높은 쪽 ② 그다음 msLv 구간이 늦게 시작하는 쪽.
   *  위키에 「LV1」과 「LV1～」처럼 불규칙하게 적힌 자리가 있는데(5건), 그럴 때 msLv 만 보면
   *  기체 LV 이 올라갔는데 스킬이 낮아지는 결과가 나온다(수중형 건담 기동전 복합시스템).
   *  GBO2 에서 기체 LV 이 올라 스킬이 내려가는 일은 없으므로 스킬 LV 을 먼저 본다. */
  const byFromDesc = (a, b) => (skillLvNum(b.lv) - skillLvNum(a.lv)) || (msLvFrom(b.msLv) - msLvFrom(a.msLv));
  function pickByMsLv(cands, lv) {
    const hits = cands.filter(s => msLvHit(s.msLv, lv));
    if (hits.length) return hits.slice().sort(byFromDesc)[0];
    // 어디에도 안 맞으면 '현재 LV 이하'의 구간 중 가장 높은 것을 쓴다.
    // 그냥 최고 구간을 집으면 구간 사이에 빈틈이 있을 때 상위 스킬이 튀어나온다
    // (실바 바레트 서프레서 LV2 · 다리 특수 완충재 = 구간 [LV1, LV3～] 자리).
    const below = cands.filter(s => msLvFrom(s.msLv) <= lv);
    if (!below.length) return null;                       // 아직 습득 전
    return below.slice().sort(byFromDesc)[0];
  }

  function openMskill(open) {
    const panel = document.getElementById('mskillInline');
    const btn = document.getElementById('skillListBtn');
    if (panel) panel.hidden = !open;
    if (btn) btn.classList.toggle('on', open);
    if (open) { renderMskill(); if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' }); }
  }

  function renderMskill() {
    const body = $('#mskillBody'), tabs = $('#mskillTabs');
    $('#mskillMsName').textContent = state.ms ? T.msName(state.ms.MS名) : '';
    const modes = (state.ms && msSkillsData[baseName(state.ms.MS名)]) || [];
    body.innerHTML = '';
    if (!modes.length) { body.append(el('div', 'detail-empty', '이 기체의 스킬 정보가 없습니다.')); tabs.hidden = true; return; }

    // 모드 탭 (다중모드일 때만)
    tabs.innerHTML = '';
    tabs.hidden = modes.length < 2;
    const curIdx = mskillModeIdx(modes);
    if (modes.length > 1) modes.forEach((md, i) => {
      const t = el('button', 'seg-btn' + (i === curIdx ? ' on' : ''), SKILL_MODE_KO[md.mode] || md.mode || '통상');
      // 탭 = 성능의 통상/변신 토글과 같은 값. 여기서 바꾸면 성능 쪽도 함께 바뀐다.
      t.onclick = () => { state.form = isAltSkillMode(md) ? 'transform' : 'normal'; renderAll(); };
      tabs.append(t);
    });

    const lv = state.ms ? msLevel(state.ms) : 1;
    const mode = modes[Math.min(curIdx, modes.length - 1)];
    // 스킬명별로 현재 기체 LV 에 맞는 구간 하나를 고른다.
    // 단일 닫힌 구간(예: 「LV1～2」)만 가진 스킬은 그 상한을 넘는 LV 에서 어떤 구간에도
    // 안 맞아 사라지므로, 그럴 땐 가장 높은 from 구간으로 폴백해 계속 보여 준다.
    const groups = new Map();
    for (const s of mode.skills) {
      const key = s.cat + '|' + s.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const fromOf = s => { const m = String(s.msLv || '').match(/LV\s*(\d+)/i); return m ? Number(m[1]) : 1; };
    const picked = new Map();
    for (const [key, cands] of groups) {
      // 구간 선택·폴백 규칙은 방어 스킬과 같은 것을 쓴다(pickByMsLv).
      //   · 아직 습득 전이면 안 보여 준다 (야크트 도가[소매] 데미지컨트롤 LV3·LV4～ 가 LV1 에 뜨던 문제)
      //   · 위키가 마지막 구간의 물결을 빼먹어 어디에도 안 맞으면 가장 높은 구간으로
      const chosen = pickByMsLv(cands, lv);
      if (chosen) picked.set(key, chosen);
    }
    // 분류별 그룹
    const order = ['足回り', '攻撃', '防御', '移動', '格闘', '射撃', 'その他', ''];
    const byCat = new Map();
    for (const s of picked.values()) { if (!byCat.has(s.cat)) byCat.set(s.cat, []); byCat.get(s.cat).push(s); }
    const cats = [...byCat.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!cats.length) { body.append(el('div', 'detail-empty', '이 LV 에서 표시할 스킬이 없습니다.')); return; }

    for (const cat of cats) {
      const sec = el('div', 'msk-sec');
      sec.append(el('div', 'msk-cat', SKILL_CAT_KO[cat] || cat || '기타'));
      for (const s of byCat.get(cat)) {
        const row = el('div', 'msk-row');
        const head = el('div', 'msk-head');
        head.append(el('span', 'msk-name', skTr(s.name)));
        if (s.lv) head.append(el('span', 'msk-lv', s.lv));
        row.append(head);
        if (s.eff) row.append(el('div', 'msk-eff', skTr(s.eff)));
        if (s.desc) row.append(el('div', 'msk-desc', skTr(s.desc)));
        sec.append(row);
      }
      body.append(sec);
    }
  }

  function renameBuild(id) {
    const list = loadBuilds();
    const b = list.find(x => x.id === id);
    if (!b) return;
    const name = (prompt('새 이름을 입력하세요', b.name) || '').trim();
    if (!name) return;
    b.name = name; writeBuilds(list); renderSavedBuilds();
  }

  function deleteBuild(id) {
    const list = loadBuilds();
    const b = list.find(x => x.id === id);
    if (b && !confirm('「' + b.name + '」 구성을 삭제할까요?')) return;
    writeBuilds(list.filter(x => x.id !== id)); renderSavedBuilds();
  }

  /** 저장한 구성을 자동 구성 카드처럼 파츠 아이콘·스탯 요약으로 보여 준다. */
  function renderSavedBuilds() {
    const box = $('#savedResults');
    box.innerHTML = '';
    const list = loadBuilds();
    $('#savedModalNote').textContent = list.length ? list.length + '개' : '';
    if (!list.length) {
      box.append(el('div', 'detail-empty', '저장된 구성이 없습니다.\n구성을 만든 뒤 상단 “저장”을 누르세요.'));
      return;
    }
    for (const bld of list) {
      const ms = msData.find(m => m.MS名 === bld.ms);
      const parts = (bld.parts || []).map(n => partByName.get(n)).filter(Boolean);
      const card = el('div', 'auto-cand saved-card');

      const head = el('div', 'ac-head');
      const nm = el('span', 'ac-rank sc-name', bld.name);
      nm.title = '클릭해서 이름 변경';
      nm.onclick = ev => { ev.stopPropagation(); renameBuild(bld.id); };
      head.append(nm);
      const del = el('button', 'sc-del', '✕');
      del.title = '이 구성 삭제';
      del.onclick = ev => { ev.stopPropagation(); deleteBuild(bld.id); };
      head.append(del);
      card.append(head);

      // 기체 한 줄 (썸네일 + 이름 · 강화 · 확장)
      const msLine = el('div', 'sc-ms');
      msLine.append(img(msImg(bld.ms), 'ms', bld.ms));
      const meta = el('div', 'sc-meta');
      meta.append(el('span', 'sc-msname', ms ? T.msName(ms.MS名) : bld.ms));
      const tags = [STAGE_LABEL[bld.stage] || ''];
      if (bld.expansion && bld.expansion !== C.EXPANSION_NONE) tags.push(expShort(bld.expansion));
      meta.append(el('span', 'sc-tags', tags.filter(Boolean).join(' · ')));
      msLine.append(meta);
      card.append(msLine);

      // 파츠 아이콘
      const thumbs = el('div', 'ac-thumbs');
      for (const part of parts) {
        const th = el('div', 'ac-thumb');
        th.append(img(partImg(part.name), 'parts', part.name));
        const lv = lvOf(part.name);
        if (lv) th.append(el('span', 'ac-lv', lv));
        th.title = T.partName(part.name);
        thumbs.append(th);
      }
      card.append(thumbs);

      // 스탯 요약 (저장된 강화·확장으로 실제 계산) — gbo2.jp 성능표처럼 핵심 스탯 + 내구 지표
      if (ms) {
        const r = C.calcStats(ms, parts, bld.stage, bld.expansion, partsByCat, fullst, bld.expLevel);
        // 자동 구성 결과와 같은 핵심 스탯 10종 (선회는 지상만)
        const stats = el('div', 'ac-stats');
        for (const k of SUMMARY_STAT_KEYS) {
          const cell = el('span', 'ac-stat');
          cell.append(el('span', 'ac-k', C.STAT_LABEL[k]));
          cell.append(el('span', 'ac-v', (r.total[k] ?? 0).toLocaleString()));
          stats.append(cell);
        }
        card.append(stats);

        // 내구 지표 — 피해 종류별 실효 HP (내성은 상한 반영된 값)
        const du = el('div', 'sc-dura');
        du.append(el('span', 'sc-dura-lb', '내구 지표'));
        for (const [k, label] of [['armorRange', '실탄'], ['armorBeam', '빔'], ['armorMelee', '격투']]) {
          const cell = el('span', 'ac-stat');
          cell.append(el('span', 'ac-k', label));
          cell.append(el('span', 'ac-v', durabilityOf(r.total, k).toLocaleString()));
          du.append(cell);
        }
        card.append(du);
      } else {
        card.append(el('div', 'ac-warn', '이 기체 데이터를 찾을 수 없습니다'));
      }

      const lost = (bld.parts || []).length - parts.length;
      card.append(el('div', 'ac-parts', `파츠 ${parts.length}개` + (lost ? ` (없는 파츠 ${lost}개 제외)` : '')));

      card.title = '클릭해서 이 구성 불러오기';
      card.onclick = () => {
        const r = deserialize(bld);
        openSavedModal(false);
        toast(r.ok
          ? ('「' + bld.name + '」 불러왔습니다' + (r.missing ? ` — 알 수 없는 파츠 ${r.missing}개 제외` : ''))
          : '이 구성의 기체를 찾을 수 없습니다');
      };
      box.append(card);
    }
  }

  /** @returns {{ok: boolean, missing?: number}} missing = 사전에 없어 제외된 파츠 수 */
  function deserialize(obj) {
    if (!obj || !obj.ms) return { ok: false };
    const ms = msData.find(m => m.MS名 === obj.ms);
    if (!ms) return { ok: false };
    state.ms = ms;
    // 손상된 저장본이 들어와도 계산이 어긋나지 않게 아는 값만 받는다
    state.stage = [0, 4, 6].includes(Number(obj.stage)) ? Number(obj.stage) : 6;
    state.expansion = C.EXPANSION_SKILLS.includes(obj.expansion) ? obj.expansion : C.EXPANSION_NONE;
    // 불러온 구성이 그대로 보이도록 변형·스킬 표시는 초기 상태로 되돌린다.
    // (스킬 선택은 기체별 인덱스라 다른 기체를 불러오면 어긋난다)
    // 기본 제외(banned)는 기체를 가리지 않는 영구 설정이므로 불러오기에서 건드리지 않는다.
    state.form = 'normal';
    state.openWeapon = null;
    state.skillPicks.clear();
    state.staggerOn.clear();    // 불러온 구성도 방어 스킬 체크는 새로 시작한다(이전 기체 것이 남지 않게)
    clearAutoResults();         // 이전 기체의 자동 구성 후보가 남아 잘못 적용되지 않게 지운다
    // expLevel 이 없던 시절의 저장본은 앱 기본값(최대 레벨)으로 맞춘다
    state.expLevel = Number(obj.expLevel) || C.MAX_EXPANSION_LEVEL;
    // 손상되거나 다른 기체·단계의 저장본이 들어와도 규칙(슬롯·중복·8개)을 지키도록,
    // 저장 순서대로 실제 장착 판정을 통과하는 파츠만 받는다.
    const wanted = obj.parts || [];
    state.equipped = [];
    for (const n of wanted) {
      const p = partByName.get(n);
      if (p && !state.banned.has(n)   // 기본 제외한 파츠는 불러온 구성에서도 빼둔다
        && C.checkEquip(p, ms, state.equipped, C.calcSlots(ms, state.equipped, state.stage, fullst)).ok) {
        state.equipped.push(p);
      }
    }
    const missing = wanted.length - state.equipped.length;
    state.locked.clear();
    syncStageSeg();
    $('#expansion').value = state.expansion;
    const expLv = $('#expLevel');
    expLv.value = String(state.expLevel);
    expLv.disabled = state.expansion === C.EXPANSION_NONE;
    renderAll();
    setView('build');
    return { ok: true, missing };
  }

  function syncStageSeg() {
    const seg = $('#stageSeg');
    if (seg) [...seg.children].forEach(c => c.classList.toggle('on', Number(c.dataset.v) === state.stage));
  }

  const STAGE_LABEL = { 0: '미강화', 4: '4단계', 6: '풀강' };

  /**
   * 강화 단계 변경.
   * 단계를 내리면 강화로 늘어난 슬롯이 줄어 기존 구성이 성립하지 않을 수 있으므로,
   * 확인을 받고 파츠를 초기화한다.
   * 6→4 도 예외가 아니다 — 슬롯 증가가 강화리스트 5·6번째 항목에 들어간 기체
   * (걈플란 TR-5 LV4, 바운드 독 LV2)는 6→4 에서도 슬롯이 줄어든다.
   * 레벨 전환과 규칙을 맞추기 위해 내리는 경우는 항상 초기화한다.
   */
  function setStage(v) {
    if (v === state.stage) return;
    const resets = v < state.stage && state.equipped.length > 0;
    if (resets && !confirm(
      `${STAGE_LABEL[v]}로 내리면 강화로 늘어난 슬롯이 줄어 지금 구성을 유지할 수 없습니다.\n\n`
      + `장착한 파츠 ${state.equipped.length}개를 모두 해제하고 진행할까요?`)) return;

    state.stage = v;
    if (resets) { state.equipped = []; state.locked.clear(); }
    syncStageSeg();
    renderAll();
    if (resets) toast(`${STAGE_LABEL[v]}로 변경해 장착 파츠를 초기화했습니다`);
  }

  /* ---------- 렌더 ---------- */

  function renderHero() {
    const m = state.ms;
    const hero = $('#heroImg');
    if (m) {
      hero.onerror = () => { hero.onerror = null; hero.src = defaultImg('ms'); };
      hero.src = msImg(m.MS名);
      hero.style.visibility = '';
    } else {
      hero.style.visibility = 'hidden';
    }

    $('#heroName').textContent = m ? T.msName(m.MS名) : '기체를 선택하세요';

    const sub = $('#heroSub');
    sub.innerHTML = '';
    if (!m) return;
    sub.append(el('span', 'dot ' + (m.属性 || '')));
    sub.append(el('span', '', T.attrName(m.属性)));
    sub.append(el('span', '', '·'));
    sub.append(el('span', 'cost-badge', '코스트 ' + m.コスト));
    const r = msRarity(m);
    if (r) {
      sub.append(el('span', '', '·'));
      sub.append(el('span', 'stars', '★'.repeat(r)));   // 기체 카드와 같은 표기
    }
  }

  /**
   * 같은 기체의 다른 레벨로 전환.
   * 레벨이 바뀌면 슬롯 상한도 바뀌어 기존 구성이 성립하지 않으므로 파츠·확장을 초기화한다.
   */
  function switchLevel(m) {
    if (!m || m === state.ms) return;
    const had = state.equipped.length;
    state.ms = m;
    state.equipped = [];
    state.skillPicks.clear();
    state.locked.clear();
    clearAutoResults();
    resetEnhance();             // 레벨이 바뀌면 슬롯도 바뀌므로 확장 스킬도 초기화한다
    renderAll();
    if (had) toast('레벨을 변경해 장착 파츠를 초기화했습니다');
  }

  /** 현재 기체에 LV2 이상 변형이 있으면 이름 위에 레벨 전환 세그먼트를 그린다. */
  function renderLevelSwitch() {
    const seg = $('#levelSwitch');
    seg.innerHTML = '';
    const variants = (state.ms && msByBase.get(baseName(state.ms.MS名))) || [];
    if (variants.length < 2) { seg.hidden = true; return; }
    seg.hidden = false;
    for (const m of variants) {
      const lv = msLevel(m);
      const b = el('button', 'seg-btn' + (m === state.ms ? ' on' : ''), 'LV' + lv);
      b.title = T.msName(m.MS名) + ' · 코스트 ' + m.コスト;
      b.onclick = () => switchLevel(m);
      seg.append(b);
    }
  }

  /** 변형 수치가 있는 기체에만 통상/변형 전환 버튼을 띄운다. */
  function renderFormSeg() {
    const seg = $('#formSeg');
    seg.innerHTML = '';
    const alt = altModeOf(state.ms);
    if (!alt) {
      seg.hidden = true;
      state.form = 'normal';        // 모드 없는 기체로 옮겨가면 통상으로 되돌린다
      return;
    }
    seg.hidden = false;
    for (const [v, label] of [['normal', '통상'], ['transform', alt.label]]) {
      const b = el('button', 'seg-btn' + (state.form === v ? ' on' : ''), label);
      b.onclick = () => {
        state.form = v;
        [...seg.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderStats();
        renderWeapons();            // 사격·격투 보정이 바뀌면 무장 위력도 달라진다
        // 스킬 패널이 열려 있으면 같은 모드로 따라가게 한다(성능만 변신, 패널은 통상이 되던 문제)
        if (!document.getElementById('mskillInline').hidden) renderMskill();
      };
      seg.append(b);
    }
  }

  const skillDur = s => (s.forever ? '무제한' : s.secs ? s.secs + '초' : '시간 제한');

  /** 스킬 한 줄에 붙일 요약 — 「사격 +10 · 격투 +35 · 무제한 · HP 50% 이하」 */
  function skillSummary(sk) {
    const e = skillLevel(sk) || {};
    const num = [];
    if (e.shoot) num.push('사격 +' + e.shoot);
    if (e.melee) num.push('격투 +' + e.melee);
    if (e.shootPct) num.push('사격 +' + e.shootPct + '%');
    if (e.meleePct) num.push('격투 +' + e.meleePct + '%');
    if (e.dmgAny) num.push('피해 +' + e.dmgAny + '%');
    if (e.dmgShoot) num.push('사격 피해 +' + e.dmgShoot + '%');
    if (e.dmgMelee) num.push('격투 피해 +' + e.dmgMelee + '%');
    if (e.crouchPct) num.push('앉기·정지 사격 +' + e.crouchPct + '%');
    const sg = n => (n > 0 ? '+' : '') + n;   // 음수(HADES 내성-5 등)는 부호 그대로
    if (e.armorRange && e.armorRange === e.armorBeam && e.armorBeam === e.armorMelee) num.push('내성 ' + sg(e.armorRange));
    else {
      if (e.armorRange) num.push('내실탄 ' + sg(e.armorRange));
      if (e.armorBeam) num.push('내빔 ' + sg(e.armorBeam));
      if (e.armorMelee) num.push('내격투 ' + sg(e.armorMelee));
    }
    if (e.speed) num.push('스피드 ' + sg(e.speed));
    if (e.hispeed) num.push('고속이동 ' + sg(e.hispeed));
    if (e.thruster) num.push('스러스터 ' + sg(e.thruster));
    if (e.turn) num.push('선회 ' + sg(e.turn));
    if (e.hpUp) num.push('HP ' + sg(e.hpUp));
    const how = [skillDur(sk), sk.hp ? 'HP ' + sk.hp + '% 이하' : null, sk.manual ? '수동' : null]
      .filter(Boolean).join(' · ');
    return { num: num.join(' · ') || '—', how };
  }

  const POSTURES = [['stand', '선 자세', '보정 없음'],
                    ['crouch', '앉기·정지', '사격 피해 +10% · 이동 불가'],
                    ['prone', '엎드리기', '사격 피해 +15% · 이동 불가']];

  /** 「자세 ▾」 버튼 라벨 — 기본(선 자세·스코프 꺼짐)이 아니면 켜진 색으로 보여 준다. */
  function updatePostureButton() {
    const cur = POSTURES.find(x => x[0] === state.posture) || POSTURES[0];
    const on = state.posture !== 'stand' || state.scope;
    $('#postureBtnText').textContent = cur[1] + (state.scope ? ' · 스코프' : '');
    $('#postureBox').classList.toggle('on', on);
    $('#postureBtn').title = cur[1] + ' — ' + cur[2] + (state.scope ? '\n스코프 조준 — 사격 피해 +5%' : '');
  }

  /** 안전 영역(상태바·노치) 높이 — body 패딩으로 들어가 있다. fixed 메뉴를 그 아래로 밀 때 쓴다. */
  const safeTop = () => parseFloat(getComputedStyle(document.body).paddingTop) || 0;

  /** 자세(라디오) + 스코프(체크) 드롭다운. 성능의 스킬 메뉴와 같은 모양·조작.
   *  무장 머리(.w-tools)가 overflow:auto 라 안쪽에 두면 잘린다 — body 로 띄운다. */
  function openPostureMenu(btn) {
    document.querySelectorAll('.posture-menu').forEach(m => m.remove());
    const menu = el('div', 'skill-menu posture-menu');
    const mk = (type, name, checked, k, v, onChange) => {
      const item = el('label', 'skill-item');
      const inp = el('input');
      inp.type = type;
      if (name) inp.name = name;
      inp.checked = checked;
      inp.onchange = () => onChange(inp);
      item.append(inp);
      const tx = el('div');
      tx.append(el('span', 'k', k));
      tx.append(el('span', 'v', v));
      item.append(tx);
      return item;
    };
    for (const [val, label, desc] of POSTURES) {
      menu.append(mk('radio', 'posture', state.posture === val, label, desc, () => {
        state.posture = val;
        updatePostureButton();
        renderWeapons();            // 자세 보정은 무장 피해에만 영향
      }));
    }
    menu.append(el('div', 'skill-sep'));
    menu.append(mk('checkbox', null, state.scope, '스코프', '사격 피해 +5% (자세와 겹쳐 적용)', inp => {
      state.scope = inp.checked;
      updatePostureButton();
      renderWeapons();
    }));

    document.body.append(menu);
    const rc = btn.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(6, Math.min(rc.left, window.innerWidth - mw - 8)) + 'px';
    const below = rc.bottom + 4;
    menu.style.top = (below + mh <= window.innerHeight - 8
      ? below                                             // 아래로 펼치는 게 기본
      : Math.max(safeTop() + 6, rc.top - mh - 4)) + 'px';  // 안 들어가면 위로
    menu.onclick = ev => ev.stopPropagation();
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
    }), 0);
  }

  /** 버튼 라벨·색만 갱신한다 (메뉴는 다시 그리지 않아 체크 시 스크롤이 튀지 않는다). */
  function updateSkillButton() {
    const n = state.skillPicks.size;
    const box = $('#skillBox'), act = activeSkills();
    box.classList.toggle('on', n === 1);
    box.classList.toggle('multi', n > 1);
    $('#skillBtnText').textContent = n === 0 ? '스킬' : n === 1 ? act[0].nameKo : '스킬 ' + n + '개';
    $('#skillBtn').title = n
      ? act.map(s => s.nameKo + ' (' + skillDur(s) + ')').join('\n')
      : '발동할 기체 스킬 고르기';
  }

  /**
   * 기체 스킬 선택 드롭다운. 체크박스라 여러 개를 겹쳐 발동할 수 있다.
   * 스킬이 아예 없거나, 현재 기체 LV 에서 쓸 수 있는 스킬이 없으면 통째로 숨긴다.
   */
  function renderSkillControls() {
    const box = $('#skillBox'), menu = $('#skillMenu');
    const avail = availableSkills();       // 현재 LV 에서 쓸 수 있는 스킬만
    if (!avail.length) {
      box.hidden = true;
      menu.hidden = true;
      menu.innerHTML = '';               // 이전 기체의 항목·상태를 남기지 않는다
      state.skillPicks.clear();
      box.classList.remove('on', 'multi');
      $('#skillBtnText').textContent = '스킬';
      return;
    }
    box.hidden = false;
    // LV 이 바뀌어 못 쓰게 된 선택은 정리한다
    for (const i of [...state.skillPicks]) if (!avail.some(x => x.i === i)) state.skillPicks.delete(i);

    menu.innerHTML = '';
    for (const { sk, i } of avail) {
      const s = skillSummary(sk);
      const item = el('label', 'skill-item');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = state.skillPicks.has(i);
      cb.onchange = () => {
        cb.checked ? state.skillPicks.add(i) : state.skillPicks.delete(i);
        updateSkillButton();            // 메뉴는 그대로 두고 버튼·성능·무장만 갱신
        renderStats();
        renderWeapons();
      };
      item.append(cb);
      const tx = el('div');
      tx.append(el('span', 'k', sk.nameKo));
      const v = el('span', 'v');
      v.append(el('b', '', s.num));
      v.append(document.createTextNode('  ·  ' + s.how));
      tx.append(v);
      item.append(tx);
      menu.append(item);
    }
    updateSkillButton();
  }

  function renderAll() {
    renderHero();
    renderFormSeg();
    renderSkillControls();
    renderLevelSwitch();
    // 기체 목록은 ① 선택 화면에서만 갱신 (파츠 장착 때마다 1,671기를 재정렬·재생성하지 않도록)
    if (state.view !== 'build') renderMsList();
    renderSlots();
    renderEquipped();
    renderStats();
    renderPartList();
    renderBannedCount();
    renderIncompleteNotice();
    renderDetail(state.detailPart);
    renderWeapons();
    if (!document.getElementById('mskillInline').hidden) renderMskill();
  }

  /** 무장·스킬 데이터가 아직 없는 기체(예: gbo2.jp 선패치·위키 미반영)면 상단에 붉은 경고를 띄운다. */
  function renderIncompleteNotice() {
    const box = $('#incompleteNotice');
    if (!box) return;
    if (!state.ms) { box.hidden = true; return; }
    const noWeapons = msWeapons().length === 0;
    const noSkills = !((msSkillsData[baseName(state.ms.MS名)] || []).some(m => (m.skills || []).length));
    if (noWeapons || noSkills) {
      const miss = [noWeapons && '무장', noSkills && '스킬'].filter(Boolean).join('·');
      box.textContent = `⚠ 이 기체는 ${miss} 정보가 아직 없습니다 — 추후 업데이트에서 반영될 예정입니다.`;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  /* ---------- 초기화 ---------- */

  function buildControls() {
    $('#brandImg').src = defaultImg('ms');

    // 강화리스트 — 세그먼트 버튼 (미강화 / 4단계 / 풀강)
    const seg = $('#stageSeg');
    for (const [v, label] of [[0, '미강화'], [4, '4단계'], [6, '풀강']]) {
      const b = el('button', 'seg-btn' + (state.stage === v ? ' on' : ''), label);
      b.dataset.v = String(v);
      b.onclick = () => setStage(v);
      seg.append(b);
    }

    const exp = $('#expansion');
    for (const name of C.EXPANSION_SKILLS) exp.append(new Option(C.EXPANSION_LABEL[name] || name, name));

    // 확장 스킬 레벨 (LV1~LV5) — 스킬을 고르지 않았을 땐 비활성
    const expLv = $('#expLevel');
    for (let lv = 1; lv <= C.MAX_EXPANSION_LEVEL; lv++) expLv.append(new Option('LV' + lv, String(lv)));
    expLv.value = String(state.expLevel);
    const syncExpLv = () => { expLv.disabled = state.expansion === C.EXPANSION_NONE; };
    syncExpLv();
    exp.onchange = () => { state.expansion = exp.value; state.autoExpansion = false; syncExpLv(); renderAll(); };
    expLv.onchange = () => { state.expLevel = Number(expLv.value); renderAll(); };

    const preset = $('#preset');
    preset.append(new Option('— 프리셋 선택 —', ''));
    for (const name of Object.keys(O.PRESETS)) preset.append(new Option(name, name));
    preset.onchange = () => {
      if (!preset.value) return;
      state.weights = {};
      for (const k of C.STAT_KEYS) state.weights[k] = 0;
      Object.assign(state.weights, O.PRESETS[preset.value]);
      state.weightsTouched = true;
      renderAutoGrid();
    };

    // 필터 칩 공통 빌더 — 한 줄의 칩을 만들고 선택 상태를 state[key]에 반영한다
    function buildChips(boxSel, items, key, extraClass) {
      const box = $(boxSel);
      for (const it of items) {
        const cls = 'chip'
          + (extraClass ? ' ' + extraClass(it) : '')
          + (state[key] === it.v ? ' on' : '');
        const chip = el('button', cls, it.label);
        chip.onclick = () => {
          state[key] = it.v;
          state.msLimit = 80;
          [...box.children].forEach(c => c.classList.remove('on'));
          chip.classList.add('on');
          renderMsList();
        };
        box.append(chip);
      }
    }

    // 속성: 전체 · 강습 · 범용 · 지원
    buildChips('#attrChips',
      [{ label: '전체', v: '' }, { label: T.attrName('強襲'), v: '強襲' },
       { label: T.attrName('汎用'), v: '汎用' }, { label: T.attrName('支援'), v: '支援' }],
      'msAttr', it => 'attr-' + it.v);
    buildChips('#costChips', COST_CHIPS, 'msCost');
    buildChips('#levelChips', LEVEL_CHIPS, 'msLv');
    buildChips('#rarityChips', RARITY_CHIPS, 'msRarity');

    $('#msQuery').oninput = e => {
      state.msQuery = T.norm(e.target.value);
      state.msLimit = 80;
      renderMsList();
    };
    $('#partQuery').oninput = e => { state.partQuery = T.norm(e.target.value); renderPartList(); };

    const tabs = $('#tabs');
    for (const cat of [C.CATEGORY_ALL, ...C.CATEGORIES]) {
      const b = el('button', 'chip' + (state.partTab === cat ? ' on' : ''),
        cat === C.CATEGORY_ALL ? '전체' : C.CATEGORY_LABEL[cat]);
      b.onclick = () => {
        state.partTab = cat;
        [...tabs.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderPartList();
      };
      tabs.append(b);
    }


    // 기체 스킬 드롭다운 — 바깥을 누르면 닫는다
    $('#skillBtn').onclick = ev => {
      ev.stopPropagation();
      const menu = $('#skillMenu');
      menu.hidden = !menu.hidden;
    };
    $('#skillMenu').onclick = ev => ev.stopPropagation();
    document.addEventListener('click', () => { $('#skillMenu').hidden = true; });

    // 사격 자세 — 선 자세 / 앉기·정지 / 엎드리기 중 하나. 스코프는 자세와 별개 토글.
    const sortSeg = $('#weaponSort');
    if (sortSeg) for (const [v, label] of [['default', '기본순'], ['power', '위력'], ['dps', 'DPS'], ['stagger', '누적치']]) {
      const b = el('button', 'seg-btn' + (state.weaponSort === v ? ' on' : ''), label);
      b.onclick = () => {
        state.weaponSort = v;
        [...sortSeg.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderWeapons();
      };
      sortSeg.append(b);
    }
    // 자세·스코프는 버튼 4개가 가로를 크게 먹어(폰에선 표 머리를 밀어냈다)
    // 성능의 「스킬 ▾」 와 같은 드롭다운 하나로 묶었다. 자세는 라디오, 스코프는 체크.
    updatePostureButton();
    $('#postureBtn').onclick = ev => {
      ev.stopPropagation();
      if (document.querySelector('.posture-menu')) { document.querySelector('.posture-menu').remove(); return; }
      openPostureMenu(ev.currentTarget);
    };

    $('#backToSelect').onclick = () => setView('select');

    // 스텝퍼: 1단계는 언제든 클릭해 기체 목록으로, 2단계는 기체가 있을 때만
    $('#stepper').querySelectorAll('li[data-step]').forEach(li => {
      li.onclick = () => {
        if (li.dataset.step === 'build' && !state.ms) { toast('먼저 기체를 선택하세요'); return; }
        setView(li.dataset.step);
      };
    });

    $('#openAuto').onclick = () => openDrawer(true);
    $('#closeAuto').onclick = () => openDrawer(false);
    $('#drawerBack').onclick = () => openDrawer(false);
    $('#runAuto').onclick = runAuto;
    // 결과 모달 — 더보기(최대 10개)·닫기·배경 클릭
    $('#autoMore').onclick = () => {
      state.autoShown = Math.min(10, (state.autoCandidates || []).length);
      renderAutoResults(state.autoCandidates || []);
    };
    $('#autoModalClose').onclick = () => openResultModal(false);   // 상세로 되돌림(후보는 유지)
    $('#autoResultShow').onclick = () => openResultModal(true);     // 남아 있는 결과 다시 보기
    $('#clearParts').onclick = () => {
      if (!state.equipped.length) { toast('장착한 파츠가 없습니다'); return; }
      const snap = snapshotEquip();
      state.equipped = [];
      state.locked.clear();
      renderAll();
      undoToast('파츠 ' + snap.equipped.length + '개를 모두 해제', snap);
    };

    // 저장: 이름을 지정해 목록에 담는다 / 불러오기: 저장 목록을 카드로 연다
    $('#save').onclick = saveCurrentBuild;
    $('#load').onclick = () => openSavedModal(true);
    $('#savedModalClose').onclick = () => openSavedModal(false);
    $('#savedModalBack').onclick = () => openSavedModal(false);
    // 빌드 A/B 비교
    $('#compareBtn').onclick = () => { if (!state.ms && !loadBuilds().length) { toast('먼저 기체를 고르거나 구성을 저장하세요'); return; } openCompareModal(true); };
    $('#compareModalClose').onclick = () => openCompareModal(false);
    $('#compareModalBack').onclick = () => openCompareModal(false);
    $('#cmpA').onchange = renderCompare;
    $('#cmpB').onchange = renderCompare;

    // 무장 헤더 '스킬' — 이 기체의 스킬 목록·설명 (무장 칸 안에서 토글)
    $('#skillListBtn').onclick = () => {
      if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
      // 모바일에선 별도 시트로 연다(무장 표와 섞이면 보기 어렵다). 데스크톱은 기존 인라인 토글.
      if (isMobileView() && openMobileSheet) openMobileSheet('mskill-inline');
      else openMskill($('#mskillInline').hidden);   // 토글
    };
    // 패널 안 '닫기' — 모바일에선 시트로 떠 있으므로 시트까지 닫아야 백드롭이 사라진다
    $('#mskillClose').onclick = () => {
      if (isMobileView() && $('#mskillInline').classList.contains('sheet-open')) closeMobileSheets();
      else openMskill(false);
    };

    // 불러오기 결과 안내 — 제외된 파츠가 있으면 조용히 넘기지 않는다 (가져오기에서 사용)
    const loadedMsg = (r, okText) => r.missing
      ? `${okText} — 알 수 없는 파츠 ${r.missing}개는 제외했습니다`
      : okText;
    $('#share').onclick = () => {
      if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
      const code = encodeShare();
      // 실패 시(파일 열람 등 비보안 컨텍스트) 직접 복사할 수 있도록 프롬프트로 대체
      const fallback = () => { toast('아래 코드를 복사하세요'); prompt('공유 코드 (Ctrl+C 로 복사)', code); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(() => toast('공유 코드를 복사했습니다'), fallback);
        } else fallback();
      } catch { fallback(); }
    };
    $('#importBtn').onclick = () => {
      const text = prompt('공유 코드(또는 예전 JSON)를 붙여넣으세요');
      if (!text) return;
      const obj = decodeShare(text);
      if (!obj) { toast('공유 코드 형식이 올바르지 않습니다'); return; }
      const r = deserialize(obj);
      toast(r.ok ? loadedMsg(r, '구성을 불러왔습니다') : '알 수 없는 기체입니다');
    };

    // PNG 이미지 배출 — 요약/상세 중 선택 (요약: 성능만 · 상세: 무장 피해까지)
    $('#pngBtn').onclick = ev => {
      ev.stopPropagation();
      const old = document.querySelector('.png-menu'); if (old) { old.remove(); return; }
      const menu = el('div', 'png-menu');
      const mk = (t, s, mode) => {
        const b = el('button', 'png-menu-item');
        b.append(el('span', 'pm-t', t));
        b.append(el('span', 'pm-s', s));
        b.onclick = () => { menu.remove(); exportPng(mode); };
        return b;
      };
      menu.append(mk('요약 카드', '기체 · 파츠 · 성능', 'summary'));
      menu.append(mk('상세 카드', '+ 무장 피해량', 'detail'));
      document.body.append(menu);
      const rc0 = ev.currentTarget.getBoundingClientRect();
      // 모바일에선 이 버튼이 「⋯」 안에 접혀 있어 rect 가 0 이다 — 그때는 「⋯」를 기준으로.
      const rc = rc0.width ? rc0 : ($('#topbarMore') || document.body).getBoundingClientRect();
      menu.style.top = (rc.bottom + 4) + 'px';
      menu.style.left = Math.max(6, Math.min(rc.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
      setTimeout(() => document.addEventListener('click', function h(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
      }), 0);
    };

    $('#pngSave').onclick = savePngShot;
    $('#pngCopy').onclick = copyPngShot;
    $('#pngClose').onclick = () => openPngModal(false);
    $('#pngModalBack').onclick = () => openPngModal(false);

    // 피탄 시뮬레이터 — 적 무장에 몇 발 버티는지 / 몇 발에 다운되는지
    $('#pietanBtn').onclick = () => openPietan(true);
    $('#pietanClose').onclick = () => openPietan(false);
    $('#pietanBack').onclick = () => openPietan(false);
    $('#pietanQuery').oninput = () => renderPietanLeft();
    $('#pietanCorr').oninput = () => { pietanCorr = Math.max(0, Number($('#pietanCorr').value) || 0); pietanCorrTouched = true; renderPietanResult(); };
    $('#pietanShield').onclick = () => {
      pietanShield = !pietanShield;
      $('#pietanShield').classList.toggle('on', pietanShield);
      renderWeapons();          // 무장 표의 실드 보정 칩도 같이 켜고 끈다
      renderPietanResult();
    };
    $('#pietanAttr').onclick = ev => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      pietanAttr = b.dataset.a; pietanAttrTouched = true;   // 수동 지정 — 기체 바꿔도 유지
      [...$('#pietanAttr').children].forEach(c => c.classList.toggle('on', c === b));
      renderPietanResult();
    };

    // 기본 파츠 설정 — 기본 제외 파츠 관리 (영구 저장, 우클릭과 동일 세트)
    $('#ownedBtn').onclick = () => openOwnedModal(true);
    $('#ownedModalClose').onclick = () => openOwnedModal(false);
    $('#ownedModalBack').onclick = () => openOwnedModal(false);
    $('#ownedQuery').oninput = () => renderOwnedList();
    $('#ownedClear').onclick = () => {
      if (!state.banned.size) return;
      state.banned.clear();
      saveBanned();
      renderOwnedList();
      updateOwnedUi();
    };

    // 창 크기가 바뀌면 예산(vh)이 달라지므로 줄 맞춤을 다시 한다
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitWholeRows($('#partList')), 120);
    });

    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (mobileSheetOpen()) { closeMobileSheets(); return; }   // 모바일 슬라이드 시트 먼저 닫기
      if (!$('#mskillInline').hidden) { openMskill(false); return; }
      if (!$('#pietanModal').hidden) { openPietan(false); return; }
      if (!$('#compareModal').hidden) { openCompareModal(false); return; }
      if (!$('#ownedModal').hidden) { openOwnedModal(false); return; }
      if (!$('#savedModal').hidden) { openSavedModal(false); return; }
      if (!$('#autoResultPanel').hidden) { openResultModal(false); return; }
      if ($('#autoDrawer').classList.contains('open')) { openDrawer(false); return; }

      // 입력 중이면 화면을 벗어나지 않는다 — 내용이 있으면 비우고, 없으면 포커스만 해제
      const t = ev.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
        if (t.value) { t.value = ''; t.dispatchEvent(new Event('input')); }
        else t.blur();
        return;
      }

      if (state.view === 'build') setView('select');
    });
  }

  // 모바일 슬라이드 시트 — 성능·무장·상세를 오른쪽에서 열고 닫는다(하단 액션바로 토글).
  // ESC/뒤로가기가 이 함수들을 참조하므로 모듈 스코프에 둔다.
  let closeMobileSheets = () => {};
  let mobileSheetOpen = () => false;
  let openMobileSheet = null;                      // 모바일 시트 열기(설치되면 채워진다)
  const isMobileView = () => window.matchMedia('(max-width: 700px), (max-height: 560px) and (pointer: coarse), (max-height: 560px) and (max-width: 1100px)').matches
    && document.body.classList.contains('view-build');
  /** 모바일 상단바 — 버튼 9개가 390px 폭에 1,211px 로 깔려 가로 스크롤로만 닿았다.
   *  자주 쓰는 것(피탄 시뮬·자동 구성)만 남기고 나머지는 「⋯」 메뉴로 접는다.
   *  메뉴 항목은 원래 버튼을 그대로 click() 하므로 동작·상태는 한 벌만 유지된다. */
  const TOPBAR_MORE = ['#save', '#load', '#compareBtn', '#share', '#pngBtn', '#importBtn', '#ownedBtn'];
  function setupTopbarOverflow() {
    const bar = document.querySelector('.topbar'); if (!bar) return;
    for (const sel of TOPBAR_MORE) { const b = $(sel); if (b) b.classList.add('in-more'); }
    const btn = el('button', 'btn-ghost topbar-more');
    btn.id = 'topbarMore'; btn.textContent = '⋯';
    btn.title = '저장 · 저장 목록 · 비교 · 공유 · 이미지 · 가져오기 · 기본 파츠 설정';
    btn.setAttribute('aria-label', '더보기');
    bar.append(btn);
    btn.onclick = ev => {
      ev.stopPropagation();
      const old = document.querySelector('.more-menu'); if (old) { old.remove(); return; }
      const menu = el('div', 'png-menu more-menu');
      const onSelect = document.body.classList.contains('view-select');
      for (const sel of TOPBAR_MORE) {
        const src = $(sel);
        if (!src || (onSelect && src.classList.contains('step-only'))) continue;   // 기체 선택 화면에선 숨는 것들
        const it = el('button', 'png-menu-item');
        it.append(el('span', 'pm-t', src.textContent.trim()));
        if (src.title) it.append(el('span', 'pm-s', src.title));
        it.onclick = () => { menu.remove(); src.click(); };
        menu.append(it);
      }
      document.body.append(menu);
      const rc = btn.getBoundingClientRect();
      menu.style.top = (rc.bottom + 4) + 'px';
      menu.style.left = Math.max(6, Math.min(rc.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
      setTimeout(() => document.addEventListener('click', function h(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
      }), 0);
    };
  }

  function setupMobileSheets() {
    // 파츠 상세는 인라인(장착↔파츠 사이)로 두고, 성능·무장만 슬라이드 시트로.
    const sheets = [
      { cls: 'build-stats', label: '📊 성능' },
      { cls: 'build-weapons', label: '🗡 무장' },
      // 스킬은 원래 무장 칸 안 인라인인데, 모바일에선 무장 표와 섞여 보기 어려워 시트로 뗀다.
      { cls: 'mskill-inline', label: '🛠 스킬' }
    ];
    const target = c => document.querySelector('.' + c);
    const backdrop = el('div', 'sheet-backdrop');
    const bar = el('div', 'm-actionbar');
    const btns = {};
    // 시트를 열 때 body 로 옮긴다 — transform 있는 조상(.build-bottom 등)이 fixed 의 기준이 되어
    // 시트가 어긋나던 버그를 원천 차단. 닫히면(슬라이드 아웃 후) 원위치로 되돌린다.
    const origPos = {};
    const toBody = cls => {
      const t = target(cls);
      if (!t || t.parentElement === document.body) return;
      origPos[cls] = { parent: t.parentElement, next: t.nextSibling };
      document.body.appendChild(t);
    };
    const restoreClosed = () => {
      for (const s of sheets) {
        const t = target(s.cls), o = origPos[s.cls];
        if (t && o && t.parentElement === document.body && !t.classList.contains('sheet-open')) {
          o.parent.insertBefore(t, o.next); origPos[s.cls] = null;
        }
      }
    };
    // 스킬 패널만 hidden 속성으로 여닫히므로(데스크톱 인라인 동작) 시트로 쓸 때도 함께 맞춘다.
    const SKILL = 'mskill-inline';
    const close = () => {
      let any = false;
      for (const s of sheets) { const t = target(s.cls); if (t) { if (t.classList.contains('sheet-open')) any = true; t.classList.remove('sheet-open'); } btns[s.cls].classList.remove('on'); }
      backdrop.classList.remove('on');
      const sp = target(SKILL);
      if (sp && !sp.hidden) { sp.hidden = true; const sb = document.getElementById('skillListBtn'); if (sb) sb.classList.remove('on'); }
      if (any) setTimeout(restoreClosed, 320);   // 슬라이드 아웃 애니메이션 후 원위치
    };
    const open = cls => {
      const already = target(cls) && target(cls).classList.contains('sheet-open');
      close();
      if (already || !target(cls)) return;
      if (cls === SKILL) { target(cls).hidden = false; renderMskill(); }
      toBody(cls); target(cls).classList.add('sheet-open'); btns[cls].classList.add('on'); backdrop.classList.add('on');
    };
    openMobileSheet = open;
    for (const s of sheets) {
      const b = el('button', 'btn-ghost', s.label);
      b.onclick = () => open(s.cls);
      btns[s.cls] = b;
      bar.append(b);
    }
    backdrop.onclick = close;
    document.body.append(backdrop, bar);
    // 각 시트에 닫기(✕) 버튼 — 시트가 열렸을 때만 보인다(CSS).
    for (const s of sheets) {
      const tgt = target(s.cls);
      if (tgt) { const x = el('button', 'sheet-close', '✕'); x.title = '닫기'; x.onclick = close; tgt.appendChild(x); }
    }

    // ── 스와이프 제스처 — '성능' 시트에만 둔다 ─────────────────────────────
    // 무장 시트는 가로로 훑어 볼 내용(무장 표)이 있어 그 드래그가 닫기로 잡혀 창이
    // 멋대로 닫혔다. 그래서 무장은 버튼 전용(하단 버튼·✕·배경 탭)으로 두고,
    // 가로로 끌 일이 없는 성능 시트만 제스처를 유지한다.
    //   열기 — 오른쪽 가장자리에서 왼쪽으로 / 닫기 — 오른쪽으로 밀기
    const STATS = 'build-stats', EDGE = 30, OPEN_AT = 0.32;
    let drag = null;
    const isMob = () => window.matchMedia('(max-width: 700px), (max-height: 560px) and (pointer: coarse), (max-height: 560px) and (max-width: 1100px)').matches && document.body.classList.contains('view-build');
    const isOpen = cls => { const t = target(cls); return !!(t && t.classList.contains('sheet-open')); };

    document.addEventListener('touchstart', ev => {
      if (drag || !isMob() || ev.touches.length !== 1) return;
      // 성능 외의 시트(무장·스킬…)가 떠 있으면 제스처가 일절 개입하지 않는다.
      // 시트를 새로 추가할 때 여기 조건을 빠뜨리기 쉬워, 이름을 하나씩 적지 않고 목록에서 뽑는다.
      if (sheets.some(x => x.cls !== STATS && isOpen(x.cls))) return;
      const x = ev.touches[0].clientX, y = ev.touches[0].clientY;
      if (isOpen(STATS)) {
        drag = { mode: 'close', x0: x, y0: y, sheet: target(STATS), size: target(STATS).getBoundingClientRect().width, prog: 0, axis: null };
      } else if (x >= window.innerWidth - EDGE) {
        drag = { mode: 'open', x0: x, y0: y, sheet: null, size: 0, prog: 0, axis: null };   // 셋업은 실제로 끌 때
      }
    }, { passive: true });

    document.addEventListener('touchmove', ev => {
      if (!drag) return;
      const dx = ev.touches[0].clientX - drag.x0, dy = ev.touches[0].clientY - drag.y0;
      if (!drag.axis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dx) <= Math.abs(dy)) { drag = null; return; }   // 세로 우세 → 스크롤이지 제스처가 아니다
        drag.axis = 'go';
        if (drag.mode === 'open') {
          toBody(STATS);
          drag.sheet = target(STATS);
          drag.size = drag.sheet.getBoundingClientRect().width || Math.min(window.innerWidth * 0.94, 480);
          drag.sheet.style.transition = 'none';
          drag.sheet.style.transform = 'translateX(100%)';
          backdrop.classList.add('on'); backdrop.style.transition = 'none'; backdrop.style.opacity = '0';
        } else { drag.sheet.style.transition = 'none'; backdrop.style.transition = 'none'; }
      }
      const prog = Math.min(1, Math.max(0, drag.mode === 'open' ? -dx : dx) / drag.size);
      drag.prog = prog;
      drag.sheet.style.transform = `translateX(${(drag.mode === 'open' ? (1 - prog) : prog) * 100}%)`;
      backdrop.style.opacity = String(drag.mode === 'open' ? prog : (1 - prog));
    }, { passive: true });

    function endDrag(commit) {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.axis) return;                        // 탭이었을 뿐 — 손댄 게 없으니 정리도 불필요
      if (d.sheet) { d.sheet.style.transition = ''; d.sheet.style.transform = ''; }
      backdrop.style.transition = ''; backdrop.style.opacity = '';
      if (!commit) { if (d.mode === 'open') close(); return; }
      if (d.mode === 'open') {
        if (d.prog > OPEN_AT) { d.sheet.classList.add('sheet-open'); btns[STATS].classList.add('on'); backdrop.classList.add('on'); }
        else close();
      } else if (d.prog > OPEN_AT) close();
    }
    document.addEventListener('touchend', () => endDrag(true), { passive: true });
    document.addEventListener('touchcancel', () => endDrag(false), { passive: true });

    closeMobileSheets = close;
    mobileSheetOpen = () => sheets.some(s => target(s.cls) && target(s.cls).classList.contains('sheet-open'));
  }

  buildControls();
  renderAutoGrid();
  setupTopbarOverflow();  // 모바일: 상단바 보조 버튼을 「⋯」 메뉴로 접는다
  setupMobileSheets();    // 모바일: 성능·무장·상세 슬라이드 시트 + 하단 액션바
  loadBanned();           // 저장된 기본 제외 파츠 복원
  loadFavRecent();        // 즐겨찾기·최근 기체 복원
  renderViewChips();
  renderDataFresh();
  updateOwnedUi();        // 버튼 배지·모달 노트 초기화
  // 빌드 화면이 곧바로 채워지도록 기본 기체를 잡아두되, 시작 화면은 ① 기체 선택.
  state.ms = msData.find(m => T.msName(m.MS名).startsWith('건담 ')) || msData[0];
  renderAll();
  setView('select');
})();

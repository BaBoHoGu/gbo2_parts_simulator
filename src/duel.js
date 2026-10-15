/* ═══ 대결 시뮬레이터 (피탄 시뮬 개편 시안) ═══════════════════════════
 * 앱이 밖으로 내놓은 것만 쓴다 — GBO2Core · GBO2Damage · GBO2i18n · GBO2_* 데이터.
 *
 * 앱 안쪽 함수(fireMult · staggerSkillsOf · conditionalPartCuts · fixedDamageWithParts · state)는
 * 바깥에서 부를 수 없어 간이판을 두었다. 간이판은 전부 아래 HOOK 한 곳에 모았다(★).
 * 본 적용 때는 앱 클로저 안에서 GBO2Duel.use({ ... }) 로 갈아 끼운다 — 이 파일은 고치지 않는다.
 *
 *   HOOK.hitsPerTrigger(wp, charged)  → 앱 fireMult(w).nc / .ch 의 n
 *   HOOK.defSkills(side)              → 앱 staggerSkillsOf + activeStaggerMods 의 cuts
 *   HOOK.extraCuts(A, B, wp)          → 앱 conditionalPartCuts(B 파츠, 무장)  (관통·폭풍 경감)
 *   HOOK.fixedDamage(A, wp)           → 앱 fixedDamageWithParts(w, A 파츠).total  (소이 등)
 *   HOOK.seed(left, setMs, force)     → 앱 state.ms · state.equipped · state.stage 를 왼쪽에
 *   HOOK.airMelee(side, wp)           → 앱 airMeleeOf + airMeleeWeapon  (공중 격투 위력 상승)
 *   HOOK.durability(side, st)         → 앱 enduranceOf + damageCutsOf  (속성별 내구 지표)
 *   HOOK.shield(side)                 → 앱 shieldOf        (그 쪽이 든 실드와 HP)
 *   HOOK.onShield(on)                 → 앱이 무장 표의 실드 보정 칩을 켜고 끈다
 *   HOOK.shieldHit(wp, dmg, charged, atkParts) → 앱 shieldHit + weaponIgnoresShield
 *   HOOK.bandWhy(info)                → 앱 hpBandWhy      (구간 무장의 발마다 피해)
 *   HOOK.bandUnknown(why)             → 앱 hpUnknownNote  (셈에 못 넣은 구간을 밝힌다)
 *   HOOK.foeArmorCut(side, wp)        → 앱 weaponFoeArmorCut + foeArmorCutOf  (적 내성 깎기)
 *   HOOK.react(wp)                    → 앱 reactOf         (강경직 / 조건부 강경직 / 경직)
 *   HOOK.stagger(side, wp)            → 앱 parseStagger + activeStaggerMods  (경직까지 히트)
 *   HOOK.goalRow(info)                → 앱 goalRowFor      (N발 버티기 → 자동 구성 목표)
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const C = window.GBO2Core, D = window.GBO2Damage, T = window.GBO2i18n;
  const G = window.GBO2_DATA, WP = window.GBO2_WEAPONS || {}, SK = window.GBO2_SKILLS || {};
  const IM = window.GBO2_IMAGES || {};
  const SKT = (window.GBO2_I18N && window.GBO2_I18N.skillText) || {};
  if (!C || !D || !T || !G) return;

  /* ---------- 데이터 도우미 ---------- */
  const baseName = n => String(n).replace(/_LV\d+$/, '');
  const msLv = ms => C.msLevel(ms.MS名);
  /* 그림 주소는 **앱의 imgUrl 하나**로 정한다 — 오프라인판은 인라인(GBO2_IMAGES), 사이트판은 images/ 주소.
     예전엔 인라인만 찾아 사이트에서 기체 그림이 다 비었다. 부를 때마다 찾으므로 실리는 순서와 무관하다. */
  const imgOf = key => (typeof window.GBO2ImgUrl === 'function' ? window.GBO2ImgUrl(key) : (IM[key] || ''));
  const msImg = ms => imgOf('ms/' + baseName(ms.MS名).normalize('NFC') + '.webp');
  /** 사이트판에서 그림 파일이 없는 기체 — 기본 그림으로 **한 번만** 바꾼다(그것도 없으면 그대로 둔다) */
  const fallbackOnce = (im, dir) => { im.onerror = () => { im.onerror = null; im.src = imgOf(dir + '/_default.webp'); }; };
  const partImg = p => imgOf('parts/' + String(p.name).normalize('NFC') + '.webp');
  const koMs = ms => T.msName(ms.MS名).replace(/\s*LV\d+$/, '');
  const pageId = ms => (String(ms && ms.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
  const allParts = Object.values(G.parts).flat();
  const byBase = new Map();
  for (const m of G.msData) {
    const b = baseName(m.MS名);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(m);
  }
  for (const arr of byBase.values()) arr.sort((a, b) => msLv(a) - msLv(b));

  const ATTR_KO = { solid: '실탄', beam: '빔', melee: '격투' };
  const ARMOR = { solid: 'armorRange', beam: 'armorBeam', melee: 'armorMelee' };
  const MS_ATTR_KO = { '強襲': '강습', '汎用': '범용', '支援': '지원' };
  const BEATS = { '汎用': '強襲', '強襲': '支援', '支援': '汎用' };
  const matchup = (a, d) => BEATS[a] === d ? 'advantage' : BEATS[d] === a ? 'disadvantage' : 'same';
  const MATCH_TXT = { advantage: '유리 ×1.3', same: '동일 ×1.0', disadvantage: '불리 ×0.8' };
  const fmt = n => Math.round(n).toLocaleString();

  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const btn = (cls, txt, on) => { const b = el('button', cls, txt); b.type = 'button'; if (on) b.onclick = on; return b; };

  /* ---------- 상태 ---------- */
  const mkSide = who => ({
    who, ms: null, stage: 6, parts: [],
    exp: C.EXPANSION_NONE, expLv: C.MAX_EXPANSION_LEVEL,   // 확장 스킬 — 쪽마다 따로 고른다
    buffs: new Set(),      // 공격·스탯 버프 스킬 (GBO2_SKILLS)
    defs: new Set(),       // 피해 경감 스킬 (msSkills 설명문)
    wKey: null, mode: 'nc', posture: 'stand', scope: false, variant: 0, dir: 0,
    air: false,            // 공중 격투 제어로 하는 공중 격투인가 (위력 상승)
    shieldOn: false,       // 이 쪽이 실드로 막는가 (맞는 쪽에 걸린다)
    /* 공격보정 직접 입력 — null 이면 구성에서 나온 값을 쓴다(자동).
       상대 파츠를 모를 때 보정만 어림해 넣으려고 둔다. 기체를 바꾸면 풀린다(setMs). */
    corr: { shoot: null, melee: null },
    pickParts: false, pq: '', pcat: 'all', pickMs: false, mq: '',
    mf: { attr: new Set(), cost: new Set(), lv: 0 },   // 기체 고르기 필터 — 속성 · 코스트(여럿) · LV(하나, 0=전체)
    form: 'normal',        // 'normal' | 'transform' — 변형 · 변신(NT-D) · 시스템 발동(트랜잠). 앱의 state.form 과 같은 뜻
    step: 1                // 이 쪽 무장으로 상대를 몇 발 맞혔는지 (게이지 미리보기)
  });
  const S = { L: mkSide('L'), R: mkSide('R'), tab: 'L' };
  const other = side => (side.who === 'L' ? S.R : S.L);

  /* ---------- 스킬 ---------- */
  /** 공격·스탯 버프 스킬 — 그 LV 에서 쓰는 효과만. */
  function buffSkills(side) {
    if (!side.ms) return [];
    const lv = msLv(side.ms), out = [];
    for (const sk of SK[baseName(side.ms.MS名)] || []) {
      const fit = (sk.levels || []).filter(l => lv >= l.from && (l.to == null || lv <= l.to));
      const e = fit[fit.length - 1];
      if (!e) continue;
      const tags = [];
      if (e.shoot) tags.push('사격+' + e.shoot);
      if (e.melee) tags.push('격투+' + e.melee);
      if (e.shootPct) tags.push('사격+' + e.shootPct + '%');
      if (e.meleePct) tags.push('격투+' + e.meleePct + '%');
      if (e.dmgAny) tags.push('피해+' + e.dmgAny + '%');
      if (e.dmgShoot) tags.push('사격피해+' + e.dmgShoot + '%');
      if (e.dmgMelee) tags.push('격투피해+' + e.dmgMelee + '%');
      if (e.armorRange || e.armorBeam || e.armorMelee) tags.push('내성+');
      if (e.hpUp) tags.push('HP+' + e.hpUp);
      if (!tags.length) continue;
      out.push({ name: sk.name, ko: sk.nameKo || sk.name, e, tags: tags.join(' · ') });
    }
    return out;
  }
  /** 켠 버프 → calcStats 의 skill 인자 (앱의 skillStatBonus 와 같은 모양). */
  function skillStatBonus(side, bare) {
    let any = false; const o = {}; let limitUp = 0;
    const add = (k, v) => { if (v) { o[k] = (o[k] || 0) + v; any = true; } };
    for (const s of buffSkills(side)) {
      if (!side.buffs.has(s.name)) continue;
      const e = s.e;
      add('shoot', (e.shoot || 0) + Math.round((bare.shoot || 0) * (e.shootPct || 0) / 100));
      add('meleeCorrection', (e.melee || 0) + Math.round((bare.meleeCorrection || 0) * (e.meleePct || 0) / 100));
      add('armorRange', e.armorRange); add('armorBeam', e.armorBeam); add('armorMelee', e.armorMelee);
      add('hp', e.hpUp);
      limitUp = Math.max(limitUp, e.limitUp || 0);
    }
    if (limitUp) o.limit = { shoot: limitUp, meleeCorrection: limitUp };
    return any ? o : null;
  }
  function skillDmgPcts(side, kind) {
    const out = [];
    for (const s of buffSkills(side)) {
      if (!side.buffs.has(s.name)) continue;
      const p = (s.e.dmgAny || 0) + (kind === 'melee' ? (s.e.dmgMelee || 0) : (s.e.dmgShoot || 0));
      if (p) out.push(p);
    }
    return out;
  }

  /** ★ 피해 경감 스킬 — 설명문에서 「…受けるダメージを N% 軽減」을 읽는 간이판.
   *  본 적용 때는 앱의 staggerSkillsOf(조건 축·상시 판정 포함)로 바꾼다. */
  const lvFits = (txt, lv) => {
    const m = String(txt || '').match(/LV(\d+)\s*(～|~)?\s*(?:LV(\d+))?/);
    if (!m) return true;
    const from = +m[1], to = m[3] ? +m[3] : (m[2] ? 99 : from);
    return lv >= from && lv <= to;
  };
  const CUT_RE = /(実弾|ビーム|格闘|射撃)?(?:属性)?(?:の)?(?:攻撃)?(?:から|による|で)?(?:受ける|被)ダメージ(?:を|が)?\s*(\d+)\s*[%％]\s*(?:軽減|減少|カット)/;
  function defSkillsDefault(side) {
    if (!side.ms) return [];
    const lv = msLv(side.ms);
    const groups = G.msSkills[baseName(side.ms.MS名)] || [];
    const best = new Map();
    for (const g of groups.slice(0, 1)) {
      for (const s of g.skills || []) {
        if (!lvFits(s.msLv, lv)) continue;
        const m = CUT_RE.exec(String(s.eff || ''));
        if (!m) continue;
        const scope = { '実弾': 'solid', 'ビーム': 'beam', '格闘': 'melee', '射撃': 'shoot' }[m[1]] || 'all';
        const always = /常時|常に/.test(s.eff);
        const prev = best.get(s.name);
        if (!prev || +m[2] > prev.pct) best.set(s.name, { name: s.name, pct: +m[2], scope, lv: s.lv, always });
      }
    }
    return [...best.values()].map(x => ({
      ...x, ko: SKT[x.name] || x.name,
      tag: '피해 −' + x.pct + '%' + (x.scope === 'all' ? '' : ' (' + ({ solid: '실탄', beam: '빔', melee: '격투', shoot: '사격' }[x.scope]) + ')')
    }));
  }

  /* ---------- 스탯 ---------- */
  function statsOf(side) {
    if (!side.ms) return null;
    /* 확장 스킬은 사격·격투 보정과 내성·상한을 올린다 — 「없음」으로 못 박아 두면
       실제로 끼고 싸우는 구성과 다른 수가 나온다. 쪽마다 고른 것을 그대로 넘긴다. */
    /* 모드도 넘긴다 — 유니콘 NT-D 는 사격 46 → 13 · 격투 22 → 65, 더블오 라이저 트랜잠은 사격 46 → 61 ·
       격투 30 → 60 이다. 예전엔 form 자리에 null 을 넘겨 늘 통상 수치로 셌다(사용자 지적 2026-10-15). */
    const run = skill => C.calcStats(side.ms, side.parts, side.stage, side.exp, G.parts, G.fullst,
      side.expLv, side.form === 'transform' ? 'transform' : 'normal', skill, null).total;
    const bare = run(null);
    const sk = skillStatBonus(side, bare);
    return sk ? run(sk) : bare;
  }
  const slotsOf = side => C.calcSlots(side.ms, side.parts, side.stage, G.fullst);

  /* ---------- 무장 ---------- */
  const noteOf = w => String((w.info && w.info['備考']) || '');
  const isTwoStage = w => /集束時間[：:][^/]*[（(]\s*[\d.]+\s*秒\s*[x×ｘ]\s*2/.test(noteOf(w));
  function weaponAttr(w) {
    if (w.type === 'melee' || w.attr === 'melee') return 'melee';
    if (w.attr === 'beam' || w.attr === 'solid') return w.attr;
    return D.isBeamWeapon(w) ? 'beam' : 'solid';
  }
  function weaponsOf(side) {
    if (!side.ms) return [];
    const page = WP[pageId(side.ms)];
    if (!page) return [];
    const lv = msLv(side.ms), out = [];
    (page.weapons || []).forEach((w, i) => {
      if (w.type === 'shield') return;
      /* ＜変身時＞使用可 · ＜通常時＞使用可 — 고른 모드에서 못 쓰는 무장은 뺀다(표기 없는 무장은 어느 모드나) */
      const wm = HOOK.weaponMode(w);
      if (wm && !(side.form === 'transform' ? wm.alt : wm.normal)) return;
      const lvs = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
      const fit = lvs.filter(l => l <= lv);
      const k = String(fit.length ? fit[fit.length - 1] : lvs[0]);
      const d = w.levels[k];
      const power = Number(d && d.power) || 0, charged = Number(d && d.powerCharged) || 0;
      if (!power && !charged) return;
      const note = noteOf(w), attr = weaponAttr(w), melee = attr === 'melee';
      const two = !melee && isTwoStage(w);
      out.push({
        key: i + ':' + w.name, w, attr, melee, power, charged, note, two,
        modes: melee ? [] : [
          { k: 'nc', t: '일반 사격', ok: power > 0, why: '집속 필수 무장 — 일반 사격 위력이 없습니다' },
          { k: 'ch', t: '집속 사격', ok: !two && charged > 0 && charged !== power,
            why: two ? '2단 집속 무장 — 1단계 위력은 위키에 없습니다' : '집속할 수 없는 무장입니다' },
          { k: 'ch2', t: '2단 집속', ok: two && charged > 0, why: '2단 집속 무장이 아닙니다' }
        ],
        canProne: !melee && !/伏せ(?:撃ち|射撃)不可/.test(note),
        canScope: !melee && !/スコープ使用不可/.test(note),
        variants: melee && w.melee && w.melee.variants && w.melee.variants.length ? w.melee.variants : null
      });
    });
    return out;
  }
  const pickedWeapon = side => weaponsOf(side).find(x => x.key === side.wKey) || null;

  /** ★ 방아쇠 한 번에 맞는 히트 수 — 동시발사·연속발사·조사 히트의 간이판.
   *  본 적용 때는 앱의 fireMult(무장 표의 「전탄」과 같은 자)로 바꾼다. */
  function hitsPerTriggerDefault(wp, charged) {
    const note = wp.note;
    const segs = note.split(/\s*\/\s*/).filter(s => charged ? !/非集束時/.test(s) : !/(?:^|[^非])集束時/.test(s));
    let shots = 1, volleys = 1, beam = 1;
    for (const s of segs) {
      let m;
      if ((m = s.match(/(\d+)\s*発同時発射/))) shots = Math.max(shots, +m[1]);
      if (/二発同時発射/.test(s)) shots = Math.max(shots, 2);
      if ((m = s.match(/[x×]\s*(\d+)\s*回攻撃/))) volleys = Math.max(volleys, +m[1]);
      if ((m = s.match(/(\d+)\s*発連続発射/))) volleys = Math.max(volleys, +m[1]);
      if (/二発連続発射/.test(s)) volleys = Math.max(volleys, 2);
      if ((m = s.match(/最大\s*(\d+)\s*(?:ヒット|HIT)/i))) beam = Math.max(beam, +m[1]);
    }
    return shots * volleys * beam;
  }

  /* ---------- ★ 교체 지점 ---------- */
  const HOOK = {
    hitsPerTrigger: (wp, charged) => hitsPerTriggerDefault(wp, charged),
    defSkills: side => defSkillsDefault(side),
    extraCuts: () => [],
    fixedDamage: () => 0,
    seed: (left, setMs, force) => seedDefault(left, setMs, force),
    /* ★ 아래 넷은 **앱 안쪽 판정**이라 간이판을 두지 않는다. 지어내면 두 번째 자가 된다 —
       안 걸렸으면 그 칸이 안 나올 뿐이고, 나온 수는 늘 앱의 수다. */
    durability: () => null,
    shield: () => null,
    onShield: () => {},
    shieldHit: () => null,
    bandWhy: () => '',
    bandUnknown: () => null,
    foeArmorCut: () => null,
    react: () => null,
    stagger: () => null,
    goalRow: () => null,
    /* ★ 공중 격투 제어 — 판정이 원문(ms_skills)에 있어 바깥에서 읽을 수 없다.
       간이판은 **없다고 답한다**. 지어내 답하면 앱과 다른 수가 나온다. */
    airMelee: () => null,
    /* ★ 모드 — 간이판은 **모른다고 답한다**(단추가 안 나온다). 앱이 altModeOf · weaponModeOf 를 넘긴다 */
    altMode: () => null,
    weaponMode: () => null
  };

  /* ---------- 한 방향의 계산 (공격 측 A → 대상 B) ---------- */
  function attack(A, B) {
    const wp = pickedWeapon(A);
    if (!wp || !B.ms) return null;
    const sA = statsOf(A), sB = statsOf(B);
    const kind = wp.melee ? 'melee' : 'shoot';
    const mode = wp.melee ? 'nc' : (wp.modes.find(m => m.k === A.mode && m.ok) || wp.modes.find(m => m.ok) || { k: 'nc' }).k;
    const charged = mode !== 'nc';
    let power = charged ? wp.charged : wp.power;
    /* 공중 격투 제어 — 그 스킬로 하는 공중 격투만 위력이 오른다. 방향도 그 공격으로 고정한다
       (땅에서의 N격·횡격에 얹으면 거짓이 된다). 수치를 낼 수 있는 때만 앱이 답을 준다. */
    const air = (A.air && wp.melee) ? HOOK.airMelee(A, wp) : null;
    if (air) power = air.power(power);
    /* 직접 입력한 보정이 있으면 그것을 쓴다 — 없으면 구성에서 나온 값. */
    const autoCorr = kind === 'melee' ? (sA.meleeCorrection || 0) : (sA.shoot || 0);
    const manual = A.corr ? A.corr[kind === 'melee' ? 'melee' : 'shoot'] : null;
    const corr = manual == null ? autoCorr : manual;
    const att = matchup(A.ms.属性, B.ms.属性);

    // 자세·스코프 — 사격 판정에만, (1 + ETCa) 로 곱해진다 (앱의 postureEtcA 와 같은 규칙)
    let etcA = 0; const etcTxt = [];
    if (kind === 'shoot') {
      const posture = (A.posture === 'prone' && !wp.canProne) ? 'stand' : A.posture;
      if (posture === 'crouch') { etcA += D.ETC_ATTACK.crouch; etcTxt.push('앉아서 +' + D.ETC_ATTACK.crouch * 100 + '%'); }
      if (posture === 'prone') { etcA += D.ETC_ATTACK.prone; etcTxt.push('엎드려 +' + D.ETC_ATTACK.prone * 100 + '%'); }
      if (A.scope && wp.canScope) { etcA += D.ETC_ATTACK.scope; etcTxt.push('스코프 +' + D.ETC_ATTACK.scope * 100 + '%'); }
    }
    // 격투 변형·방향 배율
    let ccd = [1], dirTxt = '', dirRaw = '';
    if (wp.variants) {
      const v = wp.variants[Math.min(A.variant, wp.variants.length - 1)];
      // 공중 격투는 원문이 가리키는 방향 하나로 고정된다 — 고른 방향을 쓰지 않는다
      const d = air ? (v.direction || []).find(z => z.label === air.dir)
        : v.direction[Math.min(A.dir, v.direction.length - 1)];
      if (d) {
        ccd = d.hits;
        dirRaw = d.label;
        dirTxt = (wp.variants.length > 1 ? v.label + ' ' : '')
          + (air ? '공중 ' : '') + dirLabel(d.label) + ' ' + d.raw;
      }
    }
    const raw = kind === 'melee'
      ? D.meleeDamage(power, corr, { attr: att, ccd })
      : D.shootingDamage(power, corr, { attr: att, etcA });
    const wm = D.weaponModsOf(A.parts, msLv(A.ms), A.ms.属性);
    const partPct = D.damagePctFor(wm, wp.w, kind) || 0;
    const skPcts = skillDmgPcts(A, kind);
    const boosted = D.applyDamagePct(raw, [partPct, ...skPcts]);
    /* 「攻撃対象の(特殊)緩衝材系スキル無視」 — 맞는 쪽의 완충재 스킬 경감을 **안 받는다**.
       예전엔 이 줄이 없어 무장 34종에서 피해를 작게(발수를 많게) 셌다. 조건은 원문 그대로:
       집속했을 때만 · 하격일 때만 · 「스킬 발동 중」(어느 스킬인지 원문에 없어 **셈에 안 넣고 밝힌다**). */
    const bi = D.bufferIgnoreOf ? D.bufferIgnoreOf(wp.note) : null;
    const biOn = !!bi && (bi.when === 'always' || (bi.when === 'charged' && charged)
      || (bi.when === 'down' && dirRaw === '下格'));
    const isBuffer = nm => bi && (bi.special ? /特殊緩衝材/ : /緩衝材/).test(String(nm || ''));
    // 대상의 피해 경감 — 파츠 + 켠 방어 스킬 (이름을 지닌 채 — 계산식에 하나씩 적는다)
    const allCuts = [
      ...C.partDamageCuts(B.parts, msLv(B.ms)).map(c => ({ ...c, label: '파츠 경감' })),
      ...HOOK.defSkills(B).filter(s => s.always || B.defs.has(s.name))
        .map(s => ({ scope: s.scope, pct: s.pct, label: s.ko || s.name, ignored: biOn && isBuffer(s.name) })),
      ...(HOOK.extraCuts(A, B, wp) || []).map(c => ({ ...c, label: c.label || '조건부 경감' }))];
    const cuts = allCuts.filter(c => !c.ignored);
    const factor = C.staggerDmgFactor(cuts, wp.attr);
    /* 계산식 표시용 중간값 — 셈을 다시 하지 않고 **위에서 쓴 값**을 그대로 넘긴다 */
    const atk = D.attackPower(corr);
    const tAtt = D.floorTo(atk * (1 + etcA), 2);
    const pr = D.ATTR_BONUS[att] ?? 0;
    const cutHits = c => c.scope === 'all' || c.scope === (wp.attr === 'melee' ? 'melee' : 'shoot') || c.scope === wp.attr;
    const hit = Math.floor(boosted * factor);
    const n = HOOK.hitsPerTrigger(wp, charged) || 1;
    const fixed = HOOK.fixedDamage(A, wp) || 0;           // 보정을 안 받는 고정 피해 — 경감도 안 건다
    const per = hit * n + fixed;
    /* 상대 내성을 깎는 몫 — **무장과 스킬 둘 다**. 「対象の耐ビーム補正を30%減でダメージ計算」
       은 보정값의 70% 상태라는 뜻이라, 빼지 않고 곱한다. 여럿이면 남는 비율을 곱한다.
       판정은 앱이 한다(간이판은 무장 것만 읽어 스킬 몫이 빠진다). */
    const fa = HOOK.foeArmorCut(A, wp);
    const fc = fa ? null : FOE_ARMOR_RE.exec(wp.note);
    const foeCut = fa ? fa.cut : (fc ? Number(fc[2]) : 0);
    const keep = fa ? fa.keep : (1 - foeCut / 100);
    const tB = foeCut ? { ...sB, [ARMOR[wp.attr]]: (sB[ARMOR[wp.attr]] || 0) * keep } : sB;
    const eff = C.durabilityOf(tB, ARMOR[wp.attr]);           // 실효 HP = HP ÷ (1 − 내성)
    const hp = Math.round(sB.hp || 0);
    const toHp = v => Math.round(v * (eff > 0 ? hp / eff : 1));
    const perHp = toHp(per);
    /* 대상 HP 에 따라 커지는 추가 피해(레일건［최대출력］ 등) — 구간을 따라가며 센다.
       셈은 damage.js 에 한 벌만 둔다(피탄 시뮬과 같은 함수). */
    const hpB = D.hpBonusOf(wp.note || '');
    const bands = (hpB && !hpB.unknown) ? hpB.bands : null;
    const bandWhy = (hpB && hpB.unknown) ? hpB.why : null;
    const step = D.hpBandSteps({ eff, oneHit: hit, mult: n, fixed, bands });
    const shots = bands ? step.n : (per > 0 ? Math.ceil(eff / per) : null);

    /* 실드로 막음 — 같은 무장이라도 실드 보정이 5배까지 갈린다. 판정은 앱이 한다. */
    let shield = null;
    if (B.shieldOn) {
      const sh = HOOK.shield(B);
      if (sh) {
        const r = HOOK.shieldHit(wp, hit, charged, A.parts);
        shield = r && r.hit != null
          ? { ...sh, hits: Math.ceil(sh.hp / (r.hit * n)), per: r.hit * n, note: '' }
          : { ...sh, hits: null, per: 0, note: (r && r.why) || '표기 없음' };
      }
    }

    /* 경직까지 몇 발 — 누적치 임계 ÷ 히트당 누적치. 감소 스킬 적용은 앱이 한다. */
    const stg = HOOK.stagger(B, wp);

    return { wp, mode, charged, power, corr, att, etcA, etcTxt, dirTxt, partPct, skPcts, factor, cuts,
      hit, n, fixed, per, perHp, eff, hp, shots, air, shield, stg, bands, bandWhy, step, toHp, fa,
      manual, autoCorr,
      foeCut, armor: tB[ARMOR[wp.attr]] || 0,
      // 계산식(formulaBox)이 쓰는 중간값 — 같은 셈에서 나온 것
      raw, boosted, atk, tAtt, pr, ccd, kind, armor0: sB[ARMOR[wp.attr]] || 0,
      cutList: allCuts.filter(cutHits), bi, biOn };
  }
  const FOE_ARMOR_RE = /(?:対象|敵機?)の?耐(実弾|ビーム|格闘)補正を?\s*(\d+)\s*[%％]\s*減/;
  const DIR_KO = { 'N格': 'N격', '横格': '횡격', '下格': '하격', '前格': '전격', '後格': '후격', '空中格': '공중격' };
  const dirLabel = l => DIR_KO[l] || T.weaponName(l) || l;

  /* ---------- 화면 ---------- */
  let root, back, body;

  function build() {
    /* id 를 붙인다 — 점검 도구가 이 창을 집을 손잡이가 필요하고(안전영역 CSS·열고 닫기),
       이름은 지워진 피탄 시뮬의 #pietanModal / #pietanBack / #pietanClose 와 짝을 맞춘 것이다. */
    /* <dialog> 로 띄운다(CSS 8단계). showModal() 이면
         · 최상위 층(top layer)에 떠 z-index 싸움이 없다 — 예전엔 70/71 을 손으로 골랐다
         · 뒤 화면이 inert 가 되어 Tab 이 창 밖(상단바·파츠 목록)으로 새지 않는다
         · 닫으면 포커스가 연 단추(⚔ 대결)로 돌아간다
       showModal 이 없는 곳(jsdom 스모크)에서는 예전처럼 뒤판 div 를 쓴다.
       hidden 속성은 그대로 같이 움직인다 — 앱·검사가 「열렸나」를 그것으로 본다. */
    back = el('div', 'duel-back'); back.id = 'duelBack'; back.hidden = true; back.onclick = () => open(false);
    root = el('dialog', 'duel'); root.id = 'duelModal'; root.hidden = true;
    root.setAttribute('aria-label', '대결 시뮬레이터');
    root.tabIndex = -1;
    root.addEventListener('cancel', e => { e.preventDefault(); open(false); });   // Esc
    /* 뒤판(::backdrop)을 누르면 닫는다 — 뒤판 클릭은 dialog 자신에게 오므로 창 밖 좌표인지 본다 */
    root.addEventListener('click', e => {
      if (e.target !== root) return;
      const b = root.getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) open(false);
    });
    root.dataset.tab = 'L';
    const head = el('div', 'duel-head');
    head.append(el('b', null, '⚔ 대결 시뮬레이터'), el('span', 'tag', '개편 시안'), el('span', 'grow'));
    head.append(btn('btn-ghost', '좌우 바꾸기', () => { const t = S.L; S.L = S.R; S.R = t; S.L.who = 'L'; S.R.who = 'R'; renderAll(); }));
    const closeBtn = btn('btn-ghost', '닫기', () => open(false));
    closeBtn.id = 'duelClose';
    head.append(closeBtn);
    const tabs = el('div', 'duel-tabs');
    for (const [k, t] of [['L', '나의 기체'], ['R', '상대 기체']]) {
      const b = btn('d-btn' + (k === 'L' ? ' on' : ''), t, () => {
        S.tab = k; root.dataset.tab = k;
        tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.t === k));
      });
      b.dataset.t = k; tabs.append(b);
    }
    body = el('div', 'duel-body');
    root.append(head, body);
    body.append(el('article', 'duel-side'), el('div', 'duel-center'), tabs, el('article', 'duel-side'));
    body.children[0].dataset.side = 'L';
    body.children[3].dataset.side = 'R';
    document.body.append(back, root);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) open(false); });
  }

  /** 스크롤 위치를 지키며 한쪽 패널을 다시 그린다. */
  function renderSide(side) {
    const box = body.querySelector('.duel-side[data-side="' + side.who + '"]');
    const keep = [...box.querySelectorAll('[data-keep]')].map(e => [e.dataset.keep, e.scrollTop]);
    const top = box.scrollTop;
    box.innerHTML = '';
    box.append(unitBlock(side));
    if (side.ms && !side.pickMs) {
      box.append(partsBlock(side), skillsBlock(side), weaponBlock(side));
    }
    box.scrollTop = top;
    for (const [k, t] of keep) { const e = box.querySelector('[data-keep="' + k + '"]'); if (e) e.scrollTop = t; }
  }

  function unitBlock(side) {
    const b = el('div', 'ds-block');
    const who = side.who === 'L' ? '나의 기체' : '상대 기체';
    if (!side.ms || side.pickMs) {
      b.append(el('div', 'ds-title', who + ' 고르기'));
      const pick = el('div', 'ds-mspick');
      const q = el('input', 'ds-search'); q.type = 'search'; q.placeholder = '기체 검색 (자쿠 / ザク / 건담…)'; q.value = side.mq;
      const list = el('div', 'ds-mslist'); list.dataset.keep = 'ms';
      const cnt = el('div', 'ds-mscount');
      /* 필터 — 속성 · 코스트 · LV. 코스트는 LV 마다 다르다(같은 기체 LV1 300 / LV2 350 …).
         그래서 LV 를 고르면 **그 LV 의 코스트**로 거르고, 고르지 않으면 기체의 LV 가운데
         하나라도 맞으면 남긴다. 누르면 맞은 LV 로 들어간다(LV 를 안 골랐으면 맞은 것 중 가장 높은 LV). */
      const mf = side.mf;
      const pickOf = arr => {
        const ok = m => (!mf.lv || msLv(m) === mf.lv) && (!mf.cost.size || mf.cost.has(Number(m.コスト)));
        const hit = arr.filter(ok);
        return hit.length ? hit[hit.length - 1] : null;
      };
      const filters = el('div', 'ds-msfilter');
      const chipRow = (label, items, isOn, onTap) => {
        const r = el('div', 'ds-mf-row');
        r.append(el('span', 'ds-mf-lb', label));
        // 칩은 한 덩어리로 — 코스트처럼 두 줄로 넘어가도 둘째 줄이 첫 칩 아래에서 시작한다
        const box = el('div', 'ds-mf-chips');
        box.append(btn('chip' + (items.every(([v]) => !isOn(v)) ? ' on' : ''), '전체', () => { onTap(null); }));
        for (const [v, t] of items) box.append(btn('chip' + (isOn(v) ? ' on' : ''), t, () => onTap(v)));
        r.append(box);
        return r;
      };
      const toggle = (set, v) => { if (v == null) set.clear(); else if (set.has(v)) set.delete(v); else set.add(v); };
      const drawFilters = () => {
        filters.innerHTML = '';
        filters.append(chipRow('속성', [['強襲', '강습'], ['汎用', '범용'], ['支援', '지원']],
          v => mf.attr.has(v), v => { toggle(mf.attr, v); drawFilters(); fill(); }));
        /* 코스트 칩은 데이터에서 센다 — 손으로 적은 목록은 새 코스트가 생기면 어긋난다 */
        const costs = [...new Set(G.msData.map(m => Number(m.コスト)).filter(c => c > 0))].sort((a, b) => a - b);
        filters.append(chipRow('코스트', costs.map(c => [c, String(c)]),
          v => mf.cost.has(v), v => { toggle(mf.cost, v); drawFilters(); fill(); }));
        const lvs = [...new Set(G.msData.map(msLv).filter(Boolean))].sort((a, b) => a - b);
        filters.append(chipRow('레벨', lvs.map(l => [l, 'LV' + l]),
          v => mf.lv === v, v => { mf.lv = (v == null || mf.lv === v) ? 0 : v; drawFilters(); fill(); }));
      };
      const fill = () => {
        list.innerHTML = '';
        const s = q.value.trim().toLowerCase();
        let rows = [...byBase.entries()].map(([bn, arr]) => ({ bn, rep: pickOf(arr) })).filter(r => r.rep);
        if (mf.attr.size) rows = rows.filter(r => mf.attr.has(r.rep.属性));
        if (s) rows = rows.filter(r => (T.msName(r.rep.MS名) + ' ' + r.rep.MS名).toLowerCase().includes(s));
        cnt.textContent = rows.length + '기' + (rows.length > 120 ? ' — 앞 120기만 보입니다. 검색이나 필터로 좁혀 주세요' : '');
        if (!rows.length) list.append(el('div', 'ds-msempty', '조건에 맞는 기체가 없습니다'));
        for (const r of rows.slice(0, 120)) {
          const row = btn('ds-msrow', null, () => setMs(side, r.rep));
          const im = el('img'); im.src = msImg(r.rep); im.alt = ''; im.loading = 'lazy'; fallbackOnce(im, 'ms');
          row.append(im, el('span', null, koMs(r.rep)),
            el('small', null, (MS_ATTR_KO[r.rep.属性] || '') + ' · LV' + msLv(r.rep) + ' · ' + r.rep.コスト));
          list.append(row);
        }
      };
      q.oninput = () => { side.mq = q.value; fill(); };
      drawFilters();
      fill();
      // 저장 구성 불러오기
      const builds = loadBuilds();
      if (builds.length) pick.append(buildSelect(side, builds));
      pick.append(q, filters, cnt, list);
      if (side.ms) pick.append(btn('d-btn', '취소', () => { side.pickMs = false; renderSide(side); }));
      b.append(pick);
      setTimeout(() => q.focus({ preventScroll: true }), 0);
      return b;
    }
    const ms = side.ms;
    const top = el('div', 'ds-unit');
    const im = el('img'); im.src = msImg(ms); im.alt = ''; fallbackOnce(im, 'ms');
    const info = el('div');
    info.append(el('div', 'ds-who', who));
    info.append(el('div', 'ds-name', koMs(ms)));
    const meta = el('div', 'ds-meta');
    meta.append(el('span', null, MS_ATTR_KO[ms.属性] || ms.属性));
    const cost = el('span'); cost.append('코스트 ', el('b', null, String(ms.コスト))); meta.append(cost);
    const st = statsOf(side);
    meta.append(el('span', null, 'HP ' + fmt(st.hp)));
    meta.append(el('span', null, '사격 ' + Math.round(st.shoot) + ' · 격투 ' + Math.round(st.meleeCorrection)));
    info.append(meta);
    top.append(im, info);
    b.append(top);

    /* 내구 지표 — 속성마다 한 대가 얼마나 아픈지의 기준이고, 아래 격파 발수가 이 값을 쓴다.
       **셈은 앱이 한다**(교체 지점). HP ÷ (1 − 내성) 만 쓰면 파츠 피해 경감이 빠져
       성능표와 같은 이름의 지표가 두 화면에서 갈린다 — 실제로 그렇게 냈고
       consistency_check 가 잡았다(성능 24,572 · 여기 22,115). */
    /* 화면에는 **게임 공식 수치**(내실탄 · 내빔 · 내격투 보정, 두 자리)를 적는다 — 사용자 요청 2026-10-15.
       실효 HP(내구 지표)는 게임에 없는 눈금이라 글로 적으면 낯설다. 다만 자동 구성 목표와 격파 발수가
       그 눈금을 쓰므로 **툴팁에 남긴다**(data-eff 도 — consistency_check 가 성능표와 맞대는 자리). */
    const ARMOR_OF = { solid: 'armorRange', beam: 'armorBeam', melee: 'armorMelee' };
    const rows = HOOK.durability(side, st);
    if (rows && rows.length) {
      const dura = el('div', 'ds-dura');
      dura.append(el('span', 'lb', '내성'));
      for (const d of rows) {
        const cell = el('span', 'ds-dcell');
        const arm = Math.round(st[ARMOR_OF[d.attr]] || 0);
        cell.append(el('i', null, '내' + d.ko), el('b', null, String(arm)));
        if (d.cut) cell.append(el('em', null, '피해 −' + d.cut + '%'));
        cell.dataset.eff = String(d.value);
        cell.title = '내' + d.ko + ' 보정 ' + arm + (d.cut ? ' · 파츠·스킬 피해 −' + d.cut + '%' : '')
          + '\n실효 HP ' + fmt(d.value) + ' — HP ' + fmt(st.hp) + ' ÷ (1 − 내성) ÷ 피해 경감.'
          + ' 격파 발수와 자동 구성 목표가 쓰는 눈금입니다.';
        dura.append(cell);
      }
      b.append(dura);
    }

    const row = el('div', 'ds-row');
    row.append(el('span', 'lb', 'LV'));
    const lvSeg = el('div', 'seg');
    for (const m of byBase.get(baseName(ms.MS名)) || []) {
      lvSeg.append(btn('seg-btn' + (m === ms ? ' on' : ''), 'LV' + msLv(m), () => setMs(side, m, true)));
    }
    row.append(lvSeg);
    const stSeg = el('div', 'seg');
    for (const [v, t] of [[0, '미강화'], [4, '4단계'], [6, '풀강']]) {
      stSeg.append(btn('seg-btn' + (side.stage === v ? ' on' : ''), t, () => {
        side.stage = v; side.parts = keepEquippable(side.ms, side.parts, v); changed(side);
      }));
    }
    row.append(stSeg);
    row.append(btn('d-btn', '⇄ 기체 변경', () => { side.pickMs = true; renderSide(side); }));
    b.append(row);

    /* 모드 — 변형 · 변신(NT-D) · 시스템 발동(트랜잠). 그 기체에 모드가 있을 때만 단추를 낸다.
       바꾸면 능력치(보정) · 무장 목록 · 방어 스킬 · 경직 · 공중 격투가 그 모드 것으로 바뀐다.
       고른 무장이 그 모드에서 못 쓰는 것이면 쓸 수 있는 첫 무장으로 옮긴다. */
    const alt = HOOK.altMode(ms);
    if (alt) {
      const mr = el('div', 'ds-row ds-form');
      mr.append(el('span', 'lb', '모드'));
      const fs = el('div', 'seg');
      for (const [v, t] of [['normal', '통상'], ['transform', alt.label]]) {
        fs.append(btn('seg-btn' + (side.form === v ? ' on' : ''), t, () => {
          if (side.form === v) return;
          side.form = v; side.step = 1; side.air = false;
          const ws = weaponsOf(side);
          if (!ws.some(x => x.key === side.wKey)) {
            const first = ws[0];
            side.wKey = first ? first.key : null;
            const m = first && first.modes.find(x => x.ok); side.mode = m ? m.k : 'nc';
          }
          changed(side);
        }));
      }
      mr.append(fs);
      if (side.form === 'transform') mr.append(el('small', 'ds-form-note', alt.label + ' 수치 · 무장 · 스킬로 셉니다'));
      b.append(mr);
    }

    /* 확장 스킬 — 앱의 파츠 화면과 같은 목록·같은 LV 범위. */
    const exRow = el('div', 'ds-row');
    exRow.append(el('span', 'lb', '확장'));
    const exSel = el('select', 'ds-exp');
    for (const k of C.EXPANSION_SKILLS) {
      const o = new Option(C.EXPANSION_LABEL[k] || k, k);
      if (k === side.exp) o.selected = true;
      exSel.append(o);
    }
    exSel.onchange = () => { side.exp = exSel.value; changed(side); };
    exRow.append(exSel);
    if (side.exp !== C.EXPANSION_NONE) {
      const exLv = el('div', 'seg');
      for (let v = 1; v <= C.MAX_EXPANSION_LEVEL; v++) {
        exLv.append(btn('seg-btn' + (side.expLv === v ? ' on' : ''), 'LV' + v,
          () => { side.expLv = v; changed(side); }));
      }
      exRow.append(exLv);
    }
    b.append(exRow);

    /* 공격보정 직접 입력 — 상대 파츠를 모를 때 보정만 어림해 넣는 자리.
       비우면 구성값으로 돌아간다(자동). 기체를 바꾸면 저절로 풀린다.
       피탄 시뮬에서 옮겨 왔다 — 거기서는 '만졌다' 깃발을 따로 들고 있었는데,
       값 하나(null = 자동)로 합쳤다. 둘을 따로 두면 깃발과 값이 갈린다. */
    const coRow = el('div', 'ds-row');
    coRow.append(el('span', 'lb', '보정'));
    for (const [k, ko] of [['shoot', '사격'], ['melee', '격투']]) {
      const cell = el('label', 'ds-corr');
      cell.append(el('i', null, ko));
      const inp = el('input');
      inp.type = 'number'; inp.min = '0'; inp.max = '999';
      inp.placeholder = String(Math.round(k === 'melee' ? st.meleeCorrection : st.shoot) || 0);
      if (side.corr[k] != null) { inp.value = String(side.corr[k]); cell.classList.add('on'); }
      inp.title = ko + ' 보정 — 비우면 구성값('
        + (Math.round(k === 'melee' ? st.meleeCorrection : st.shoot) || 0) + ')을 씁니다';
      inp.oninput = () => {
        const t = inp.value.trim();
        side.corr[k] = t === '' ? null : Math.max(0, Math.min(999, Number(t) || 0));
        changed(side);
      };
      cell.append(inp);
      coRow.append(cell);
    }
    if (side.corr.shoot != null || side.corr.melee != null) {
      coRow.append(btn('d-btn', '↺ 자동으로',
        () => { side.corr = { shoot: null, melee: null }; changed(side); }));
    }
    b.append(coRow);

    /* 🛡 실드로 막음 — 이 쪽이 맞을 때, 실드 HP 로 먼저 받는 계산을 함께 본다.
       실드가 없는 기체에서는 단추 자체가 안 나온다(눌러도 아무 일 없는 단추를 두지 않는다). */
    const sh = HOOK.shield(side);
    if (sh) {
      const shRow = el('div', 'ds-row');
      shRow.append(el('span', 'lb', '실드'));
      const sw = el('div');
      sw.append(btn('d-btn' + (side.shieldOn ? ' on' : ''),
        (side.shieldOn ? '🛡 실드로 막음 켬' : '🛡 실드로 막음')
        + ' — ' + sh.name + ' HP ' + fmt(sh.hp),
        () => {
          side.shieldOn = !side.shieldOn;
          /* 무장 표의 🛡 보정 칩도 같이 켜고 끈다 — 피탄 시뮬에서 그랬던 대로.
             양쪽 중 한 쪽이라도 켜져 있으면 켠 것으로 본다. */
          HOOK.onShield(S.L.shieldOn || S.R.shieldOn);
          changed(side);
        }));
      shRow.append(sw);
      b.append(shRow);
    } else if (side.shieldOn) { side.shieldOn = false; }

    /* 저장 구성 — 기체를 고른 뒤에도 불러올 수 있어야 한다. 예전에는 이 줄이
       「기체 고르기」 화면에만 있어서, 이미 기체가 앉은 쪽(특히 왼쪽)에서는
       ⇄ 기체 변경을 거치지 않으면 저장한 파츠를 가져올 길이 없었다. */
    const builds = loadBuilds();
    if (builds.length) {
      const ld = el('div', 'ds-row');
      ld.append(el('span', 'lb', '저장'));
      ld.append(buildSelect(side, builds));
      b.append(ld);
    }
    if (side.who === 'L') {
      const sync = el('div', 'ds-row');
      sync.append(el('span', 'lb', ''));
      sync.append(btn('d-btn', '⟳ 지금 편집 중인 구성 가져오기',
        () => { HOOK.seed(side, setMs, true); renderAll(); }));
      b.append(sync);
    }
    return b;
  }

  /** 저장 구성 드롭다운 — 기체 고르기 화면과 기체가 앉은 화면이 같이 쓴다. */
  function buildSelect(side, builds) {
    const sel = el('select', 'ds-search');
    sel.append(new Option('저장 구성에서 불러오기…', ''));
    builds.forEach((bd, i) => sel.append(new Option(bd.name, String(i))));
    sel.onchange = () => { if (sel.value !== '') applyBuild(side, builds[+sel.value]); };
    return sel;
  }

  function partsBlock(side) {
    const b = el('div', 'ds-block');
    const t = el('div', 'ds-title');
    t.append('커스텀 파츠 ', el('span', 'n', side.parts.length + ' / ' + C.MAX_PARTS), el('span', 'grow'));
    if (side.parts.length) t.append(btn('d-btn', '전체 해제', () => { side.parts = []; changed(side); }));
    b.append(t);
    const sl = slotsOf(side);
    const meter = el('div', 'ds-meter');
    for (const [k, mk, lb, c] of [['close', 'maxClose', '근', '#ff9f5a'], ['mid', 'maxMid', '중', '#58a9ff'], ['long', 'maxLong', '원', '#b38bff']]) {
      const cell = el('div', sl[k] > sl[mk] ? 'over' : '');
      cell.append(lb + ' ', el('b', null, sl[k] + '/' + sl[mk]));
      const bar = el('i'); const s = el('s'); s.style.width = Math.min(100, sl[mk] ? sl[k] / sl[mk] * 100 : 0) + '%';
      bar.style.setProperty('--c', c); bar.append(s); cell.append(bar);
      meter.append(cell);
    }
    b.append(meter);
    const slots = el('div', 'ds-slots');
    for (let i = 0; i < C.MAX_PARTS; i++) {
      const p = side.parts[i];
      if (p) {
        const s = btn('ds-slot full', null, () => { side.parts.splice(i, 1); changed(side); });
        s.title = T.partName(p.name) + ' — 눌러서 빼기\n' + (T.partDesc ? T.partDesc(p.name, p.description) || '' : '');
        const im = el('img'); im.src = partImg(p); im.alt = T.partName(p.name); fallbackOnce(im, 'parts');
        const lv = (String(p.name).match(/_LV(\d+)$/) || [])[1];
        s.append(im); if (lv) s.append(el('span', 'lv', lv));
        slots.append(s);
      } else {
        const s = btn('ds-slot', '+', () => { side.pickParts = !side.pickParts; renderSide(side); });
        s.title = '파츠 추가';
        slots.append(s);
      }
    }
    b.append(slots);
    if (side.pickParts) b.append(partPicker(side));
    return b;
  }

  const CODE_TXT = {
    equipped: () => '장착 중', full: () => '8개 가득', banned: () => '기본 제외',
    category: a => (T.attrName ? T.attrName(a) : a) + ' 전용', kind: k => (T.kindName ? T.kindName(k) : k) + ' 계열 중복',
    effect: n => T.partName(n) + ' 효과 중복', movement: () => '스피드/선회 중복',
    slotClose: () => '근접 슬롯 부족', slotMid: () => '중거리 슬롯 부족', slotLong: () => '원거리 슬롯 부족'
  };
  const slotTxt = p => p.close == null ? '슬롯 없음' : '근' + p.close + ' 중' + p.mid + ' 원' + p.long;
  function partPicker(side) {
    const w = el('div', 'ds-picker');
    const q = el('input'); q.type = 'search'; q.placeholder = '파츠 검색 (이름·효과)'; q.value = side.pq;
    const cats = el('div', 'ds-cats');
    for (const [k, t] of [['all', '전체'], ...Object.entries(C.CATEGORY_LABEL)]) {
      cats.append(btn('d-btn' + (side.pcat === k ? ' on' : ''), t, () => { side.pcat = k; renderSide(side); }));
    }
    cats.append(btn('d-btn', '닫기', () => { side.pickParts = false; renderSide(side); }));
    const list = el('div', 'ds-plist'); list.dataset.keep = 'parts';
    const fill = () => {
      list.innerHTML = '';
      const s = q.value.trim().toLowerCase();
      const sl = slotsOf(side);
      for (const p of allParts) {
        if (side.pcat !== 'all' && p.category !== side.pcat) continue;
        const nm = T.partName(p.name);
        if (s && !(nm + ' ' + p.name + ' ' + (p.description || '')).toLowerCase().includes(s)) continue;
        const ck = C.checkEquip(p, side.ms, side.parts, sl);
        const it = btn('ds-pitem', null, () => { side.parts.push(p); changed(side); });
        it.disabled = !ck.ok;
        it.title = (T.partDesc ? T.partDesc(p.name, p.description) : p.description) || '';
        const im = el('img'); im.src = partImg(p); im.alt = ''; im.loading = 'lazy'; fallbackOnce(im, 'parts');
        const tx = el('span', null, nm);
        tx.append(el('small', null, ck.ok ? slotTxt(p) : ((CODE_TXT[ck.code] && CODE_TXT[ck.code](ck.param)) || '장착 불가')));
        it.append(im, tx);
        list.append(it);
      }
    };
    q.oninput = () => { side.pq = q.value; fill(); };
    fill();
    w.append(q, cats, list);
    return w;
  }

  function skillsBlock(side) {
    const b = el('div', 'ds-block');
    b.append(el('div', 'ds-title', '스킬'));
    const wrap = el('div', 'ds-skills');
    const buffs = buffSkills(side), defs = HOOK.defSkills(side);
    for (const s of buffs) {
      const c = btn('ds-chip' + (side.buffs.has(s.name) ? ' on' : ''), null, () => {
        side.buffs.has(s.name) ? side.buffs.delete(s.name) : side.buffs.add(s.name); changed(side);
      });
      c.append(s.ko, el('span', 't', s.tags));
      c.title = '발동 중으로 계산 — ' + s.tags;
      wrap.append(c);
    }
    for (const s of defs) {
      const on = s.always || side.defs.has(s.name);
      const c = btn('ds-chip def' + (on ? ' on' : ''), null, () => {
        if (s.always) return;
        side.defs.has(s.name) ? side.defs.delete(s.name) : side.defs.add(s.name); changed(side);
      });
      c.append(s.ko, el('span', 't', s.tag + (s.always ? ' · 상시' : '')));
      wrap.append(c);
    }
    if (!buffs.length && !defs.length) wrap.append(el('span', 'ds-empty', '계산에 반영되는 스킬이 없습니다'));
    b.append(wrap);
    return b;
  }

  function weaponBlock(side) {
    const b = el('div', 'ds-block');
    const t = el('div', 'ds-title'); t.append('무장 · 사격 조건');
    b.append(t);
    const list = el('div', 'ds-wlist'); list.dataset.keep = 'w';
    const ws = weaponsOf(side);
    if (!ws.length) list.append(el('span', 'ds-empty', '무장 데이터가 없습니다'));
    for (const x of ws) {
      const r = btn('ds-w' + (x.key === side.wKey ? ' on' : ''), null, () => {
        side.wKey = x.key; side.variant = 0; side.dir = 0; side.step = 1;
        const first = x.modes.find(m => m.ok); side.mode = first ? first.k : 'nc';
        changed(side);
      });
      const ty = el('span', 'w-type type-' + x.attr, ATTR_KO[x.attr]);
      const pw = el('span', 'pw', fmt(x.power || x.charged));
      if (x.charged && x.power && x.charged !== x.power) { pw.append(' / '); pw.append(el('em', null, fmt(x.charged))); }
      r.append(ty, el('span', 'nm', T.weaponName(x.w.name)), pw);
      list.append(r);
    }
    b.append(list);

    const x = pickedWeapon(side);
    if (x) {
      const cond = el('div', 'ds-cond');
      if (!x.melee) {
        cond.append(el('span', 'lb', '사격'));
        const m = el('div', 'seg');
        for (const md of x.modes) {
          const bb = btn('seg-btn' + (side.mode === md.k && md.ok ? ' on' : ''), md.t, () => { side.mode = md.k; side.step = 1; changed(side); });
          bb.disabled = !md.ok; if (!md.ok) bb.title = md.why;
          m.append(bb);
        }
        cond.append(m);
        cond.append(el('span', 'lb', '자세'));
        const p = el('div', 'seg');
        for (const [k, tx, ok] of [['stand', '서서', true], ['crouch', '앉아서', true], ['prone', '엎드려서', x.canProne]]) {
          const bb = btn('seg-btn' + (side.posture === k ? ' on' : ''), tx, () => { side.posture = k; changed(side); });
          bb.disabled = !ok; if (!ok) bb.title = '이 무장은 엎드려 쏠 수 없습니다';
          p.append(bb);
        }
        cond.append(p);
        cond.append(el('span', 'lb', '조준'));
        const sc = btn('d-btn' + (side.scope && x.canScope ? ' on' : ''), side.scope && x.canScope ? '🔭 스코프 켬' : '🔭 스코프', () => { side.scope = !side.scope; changed(side); });
        sc.disabled = !x.canScope; if (!x.canScope) sc.title = '스코프를 쓸 수 없는 무장입니다';
        const scw = el('div'); scw.append(sc); cond.append(scw);
      } else if (x.variants) {
        if (x.variants.length > 1) {
          cond.append(el('span', 'lb', '종류'));
          const v = el('div', 'seg');
          x.variants.forEach((vv, i) => v.append(btn('seg-btn' + (i === side.variant ? ' on' : ''), vv.label, () => { side.variant = i; side.dir = 0; changed(side); })));
          cond.append(v);
        }
        const dirs = x.variants[Math.min(side.variant, x.variants.length - 1)].direction || [];
        /* 공중 격투 제어 — 켜면 방향이 원문이 가리키는 하나로 고정되므로 방향 세그먼트를 잠근다.
           대응 무장이 아니거나 수치를 낼 수 없는 기체(방향 배율이 위키에 없는 쪽)에서는
           단추 자체가 안 나온다 — 눌러도 아무 일 없는 단추를 두지 않는다. */
        const air = HOOK.airMelee(side, x);
        if (dirs.length > 1) {
          cond.append(el('span', 'lb', '방향'));
          const d = el('div', 'seg');
          dirs.forEach((dd, i) => {
            const bb = btn('seg-btn' + (!side.air && i === side.dir ? ' on' : ''),
              dirLabel(dd.label) + ' ' + dd.raw, () => { side.dir = i; side.air = false; changed(side); });
            if (side.air && air) { bb.disabled = true; bb.title = '공중 격투는 ' + dirLabel(air.dir) + ' 로 고정됩니다'; }
            d.append(bb);
          });
          cond.append(d);
        }
        if (air) {
          cond.append(el('span', 'lb', '공중'));
          const aw = el('div');
          aw.append(btn('d-btn' + (side.air ? ' on' : ''),
            side.air ? '🛩 공중 격투 켬 (위력 +' + air.pct + '%)' : '🛩 공중 격투 (위력 +' + air.pct + '%)',
            () => { side.air = !side.air; changed(side); }));
          cond.append(aw);
        } else if (side.air) { side.air = false; }
      }
      b.append(cond);
      if (!x.melee) b.append(el('div', 'ds-why', '자세·스코프는 사격 피해에 (1 + 보정) 으로 곱해집니다 — 앉아서 +5%, 엎드려서 +10%, 스코프 +5%.'));
    }
    return b;
  }

  /* ---------- 중앙 ---------- */
  function renderCenter() {
    const box = body.querySelector('.duel-center');
    box.innerHTML = '';
    const vs = el('div', 'dc-vs');
    const att = S.L.ms && S.R.ms ? matchup(S.L.ms.属性, S.R.ms.属性) : null;
    vs.append(el('div', 'who L', S.L.ms ? koMs(S.L.ms) : '나의 기체'));
    const x = el('div', 'x'); x.append(el('b', null, 'VS'));
    x.append(att ? '내 상성 ' + MATCH_TXT[att] : '양쪽 기체를 고르세요');
    vs.append(x, el('div', 'who R', S.R.ms ? koMs(S.R.ms) : '상대 기체'));
    // 판정 — 서로 필요한 발수만 견준다 (연사 속도·리로드는 보지 않는다)
    const a = attack(S.L, S.R), d = attack(S.R, S.L);
    if (a && d && a.shots && d.shots) {
      const v = el('div', 'dc-verdict');
      const cls = a.shots < d.shots ? 'win' : a.shots > d.shots ? 'lose' : 'even';
      const txt = cls === 'win' ? '내가 먼저 격파' : cls === 'lose' ? '상대가 먼저 격파' : '같은 발수';
      v.append('나 ', el('b', null, a.shots + '발'), ' · 상대 ', el('b', null, d.shots + '발'), ' → ', el('b', cls, txt));
      v.title = '고른 무장끼리 서로 필요한 발수만 견줍니다 — 발사 간격·리로드·명중률은 보지 않습니다';
      vs.append(v);
    }
    box.append(vs);
    box.append(dirCard(S.L, S.R, 'LR'), dirCard(S.R, S.L, 'RL'));
    box.append(el('div', 'dc-foot',
      '※ 실피해식 [Wp·Att·(1+자세·스코프)·상성] × 파츠·스킬 피해% × 상대 피해 경감, 내성은 실효 HP 로 반영. '
      + '게이지는 실제로 깎이는 HP 입니다. 전탄 명중 · 국부보정 미반영.'));
  }

  function dirCard(A, B, dir) {
    const c = el('div', 'dc-card'); c.dataset.dir = dir;
    const cap = el('div', 'dc-cap');
    cap.append(el('b', null, A.who === 'L' ? '나' : '상대'), el('span', 'arrow', '→'),
      el('b', null, B.who === 'L' ? '나' : '상대'), el('span', 'grow'));
    const r = attack(A, B);
    if (r) {
      cap.append(el('span', null, T.weaponName(r.wp.w.name)));
      /* 이 무장이 **무슨 반응**을 일으키는가 — 강경직이면 한 발로 못 움직이게 된다.
         조건부(공중의 적에게만 등)를 그냥 「강경직」으로 적으면 없는 성능을 말하는 셈이다. */
      const rc = HOOK.react(r.wp);
      if (rc) cap.append(el('span', 'dc-react' + (/강경직/.test(rc) ? ' strong' : ''), rc));
    }
    c.append(cap);
    if (!A.ms || !B.ms) { c.append(el('div', 'dc-wait', '양쪽 기체를 고르면 계산합니다')); return c; }
    if (!r) {
      c.append(el('div', 'dc-wait', (A.who === 'L' ? '왼쪽' : '오른쪽') + ' 패널에서 무장을 고르면 '
        + (B.who === 'L' ? '내' : '상대') + ' 체력이 얼마나 깎이는지 보여 줍니다'));
      c.append(gauge(statsOf(B).hp, 0, 0, 0));
      return c;
    }
    const main = el('div', 'dc-main');
    const kill = el('div', 'dc-kill', r.shots != null ? String(r.shots) : '—');
    kill.append(el('small', null, '발 격파'));
    const sub = el('div', 'dc-sub');
    const pct = r.hp ? r.perHp / r.hp * 100 : 0;
    sub.append('1발 ', el('b', null, fmt(r.perHp)), ' HP (', el('b', null, pct.toFixed(1) + '%'), ')');
    if (r.n > 1) sub.append(el('br'), '= ' + fmt(Math.round(r.perHp / r.n)) + ' × ' + r.n + '히트');
    sub.append(el('br'), '대상 HP ', el('b', null, fmt(r.hp)), ' · 내' + ATTR_KO[r.wp.attr] + ' ' + Math.round(r.armor) + (r.foeCut ? ' (−' + r.foeCut + '%)' : ''));
    /* 내구 지표(실효 HP)는 **글로 적지 않는다.** 자동 구성이 쓰는 눈금이라 어딘가에는
       있어야 하지만, 글로 적으면 HP 와 숫자가 둘이 되어 사용자가 제 HP 와 견주다
       헷갈린다 — 「1발 20,134 인데 내 HP 는 24,000?」. 앱이 그래서 툴팁으로 옮겼고,
       옮겨 오면서 내가 그 결정을 되돌렸다(hpcond_check 가 잡았다). 속성별 값은
       쪽 패널의 내구 칸에 그대로 있다. */
    kill.title = '실효 HP ' + fmt(r.eff)
      + ' — HP ÷ (1 − 내성) ÷ 피해경감. 자동 구성의 「실효 HP」 목표가 쓰는 눈금입니다.';
    if (r.bands) {
      /* 구간 무장은 「÷ 1발」이 거짓말이 된다 — 발마다 값이 다르다. 그래서 **발마다 적는다**.
         이 줄이 없으면 발수의 근거가 화면에 없다(문구는 앱의 hpBandWhy 한 곳에서 만든다). */
      const why = HOOK.bandWhy({ eff: r.eff, bands: r.bands, dmgAt: r.step.dmgAt,
        toHp: r.toHp, hits: r.shots });
      sub.append(el('br'), '※ 대상 HP 구간마다 피해가 다릅니다' + why);
    }
    else if (r.bandWhy) {
      /* 셈에 못 넣은 구간 — 숫자를 지어내지 않고, **어느 쪽으로 틀리는지**를 적는다.
         문장은 앱의 hpUnknownNote 한 곳에서 만든다(두 화면이 같은 말을 하게). */
      const u = HOOK.bandUnknown(r.bandWhy);
      const box = el('div', 'dc-unmod');
      box.append(el('span', 'lb', (u && u.label) || '※'),
        el('b', null, (u && u.value) || ''),
        el('small', null, (u && u.note) || r.bandWhy));
      c.append(box);
    }
    main.append(kill, sub);
    c.append(main);

    /* 🛡 실드로 막으면 — 실드부터 깨야 하는 경우. 「실드 무시」 무장은 그렇게 적는다. */
    if (r.shield) {
      const sr = el('div', 'dc-shield');
      sr.append(el('span', 'lb', '🛡 ' + r.shield.name));
      if (r.shield.hits != null) {
        sr.append(el('b', null, r.shield.hits + '발'));
        sr.append(el('small', null, '실드 HP ' + fmt(r.shield.hp)
          + (r.shield.bonus ? ' (+' + fmt(r.shield.bonus) + ')' : '')
          + ' ÷ 한 방아쇠 ' + fmt(r.shield.per)));
      } else {
        sr.append(el('b', null, '—'));
        sr.append(el('small', null, r.shield.note));
      }
      c.append(sr);
    }

    /* 경직까지 몇 발 — 누적치 임계 ÷ 히트당 누적치. */
    if (r.stg) {
      const st = el('div', 'dc-stag');
      st.append(el('span', 'lb', '경직까지'));
      // **히트 수**다 — 「발」로 적으면 위 격파 발수와 뜻이 섞인다(앱의 staggerBox 가 문구를 정한다)
      st.append(el('b', null, r.stg.value));
      st.append(el('small', null, r.stg.note));
      c.append(st);
    }

    const k = Math.max(0, Math.min(A.step, r.shots || 0));
    c.append(gauge(r.hp, r.perHp, k, r.shots || 0));
    const lg = el('div', 'dc-legend');
    lg.append(el('i', 'sw fill'), '남은 HP', el('i', 'sw next'), '다음 한 발', el('i', 'sw tk'), '발마다 눈금');
    c.append(lg);
    if (r.shots) {
      const st = el('div', 'dc-step');
      const rg = el('input'); rg.type = 'range'; rg.min = '0'; rg.max = String(r.shots); rg.value = String(k);
      rg.setAttribute('aria-label', '맞힌 발수');
      const out = el('output');
      const left = () => Math.max(0, r.hp - r.perHp * Number(rg.value));
      out.textContent = rg.value + '발 → ' + fmt(left());
      rg.oninput = () => {
        A.step = Number(rg.value);
        const g = c.querySelector('.dc-hp'); g.replaceWith(gauge(r.hp, r.perHp, A.step, r.shots));
        out.textContent = rg.value + '발 → ' + fmt(left());
      };
      st.append(el('span', null, '맞힌 발수'), rg, out);
      c.append(st);
    }
    const chips = el('div', 'dc-chips');
    const chip = (t, cls) => chips.append(el('span', cls || '', t));
    chip('위력 ' + fmt(r.power) + (r.charged ? (r.mode === 'ch2' ? ' (2단 집속)' : ' (집속)') : ''));
    chip((r.wp.melee ? '격투' : '사격') + '보정 ' + Math.round(r.corr)
      + (r.manual == null ? '' : ' (직접 입력 · 구성값 ' + Math.round(r.autoCorr) + ')'),
      r.manual == null ? '' : 'down');
    for (const e of r.etcTxt) chip(e, 'up');
    if (r.dirTxt) chip(r.dirTxt);
    if (r.air) chip('공중 격투 제어 위력 +' + r.air.pct + '%', 'up');
    if (r.fixed) chip('고정 피해 +' + fmt(r.fixed), 'up');
    chip('상성 ' + MATCH_TXT[r.att], r.att === 'advantage' ? 'up' : r.att === 'disadvantage' ? 'down' : '');
    if (r.partPct) chip('파츠 피해 +' + r.partPct + '%', 'up');
    for (const p of r.skPcts) chip('스킬 피해 +' + p + '%', 'up');
    if (r.foeCut) chip('상대 내' + ATTR_KO[r.wp.attr] + ' −' + r.foeCut + '%'
      + (r.fa && r.fa.sCut ? (r.fa.wCut ? ' (무장+스킬)' : ' (스킬 효과)') : ' (무장 효과)'), 'up');
    if (r.factor < 1) chip('상대 경감 ×' + (+r.factor.toFixed(3)), 'down');
    c.append(chips);
    c.append(formulaBox(r, dir));

    /* 「이 무장 N발 버티기 → 자동 구성 목표로」.
       맞는 쪽이 **내 구성(왼쪽)** 일 때만 뜻이 있다 — 목표는 내 파츠를 고르는 자다.
       줄 자체는 앱이 만든다(목표 칸·자동 구성·토스트가 전부 앱 안쪽이다). */
    if (B.who === 'L' && r.shots != null) {
      /* N 발 버티는 데 드는 실효 HP. 구간 무장은 **쌓아서** 센다 —
         dmg × N 으로 어림하면 레일건 같은 무장에서 목표가 작게 잡힌다. */
      const needOf = n => r.bands
        ? D.hpBandSteps({ eff: r.eff, oneHit: r.hit, mult: r.n, fixed: r.fixed,
            bands: r.bands, targetHits: n }).total
        : r.per * n;
      /* note·psycommu·type·mods 까지 넘긴다 — 자동 구성이 조건부 파츠 경감(관통·폭풍)을
         다시 잴 때 그것들을 본다. 이름만 넘기면 목표가 사용자가 본 값과 갈린다. */
      const g = HOOK.goalRow({ side: B, attacker: A, wp: r.wp, attr: r.wp.attr,
        name: r.wp.w.name, note: r.wp.note, psycommu: !!r.wp.w.psycommu,
        type: r.wp.w.type, mods: r.wp.w.mods,
        per: r.per, hits: r.shots, eff: r.eff, toHp: r.toHp,
        bands: r.bands, needOf, close: () => open(false) });
      if (g) c.append(g);
    }
    return c;
  }

  /* ---------- 피해량 계산식 ----------
     카드의 숫자가 **어떻게 나왔는지** 단계마다 적는다. 셈은 다시 하지 않는다 — attack() 이
     실제로 쓴 중간값(r.raw · r.boosted · r.cutList …)을 그대로 옮겨 적을 뿐이다. 그래야 식과
     위 숫자가 갈라지지 않는다. 무장 원문의 조건(완충재 무시 · 관통 · 구간 피해 …)은
     「셈에 넣었는가」 를 같이 적는다 — 넣지 못한 것을 넣은 것처럼 보이면 안 된다. */
  const fxOpen = { LR: false, RL: false };     // 다시 그려도 펼친 채로 둔다(발수 막대를 움직일 때마다 다시 그린다)
  const pctTxt = p => (p > 0 ? '+' : '') + p + '%';
  function formulaBox(r, dir) {
    const box = el('details', 'dc-formula');
    box.open = !!fxOpen[dir];
    box.ontoggle = () => { fxOpen[dir] = box.open; };
    box.append(el('summary', null, '피해량 계산식'));
    const ol = el('ol', 'fx-steps');
    const row = (lb, expr, val, note) => {
      const li = el('li');
      li.append(el('span', 'fx-lb', lb), el('span', 'fx-ex', expr));
      if (val != null) li.append(el('b', 'fx-val', '= ' + val));
      if (note) li.append(el('small', 'fx-note', note));
      ol.append(li);
    };
    const f2 = v => (+v.toFixed(2)).toString();
    const kindKo = r.kind === 'melee' ? '격투' : '사격';

    // ① 공격력
    row('공격력', '1 + ' + kindKo + '보정 ' + Math.round(r.corr) + ' ÷ 100'
      + (r.etcA ? ' → × (1 + ' + f2(r.etcA) + ' ' + r.etcTxt.join('·') + ')' : ''),
      f2(r.tAtt), r.etcA ? '소수 둘째 자리 아래는 버림' : null);
    /* ⌊ ⌋ · ⌈ ⌉ 기호는 앱 글꼴에서 [ ] 처럼 보여 버림과 올림이 안 갈렸다 — 중간값을 적고 말로 쓴다 */
    // ② 기본 피해 (상성까지)
    const mult = f2(1 + r.pr);
    const base = Math.floor(r.power * r.tAtt);
    if (r.kind === 'melee') {
      const dirs = r.ccd.length > 1 || r.ccd[0] !== 1;
      row('기본 피해', '위력 ' + fmt(r.power) + ' × ' + f2(r.tAtt) + ' = ' + fmt(base)
        + (dirs ? ' → 타마다 × 방향 [' + r.ccd.join(', ') + ']' : '') + ' → × 상성 ' + mult, fmt(r.raw),
        (r.dirTxt ? r.dirTxt + ' · ' : '') + '곱할 때마다 소수점 버림' + (r.ccd.length > 1 ? ' · 타마다 따로 셈해 더함' : ''));
    } else {
      row('기본 피해', '위력 ' + fmt(r.power) + ' × ' + f2(r.tAtt) + ' = ' + fmt(base) + ' → × 상성 ' + mult, fmt(r.raw),
        '곱할 때마다 소수점 버림' + (r.charged ? ' · ' + (r.mode === 'ch2' ? '2단 집속 위력' : '집속 위력') : ''));
    }
    // ③ 파츠·스킬 피해 %
    const ups = [r.partPct, ...r.skPcts].filter(Boolean);
    row('피해 증가', ups.length
      ? fmt(r.raw) + ' × ' + ups.map(p => '(1 ' + (p > 0 ? '+ ' : '− ') + Math.abs(p) + '%)').join(' × ')
      : '없음', ups.length ? fmt(r.boosted) : null, ups.length ? '파츠·스킬 피해% — 하나씩 곱하고 버림' : null);
    // ④ 상대 경감
    const live = r.cutList.filter(c => !c.ignored);
    const cutTxt = r.cutList.length
      ? r.cutList.map(c => c.label + ' −' + c.pct + '%' + (c.ignored ? ' (무시)' : '')).join(' · ')
      : '없음';
    row('상대 경감', live.length
      ? fmt(r.boosted) + ' × ' + live.map(c => '(1 − ' + c.pct + '%)').join(' × ') + ' → 버림'
      : fmt(r.boosted) + ' (경감 없음)', fmt(r.hit), r.cutList.length ? cutTxt : null);
    // ⑤ 한 발
    if (r.n > 1 || r.fixed) {
      row('한 발', fmt(r.hit) + (r.n > 1 ? ' × ' + r.n + '히트' : '')
        + (r.fixed ? ' + 고정 피해 ' + fmt(r.fixed) : ''), fmt(r.per),
        r.fixed ? '고정 피해는 보정·상성·경감을 안 받는다' : null);
    }
    // ⑥ 내성 → 실효 HP
    const arm = '내' + ATTR_KO[r.wp.attr] + ' ' + Math.round(r.armor0)
      + (r.foeCut ? ' × (1 − ' + r.foeCut + '%) = ' + f2(r.armor) : '');
    row('실효 HP', 'HP ' + fmt(r.hp) + ' ÷ (1 − ' + f2(Math.min(r.armor, 99)) + '%)', fmt(r.eff), arm);
    // ⑦ 깎이는 HP · 격파
    row('깎이는 HP', fmt(r.per) + ' × HP ' + fmt(r.hp) + ' ÷ 실효 ' + fmt(r.eff), fmt(r.perHp) + ' / 발');
    if (r.bands) row('격파', '대상 HP 구간마다 한 발 피해가 달라 발마다 쌓아 센다', r.shots != null ? r.shots + '발' : '—');
    else row('격파', '실효 HP ' + fmt(r.eff) + ' ÷ 한 발 ' + fmt(r.per)
      + (r.per > 0 ? ' = ' + f2(r.eff / r.per) + ' → 올림' : ''), r.shots != null ? r.shots + '발' : '—');
    box.append(ol);

    // 무장 원문의 조건 — 셈에 넣었는가
    const conds = [];
    const note = String(r.wp.note || '');
    if (r.bi) {
      const why = { always: '늘', charged: '집속했을 때만', down: '하격일 때만', skill: '스킬 발동 중일 때만' }[r.bi.when];
      const on = r.biOn ? '반영 — 상대 완충재 스킬 경감을 뺐다'
        : r.bi.when === 'skill' ? '셈에 안 넣음 — 원문에 어느 스킬인지 없다'
        : '지금 조건이 아니라 반영 안 함';
      conds.push(['상대 ' + (r.bi.special ? '특수' : '') + '완충재 스킬 무시 (' + why + ')', on, r.bi.text, r.biOn ? 'on' : 'off']);
    }
    if (r.foeCut) conds.push(['상대 내' + ATTR_KO[r.wp.attr] + ' −' + r.foeCut + '%', '반영 — ⑥ 실효 HP 에', '', 'on']);
    if (/ユニット貫通/.test(note)) conds.push(['관통', r.cutList.some(c => c.label === '관통 경감')
      ? '반영 — 상대의 관통 경감 파츠가 ④ 에' : '상대에게 관통 경감 파츠가 없어 바뀌는 것 없음', 'ユニット貫通', 'on']);
    if (/爆風/.test(note) && !/爆風なし/.test(note)) conds.push(['폭풍', r.cutList.some(c => c.label === '폭풍 경감')
      ? '반영 — 상대의 폭풍 경감 파츠가 ④ 에' : '상대에게 폭풍 경감 파츠가 없어 바뀌는 것 없음', '爆風', 'on']);
    if (/シールド(?:HP)?を?(?:無視|貫通)/.test(note)) conds.push(['실드 무시', '「실드로 막음」 을 켰을 때 실드 줄에 반영', '', 'on']);
    if (r.bands) conds.push(['대상 HP 구간 추가 피해', '반영 — 발마다 쌓아 셈', '', 'on']);
    else if (r.bandWhy) conds.push(['대상 HP 에 따른 추가 피해', '셈에 못 넣음 — 위 ※ 줄 참고', '', 'off']);
    if (r.fixed) conds.push(['고정 피해 ' + fmt(r.fixed), '반영 — ⑤ 에', '', 'on']);
    if (conds.length) {
      const cl = el('div', 'fx-conds');
      cl.append(el('div', 'fx-cap', '무장 원문의 조건'));
      for (const [name, how, ja, st] of conds) {
        const d = el('div', 'fx-cond ' + st);
        d.append(el('b', null, name), el('span', null, how));
        if (ja) d.title = '원문: ' + ja;
        cl.append(d);
      }
      box.append(cl);
    }
    box.append(el('div', 'fx-foot', '전탄 명중으로 셈한다 · 국부 보정 · 명중률은 넣지 않는다.'));
    return box;
  }

  /** 체력 게이지 — k 발 맞은 뒤 남은 HP, 다음 한 발(빗금), 발마다 눈금. */
  function gauge(hp, per, k, shots) {
    const g = el('div', 'dc-hp');
    const left = Math.max(0, hp - per * k);
    const fill = el('div', 'fill'); fill.style.width = (hp ? left / hp * 100 : 100) + '%';
    g.append(fill);
    if (per > 0 && left > 0) {
      const nx = el('div', 'next');
      const w = Math.min(per, left) / hp * 100;
      nx.style.left = (left / hp * 100 - w) + '%'; nx.style.width = w + '%';
      g.append(nx);
    }
    if (per > 0 && shots && shots <= 60) {
      for (let i = 1; i < shots; i++) {
        const t = el('i', 'tick'); t.style.left = (100 - per * i / hp * 100) + '%'; g.append(t);
      }
    }
    const tx = el('div', 'txt');
    tx.append(el('span', null, fmt(left) + ' / ' + fmt(hp)), el('span', null, hp ? Math.round(left / hp * 100) + '%' : ''));
    g.append(tx);
    return g;
  }

  /* ---------- 동작 ---------- */
  function keepEquippable(ms, wanted, stage) {
    const out = [];
    for (const p of wanted) if (C.checkEquip(p, ms, out, C.calcSlots(ms, out, stage, G.fullst)).ok) out.push(p);
    return out;
  }
  function setMs(side, ms, keepParts) {
    side.ms = ms; side.pickMs = false; side.mq = '';
    side.parts = keepParts ? keepEquippable(ms, side.parts, side.stage) : [];
    side.buffs.clear(); side.defs.clear();
    side.wKey = null; side.step = 1; side.pickParts = false; side.air = false;
    side.corr = { shoot: null, melee: null };   // 기체가 바뀌면 손으로 넣은 보정은 풀린다
    if (!keepParts || !HOOK.altMode(ms)) side.form = 'normal';
    // 주무장을 기본으로 골라 둔다 — 고르기 전 빈 화면을 줄인다
    const first = weaponsOf(side)[0];
    if (first) { side.wKey = first.key; const m = first.modes.find(x => x.ok); side.mode = m ? m.k : 'nc'; }
    changed(side);
  }
  function loadBuilds() {
    try { return JSON.parse(localStorage.getItem('gbo2-offline-builds')) || []; } catch { return []; }
  }
  function applyBuild(side, bd) {
    const ms = G.msData.find(m => m.MS名 === bd.ms);
    if (!ms) return;
    side.stage = bd.stage != null ? bd.stage : 6;
    const wanted = (bd.parts || []).map(n => allParts.find(p => p.name === n)).filter(Boolean);
    setMs(side, ms);
    side.parts = keepEquippable(ms, wanted, side.stage);
    /* 확장 스킬도 저장본에 들어 있다(앱 serialize 가 싣는다) — 파츠만 되살리고
       확장을 「없음」으로 두면 저장한 구성과 다른 수가 나온다.
       setMs **뒤에** 넣는다(setMs 가 쪽을 초기화한다). */
    side.exp = C.EXPANSION_SKILLS.includes(bd.expansion) ? bd.expansion : C.EXPANSION_NONE;
    side.expLv = Number(bd.expLevel) || C.MAX_EXPANSION_LEVEL;
    changed(side);
  }
  function changed(side) { renderSide(side); renderCenter(); }
  function renderAll() { renderSide(S.L); renderSide(S.R); renderCenter(); }

  /** 지금 편집 중인 기체를 왼쪽에 앉힌다 — **앱이 끼워 주는 것이 본판**이다.
   *  시안 때는 앱 상태(state)를 못 읽어 피탄 시뮬 제목줄에서 기체 이름을 훔쳐 왔는데,
   *  그 화면이 없어졌다(2026-10-13). 이름을 다른 데서 긁어 오는 길을 새로 만들지 않는다 —
   *  지어낸 값으로 왼쪽을 앉히면 **앱 구성과 다른 수**가 나오고, 그게 더 나쁘다.
   *  앱이 교체 지점을 안 끼웠으면 왼쪽을 비워 두고 사용자가 고르게 한다. */
  function seedDefault() { /* 앱(ui.js)이 use({ seed }) 로 끼운다 */ }

  /* 폰 「넓게 보기」는 768px 을 기기 폭으로 줄여 보여 준다 — 그대로 두면 이 창의 글자가 절반이 된다.
     viewport 를 바꾸면 앱이 resize 때 되돌리므로, 창에만 zoom 을 걸어 기기 폭만큼으로 키운다.
     안쪽 배치는 컨테이너 쿼리라 줄어든 창 폭(≈기기 폭)을 보고 폰 배치로 바뀐다. */
  function fitZoom() {
    if (!root) return;
    const wide = document.body.classList.contains('vm-wide');
    const dev = Number((window.screen || {}).width) || window.innerWidth;
    root.style.zoom = wide && dev < window.innerWidth ? String(+(window.innerWidth / dev).toFixed(4)) : '';
  }
  window.addEventListener('resize', () => { if (root && !root.hidden) fitZoom(); });

  function open(on) {
    if (!root) build();
    if (on) fitZoom();
    const modal = typeof root.showModal === 'function';
    root.hidden = !on;
    back.hidden = !on || modal;
    if (modal) {
      /* showModal 은 첫 단추(닫기)에 포커스를 준다 — 마우스로 열어도 닫기에 고리가 그려졌다.
         창 자체에 준다(tabIndex -1). Tab 을 누르면 그 다음부터 창 안 단추를 돈다. */
      if (on && !root.open) { root.showModal(); root.focus(); }
      else if (!on && root.open) root.close();
    }
    document.documentElement.style.overflow = on ? 'hidden' : '';
    if (on) { HOOK.seed(S.L, setMs); renderAll(); }
  }

  function mountButton() {
    /* 상단바의 ⚖ 비교 옆에 둔다 — 전에는 🛡 피탄 시뮬 옆이었는데 그 단추가 없어졌다.
       못 찾으면 body 에 붙는데, 그러면 상단바 밖에 떠서 눌릴 자리가 이상해진다.
       그래서 topbar_check 의 MUST_REACH 가 #duelBtn 을 지킨다. */
    const ref = document.getElementById('compareBtn');
    const b = btn('btn-ghost', '⚔ 대결', () => open(true));
    b.id = 'duelBtn';
    b.title = '나와 상대를 좌우에 두고, 무장·사격 조건별로 서로의 체력이 얼마나 깎이는지 봅니다 (개편 시안)';
    if (ref && ref.parentNode) ref.parentNode.insertBefore(b, ref.nextSibling);
    else document.body.append(b);
  }

  /** 본 적용용 — 앱 안에서 간이판을 앱 함수로 바꾼다. 모르는 키는 무시한다. */
  function use(over) {
    for (const [k, f] of Object.entries(over || {})) if (k in HOOK && typeof f === 'function') HOOK[k] = f;
    if (root && !root.hidden) renderAll();
  }
  window.GBO2Duel = { open: () => open(true), close: () => open(false), use, state: S, attack, weaponsOf };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();
})();

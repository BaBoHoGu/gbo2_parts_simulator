// 위키 「スキル情報」 표에서 사격·격투 보정을 올리는 스킬을 뽑아 낸다.
//   node tools/find_buff_skills.js          # 반영구만
//   node tools/find_buff_skills.js --all    # 시간 제한까지
//
// 「효과 시간 무제한」인 것만 반영구로 본다. 위키가 「効果時間は、なし」「効果時間は 無し」
// 처럼 제각각 적어 두어 표기 변형을 모두 받는다.
const fs = require('fs'), path = require('path');
const { parseTable: parseGrid } = require('./lib/table.js');

const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');
const clean = s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const parseTable = html => parseGrid(html, clean);

const MS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const I18N = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.json'), 'utf8'));
const SKILL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'skills.json'), 'utf8'));
// 수동 사전에 없는 스킬명은 MT 캐시(skill_text.json, MS 스킬 패널용)로 폴백한다.
// 방어·기동 버프 스킬처럼 이전엔 안 뽑히던 스킬도 대개 여기 이미 번역돼 있다.
let SKILL_MT = {};
try { SKILL_MT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'skill_text.json'), 'utf8')); } catch { /* 없어도 됨 */ }
const hasJa = s => /[ぁ-ゖァ-ヺ一-鿿㐀-䶿]/.test(s);   // ・ ー 등 문장부호는 제외
const koName = n => I18N[n.normalize('NFC')] || n;
const koSkill = n => {
  const k = n.normalize('NFC');
  if (SKILL[k]) return SKILL[k];                       // 수동 사전 우선(신뢰)
  if (SKILL_MT[k] && !hasJa(SKILL_MT[k])) return SKILL_MT[k];   // MT 캐시 폴백
  return n;
};

const byPage = new Map();
for (const m of MS) {
  const id = (String(m.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
  if (!id) continue;
  if (!byPage.has(id)) byPage.set(id, []);
  byPage.get(id).push(m);
}

// --merge: raw/wiki 에 있는 페이지의 기체만 다시 뽑아 기존 skills.json 에 덮어쓴다.
// (배포본 증분 업데이트용 — 나머지 기체의 스킬은 그대로 둔다)
const MERGE = process.argv.includes('--merge');
const baseName = n => n.replace(/_LV\d+$/, '');
const touchedMs = new Set();   // 이번에 다시 뽑은 페이지에 속한 기체들(기본 이름)

const found = [];
const grants = [];   // 「스킬「X」…付与」 — 다른 스킬 발동 시 부여되는 스킬 (F91[BC]·G도어즈 등)
for (const f of fs.readdirSync(WIKI).filter(x => x.endsWith('.html'))) {
  const id = f.replace('.html', '');
  const ms = byPage.get(id);
  if (!ms) continue;
  for (const m of ms) touchedMs.add(baseName(m.MS名));
  const html = fs.readFileSync(path.join(WIKI, f), 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
  const at = html.search(/<h[2-5][^>]*>[^<]*スキル情報/);
  if (at < 0) continue;
  const rest = html.slice(at + 10);
  const end = rest.search(/<h[2-5][^>]*>[^<]*(強化リスト情報|備考|機体情報|機体考察)/);
  const seg = end < 0 ? rest : rest.slice(0, end);

  for (const t of seg.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    for (const row of parseTable(t[0])) {
      const line = row.join(' ');
      // 케이스 ② — 이 스킬(부모) 발동 시 「X」LV1 付与. 부모의 발동 조건을 그대로 물려준다.
      // (부모 자신이 버프 수치가 없어 아래에서 걸러지더라도 부여 정보는 먼저 모아 둔다)
      for (const gm of line.matchAll(/[「『]([^」『]{2,30})[」『][^。「『]{0,12}付与/g)) {
        const gname = gm[1].replace(/(LV|Lv)\s*\d+.*$/, '').trim();
        if (!gname || /タックル/.test(gname)) continue;   // 태클류는 제외
        grants.push({
          ms: ms[0].MS名.replace(/_LV\d+$/, ''), name: gname,
          forever: /効果時間は?[、,\s]*(無し|なし|ナシ)/.test(line),
          // 「は」를 필수로 — 「効果時間5秒消費」(행동 시 감소 페널티)를 실제 지속시간으로 오인하지 않게.
        secs: Number((line.match(/効果時間は[、,\s]*(\d+)\s*秒/) || [])[1]) || null,
          hp: Number((line.match(/機体HPが?\s*(\d+)\s*[%％]以下/) || [])[1]) || null,
          manual: /タッチパッドを押す/.test(line)
        });
      }
      const flat = (v, re) => { const m = line.match(re); return m ? Number(m[1]) : 0; };
      const shoot = flat(0, /射撃補正\s*[＋+]\s*(\d+)(?!\s*%)/);
      const melee = flat(0, /格闘補正\s*[＋+]\s*(\d+)(?!\s*%)/);
      // 「しゃがみ状態や静止時には射撃補正時に＋5%」= 고정밀 포격. 자세 조건이 붙은
      // 사격 % 라 일반 사격보정 % (ZERO 시스템 등)와 나눠 crouchPct 로 담는다.
      const crouch = line.match(/(?:しゃがみ|静止)[^。]{0,40}射撃補正[^。]{0,8}[＋+]\s*(\d+)\s*[%％]/);
      const crouchPct = crouch ? Number(crouch[1]) : 0;
      const shootPct = crouchPct ? 0 : flat(0, /射撃補正を?[^。]{0,12}[＋+]\s*(\d+)\s*%/);
      const meleePct = flat(0, /格闘補正を?[^。]{0,12}[＋+]\s*(\d+)\s*%/);
      // ZERO 시스템: 「射撃/格闘補正の上限値 ＋20」 — 발동 중 사격·격투 상한이 오른다
      const limitUp = flat(0, /射撃[／/]格闘補正の上限値\s*[＋+]\s*(\d+)/);
      // 보정이 아니라 피해량을 직접 올리는 스킬도 함께 잡는다.
      // 적용 대상은 수치 앞쪽 수식어로 갈린다 —
      //   「射撃属性与ダメージ ＋20%」「格闘兵装で与えるダメージが 15% 上昇」
      // 수식어가 없으면 사격·격투 모두에 걸리는 것으로 본다.
      // 「与ダメージ15%分のHP回復」은 회복량이라 ＋ 나 増加/上昇 표기를 요구해 걸러 낸다.
      // 「与えるダメージが 20% 上昇」「与えるダメージを 50% 増加」 — 조사가 が·を 로 갈린다
      let dmgShoot = 0, dmgMelee = 0, dmgAny = 0;
      const DMG_RE = /([^。]{0,26})(?:与ダメージ|与えるダメージ)\s*(?:[がをは]\s*)?([＋+]?)\s*(\d+)\s*[%％]\s*(増加|上昇)?/g;
      for (const m of line.matchAll(DMG_RE)) {
        if (!m[2] && !m[4]) continue;                    // 피해 상승이 아닌 표현
        const v = Number(m[3]);
        if (/射撃(属性|兵装|攻撃)/.test(m[1])) dmgShoot = Math.max(dmgShoot, v);
        else if (/格闘(属性|兵装|攻撃)/.test(m[1])) dmgMelee = Math.max(dmgMelee, v);
        else dmgAny = Math.max(dmgAny, v);
      }
      // 「攻撃力が N% 上昇」 — 대부분 「タックル発生時の攻撃力」이라 태클 전용이다.
      // 태클이 앞에 없는 것(고정밀 스나이프의 스나이프 모드 등)만 사격·격투 공통 피해로 받는다.
      const atk = line.match(/攻撃力(?:が|を)\s*(\d+)\s*[%％]\s*(?:上昇|増加)/);
      if (atk && !/タックル/.test(line.slice(Math.max(0, atk.index - 12), atk.index))) {
        dmgAny = Math.max(dmgAny, Number(atk[1]));
      }
      const dmgPct = dmgAny || dmgShoot || dmgMelee;
      const powerPct = flat(0, /威力\s*[＋+]\s*(\d+)\s*[%％]/)
        || flat(0, /威力が\s*(\d+)\s*[%％]\s*(?:増加|上昇)/);
      // 방어·기동·HP 발동 버프 (능력UP「바이오센서」 등) — 스탯 패널에 반영한다.
      // 「各耐性 ＋15」은 3속성 모두에 얹고, 개별 「耐実弾補正 ＋N」이 있으면 더한다.
      // ＋ 를 요구해 조건 표기(「機体HPが N%以下」·AMBAC 「旋回性能が N増加」)는 걸러진다.
      // ＋ 뿐 아니라 － 도 잡는다 — HADES(各耐性－5)·액티브퍼지(高速移動－10) 같은 트레이드오프 반영.
      // % 가 붙은 것(「スラスター消費 －50%」)은 소비율이라 제외.
      const sgn = re => { const m = line.match(re); return m ? (/[－-]/.test(m[1]) ? -1 : 1) * Number(m[2]) : 0; };
      const armorAll = sgn(/各耐性\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const armorRange = armorAll + sgn(/耐実弾補正\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const armorBeam = armorAll + sgn(/耐ビーム補正\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const armorMelee = armorAll + sgn(/耐格闘補正\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const speed = sgn(/スピード\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const hispeed = sgn(/高速移動\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const thruster = sgn(/スラスター\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);   // 消費 는 スラスター 뒤에 － 가 아니라 消費 가 와서 안 걸림
      const turn = sgn(/旋回(?:性能)?\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const hpUp = sgn(/(?:機体HP|最大HP)\s*([＋+－-])\s*(\d+)(?!\s*[%％])/);
      const hasMob = armorRange || armorBeam || armorMelee || speed || hispeed || thruster || turn || hpUp;
      if (!shoot && !melee && !shootPct && !meleePct && !crouchPct && !dmgPct && !powerPct && !hasMob) continue;

      // 표는 [스킬명, 스킬LV, 필요 기체LV, 설명, 효과] 순이다.
      // 필요 기체LV 는 「LV1～」「Lv4～」「Lv1～3」 처럼 적혀 있다.
      const need = (row[2] || '').match(/LV\s*(\d+)\s*[～~]?\s*(\d+)?/i);
      found.push({
        ms: ms[0].MS名.replace(/_LV\d+$/, ''), cost: ms[0].コスト, attr: ms[0].属性,
        msLvFrom: need ? Number(need[1]) : 1,
        msLvTo: need && need[2] ? Number(need[2]) : null,
        // 스킬명 = LV 표기가 아닌 첫 칸
        skill: row.find(c => c && !/^(LV|Lv)\s*\d*\s*[～~]?$/.test(c) && c.length > 1) || '(무명)',
        shoot, melee, shootPct, meleePct, crouchPct, limitUp, dmgPct, dmgShoot, dmgMelee, dmgAny, powerPct,
        armorRange, armorBeam, armorMelee, speed, hispeed, thruster, turn, hpUp,
        forever: /効果時間は?[、,\s]*(無し|なし|ナシ)/.test(line),
        // 「は」를 필수로 — 「効果時間5秒消費」(행동 시 감소 페널티)를 실제 지속시간으로 오인하지 않게.
        secs: Number((line.match(/効果時間は[、,\s]*(\d+)\s*秒/) || [])[1]) || null,
        hp: Number((line.match(/機体HPが?\s*(\d+)\s*[%％]以下/) || [])[1]) || null,
        manual: /タッチパッドを押す/.test(line)
      });
    }
  }
}

// ── 케이스 ② 자동 반영 ─────────────────────────────────────────────
// 「X」…付与로 부여되는 스킬 X 를, 다른 기체에서 정식 추출된 동일 스킬 X 의 수치를 빌려
// (부모의 발동 조건으로) 그 기체에 얹는다. 표준 추출 이력이 아예 없는 스킬만 경고로 남긴다.
{
  const wOf = e => (e.shoot || 0) + (e.melee || 0) + (e.shootPct || 0) + (e.meleePct || 0)
    + (e.crouchPct || 0) + (e.dmgAny || 0) + (e.dmgShoot || 0) + (e.dmgMelee || 0)
    + (e.armorRange || 0) + (e.armorBeam || 0) + (e.armorMelee || 0)
    + (e.speed || 0) + (e.hispeed || 0) + (e.thruster || 0) + (e.turn || 0) + (e.hpUp || 0);
  // 이름 → 표준 추출 수치(가장 높은 것). 이번 실행분(found) + 기존 skills.json(증분 실행 대비).
  const buffByName = new Map();
  const consider = (name, e, extra) => {
    if (!wOf(e)) return;
    const cur = buffByName.get(name);
    if (!cur || wOf(e) > wOf(cur)) buffByName.set(name, { ...e, ...extra });
  };
  for (const r of found) consider(r.skill, r, { cost: r.cost, attr: r.attr });
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'skills.json'), 'utf8'));
    for (const list of Object.values(prev)) for (const sk of list) {
      const e = (sk.levels || [])[0] || {};
      consider(sk.name, { ...e, dmgPct: e.dmgAny || e.dmgShoot || e.dmgMelee || 0 }, { cost: 0, attr: null });
    }
  } catch { /* 최초 실행 */ }

  // 이동·자세·방어계 등 '피해/보정과 무관'이 확인된 부여 스킬 — 경고에서 제외(매 실행 소음 방지).
  // 여기 없는 새 부여 스킬이 수치를 못 구하면 경고가 뜬다(= 검토가 필요한 진짜 신규).
  const NON_DMG_GRANT = new Set([
    'パワーアクセラレータ', 'フラップ・ブースター', '空中制御プログラム', '空中格闘制御',
    '攻撃姿勢制御', '攻撃姿勢制御改', '停止射撃姿勢制御', '強制噴射装置', 'スラスター出力強化',
    'G-バード高速機動制御機構', 'タクティカルブースト', 'マニューバーアーマー', 'ダメージコントロール',
    '水中機動射撃', '高速機動射撃', 'ステルス', '高性能AMBAC', '緊急回避制御', '高精度解析システム',
    '廃熱効率適正化', '観測情報連結', '爆発反応装甲', '耐爆機構',
    '頭部特殊緩衝材', '脚部特殊緩衝材', '肩部特殊緩衝材', '背部オプション特殊緩衝材'
  ]);
  const haveSkill = new Set(found.map(r => r.ms + '|' + r.skill));
  const added = new Set();
  const warn = [];
  for (const g of grants) {
    const key = g.ms + '|' + g.name;
    if (haveSkill.has(key) || added.has(key)) continue;   // 이미 그 기체가 가진 스킬이면 스킵
    const src = buffByName.get(g.name);
    if (!src) { if (!NON_DMG_GRANT.has(g.name)) warn.push(g); continue; }   // 표준 이력 없음 → 수동 검토(비피해 스킬은 무시)
    added.add(key);
    found.push({
      ms: g.ms, cost: src.cost || 0, attr: src.attr || null,
      msLvFrom: 1, msLvTo: null, skill: g.name,
      shoot: src.shoot || 0, melee: src.melee || 0, shootPct: src.shootPct || 0, meleePct: src.meleePct || 0,
      crouchPct: src.crouchPct || 0, limitUp: src.limitUp || 0, dmgPct: src.dmgPct || 0,
      dmgShoot: src.dmgShoot || 0, dmgMelee: src.dmgMelee || 0, dmgAny: src.dmgAny || 0, powerPct: 0,
      armorRange: src.armorRange || 0, armorBeam: src.armorBeam || 0, armorMelee: src.armorMelee || 0,
      speed: src.speed || 0, hispeed: src.hispeed || 0, thruster: src.thruster || 0,
      turn: src.turn || 0, hpUp: src.hpUp || 0,
      // 발동 조건은 부모(부여한 스킬)의 것을 따른다
      forever: g.forever, secs: g.secs, hp: g.hp, manual: g.manual
    });
  }
  if (added.size) console.log('부여 스킬 자동 반영 ' + added.size + '건: '
    + [...added].map(k => k.split('|').reverse().join(' ← ')).join(', '));
  const uniqWarn = [...new Map(warn.map(g => [g.ms + '|' + g.name, g])).values()];
  if (uniqWarn.length) {
    console.log('⚠ 부여 스킬이지만 표준 추출 이력이 없어 자동 반영 못 함(수동 검토): '
      + uniqWarn.map(g => koName(g.ms) + ' ← ' + koSkill(g.name)).join(', '));
  }
}

// 기체+스킬 단위로 가장 높은 수치(= 최고 스킬 LV)만 남긴다
const best = new Map();
for (const r of found) {
  const k = r.ms + '|' + r.skill;
  const p = best.get(k);
  const w = x => x.shoot + x.melee + x.shootPct + x.meleePct + x.dmgPct + x.powerPct;
  if (!p || w(r) > w(p)) best.set(k, r);
}
const rows = [...best.values()];
const perm = rows.filter(r => r.forever);
const temp = rows.filter(r => !r.forever);

const pad = (s, n) => {           // 한글은 두 칸 너비로 세어 표를 맞춘다
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(1, n - w));
};
function show(title, list) {
  console.log('\n' + title + '  ' + list.length + '건');
  console.log('  ' + pad('기체', 28) + pad('코스트', 7) + pad('스킬', 30) + pad('사격', 8) + pad('격투', 8) + pad('피해', 10) + '발동 조건');
  for (const r of list.sort((a, b) => (b.shoot + b.melee) - (a.shoot + a.melee) || b.cost - a.cost)) {
    const val = (n, p) => (p ? '+' + p + '%' : n ? '+' + n : '·');
    const trig = [r.hp ? 'HP ' + r.hp + '% 이하' : null, r.manual ? '수동' : null]
      .filter(Boolean).join(' + ') || '조건부';
    console.log('  ' + pad(koName(r.ms), 28) + pad(r.cost, 7) + pad(koSkill(r.skill), 30)
      + pad(val(r.shoot, r.shootPct), 8) + pad(val(r.melee, r.meleePct), 8)
      + pad(r.dmgPct ? '+' + r.dmgPct + '%' : r.powerPct ? '위력+' + r.powerPct + '%' : '·', 10)
      + trig + (r.forever ? '' : ' / ' + (r.secs ? r.secs + '초' : '시간 제한')));
  }
}

if (process.argv.includes('--ui')) {
  // 시뮬레이터가 쓰는 형태 — 기체마다 고를 수 있는 버프 스킬 목록.
  // 태클·특정 무장의 위력만 올리는 스킬은 성능표·무장표에 얹을 자리가 없어 뺀다.
  const usable = found.filter(r =>
    r.shoot || r.melee || r.shootPct || r.meleePct || r.crouchPct || r.dmgPct
    || r.armorRange || r.armorBeam || r.armorMelee || r.speed || r.hispeed || r.thruster || r.turn || r.hpUp);
  const byMs = new Map();
  for (const r of usable) {
    if (!byMs.has(r.ms)) byMs.set(r.ms, []);
    byMs.get(r.ms).push(r);
  }
  const weight = x => x.shoot + x.melee + x.shootPct + x.meleePct + x.dmgPct;
  const out = {};
  for (const [ms, list] of byMs) {
    const skills = [];
    for (const name of [...new Set(list.map(r => r.skill))]) {
      const mine = list.filter(r => r.skill === name);
      const seen = new Set();
      const levels = mine
        .sort((a, b) => a.msLvFrom - b.msLvFrom)
        .map(r => ({
          from: r.msLvFrom, to: r.msLvTo,
          shoot: r.shoot, melee: r.melee,
          shootPct: r.shootPct, meleePct: r.meleePct,
          crouchPct: r.crouchPct,   // 고정밀 포격 — 앉기·정지에서만 사격 피해 +N%
          limitUp: r.limitUp,       // ZERO 시스템 — 사격·격투 상한 상승
          // 피해 % 는 걸리는 대상이 갈린다 — any 는 사격·격투 모두에 얹는다
          dmgAny: r.dmgAny, dmgShoot: r.dmgShoot, dmgMelee: r.dmgMelee,
          // 방어·기동·HP 발동 버프 — 성능표 스탯에 반영
          armorRange: r.armorRange, armorBeam: r.armorBeam, armorMelee: r.armorMelee,
          speed: r.speed, hispeed: r.hispeed, thruster: r.thruster, turn: r.turn, hpUp: r.hpUp
        }))
        // 같은 구간·같은 수치가 표에 두 번 적힌 경우가 있어 하나만 남긴다
        .filter(l => { const k = JSON.stringify(l); if (seen.has(k)) return false; seen.add(k); return true; });
      // 버프는 LV 로 감소하지 않는다. 위키 미공개(「射撃補正 ＋？」→0) 등으로 상위 LV 값이 0 이 되면
      // 하위 LV 값으로 올려 0/0 표시를 막는다(0→하위값). 음수 트레이드오프는 건드리지 않는다.
      const LVF = ['shoot', 'melee', 'shootPct', 'meleePct', 'crouchPct', 'limitUp', 'dmgAny', 'dmgShoot', 'dmgMelee', 'armorRange', 'armorBeam', 'armorMelee', 'speed', 'hispeed', 'thruster', 'turn', 'hpUp'];
      for (let i = 1; i < levels.length; i++) for (const f of LVF)
        if (levels[i][f] === 0 && (levels[i - 1][f] || 0) > 0) levels[i][f] = levels[i - 1][f];
      const top = mine.reduce((a, b) => (weight(b) > weight(a) ? b : a));
      skills.push({
        name, nameKo: koSkill(name),
        forever: top.forever, secs: top.secs, hp: top.hp, manual: top.manual,
        levels
      });
    }
    // 효과가 큰 것부터 — 드롭다운에서 위에 오게 한다
    const lvWeight = l => l.shoot + l.melee + l.shootPct + l.meleePct + l.crouchPct
      + l.dmgAny + l.dmgShoot + l.dmgMelee
      + (l.armorRange || 0) + (l.armorBeam || 0) + (l.armorMelee || 0)
      + (l.speed || 0) + (l.hispeed || 0) + (l.thruster || 0) + (l.turn || 0) + (l.hpUp || 0);
    skills.sort((a, b) => Math.max(...b.levels.map(lvWeight)) - Math.max(...a.levels.map(lvWeight)));
    out[ms] = skills;
  }
  const dest = path.join(ROOT, 'data', 'skills.json');
  // 병합: 이번에 다시 뽑은 기체만 교체(스킬이 사라졌으면 제거)하고 나머지는 그대로 둔다.
  let result = out;
  if (MERGE && fs.existsSync(dest)) {
    result = JSON.parse(fs.readFileSync(dest, 'utf8'));
    for (const ms of touchedMs) {
      if (out[ms]) result[ms] = out[ms];
      else delete result[ms];
    }
  }
  // 스킬 정보 표에 없어 자동 추출이 안 되는 무장 발동형 버프(리젤 N형 사이코 프레임 전개 등)를
  // 마지막에 멱등하게 얹는다 — 같은 이름의 기존 override 스킬은 지우고 다시 넣어 중복을 막는다.
  const ovPath = path.join(ROOT, 'data', 'skills.override.json');
  if (fs.existsSync(ovPath)) {
    const ov = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
    for (const [ms, list] of Object.entries(ov)) {
      if (ms.startsWith('_')) continue;
      const names = new Set(list.map(s => s.name));
      result[ms] = (result[ms] || []).filter(s => !names.has(s.name)).concat(list);
    }
  }
  fs.writeFileSync(dest, JSON.stringify(result, null, 1));
  const all = Object.values(result).flat();
  console.log('기체 ' + Object.keys(result).length + '기 · 스킬 ' + all.length
    + '개 (반영구 ' + all.filter(s => s.forever).length + ')');
  console.log('스킬을 2개 이상 가진 기체: ' + Object.values(result).filter(v => v.length > 1).length + '기');
  console.log('→', path.relative(process.cwd(), dest));
} else if (process.argv.includes('--json')) {
  const dest = path.join(ROOT, 'data', 'buff_skills.json');
  fs.writeFileSync(dest, JSON.stringify(rows.map(r => ({ ...r, msKo: koName(r.ms), skillKo: koSkill(r.skill) })), null, 1));
  console.log('스킬 ' + rows.length + '건 (반영구 ' + perm.length + ' / 시간 제한 ' + temp.length + ')');
  console.log('→', path.relative(process.cwd(), dest));
} else {
  show('■ 반영구 — 한 번 발동하면 그 판 내내 유지', perm);
  if (process.argv.includes('--all')) show('■ 시간 제한', temp);
  else console.log('\n(시간 제한 스킬 ' + temp.length + '건은 --all 로 함께 볼 수 있습니다)');
}

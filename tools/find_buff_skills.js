// 위키 「スキル情報」 표에서 사격·격투 보정을 올리는 스킬을 뽑아 낸다.
//   node tools/find_buff_skills.js          # 반영구만
//   node tools/find_buff_skills.js --all    # 시간 제한까지
//
// 「효과 시간 무제한」인 것만 반영구로 본다. 위키가 「効果時間は、なし」「効果時間は 無し」
// 처럼 제각각 적어 두어 표기 변형을 모두 받는다.
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');
const clean = s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** rowspan/colspan 을 펼쳐 2차원 배열로. (extract_weapons 와 같은 방식) */
function parseTable(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  const grid = [];
  rows.forEach((r, ri) => {
    grid[ri] = grid[ri] || [];
    let ci = 0;
    for (const c of r.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const text = clean(c[3]);
      const cs = Number((c[2].match(/colspan="?(\d+)/i) || [])[1] || 1);
      const rs = Number((c[2].match(/rowspan="?(\d+)/i) || [])[1] || 1);
      while (grid[ri][ci] !== undefined) ci++;
      for (let dr = 0; dr < rs; dr++) {
        grid[ri + dr] = grid[ri + dr] || [];
        for (let dc = 0; dc < cs; dc++) grid[ri + dr][ci + dc] = text;
      }
      ci += cs;
    }
  });
  return grid.map(r => Array.from(r, v => (v === undefined ? '' : v)));
}

const MS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const I18N = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.json'), 'utf8'));
const SKILL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'skills.json'), 'utf8'));
const koName = n => I18N[n.normalize('NFC')] || n;
const koSkill = n => SKILL[n.normalize('NFC')] || n;

const byPage = new Map();
for (const m of MS) {
  const id = (String(m.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
  if (!id) continue;
  if (!byPage.has(id)) byPage.set(id, []);
  byPage.get(id).push(m);
}

const found = [];
for (const f of fs.readdirSync(WIKI).filter(x => x.endsWith('.html'))) {
  const id = f.replace('.html', '');
  const ms = byPage.get(id);
  if (!ms) continue;
  const html = fs.readFileSync(path.join(WIKI, f), 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
  const at = html.search(/<h[2-5][^>]*>[^<]*スキル情報/);
  if (at < 0) continue;
  const rest = html.slice(at + 10);
  const end = rest.search(/<h[2-5][^>]*>[^<]*(強化リスト情報|備考|機体情報|機体考察)/);
  const seg = end < 0 ? rest : rest.slice(0, end);

  for (const t of seg.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    for (const row of parseTable(t[0])) {
      const line = row.join(' ');
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
      if (!shoot && !melee && !shootPct && !meleePct && !crouchPct && !dmgPct && !powerPct) continue;

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
        forever: /効果時間は?[、,\s]*(無し|なし|ナシ)/.test(line),
        secs: Number((line.match(/効果時間は?[、,\s]*(\d+)\s*秒/) || [])[1]) || null,
        hp: Number((line.match(/機体HPが?\s*(\d+)\s*[%％]以下/) || [])[1]) || null,
        manual: /タッチパッドを押す/.test(line)
      });
    }
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
    r.shoot || r.melee || r.shootPct || r.meleePct || r.crouchPct || r.dmgPct);
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
          dmgAny: r.dmgAny, dmgShoot: r.dmgShoot, dmgMelee: r.dmgMelee
        }))
        // 같은 구간·같은 수치가 표에 두 번 적힌 경우가 있어 하나만 남긴다
        .filter(l => { const k = JSON.stringify(l); if (seen.has(k)) return false; seen.add(k); return true; });
      const top = mine.reduce((a, b) => (weight(b) > weight(a) ? b : a));
      skills.push({
        name, nameKo: koSkill(name),
        forever: top.forever, secs: top.secs, hp: top.hp, manual: top.manual,
        levels
      });
    }
    // 효과가 큰 것부터 — 드롭다운에서 위에 오게 한다
    const lvWeight = l => l.shoot + l.melee + l.shootPct + l.meleePct + l.crouchPct
      + l.dmgAny + l.dmgShoot + l.dmgMelee;
    skills.sort((a, b) => Math.max(...b.levels.map(lvWeight)) - Math.max(...a.levels.map(lvWeight)));
    out[ms] = skills;
  }
  // 스킬 정보 표에 없어 자동 추출이 안 되는 무장 발동형 버프(리젤 N형 사이코 프레임 전개 등)를 합친다
  const ovPath = path.join(ROOT, 'data', 'skills.override.json');
  if (fs.existsSync(ovPath)) {
    const ov = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
    for (const [ms, list] of Object.entries(ov)) {
      if (ms.startsWith('_')) continue;
      out[ms] = (out[ms] || []).concat(list);
    }
  }
  const dest = path.join(ROOT, 'data', 'skills.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));
  const all = Object.values(out).flat();
  console.log('기체 ' + Object.keys(out).length + '기 · 스킬 ' + all.length
    + '개 (반영구 ' + all.filter(s => s.forever).length + ')');
  console.log('스킬을 2개 이상 가진 기체: ' + Object.values(out).filter(v => v.length > 1).length + '기');
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

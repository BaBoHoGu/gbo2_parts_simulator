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
      const shootPct = flat(0, /射撃補正を?[^。]{0,12}[＋+]\s*(\d+)\s*%/);
      const meleePct = flat(0, /格闘補正を?[^。]{0,12}[＋+]\s*(\d+)\s*%/);
      // 보정이 아니라 피해량·위력을 직접 올리는 스킬도 함께 잡는다
      const dmgPct = flat(0, /(?:与ダメージ|与えるダメージ)\s*[＋+]\s*(\d+)\s*[%％]/)
        || flat(0, /(?:与ダメージ|与えるダメージ)が\s*(\d+)\s*[%％]\s*(?:増加|上昇)/);
      const powerPct = flat(0, /威力\s*[＋+]\s*(\d+)\s*[%％]/)
        || flat(0, /威力が\s*(\d+)\s*[%％]\s*(?:増加|上昇)/);
      if (!shoot && !melee && !shootPct && !meleePct && !dmgPct && !powerPct) continue;

      found.push({
        ms: ms[0].MS名.replace(/_LV\d+$/, ''), cost: ms[0].コスト, attr: ms[0].属性,
        // 스킬명 = LV 표기가 아닌 첫 칸
        skill: row.find(c => c && !/^(LV|Lv)\s*\d*\s*[～~]?$/.test(c) && c.length > 1) || '(무명)',
        shoot, melee, shootPct, meleePct, dmgPct, powerPct,
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

if (process.argv.includes('--json')) {
  const dest = path.join(ROOT, 'data', 'buff_skills.json');
  fs.writeFileSync(dest, JSON.stringify(rows.map(r => ({ ...r, msKo: koName(r.ms), skillKo: koSkill(r.skill) })), null, 1));
  console.log('스킬 ' + rows.length + '건 (반영구 ' + perm.length + ' / 시간 제한 ' + temp.length + ')');
  console.log('→', path.relative(process.cwd(), dest));
} else {
  show('■ 반영구 — 한 번 발동하면 그 판 내내 유지', perm);
  if (process.argv.includes('--all')) show('■ 시간 제한', temp);
  else console.log('\n(시간 제한 스킬 ' + temp.length + '건은 --all 로 함께 볼 수 있습니다)');
}

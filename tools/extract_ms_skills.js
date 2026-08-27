// 위키 「スキル情報」 표에서 기체의 전체 스킬(효과·설명 포함)을 뽑아 data/ms_skills.json 으로.
//   node tools/extract_ms_skills.js [--merge]
// 가변·변형 기체는 ＜通常時＞/＜変形時＞ 등 모드별로 나눠 담는다.
// 구조: { "<기체>": [ { mode, skills: [ { cat, name, lv, msLv, eff, desc } ] } ] }
const fs = require('fs');
const path = require('path');
const { parseTable: parseGrid } = require('./lib/table.js');
const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');
const DEST = path.join(ROOT, 'data', 'ms_skills.json');
// 정상 기체의 스킬 수는 최대 38개다. 그 배를 넘으면 스텁 페이지를 긁은 것으로 본다.
const SKILL_SANITY_MAX = 80;
const skipped = [];

const clean = s => s
  .replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').replace(/(?:\s*\/\s*)+/g, ' / ').replace(/^\s*\/\s*|\s*\/\s*$/g, '').trim();

const parseTable = html => parseGrid(html, clean);

const CATS = ['足回り', '攻撃', '防御', 'その他', '移動'];
const isLv = s => /^(LV|Lv)\s*\d/.test(String(s || '').trim());

/** 한 모드 구간의 표들에서 스킬 목록을 뽑는다. */
function parseSkills(seg) {
  const skills = [];
  for (const t of seg.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const grid = parseTable(t[0]);
    // 헤더 행에서 열 위치를 잡는다
    const head = grid.find(r => r.includes('スキル') && (r.includes('効果') || r.includes('説明')));
    if (!head) continue;
    const iName = head.indexOf('スキル');
    const iLv = head.findIndex(c => /レベル/.test(c));
    const iMsLv = head.findIndex(c => /機体LV/.test(c));
    const iEff = head.findIndex(c => /効果/.test(c));
    const iDesc = head.findIndex(c => /説明/.test(c));
    let cat = '';
    for (const row of grid) {
      if (row === head) continue;
      const nameCell = (row[iName] || '').trim();
      if (CATS.includes(nameCell) && !isLv(row[iLv])) { cat = nameCell; continue; }
      if (!isLv(row[iLv])) continue;                 // 스킬 행이 아님
      const name = nameCell || (row.find(c => c && !isLv(c)) || '');
      if (!name || name.length < 2) continue;
      skills.push({
        cat,
        name,
        lv: (row[iLv] || '').trim(),
        msLv: (row[iMsLv] || '').trim(),
        eff: iEff >= 0 ? (row[iEff] || '').trim() : '',
        desc: iDesc >= 0 ? (row[iDesc] || '').trim() : ''
      });
    }
  }
  // 표 밖(같은 열)에서 같은 스킬이 여러 번 잡히면 중복 제거
  const seen = new Set();
  return skills.filter(s => { const k = s.cat + '|' + s.name + '|' + s.lv; if (seen.has(k)) return false; seen.add(k); return true; });
}

// page id → 기체 base 이름들
// wiki_url 이 빈 신기체(ゴトラタン 등)를 override 로 보정 — 페이지↔기체 매핑에 필요.
const msData = require('./lib/msdata.js').applyWikiOverride(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8')), ROOT);
const byPage = new Map();
for (const m of msData) {
  const id = (String(m.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
  if (!id) continue;
  const base = m.MS名.replace(/_LV\d+$/, '');
  if (!byPage.has(id)) byPage.set(id, new Set());
  byPage.get(id).add(base);
}

const MERGE = process.argv.includes('--merge');
const out = MERGE && fs.existsSync(DEST) ? JSON.parse(fs.readFileSync(DEST, 'utf8')) : {};
const files = fs.existsSync(WIKI) ? fs.readdirSync(WIKI).filter(f => f.endsWith('.html')) : [];
let mechs = 0, modeCount = 0;

for (const f of files) {
  const id = f.replace('.html', '');
  const bases = byPage.get(id);
  if (!bases) continue;
  const html = fs.readFileSync(path.join(WIKI, f), 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');

  // 모든 「スキル情報[＜모드＞]」 제목 위치 + 라벨
  const marks = [...html.matchAll(/<h[2-5][^>]*>([^<]*スキル情報[^<]*)<\/h[2-5]>/gi)]
    .map(m => ({ at: m.index, label: (m[1].match(/＜([^＞]+)＞/) || [])[1] || '' }));
  if (!marks.length) continue;
  // 다음 큰 섹션(강화리스트/고찰/概要 등)까지가 스킬 구간
  const endAt = (() => { const m = html.slice(marks[0].at).search(/<h[2-5][^>]*>[^<]*(強化リスト情報|機体考察|機体概要|アップデート履歴)/); return m < 0 ? html.length : marks[0].at + m; })();

  const modes = [];
  marks.forEach((mk, i) => {
    const segEnd = i + 1 < marks.length ? marks[i + 1].at : endAt;
    const skills = parseSkills(html.slice(mk.at, segEnd));
    if (skills.length) modes.push({ mode: mk.label, skills });
  });
  if (!modes.length) continue;

  // 아직 스탯이 안 채워진 '스텁' 페이지는 스킬 표 자리에 위키의 스킬 용어집(전 스킬 목록)이
  // 그대로 들어 있어, 긁으면 기체가 수백 개 스킬을 가진 것처럼 된다.
  // (실제로 ガンダムDX 가 306개로 들어왔다 — 정상 기체의 최대는 38개)
  // 상한을 넘으면 추출 실패로 보고 건너뛴다. 기체 하나 빠지는 편이 거짓 데이터보다 낫다.
  const total = modes.reduce((a, m) => a + m.skills.length, 0);
  if (total > SKILL_SANITY_MAX) {
    const who = [...bases][0] || ('페이지 ' + id);   // bases 는 Set 이라 인덱스로 못 꺼낸다
    console.log(`  건너뜀: ${who} — 스킬 ${total}개(상한 ${SKILL_SANITY_MAX}). 위키 페이지가 아직 스텁으로 보입니다.`);
    skipped.push(who);
    continue;
  }

  for (const base of bases) { out[base] = modes; }
  mechs++; modeCount += modes.length;
}

fs.writeFileSync(DEST, JSON.stringify(out, null, 1) + '\n');
const kb = (fs.statSync(DEST).size / 1024).toFixed(0);
console.log(`스킬 추출: 기체 ${Object.keys(out).length}기 (이번 ${mechs}) · 모드 ${modeCount} → data/ms_skills.json ${kb}KB`);
if (skipped.length) console.log(`⚠ 스텁으로 보여 건너뛴 기체 ${skipped.length}기: ${skipped.join(', ')}`);

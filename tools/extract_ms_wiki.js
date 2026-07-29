// 위키 기체 페이지의 스탯·슬롯 표를 읽어, gbo2.jp msData 와 "다른" 값만 교정 목록에 담는다.
//   (gbo2.jp 가 밸런스 패치를 아직 반영 못 한 항목을 위키 값으로 바로잡기 위함)
//   node tools/extract_ms_wiki.js [--pages=ID,ID]
//
// 결과: data/msData.override.json  = { "<MS名>": { "<필드>": 위키값, ... }, ... }
// build.js 가 빌드 시 이 값으로 msData 를 덮어쓴다. msData.json 자체는 순수 gbo2 로 두어
// (감지 diff 가 gbo2 와 영구 불일치로 어긋나지 않게) 한다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');
const OVERRIDE = path.join(ROOT, 'data', 'msData.override.json');
const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));

// 위키 표의 행 라벨 → msData 필드명
const FIELD = {
  '機体HP': 'HP', 'Cost': 'コスト',
  '耐実弾補正': '耐実弾補正', '耐ビーム補正': '耐ビーム補正', '耐格闘補正': '耐格闘補正',
  '射撃補正': '射撃補正', '格闘補正': '格闘補正',
  'スピード': 'スピード', '高速移動': '高速移動', 'スラスター': 'スラスター',
  '近距離': '近スロット', '中距離': '中スロット', '遠距離': '遠スロット'
};

const clean = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
const tableRows = t => (t.match(/<tr[\s\S]*?<\/tr>/gi) || [])
  .map(r => (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(clean));

// page id → [{ m, lv }]
const byPage = new Map();
for (const m of msData) {
  const id = (String(m.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
  if (!id) continue;
  const lv = Number((m.MS名.match(/_LV(\d+)/) || [])[1] || 1);
  if (!byPage.has(id)) byPage.set(id, []);
  byPage.get(id).push({ m, lv });
}

const pagesArg = process.argv.find(a => a.startsWith('--pages='));
const onlyIds = pagesArg ? new Set(pagesArg.slice('--pages='.length).split(',').filter(Boolean)) : null;

let override = {};
try { override = JSON.parse(fs.readFileSync(OVERRIDE, 'utf8')); } catch { /* 처음 */ }

const files = fs.existsSync(WIKI) ? fs.readdirSync(WIKI).filter(f => f.endsWith('.html')) : [];
let mechs = 0, fixed = 0, cleared = 0;

for (const f of files) {
  const id = f.replace('.html', '');
  if (onlyIds && !onlyIds.has(id)) continue;
  const entries = byPage.get(id);
  if (!entries) continue;

  const html = fs.readFileSync(path.join(WIKI, f), 'utf8');
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const statT = tables.find(t => t.includes('機体HP') && t.includes('LV1'));
  const slotT = tables.find(t => t.includes('近距離') && t.includes('遠距離') && !t.includes('機体HP'));

  const wikiVals = {};   // field → { lv: number }
  for (const t of [statT, slotT]) {
    if (!t) continue;
    for (const cells of tableRows(t)) {
      if (cells.length < 2) continue;
      const field = FIELD[cells[0]];
      if (!field) continue;
      // 위키는 상위 LV 값이 이전과 같으면 칸을 비운다("이전 LV와 동일" 관례).
      // 그래서 빈 칸은 직전 값을 이어(carry-forward) 채운다. 첫 값 전의 빈 칸은 그대로 둔다.
      wikiVals[field] = wikiVals[field] || {};
      let last = null;
      cells.slice(1).forEach((c, i) => {
        const v = Number(c);
        if (c !== '' && !isNaN(v)) last = v;
        if (last != null) wikiVals[field][i + 1] = last;
      });
    }
  }
  if (!Object.keys(wikiVals).length) continue;   // 표를 못 읽으면 그냥 gbo2 값 유지
  mechs++;

  for (const { m, lv } of entries) {
    for (const [field, byLv] of Object.entries(wikiVals)) {
      const wv = byLv[lv];
      if (wv == null) continue;
      if (wv !== Number(m[field])) {              // 위키 ≠ gbo2 → 위키 값으로 교정
        (override[m.MS名] = override[m.MS名] || {})[field] = wv;
        fixed++;
      } else if (override[m.MS名] && field in override[m.MS名]) {  // 이제 일치 → 교정 해제
        delete override[m.MS名][field];
        cleared++;
      }
    }
    if (override[m.MS名] && !Object.keys(override[m.MS名]).length) delete override[m.MS名];
  }
}

fs.writeFileSync(OVERRIDE, JSON.stringify(override, null, 1));
console.log(`위키 대조: 기체 페이지 ${mechs}개 · 교정 ${fixed} · 해제 ${cleared} → ${Object.keys(override).length}기 오버라이드`);

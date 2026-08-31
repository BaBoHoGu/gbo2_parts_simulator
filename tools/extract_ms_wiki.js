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
  '近距離': '近スロット', '中距離': '中スロット', '遠距離': '遠スロット',
  // 선회 — 한 번도 대조된 적이 없던 항목. 위키는 표기가 네 갈래로 갈린다:
  //   旋回（地上）[度/秒] / 旋回（地上）＜通常時＞[度/秒] / 旋回[度/秒] / 旋回＜通常時＞[度/秒]
  // 변형·변신 행은 gbo2 필드가 따로 있어 그쪽으로 보낸다.
  '旋回（地上）[度/秒]': '旋回_地上_通常時',
  '旋回（宇宙）[度/秒]': '旋回_宇宙_通常時',
  '旋回（地上）＜通常時＞[度/秒]': '旋回_地上_通常時',
  '旋回（宇宙）＜通常時＞[度/秒]': '旋回_宇宙_通常時',
  '旋回（地上）＜変形時＞[度/秒]': '旋回_地上_変形時',
  '旋回（宇宙）＜変形時＞[度/秒]': '旋回_宇宙_変形時',
  '旋回＜変形時＞[度/秒]': '旋回_変形時'
  // 「旋回[度/秒]」·「旋回＜通常時＞[度/秒]」 은 일부러 뺐다. 지상/우주 구분이 없는 표기라
  // 어느 쪽인지 알 수 없다. 실제로 우주 전용 기체(リック・ドム·サイコ・ザク【TB】)에서
  // 이 값은 gbo2 의 '선회우주' 와 같았다 — 지상으로 넣으면 없는 지상 선회를 지어내게 된다.
};

const clean = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
// colspan 을 펼쳐서 셀 위치 = LV 가 되도록 맞춘다.
// 위키는 여러 LV 가 같은 값이면 「<td colspan="3">135</td>」처럼 묶어 적는다.
// 이걸 무시하면 열이 통째로 밀려 엉뚱한 LV 의 값으로 교정해 버린다(아크트 자쿠 스피드 등).
const tableRows = t => (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map(r => {
  const out = [];
  for (const c of (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [])) {
    const span = Math.min(Number((c.match(/colspan\s*=\s*"?(\d+)/i) || [])[1]) || 1, 12);
    const v = clean(c);
    for (let i = 0; i < span; i++) out.push(v);
  }
  return out;
});

const pagesArg = process.argv.find(a => a.startsWith('--pages='));
const onlyIds = pagesArg ? new Set(pagesArg.slice('--pages='.length).split(',').filter(Boolean)) : null;

let override = {};
try { override = JSON.parse(fs.readFileSync(OVERRIDE, 'utf8')); } catch { /* 처음 */ }

// page id → [{ m, lv }]
// wiki_url 은 override 를 먼저 본다 — gbo2.jp 가 URL 을 비워 보낸 신기체(ゲルググＲ 등)는
// update.js 가 override 에만 URL 을 넣으므로, msData 만 보면 위키 대조에서 통째로 빠진다.
//
// 미러에 없는 기체(msData.additions.json — 손으로 넣은 것, 미러에서 사라져 보관한 것,
// 위키가 앞서 만든 LV)도 함께 넣는다. 이걸 빼면 그 기체들은 위키 페이지가 통째로
// 건너뛰어져 밸런스 패치를 영영 못 받는다(보관된 ガンダムDX 가 그 상태였다).
// build.js 가 additions 를 병합한 *뒤에* override 를 적용하므로 반영 경로는 이미 있다.
// 주의: 아래 official 판정은 순수 미러(msData)로 해야 하므로 msData 는 건드리지 않는다.
let addData = [];
try { addData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.additions.json'), 'utf8')); } catch { /* 없어도 됨 */ }
const msAll = msData.concat(addData);

const byPage = new Map();
for (const m of msAll) {
  const url = (override[m.MS名] && override[m.MS名].wiki_url) || m.wiki_url || '';
  const id = (String(url).match(/pages\/(\d+)\.html/) || [])[1];
  if (!id) continue;
  const lv = Number((m.MS名.match(/_LV(\d+)/) || [])[1] || 1);
  if (!byPage.has(id)) byPage.set(id, []);
  byPage.get(id).push({ m, lv });
}

const files = fs.existsSync(WIKI) ? fs.readdirSync(WIKI).filter(f => f.endsWith('.html')) : [];
let mechs = 0, fixed = 0, cleared = 0;
const autoAdds = [];   // 위키엔 있고 gbo2 엔 없는 LV (자동 생성)

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
  const filledTo = {};   // field → 실제로 값이 적힌 마지막 LV (carry-forward 이전)
  const rawRow = {};     // 숫자가 아닌 행(재출격·레어도)도 그대로 담아 둔다
  for (const t of [statT, slotT]) {
    if (!t) continue;
    for (const cells of tableRows(t)) {
      if (cells.length < 2) continue;
      rawRow[cells[0]] = cells.slice(1);
      const field = FIELD[cells[0]];
      if (!field) continue;
      // 위키는 상위 LV 값이 이전과 같으면 칸을 비운다("이전 LV와 동일" 관례).
      // 그래서 빈 칸은 직전 값을 이어(carry-forward) 채운다. 첫 값 전의 빈 칸은 그대로 둔다.
      wikiVals[field] = wikiVals[field] || {};
      let last = null;
      cells.slice(1).forEach((c, i) => {
        const v = Number(c);
        if (c !== '' && !isNaN(v)) { last = v; filledTo[field] = i + 1; }
        if (last != null) wikiVals[field][i + 1] = last;
      });
    }
  }
  if (!Object.keys(wikiVals).length) continue;   // 표를 못 읽으면 그냥 gbo2 값 유지
  mechs++;

  for (const { m, lv } of entries) {
    for (const [field, byLv] of Object.entries(wikiVals)) {
      const wv = byLv[lv];
      // 위키가 그 값을 비웠으면(되돌렸으면) 낡은 교정도 함께 거둔다.
      // 그러지 않으면 한 번 생긴 교정이 영영 남아, 미러/수동 입력 값을 계속 덮어쓴다.
      if (wv == null) {
        if (override[m.MS名] && field in override[m.MS名]) { delete override[m.MS名][field]; cleared++; }
        continue;
      }
      // gbo2 에 값 자체가 없는 항목은 건드리지 않는다. 이 파일은 '교정'용이지 빠진 값을
      // 채우는 곳이 아니다(Number(undefined) 는 NaN 이라 무조건 불일치로 잡힌다).
      if (m[field] == null || m[field] === '') continue;
      // carry-forward 로 채워진 칸(= 위키가 그 LV 를 아직 안 적음)으로는 교정하지 않는다.
      // 빈 칸의 뜻은 '이전 LV 와 동일'이지만, 마지막 기재 LV 를 넘어선 빈 칸은
      // '동일'이 아니라 '미기재'다. 이걸 값으로 믿으면 없는 LV 를 지어낸다
      // (ガブスレイ LV4 슬롯이 LV3 값으로 덮일 뻔했다).
      if (filledTo[field] && lv > filledTo[field]) {
        if (override[m.MS名] && field in override[m.MS名]) { delete override[m.MS名][field]; cleared++; }
        continue;
      }
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

  // ── 위키엔 있는데 gbo2.jp 에 아직 없는 LV 를 보충한다 ──────────────────────
  // 위키가 미러보다 빠르다. 이미 있는 LV 를 베이스로 복제하고 위키 값만 덮어쓴다.
  // build.js 는 같은 MS名 이 공식에 생기면 이 추가분을 자동 무시하므로 중복 걱정이 없다.
  // 실제로 값이 적힌 마지막 LV 까지만 만든다(carry-forward 로 채워진 빈 칸은 세지 않는다).
  // 레벨 수는 HP·코스트처럼 LV 마다 값이 다른 행으로만 판단하고, 둘 다 있으면 작은 쪽을 쓴다.
  // (colspan 은 존재하지 않는 LV 칸까지 덮을 수 있어 넉넉히 잡으면 없는 LV 를 만들어 낸다)
  const lvCand = [filledTo['HP'], filledTo['コスト']].filter(Boolean);
  const maxLv = lvCand.length ? Math.min(...lvCand) : 0;
  if (maxLv > 1) {
    const haveLv = new Set(entries.map(e => e.lv));
    const baseEntry = entries.slice().sort((a, b) => b.lv - a.lv)[0];   // 가장 높은 기존 LV 를 베이스로
    const stem = baseEntry.m.MS名.replace(/_LV\d+$/, '');
    const wikiUrl = (override[baseEntry.m.MS名] && override[baseEntry.m.MS名].wiki_url) || baseEntry.m.wiki_url || '';
    for (let lv = 2; lv <= maxLv; lv++) {
      if (haveLv.has(lv)) continue;
      const e = JSON.parse(JSON.stringify(baseEntry.m));
      e.MS名 = stem + '_LV' + lv;
      e.wiki_url = wikiUrl;
      for (const [field, byLv] of Object.entries(wikiVals)) if (byLv[lv] != null) e[field] = byLv[lv];
      const sec = (rawRow['再出撃時間'] || [])[lv - 1];       // '11秒' → 11
      if (sec && /\d/.test(sec)) e.再出撃時間 = Number(sec.match(/\d+/)[0]);
      const rar = (rawRow['レアリティ'] || [])[lv - 1];
      if (rar) e.レアリティ = rar;
      e._fromWiki = true;                                     // 자동 생성 표시(수동 추가분과 구분)
      autoAdds.push(e);
    }
  }
}

fs.writeFileSync(OVERRIDE, JSON.stringify(override, null, 1));
console.log(`위키 대조: 기체 페이지 ${mechs}개 · 교정 ${fixed} · 해제 ${cleared} → ${Object.keys(override).length}기 오버라이드`);

// 자동 보충 LV 를 additions 에 반영한다.
// --pages 로 일부만 돌 때 다른 기체의 자동 분을 지우지 않도록, 이번에 본 페이지의 것만 갈아끼운다.
// 손으로 넣은 항목(_fromWiki 없음)은 언제나 보존한다.
{
  const ADD = path.join(ROOT, 'data', 'msData.additions.json');
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(ADD, 'utf8')); } catch { /* 처음 */ }
  const touched = new Set(autoAdds.map(m => m.MS名.replace(/_LV\d+$/, '')));
  const kept = prev.filter(m => !m._fromWiki || !touched.has(String(m.MS名).replace(/_LV\d+$/, '')));
  const have = new Set(kept.map(m => m.MS名));
  const merged = kept.concat(autoAdds.filter(m => !have.has(m.MS名)));
  // 위키와 gbo2.jp 는 같은 기체를 전각/반각으로 다르게 적는다(ゲルググＲ ↔ ゲルググR).
  // 문자열 그대로 비교하면 공식에 생겼는데도 보충분이 안 지워져 같은 기체가 둘로 늘어난다.
  // NFKC 로 접어서 비교한다.
  const key = n => String(n).normalize('NFKC').replace(/\s+/g, '');
  const official = new Set(msData.map(m => key(m.MS名)));
  // 자동 보충분(_fromWiki)과 '미러에서 사라져 보관한 것'(_keptFromMirror)은
  // 공식에 (다시) 실리면 정리한다. 손으로 넣은 항목은 언제나 남긴다.
  const live = merged.filter(m => (!m._fromWiki && !m._keptFromMirror) || !official.has(key(m.MS名)));
  if (live.length !== prev.length || autoAdds.length) {
    fs.writeFileSync(ADD, JSON.stringify(live, null, 1) + '\n');
  }
  const autoN = live.filter(m => m._fromWiki).length;
  if (autoAdds.length || autoN) {
    console.log(`  위키 보충 LV: 이번 ${autoAdds.length}건 · 보관 중 ${autoN}건 (gbo2 반영 시 자동 소멸)`);
    for (const m of autoAdds) console.log(`     + ${m.MS名} (코스트 ${m.コスト} · HP ${m.HP})`);
  }
}

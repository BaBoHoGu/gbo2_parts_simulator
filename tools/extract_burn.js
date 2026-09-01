// 위키 5891(특수 연소제)의 **실측표**를 data/burn.override.json 으로 뽑는다.
//   node tools/extract_burn.js
//
// 왜 필요한가 — 소이 히트 수는 계산으로 한 값을 못 낸다.
// 게임은 지속시간을 틱 간격으로 나눠 내림하므로(히트 = floor(지속÷간격)+1),
// 기본 히트 h 는 '지속÷간격 ∈ [h-1, h)' 만 알려 준다. 여기에 지속 배율을 곱하면
// 결과가 두 정수에 걸친다. 그래서 앱은 「16~17히트」처럼 범위로 낸다.
// 위키에 **실제로 재 본 값**이 있는 무장만은 그 값을 그대로 쓴다.
//
// 표에서 쓰는 건 「ダメージ（標準値）」와 「特殊燃焼剤装備」 두 열뿐이다.
// 「イレギュラーDBL併用時」·「弾薬強化キット併用時」 은 **어느 파츠까지 겹친 값인지
// 표에 적혀 있지 않아** 쓰지 않는다 — 잘못 붙이면 틀린 수치를 확신에 차서 보여 준다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fetchWikiUrl } = require('./lib/wiki_fetch.js');

const URL = 'https://w.atwiki.jp/battle-operation2/pages/5891.html';
const DEST = path.join(ROOT, 'data', 'burn.override.json');

const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const cell = c => {
  const m = clean(c).match(/([\d,]+)\s*[（(]\s*([\d,]+)\s*[x×ｘ]\s*(\d+)\s*[)）]/);
  return m ? { per: +m[2].replace(/,/g, ''), hits: +m[3] } : null;
};
const nkey = s => String(s).normalize('NFKC').replace(/[\s・･]/g, '');
const FX = /(\d+)\s*固定ダメージ\s*[（(]\s*(\d+)\s*[x×ｘ]\s*(\d+)\s*HIT/i;

(async () => {
  const html = await fetchWikiUrl(URL);
  // 받기 실패·표 구조 변경은 경고만 하고 넘어간다. 기존 실측 파일을 그대로 두는 편이
  // 업데이트 전체를 세우는 것보다 낫다(이 데이터는 자주 바뀌지 않는다).
  if (!html) { console.log('  · 위키 5891 을 받지 못해 소이 실측은 그대로 둡니다.'); process.exit(0); }
  const table = (html.match(/<table[\s\S]*?<\/table>/gi) || []).find(x => /特殊燃焼剤装備/.test(x));
  if (!table) { console.log('  · 위키 5891 에서 실측표를 못 찾아 그대로 둡니다(표 구조 변경?).'); process.exit(0); }

  const ms = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
  const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'weapons.json'), 'utf8'));
  const pageOf = new Map();
  for (const m of ms) {
    const id = (String(m.wiki_url || '').match(/pages\/(\d+)/) || [])[1];
    if (id) pageOf.set(nkey(String(m['MS名']).replace(/_LV\d+$/, '')), id);
  }

  const out = {};
  const miss = [];
  let rows = 0;
  for (const tr of (table.match(/<tr[\s\S]*?<\/tr>/gi) || [])) {
    const cells = tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
    if (cells.length < 3) continue;
    const base = cell(cells[1]), soi = cell(cells[2]);
    if (!base || !soi) continue;
    rows++;
    for (const raw of clean(cells[0]).split(/[、,]/).map(x => x.trim()).filter(Boolean)) {
      // 이름 뒤 괄호는 두 가지다 — 기체 변형(（BA）·（UL）·（CH）)이거나 부기(（連動射撃）).
      // **전체 이름을 먼저** 찾는다. 떼고 먼저 찾으면 변형 기체가 기본형으로 잘못 붙는다
      // (装甲強化型ジム（BA） → 装甲強化型ジム 로 가서 소이 무장이 없다고 나왔다).
      const bare = raw.replace(/[（(][^）)]*[)）]\s*$/, '').trim();
      const id = pageOf.get(nkey(raw)) || pageOf.get(nkey(bare));
      if (!id || !W[id]) { miss.push(raw + ' — 기체를 못 찾음'); continue; }
      // 이름이 아니라 '기본값이 같은 무장'으로 맞춘다. 표기가 흔들려도 숫자는 안 흔들린다.
      const cand = (W[id].weapons || []).filter(w => {
        const m = ((w.info && w.info['備考']) || '').match(FX);
        return m && +m[2] === base.per && +m[3] === base.hits;
      });
      if (cand.length !== 1) { miss.push(raw + ' — 기본 ' + base.per + '×' + base.hits + ' 무장 ' + cand.length + '개'); continue; }
      out[id + '|' + cand[0].name] = { base: [base.per, base.hits], soi: [soi.per, soi.hits] };
    }
  }

  fs.writeFileSync(DEST, JSON.stringify(out, null, 1) + '\n');
  console.log('위키 5891 실측 ' + rows + '행 → 무장 ' + Object.keys(out).length + '종 매핑 (data/burn.override.json)');
  if (miss.length) {
    console.log('  못 붙인 것 ' + miss.length + '건:');
    for (const m of miss) console.log('    · ' + m);
  }
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

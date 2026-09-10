// 위키 「カスタムパーツ」 페이지에서 파츠별 필요 리사이클 티켓 수를 읽어
// data/parts.recycle.json 을 만든다.
//
//   수치가 적혀 있으면  → 리사이클 티켓으로 살 수 있다 = 무과금 파츠
//   「-」                → 기본 지급 (역시 무과금)
//   빈 칸                → 티켓으로 못 산다 = 과금 파츠
//
//   node tools/build_parts_recycle.js [--offline]
// --offline 은 raw/wiki_parts_263.html 캐시를 쓴다(위키 접속 없이 재생성).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const W = require('./lib/wiki_fetch.js');

const PAGE = '263';
const CACHE = path.join(ROOT, 'raw', 'wiki_parts_263.html');
const OUT = path.join(ROOT, 'data', 'parts.recycle.json');

const cell = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** 표를 읽어 [{name, lv, recycle}] 로. 이름 칸은 rowspan 으로 여러 LV 를 덮는다. */
function parseTables(html) {
  const out = [];
  for (const t of [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0])) {
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m =>
      [...m[0].matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/g)].map(c => ({
        txt: cell(c[3]),
        rs: Number((c[2].match(/rowspan\s*=\s*"?(\d+)/) || [])[1] || 1)
      })));
    if (!rows.length) continue;
    if (!rows[0].map(c => c.txt).some(h => /リサイクル/.test(h))) continue;
    let name = null, left = 0;
    for (const r of rows.slice(2)) {            // 0=머리, 1=近/中/遠
      let cells = r.map(c => c.txt);
      if (left > 0) left--;
      else if ((r[0] && r[0].rs > 1) || cells.length >= 10) { name = cells[0]; left = (r[0].rs || 1) - 1; cells = cells.slice(1); }
      if (!name || cells.length < 7) continue;
      out.push({ name, lv: cells[0], recycle: cells[6] });
    }
  }
  return out;
}

/** 이름 대조용 정규화 — 표기 차이를 지운다.
 *  위키 「カテゴリ特攻プログラム［強襲］_LV1」 vs 우리 「カテゴリ特攻プログラム_強襲_LV1」 처럼
 *  괄호가 전각/반각/언더바로 제각각이라, 괄호·공백·언더바를 전부 지우고 비교한다. */
const norm = s => String(s)
  .replace(/[［\[\]］（）()]/g, '')
  .replace(/[\s_]/g, '')
  .replace(/推進材/g, '推進剤')      // 위키 表記ゆれ
  .replace(/^試験型/, '')            // 우리 데이터는 접두 없이 적혀 있다
  .toUpperCase();

function main() {
  const offline = process.argv.includes('--offline');
  const run = html => {
    fs.writeFileSync(CACHE, html, 'utf8');
    const rows = parseTables(html);
    const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parts.json'), 'utf8'));
    const ours = [];
    for (const cat of Object.keys(parts)) for (const p of parts[cat]) ours.push(p.name);

    // 위키 행을 정규화 키로 색인 — 이름+LV, 그리고 LV 가 이름에 안 붙는 우리 표기를 위해 이름만도
    const byKey = new Map();
    for (const r of rows) {
      byKey.set(norm(r.name + r.lv), r);
      if (r.lv === 'LV1' && !byKey.has(norm(r.name))) byKey.set(norm(r.name), r);
    }

    const map = {}, miss = [];
    for (const nm of ours) {
      const r = byKey.get(norm(nm)) || byKey.get(norm(nm.replace(/_LV\d+$/, '')));
      if (!r) { miss.push(nm); continue; }
      const n = String(r.recycle).replace(/,/g, '');
      map[nm] = /^\d+$/.test(n) ? Number(n) : (r.recycle === '-' ? 0 : null);
    }
    const free = Object.values(map).filter(v => v !== null).length;
    const paid = Object.values(map).filter(v => v === null).length;

    fs.writeFileSync(OUT, JSON.stringify({
      _설명: '파츠별 필요 리사이클 티켓. 숫자=티켓으로 구매 가능(무과금), 0=기본 지급, null=티켓으로 못 삼(과금).',
      _출처: 'https://w.atwiki.jp/battle-operation2/pages/263.html',
      _생성: new Date().toISOString().slice(0, 10),
      ticket: map
    }, null, 1) + '\n', 'utf8');

    console.log(`위키 행 ${rows.length} · 우리 파츠 ${ours.length}`);
    console.log(`  무과금 ${free}종 (기본지급 ${Object.values(map).filter(v => v === 0).length} 포함) · 과금 ${paid}종`);
    if (miss.length) console.log('  ⚠ 위키에서 못 찾음 ' + miss.length + '종: ' + miss.join(', '));
    console.log('→ ' + path.relative(ROOT, OUT));
  };

  if (offline) {
    if (!fs.existsSync(CACHE)) { console.error('캐시가 없습니다: ' + CACHE); process.exit(1); }
    return run(fs.readFileSync(CACHE, 'utf8'));
  }
  const got = {};
  W.fetchWikiHtml([PAGE], (id, h) => { got[id] = h; })
    .then(() => {
      if (!got[PAGE]) { console.error('위키 페이지를 받지 못했습니다.'); process.exit(1); }
      run(got[PAGE]);
    })
    .catch(e => { console.error(String(e.message || e)); process.exit(1); });
}
main();

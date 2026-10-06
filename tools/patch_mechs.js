// 위키의 「パラメータ調整」 목록에서 **이번 밸런스 패치로 조정된 기체**를 뽑아
// data/patch.json 에 적는다.
//   node tools/patch_mechs.js
//
// 왜 따로 두는가 — update.js 는 **새 패치를 감지했을 때만** 이 목록을 적는다.
// 이미 반영이 끝난 패치(지금은 20260924)는 다시 감지되지 않아 목록이 비어 있다.
// 추천 영상이 이 목록을 보험으로 쓰므로, 한 번은 채워 넣어야 한다.
// (다음 패치부터는 update.js 가 알아서 적는다)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fetchWikiUrl } = require('./lib/wiki_fetch.js');

(async () => {
  const msList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));

  // 평문 https 는 Cloudflare 가 403 을 준다 — 헤드리스 경로로 받는다(update.js 와 같은 이유).
  const html = await fetchWikiUrl('https://w.atwiki.jp/battle-operation2/');
  if (!html) { console.error('위키 첫 페이지를 받지 못했습니다.'); process.exit(1); }

  const start = html.search(/パラメータ調整/);
  if (start < 0) { console.error('「パラメータ調整」 목록을 찾지 못했습니다.'); process.exit(1); }
  const rest = html.slice(start + 10);
  const endRel = rest.search(/<h3[ >]/);
  const seg = endRel < 0 ? rest : rest.slice(0, endRel);

  const date = [...seg.matchAll(/(\d{8})アプデ分/g)].map(m => m[1]).sort().pop() || '';
  const byId = new Map();
  for (const m of msList) {
    const id = (String(m.wiki_url || '').match(/pages\/(\d+)/) || [])[1];
    if (id) byId.set(id, String(m.MS名).replace(/_LV\d+$/, ''));
  }
  const ids = [...new Set([...seg.matchAll(/pages\/(\d+)\.html/g)].map(m => m[1]))];
  const mechs = [...new Set(ids.map(id => byId.get(id)).filter(Boolean))].sort();

  const P = path.join(ROOT, 'data', 'patch.json');
  const prev = JSON.parse(fs.readFileSync(P, 'utf8'));
  fs.writeFileSync(P, JSON.stringify({ applied: prev.applied || date, date, mechs }, null, 1) + '\n');
  console.log(`패치 ${date} · 조정된 기체 ${mechs.length}기 → data/patch.json`);
  console.log('  ' + mechs.slice(0, 12).join(' / ') + (mechs.length > 12 ? ' …' : ''));
})().catch(e => { console.error(e); process.exit(1); });

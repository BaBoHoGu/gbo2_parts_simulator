// 격투 방향·연격 표의 **열을 무장에 제대로 붙였는가.**
//   node tools/melee_col_check.js
//
// ■ 왜 — 위키는 열 머리에 무장명을 **줄여** 적는다(「アロンダイト」/「アロンダイトビームソード」).
//   열을 못 찾으면 `matchColumn` 이 조용히 「標準倍率」(기체 공통값)로 떨어진다. 값이
//   비는 게 아니라 **그럴듯한 다른 수**가 들어앉아, 화면에는 아무 이상이 없다.
//   2026-10-13 에 사용자가 짚었다: 데스티니의 하격이 130% 로 보였다(실제 315%(45%x7)),
//   「최대가동（S）」 변형은 통째로 없었다. 전수로 세 보니 무장 43개가 어긋나 있었다.
//
// ■ 자 — 생산자(matchColumn)에게 다시 묻지 않는다. **위키 표의 열이 다 쓰였는가**를 본다.
//   어느 무장도 쓰지 않는 열이 남아 있으면, 그 열은 누군가의 값인데 아무도 안 가져간 것이다.
//   이 수가 늘면 운다 — 줄어드는 것은 좋은 일이니 막지 않는다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');
const { parseTable } = require('./lib/table.js');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'weapons.json'), 'utf8'));
const clean = s => s.replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&/g, '').replace(/\s+/g, ' ').trim();
const OWN = /^(本武器|本MS|本機).{0,2}倍率$/;

/* ── ① 아무도 안 쓰는 格闘方向 열 ───────────────────────────────────────
   남아 있는 19개는 전부 **줄임말이 무장명의 일부가 아닌** 것들이다 —
   위키가 「ロング・ビーム・サーベル」를 「L・B・S」로 적은 꼴. 글자로는 이을 수가 없어
   (S 는 サーベル·シールド·ソード 다 된다) 손대지 않았다. 잘못 이으면 **다른 무장의 값**이
   들어와 標準倍率 보다 더 나쁘다. 그 19개를 못 박아 **더 늘지 않게** 한다. */
const UNCLAIMED_MAX = 19;   // was 24 (2026-10-13 고치기 전)
{
  const rest = [];
  let pages = 0;
  for (const f of fs.readdirSync(WIKI)) {
    const id = f.replace('.html', '');
    const page = W[id];
    if (!page) continue;
    const html = fs.readFileSync(path.join(WIKI, f), 'utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    let dir = null;
    for (const t of html.match(/<table[\s\S]*?<\/table>/g) || []) {
      const g = parseTable(t, clean);
      if (g[0] && g[0][0] === '格闘方向') { dir = g; break; }
    }
    if (!dir) continue;
    pages++;
    // 쓰인 열의 '지문' = 그 열의 방향별 값 묶음. 어느 variant 가 그대로 들고 있으면 쓰인 것.
    const used = new Set();
    for (const w of page.weapons || []) {
      for (const v of ((w.melee && w.melee.variants) || [])) {
        used.add(v.direction.map(d => d.label + '=' + d.raw).join('|'));
      }
    }
    for (let i = 1; i < dir[0].length; i++) {
      const c = dir[0][i];
      if (!c || c === '標準倍率' || OWN.test(c)) continue;
      const fp = dir.slice(1).filter(r => r[i] && !/連撃不可|^-$|^―$/.test(r[i]))
        .map(r => r[0] + '=' + r[i].trim()).join('|');
      if (fp && !used.has(fp)) rest.push(id + ' ' + c);
    }
  }
  /* 읽은 페이지 수는 **바닥만** 막는다 — 0 페이지를 읽고 통과하는 헛검사를 막으려는 줄이다.
     같다(===)로 박았더니 새 기체가 위키에 올라온 날(2026-10-16 밴디트 8007) 배포가 멈췄다. 기체는 늘기만 한다. */
  ok('方向 표를 읽은 페이지가 줄지 않았다 (≥597, 지금 ' + pages + ')', pages >= 597, pages);   // was === 597
  ok('아무도 안 쓰는 方向 열이 ' + UNCLAIMED_MAX + '개를 넘지 않는다',
    rest.length <= UNCLAIMED_MAX, { 지금: rest.length, 넘친것: rest.slice(0, 8) });
}

/* ── ② 사용자가 짚은 자리를 **글자로 못 박는다** ───────────────────────
   되돌아가면 ①은 '열이 쓰였다'고만 보므로 못 잡는다 — 다른 무장이 그 열을 가져가도
   열은 쓰인 것이기 때문이다. 그래서 값 자체를 적어 둔다. was = 고치기 전에 보였던 값. */
const page = id => W[id] || { weapons: [] };
const wOf = (id, name) => (page(id).weapons || []).find(w => w.name === name);
const dirOf = (w, vLabel, dLabel) => {
  const v = ((w && w.melee && w.melee.variants) || []).find(x => x.label === vLabel);
  return v && (v.direction || []).find(d => d.label === dLabel);
};
const PINS = [
  // [페이지, 무장, 변형, 방향, 기대 raw, 기대 히트수, was]
  ['7202', 'アロンダイトビームソード', '기본', '下格', '315%(45%x7)', 7, '130% / 1히트 (標準倍率)'],
  ['7202', 'アロンダイトビームソード', '최대가동', '下格', '270%', 1, '변형 자체가 없었다'],
  ['6911', 'X1改用ビーム・ザンバー', '최대출력', '下格', '240%(120%x2)', 2, '(이건 원래 맞았다 — 짝으로 둔다)'],
  ['6911', 'X1改用スクリュー・ウェッブ', '기본', '下格', '1750%(250%x7(3＋4))', 7, '같은 raw 인데 1히트로 삼켰다'],
  ['4195', 'ビーム・ナギナタ［片刃］', '기본', '下格', '180%(60%x3)', 3, '130% (［강화］와 같은 열을 썼다)'],
  ['7435', 'ソードメイス', '阿頼耶識', '下格', '280%(140%x2)', 2, '변형 자체가 없었다(［］ 괄호를 안 봤다)'],
  ['3084', '高機動型Gα用ビーム・サーベル', '기본', '下格', '195%(65%x3)', 3, '130% (標準倍率)']
];
for (const [id, nm, vl, dl, raw, n, was] of PINS) {
  const d = dirOf(wOf(id, nm), vl, dl);
  ok(nm + ' ' + vl + ' ' + dl + ' = ' + raw + ' · ' + n + '히트   (was ' + was + ')',
    !!d && d.raw === raw && d.hits.length === n,
    d ? { raw: d.raw, 히트: d.hits.length } : '(그 변형/방향이 없다)');
}

/* ③ 連撃数 표도 같은 matchColumn 을 쓴다 — 방향만 보고 연격을 놓치지 않게 한 자리 */
{
  const w = wOf('3968', 'ザクⅣ（IP）用大型H・ホーク');
  const c2 = ((w && w.melee && w.melee.combo) || []).find(x => x.label === '2撃目');
  ok('ザクⅣ（IP）用大型H・ホーク 2撃目 = 80%   (was 50% — 標準倍率)',
    !!c2 && c2.mult === 0.8, c2 || '(연격 없음)');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

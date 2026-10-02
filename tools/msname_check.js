// 기체 이름 번역이 그 기체의 무장 이름과 어긋나지 않는가.
//   node tools/msname_check.js
//
// **왜 이런 자가 필요한가** — 기체 이름은 기계번역이 옮긴다. 틀려도 그럴듯한 한국어면
// 「일본어가 남았나」 검사도, 용어 대조도 통과한다. 실제로 ギャン改 가 「깡패」로 들어갔고
// 배포까지 나갔다(사용자가 찾았다).
//
// 다행히 **같은 이름을 두 경로로** 갖고 있다. 「ギャン改用大型ビーム・ソード」처럼 무장 이름은
// 기체 이름을 접두로 달고 있고, 무장명 사전은 MT 가 아니라 **규칙 기반**(weapon_terms)이다.
// 둘이 어긋나면 MT 쪽이 의심스럽다. 표본 608기에서 헛경보 0, 「깡패」는 잡힌다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra != null ? '  — ' + JSON.stringify(extra, null, 1) : ''));
  good ? pass++ : fail++;
};

const weapons = rd('data', 'weapons.json');
const msData = rd('data', 'msData.json');
const override = rd('data', 'msData.override.json');
const msDic = { ...rd('data', 'i18n', 'ms.auto.json'), ...rd('data', 'i18n', 'ms.json') };
const wDic = rd('data', 'i18n', 'weapons.json');

// wiki_url 은 override 가 채워 주는 기체가 있다 (새 기체는 본 자료에 비어 있다)
const urlOf = m => m.wiki_url
  || ((override[m.MS名] || override[String(m.MS名).replace(/_LV\d+$/, '')] || {}).wiki_url)
  || '';
const pageOf = m => (String(urlOf(m)).match(/\/pages\/(\d+)\.html/) || [])[1];
const norm = s => String(s).replace(/\s+/g, '');

let checked = 0;
const bad = [];
const seen = new Set();
for (const m of msData) {
  const base = String(m.MS名).replace(/_LV\d+$/, '');
  if (seen.has(base)) continue;
  const page = weapons[pageOf(m)];
  if (!page) continue;
  const koMs = msDic[base];
  if (!koMs) continue;
  // 「<기체>用…」으로 시작하는 무장만 본다 — 그 접두가 곧 기체 이름이다
  const owned = (page.weapons || []).filter(w => String(w.name).indexOf(base + '用') === 0);
  if (!owned.length) continue;

  /* 「샤아 전용 즈고크용 …」처럼 '용' 이 여러 번 나온다 — **마지막** 것으로 가른다.
     띄어쓰기는 지우고 견준다(「겔구그R」 vs 「겔구그 R」은 틀린 게 아니다).
     기체 이름에 구분자가 붙는 경우가 있어(「카풀 - カプル」) 앞부분만 맞으면 통과시킨다. */
  const prefixes = new Set();
  for (const w of owned) {
    const ko = wDic[w.name];
    if (!ko) continue;
    const mm = /^(.+)용\s/.exec(ko);
    if (mm) prefixes.add(mm[1]);
  }
  if (!prefixes.size) continue;
  seen.add(base);
  checked++;
  const koN = norm(koMs);
  if (![...prefixes].some(p => koN === norm(p) || koN.indexOf(norm(p)) === 0))
    bad.push({ 기체: base, 기체명: koMs, 무장이_말하는_이름: [...prefixes] });
}

// 자가 헛돌지 않는지 — 맞대 볼 기체가 실제로 많아야 뜻이 있다
/* 헛돌지 않는지만 본다. 실측 227기(LV 중복 제외) — 자료가 늘고 줄 수 있으니 바닥만 둔다.
   0 에 가까우면 기체↔무장 잇기가 깨진 것이라, 그때는 「어긋남 0」이 아무 뜻이 없다. */
ok('맞대 볼 기체가 충분하다 (150기 이상)', checked >= 150, { 맞대봄: checked });
ok('기체 이름이 그 기체 무장 이름과 어긋나지 않는다', bad.length === 0, bad.slice(0, 8));
if (!bad.length) console.log('  (맞대 본 기체 ' + checked + '기 · 어긋남 0)');
else console.log('  고치는 법: data/i18n/ms.json 에 수동 번역을 더하세요 (자동 사전보다 우선합니다)');

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

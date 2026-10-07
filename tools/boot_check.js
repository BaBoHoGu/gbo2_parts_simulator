// **JS 가 돌기 전 화면**이 멀쩡한가.
//   node tools/boot_check.js
//
// 화면 여섯을 감추는 규칙은 body 의 view-* 클래스에 걸려 있는데, 그 클래스는 JS 가 붙인다.
// 산출물이 16.7MB 라 **콜드 스타트에서는 JS 전에 한 번 그려진다** — 그때 기체 선택·공유
// 갤러리·토큰 계산기·강화 플랜·스킬 도감·파츠 적용이 통째로 쌓여 보였다(사용자 보고,
// APK 를 완전히 끈 뒤 처음 열 때. 나갔다 들어오면 캐시가 더워져 안 보였다).
//
// 그래서 **자바스크립트를 꺼 놓고** 연다. 그 상태가 곧 「JS 가 아직 안 돈 순간」이다.
// 눈으로는 못 잡는다 — 빠른 PC 에서는 그 틈이 몇 밀리초라 그냥 안 보인다.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GBO2Browser = require('./lib/browser.js');
const { findChrome } = require('./lib/wiki_fetch.js');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra != null ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const DIST = path.join(ROOT, 'dist', 'gbo2-simulator.html');

(async () => {
  if (!fs.existsSync(DIST)) {
    console.log('dist 가 없습니다 — node tools/build.js 먼저'); process.exit(1);
  }
  const br = await GBO2Browser.launch({ executablePath: findChrome(), headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  await pg.setJavaScriptEnabled(false);          // ← JS 가 아직 안 돈 순간을 그대로 만든다
  await pg.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });
  await pg.goto('file:///' + DIST.replace(/\\/g, '/').replace(/ /g, '%20'),
    { waitUntil: 'load', timeout: 120000 });

  const seen = await pg.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll('.screen')) {
      const r = s.getBoundingClientRect();
      const st = getComputedStyle(s);
      if (st.display !== 'none' && r.width > 0 && r.height > 0) out.push(s.id);
    }
    return { visible: out, bodyClass: document.body.className, docH: document.documentElement.scrollHeight };
  });

  ok('body 가 처음부터 화면을 하나 정해 둔다', /view-\w+/.test(seen.bodyClass), { class: seen.bodyClass });
  /* 가장 중요한 줄. 둘 이상 보이면 사용자가 본 그 모습이다. */
  ok('JS 없이도 화면이 하나만 보인다', seen.visible.length === 1, seen.visible);
  ok('그 하나가 기체 선택 화면이다', seen.visible[0] === 'screenSelect', seen.visible);

  /* 쌓이면 문서가 세로로 길어진다 — 개수와 따로 재서, 한쪽이 거짓이어도 다른 쪽이 잡게 한다. */
  ok('문서가 한 화면 높이에서 크게 벗어나지 않는다', seen.docH < 915 * 3,
    { 높이: seen.docH, 한화면: 915 });

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

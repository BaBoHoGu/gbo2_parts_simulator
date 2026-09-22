// 「계산 안 함」 모아 보기 — 스킬 도감 안의 보기 전환이 제대로 도는지 본다.
//
//   node tools/unmodview_check.js
//
// 이 화면은 **앱이 알고는 있지만 숫자에 넣지 않은 것**을 모은다. 여태 기체·파츠를 하나씩
// 열어야만 보여서 무엇이 비어 있는지 전체를 볼 수 없었다.
// 검사할 것은 셋이다:
//   ① 정말 모으는가 (종류·기체 수가 그럴듯한가) — 0 이면 훑기가 죽은 것이다
//   ② **왜** 안 넣는지를 갈래로 나눠 보여 주는가
//   ③ 일본어가 남지 않는가 — 원문을 그대로 실으면 이 앱의 원칙이 깨진다.
//      번역 사전은 **문장 전체**가 열쇠라, 잘라 낸 조각을 넘기면 조용히 원문이 나온다.
const path = require('path');
const { TAIL_SRC } = require('./lib/janame.js');
const ROOT = path.join(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra, null, 1) : '')); }
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  const r = await pg.evaluate(async (TAIL_SRC) => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.querySelector('#infoClose');
    if (c && document.body.classList.contains('info-open')) c.click();
    const btn = document.querySelector('#codexBtn');
    if (!btn) return { err: '스킬 도감 버튼이 없음' };
    btn.click(); await wait(700);
    const seg = document.querySelector('#codexView .seg-btn[data-v="unmod"]');
    if (!seg) return { err: '보기 전환이 없음' };
    const t0 = performance.now();
    seg.click();
    const ms = Math.round(performance.now() - t0);
    await wait(500);

    const chips = [...document.querySelectorAll('#codexCatChips .chip')].map(x => x.textContent.trim());
    const items = [...document.querySelectorAll('#codexList .codex-item')];
    const note = document.querySelector('#codexNote').textContent;
    // 칩 글은 「고칠 수 있음 29」 꼴이다 — 뒤의 수를 떼어 합을 맞춰 본다
    const num = c => Number((c.match(/(\d+)$/) || [])[1] || 0);
    const total = num(chips.find(c => c.startsWith('전체')) || '');
    let sum = 0;
    for (const g of ['고칠 수 있음', '값이 나와야 함', '일부러 안 넣음'])
      sum += num(chips.find(c => c.startsWith(g)) || '');
    const tags = document.querySelectorAll('#codexList .unmod-grp').length;

    /* 가나만 본다 — 한자는 한국어 표기에도 쓰여(「제간」 등) 잡으면 거짓 경보가 난다.
       이 화면은 **가진 기체 이름**을 늘어놓으므로 「카풀 - カプール」 꼬리표가 섞인다 —
       봐 주는 규칙은 lib/janame.js 한 곳에 있다(셋이 베껴 쓰면 언젠가 갈린다). */
    const JA = /[ぁ-ゖァ-ヺ]/;
    const TAIL = new RegExp(TAIL_SRC, 'g');
    const cut = t => String(t).replace(TAIL, '');
    const bad = [];
    let panes = 0;
    for (const it of items) {
      it.click(); await wait(25);
      const t = document.querySelector('#codexPane').textContent;
      if (t && t.length > 20) panes++;
      const nm = it.textContent.replace(/\s+/g, ' ').trim().slice(0, 30);
      if (JA.test(cut(t)) || JA.test(cut(nm))) bad.push(nm);
    }
    // 스킬 보기로 돌아가도 멀쩡한가 — 전환이 한쪽으로만 되면 화면이 망가진다
    document.querySelector('#codexView .seg-btn[data-v="skill"]').click();
    await wait(400);
    const backItems = document.querySelectorAll('#codexList .codex-item').length;

    return { ms, note, chips, n: items.length, panes, bad, backItems, total, sum, tags };
  }, TAIL_SRC);

  await br.close();

  if (r.err) { console.log('FAIL  ' + r.err); process.exit(1); }
  console.log('「계산 안 함」 모아 보기 — ' + r.note + '  (훑기 ' + r.ms + 'ms)\n');

  // ① 정말 모으는가 — 0 이면 훑기가 죽은 것이고, 너무 적으면 표본이 깨진 것이다
  ok('모아 놓은 것이 있다 (50종 이상)', r.n >= 50, { 종류: r.n });
  ok('기체 수를 함께 적는다', /기체 \d+기/.test(r.note), r.note);
  /* ② **고칠 수 있는가**로 가른다 — 이것이 이 화면을 여는 이유다.
     「왜 안 넣는가」는 일곱 갈래인데, 정작 알고 싶은 것은 「이 중 뭐가 고쳐지나」였다.
     「왜」는 항목마다 꼬리표로 남기므로 둘 다 살아 있어야 한다. */
  ok('고칠 수 있는가로 가른다 (세 갈래 + 전체)', r.chips.length >= 4, r.chips);
  for (const g of ['고칠 수 있음', '값이 나와야 함', '일부러 안 넣음'])
    ok('「' + g + '」 갈래가 있다', r.chips.some(c => c.startsWith(g)), r.chips);
  /* 「그 밖」은 **갈래를 못 정한 것**이다. 실제로 세 종이 말없이 여기 떨어져 있었다 —
     이유 글의 **강조** 때문에 낱말이 끊겨서였다. 0 이 아니면 새 문구가 들어온 것이다. */
  ok('갈래를 못 정한 것이 없다 (「그 밖」 0)', !r.chips.some(c => c.startsWith('그 밖')), r.chips);
  // 세 갈래의 합이 전체와 맞는가 — 어긋나면 어느 하나가 두 갈래에 들어갔다는 뜻이다
  ok('세 갈래의 합이 전체와 맞는다', r.sum === r.total, { 합: r.sum, 전체: r.total });
  ok('왜 안 넣는지도 꼬리표로 남아 있다', r.tags >= 50, { 꼬리표: r.tags });
  // ③ 고른 것마다 상세가 뜨는가 — 목록만 있고 상세가 비면 반쪽이다
  ok('고르면 상세가 뜬다 (전부)', r.panes === r.n, { 항목: r.n, 상세: r.panes });
  /* ④ 일본어가 남지 않는가.
     번역 사전은 문장 전체가 열쇠라, 잘라 낸 조각을 넘기면 조용히 원문이 그대로 나온다 —
     실제로 처음 만들 때 그렇게 나왔다. 전 항목을 눌러 가며 본다. */
  ok('112종을 눌러 봐도 일본어가 안 남는다', r.bad.length === 0, r.bad.slice(0, 5));
  // ⑤ 돌아오기 — 한쪽으로만 전환되면 스킬 도감이 망가진다
  ok('스킬 보기로 돌아가도 목록이 산다', r.backItems > 0, { 돌아온뒤: r.backItems });
  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

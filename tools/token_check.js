// 들여온 토큰 계산기가 파츠 안에서 제대로 도는지 실측한다.
//
//   node tools/token_check.js
//
// 왜 필요한가 — 계산기는 원래 제 문서에서 혼자 돌던 것이다. 한 문서로 합치면
// 이름이 부딪히거나(id·클래스) 스타일이 새어 조용히 망가진다. 실제로 이식하면서
// 세 번 밟았다: JS 식별자가 클래스 접두사에 휩쓸려 `const total` 이 깨졌고,
// `@media` 줄까지 선택자로 보고 접두사를 달아 2열 배치가 죽었고,
// 팔레트에서 빠진 색 때문에 어두운 화면에 흰 상자가 남았다.
//
// 그래서 보는 것은 셋이다: **계산이 맞는가 · 데이터가 실렸는가 · 읽히는가.**
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1100 });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 90)));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 90)); });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  ok('상단바에 토큰 버튼이 있다', await pg.evaluate(() => !!document.querySelector('#tokenBtn')));
  await pg.evaluate(() => { const b = document.querySelector('#tokenBtn'); if (b) b.click(); });
  await sleep(1200);

  const shell = await pg.evaluate(() => {
    const sc = document.querySelector('#screenToken');
    return {
      vis: !!sc && getComputedStyle(sc).display !== 'none',
      cards: sc ? sc.querySelectorAll('.card').length : 0,
      cols: sc ? getComputedStyle(sc.querySelector('.container')).gridTemplateColumns : ''
    };
  });
  ok('토큰 화면이 열린다', shell.vis);
  ok('카드가 다 있다 (12장 이상)', shell.cards >= 12, '카드 ' + shell.cards + '장');
  // 넓은 화면에서는 2열이어야 한다 — @media 가 깨지면 1열로 주저앉는다
  ok('넓은 화면에서 2열로 선다', /\s/.test(shell.cols.trim()) && shell.cols !== 'none', '「' + shell.cols + '」');

  const data = await pg.evaluate(() => ({
    pick: document.querySelectorAll('#pickupList tr').length,
    steam: document.querySelectorAll('#steamNewsList tr').length,
    pu: (document.querySelector('#pickupUpdated') || {}).textContent || '',
    su: (document.querySelector('#steamUpdated') || {}).textContent || ''
  }));
  ok('픽업 데이터가 실렸다', data.pick > 1, data.pick + '줄');
  ok('스팀 픽업이 실렸다', data.steam > 1, data.steam + '줄');
  ok('갱신 날짜가 보인다', /\d{4}-\d{2}-\d{2}/.test(data.pu) && /\d{4}-\d{2}-\d{2}/.test(data.su),
    '픽업「' + data.pu + '」스팀「' + data.su + '」');

  // ── 계산 ── 손으로 셀 수 있는 값으로 확인한다
  const set = (id, v) => pg.evaluate((i, val) => {
    const e = document.getElementById(i); e.value = val;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, id, v);
  await set('currentDate', '2026-09-17');
  await set('currentToken', '100');
  await set('targetDate', '2026-10-17');
  await sleep(800);
  const base = await pg.evaluate(() => {
    const g = i => (document.getElementById(i) || {}).textContent;
    return { total: g('resultToken'), daily: g('bdDaily'), weekly: g('bdWeekly'), sum: g('bdTotal') };
  });
  // 9/17~10/17 = 31일. 오늘 일일을 안 했으므로 30일 × 3 = 90.
  // 주간 지급일(3·5·7·13·15·17·23·25·27)이 이 범위에 10번 → +10. 100+90+10 = 200.
  ok('일일 수급이 맞다 (30일 × 3 = 90)', base.daily === '+90', '「' + base.daily + '」');
  ok('주간 수급이 맞다 (10회 = 10)', base.weekly === '+10', '「' + base.weekly + '」');
  ok('합계가 맞다 (100+90+10 = 200)', base.total === '200' && base.sum === '200',
    '예상「' + base.total + '」합계「' + base.sum + '」');

  for (let i = 0; i < 3; i++) {
    await pg.evaluate(() => document.getElementById('goldPlus').click());
    await sleep(120);
  }
  await pg.evaluate(() => {
    const c = document.querySelector('.questCheckbox');
    c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(700);
  const more = await pg.evaluate(() => (document.getElementById('resultToken') || {}).textContent);
  ok('금상자 3 + 특수임무 1 이 더해진다 (200 → 210)', more === '210', '「' + more + '」');

  ok('달성 가능 총람이 채워진다',
    await pg.evaluate(() => document.querySelectorAll('#reachBody tr').length > 1));

  // ── 읽히는가 ── 「밝다」가 아니라 **「안 읽힌다」**로 잰다.
  // 처음에는 밝은 배경을 전부 잡았는데, 노란 버튼·구성 막대처럼 **일부러 밝게 둔 것**까지
  // 걸렸다. 실제로 밟은 사고는 「흰 상자에 흰 글씨」였으므로 글자와 배경의 밝기 차를 본다.
  const unreadable = await pg.evaluate(() => {
    const L = c => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
      if (!m) return null;
      if (m[4] !== undefined && Number(m[4]) < 0.5) return null;   // 거의 투명하면 뒤가 비친다
      return +m[1] * 0.299 + +m[2] * 0.587 + +m[3] * 0.114;
    };
    const out = [];
    for (const el of document.querySelectorAll('#screenToken *')) {
      // 제 글자를 직접 가진 것만 — 자식 글자는 그 자식이 따로 검사된다
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      // 배경이 투명하면 **조상까지 올라가** 실제로 깔린 색을 찾는다.
      // 건너뛰면 링크처럼 배경 없는 글자를 통째로 안 보게 된다 —
      // 실제로 그래서 「어두운 바탕에 기본 파랑 링크」 34곳을 놓쳤다.
      let bg = null;
      for (let e = el; e; e = e.parentElement) {
        const v = L(getComputedStyle(e).backgroundColor);
        if (v != null) { bg = v; break; }
      }
      const fg = L(cs.color);
      if (bg == null || fg == null) continue;
      if (Math.abs(bg - fg) < 45)
        out.push((el.className || el.tagName) + ' 배경 ' + cs.backgroundColor + ' 글자 ' + cs.color);
    }
    return [...new Set(out)];
  });
  ok('글자가 배경에 묻히지 않는다', unreadable.length === 0, unreadable.slice(0, 4).join(' / '));

  // 입력칸은 위 검사에 안 걸린다 — 제 글자가 텍스트 노드가 아니라 value·placeholder 라
  // `own` 에서 걸러진다. 그래서 흰 메모칸이 그대로 남아 있었다. 따로 본다.
  const pale = await pg.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#screenToken input:not([type=checkbox]), #screenToken textarea, #screenToken select')) {
      const c = getComputedStyle(el).backgroundColor;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
      if (!m) continue;
      if (+m[1] * 0.299 + +m[2] * 0.587 + +m[3] * 0.114 > 120)
        out.push((el.id || el.className || el.tagName) + ' ' + c);
    }
    return [...new Set(out)];
  });
  ok('입력칸이 어두운 테마를 따른다', pale.length === 0, pale.slice(0, 4).join(' / '));

  // ── 카드 접기 ── 눌러서 실제로 접히는지 본다.
  // 「UI 만 있고 안 먹는」 상태가 실제로 있었다 — 계산기 스크립트가 두 벌 실려
  // 리스너가 둘이라 한 번 누르면 두 번 토글돼 제자리로 돌아왔다.
  const fold = await pg.evaluate(async () => {
    const c = document.querySelector('#screenToken .card.collapsible');
    const h = c.querySelector('h2');
    const was = c.classList.contains('collapsed');
    h.click();
    await new Promise(r => setTimeout(r, 120));
    const now = c.classList.contains('collapsed');
    h.click();                                    // 원래대로 돌려 놓는다
    await new Promise(r => setTimeout(r, 120));
    return { was, now, back: c.classList.contains('collapsed') };
  });
  ok('카드가 접히고 펴진다', fold.now !== fold.was && fold.back === fold.was, JSON.stringify(fold));

  // ── 미래시 ──
  const fut = await pg.evaluate(() => {
    const c = document.querySelector('[data-ck="future"]');
    if (!c) return { missing: true };
    return {
      bars: c.querySelectorAll('.fw-bar').length,
      labels: [...c.querySelectorAll('.fw-label')].map(e => e.textContent).filter(Boolean),
      weeks: c.querySelectorAll('.fw-cell').length,
      today: !!c.querySelector('.fw-today'),
      offRows: c.querySelectorAll('.future-off-row').length,
      png: !!c.querySelector('#futurePng')
    };
  });
  ok('미래시 카드가 그려진다', !fut.missing && fut.bars > 3 && fut.weeks > 3,
    '막대 ' + fut.bars + ' · 주 ' + fut.weeks);

  /* 달 단위로 나뉘어야 한다 — 두 달을 한 줄에 놓으니 복잡하다는 지적을 받아 나눴다.
     한 덩이로 되돌아가면 눈에 잘 안 띄므로 덩이 수와 머리글을 같이 본다. */
  const mb = await pg.evaluate(() =>
    [...document.querySelectorAll('[data-ck="future"] .fw-month-block .fw-mhead')]
      .map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok('미래시가 달 단위로 나뉜다', mb.length >= 2 && mb.every(t => /\d+월/.test(t)),
    mb.join(' | ') || '(덩이 없음)');

  /* 「예상이 지났는데 스팀에 안 나온 기체」도 잡아야 한다. 갱신기가 지난 항목을 예보에서
     지우기 때문에 스냅샷만으로는 못 본다 — data/pickups.history.json 이 그걸 기억한다.
     실제 사례: 기라 줄루(CM) 은 8/29 예보에 09-10 로 있었는데 스팀에 안 나왔다. */
  const hist = await pg.evaluate(() =>
    !!(window.GBO2_PICKUPS && window.GBO2_PICKUPS.history && window.GBO2_PICKUPS.history.seen));
  ok('픽업 이력이 실려 있다', hist);

  /* 픽업은 목요일에 갈린다 — 시작·끝이 맞닿는 건 정상이지만 **한쪽 시작이 다른 쪽
     한가운데로 들어오면** 안 된다. 실제로 하나 있었다: 갱신기가 공지 게시일(07-19 일)을
     개최일(07-23 목)로 잘못 읽어 「72시간 한정」이 플린트 기간 중간에서 시작했다. */
  const overlap = await pg.evaluate(() => {
    const P = (window.GBO2_PICKUPS && window.GBO2_PICKUPS.pickups) || [];
    const t = s => { const [y, m, d] = String(s).split('-').map(Number); return +new Date(y, m - 1, d); };
    const out = [];
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j];
      if (!a.start || !a.end || !b.start || !b.end) continue;
      const as = t(a.start), ae = t(a.end), bs = t(b.start), be = t(b.end);
      if ((bs > as && bs < ae) || (as > bs && as < be))
        out.push(a.name + '(' + a.start + ') × ' + b.name + '(' + b.start + ')');
    }
    return out;
  });
  ok('픽업 기간이 한가운데서 겹치지 않는다', overlap.length === 0, overlap.slice(0, 2).join(' / '));

  // 줄 끝에 날짜가 있어야 한다 — 막대만 보면 눈금에서 되짚어야 한다
  const dated = await pg.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-ck="future"] .fw-rows .fw-row')];
    return { n: rows.length, blank: rows.filter(r => {
      const d = r.querySelector('.fw-date');
      return !d || !/\d+\/\d+/.test(d.textContent);
    }).length };
  });
  ok('미래시 줄 끝에 날짜가 있다', dated.n > 3 && dated.blank === 0,
    dated.n + '줄 중 빈 것 ' + dated.blank);

  // 픽업 예상 표는 빠른 순서로 — 받아 온 차례는 공지 순(최근 것부터)이라 거꾸로 보인다
  const tblOrder = await pg.evaluate(() =>
    [...document.querySelectorAll('#pickupList tr')]
      .map(tr => ((tr.children[1] || {}).textContent || '').match(/\d{4}-\d{2}-\d{2}/))
      .filter(Boolean).map(m => m[0]));
  ok('픽업 예상 표가 빠른 순서다',
    tblOrder.length > 3 && tblOrder.every((d, i) => i === 0 || tblOrder[i - 1] <= d),
    tblOrder.slice(0, 4).join(' , '));
  ok('미래시에 오늘 표시가 있다', !!fut.today);
  ok('이미지 저장 버튼이 있다', !!fut.png);
  /* 이름에 섞여 오는 위키 태그가 글자로 보이면 안 된다 — 실제로 「건담 <ruby>DX…」가 그랬다.
     **미래시 라벨만 보면 안 잡힌다** — 태그가 있는 건담 DX 는 「벗어남」으로 빠져서 거기
     안 나온다. 되돌려 보고 나서야 알았다. 토큰 화면 글자를 통째로 훑는다. */
  const tagged = await pg.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#screenToken *')) {
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && /<\/?[a-z][^>]*>/i.test(n.textContent)) out.push(n.textContent.trim().slice(0, 60));
      }
    }
    return [...new Set(out)];
  });
  ok('화면 글자에 HTML 태그가 안 보인다', tagged.length === 0, tagged.slice(0, 2).join(' / '));
  // 「벗어남」은 되풀이 품목(커스텀 파츠·티켓)이 아니라 **기체**만 잡아야 한다
  const offNames = await pg.evaluate(() =>
    [...document.querySelectorAll('.future-off-row .fo-nm')].map(e => e.textContent));
  ok('벗어남은 기체만 잡는다',
    offNames.every(n => !/커스텀 파츠|티켓|키트|리퀘스트/.test(n)),
    offNames.join(' / ') || '(없음)');

  // 이미지가 실제로 만들어지는가 — 버튼만 있고 안 그려지면 소용이 없다
  const pngSize = await pg.evaluate(() => new Promise(res => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    let done = false;
    HTMLCanvasElement.prototype.toBlob = function (cb, type) {
      done = true; HTMLCanvasElement.prototype.toBlob = orig;
      const u = this.toDataURL(type || 'image/png');
      res({ w: this.width, h: this.height, bytes: u.length });
    };
    const b = document.querySelector('#futurePng');
    if (b) b.click();
    setTimeout(() => { if (!done) { HTMLCanvasElement.prototype.toBlob = orig; res(null); } }, 4000);
  }));
  ok('미래시 이미지가 만들어진다', !!pngSize && pngSize.w > 600 && pngSize.bytes > 20000,
    JSON.stringify(pngSize));
  // 저장 버튼이 카드 머리줄 안에 있어서, 전파를 안 막으면 저장하면서 카드가 접힌다
  ok('이미지 저장이 카드를 접지 않는다',
    await pg.evaluate(() => !document.querySelector('[data-ck="future"]').classList.contains('collapsed')));

  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].slice(0, 3).join(' | '));

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

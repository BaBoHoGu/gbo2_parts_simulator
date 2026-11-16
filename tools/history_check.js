// 파츠 화면 「업데이트 이력」 칸 — 위키 「アップデート履歴」 전체를 제대로 싣고 보이는가.
//   node tools/history_check.js        (먼저 node tools/build.js · 사이트판 부분은 dist/web 이 있을 때만)
//
// ■ 무엇을 — 2026-11-16 신규. data/ms_history.json(extract_ms_history.js) → 무장 칸 아래 접이식 칸.
//   ① 자료: 한국어 줄에 일본어가 섞이지 않았다(반쯤 옮긴 글을 내지 않는다) · 숫자가 원문과 같다(수치 기록이다)
//      · 최신이 위 · 갈래(adj/get)가 있다 · 알려진 항목(RF 겔구그 10-29 아암 미사일 1100 → 1250)이 들어 있다
//   ② 화면: 처음엔 접혀 있고 **자료를 읽지 않는다** · 진짜 마우스로 펼치면 항목 수가 자료와 같다
//      · 「성능 조정만」 이 adj 만 남긴다 · 한국어 모드 화면 글에 일본어 줄이 거의 없다
//   ③ 사이트판: 이력은 따로 떨어진 파일(history.<지문>.json)이고 HTML 에는 주소만 실린다(첫 접속에 안 실린다)
// 개수는 바닥만 막는다(데이터가 늘면 같이 는다).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require('./lib/history_tr.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ① 자료
  const F = path.join(ROOT, 'data', 'ms_history.json');
  ok('data/ms_history.json 이 있다', fs.existsSync(F));
  const H = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : {};
  const ids = Object.keys(H);
  ok('기체 페이지 500개 이상', ids.length >= 500, ids.length);
  let lines = 0, ko = 0, mixed = [], badNum = [], order = [], kinds = [], dates = [];
  for (const id of ids) {
    const es = H[id];
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.d)) dates.push(id + ' ' + e.d);
      if (!['adj', 'get'].includes(e.k)) kinds.push(id + ' ' + e.d);
      if (i && es[i - 1].d < e.d) order.push(id + ' ' + e.d);
      const pairs = [[e.h, e.hk], ...(e.l || []).map(x => [x[1], x[2]])];
      for (const [ja, k] of pairs) {
        lines++;
        if (k == null) { if (!T.hasJa(ja)) ko++; continue; }
        ko++;
        if (T.hasJa(k)) mixed.push(ja + ' → ' + k);
        if (!T.digitsOk(ja, k)) badNum.push(ja + ' → ' + k);
      }
    }
  }
  ok('날짜 꼴이 YYYY-MM-DD', dates.length === 0, dates.slice(0, 3));
  ok('항목마다 갈래(adj/get)가 있다', kinds.length === 0, kinds.slice(0, 3));
  ok('최신이 위', order.length === 0, order.slice(0, 3));
  ok('한국어 줄에 일본어가 안 섞였다', mixed.length === 0, mixed.slice(0, 3));
  ok('한국어 줄의 숫자가 원문과 같다', badNum.length === 0, badNum.slice(0, 3));
  ok('한국어로 읽히는 줄이 95% 이상', lines && ko / lines >= 0.95, (100 * ko / lines).toFixed(2) + '%');
  const rf = (H['6640'] || []).find(e => e.d === '2026-10-29');
  ok('RF 겔구그 2026-10-29 성능 조정이 들어 있다 (아암 미사일 1100 → 1250)',
    !!rf && rf.k === 'adj' && rf.l.some(x => /1100\s*→\s*1250/.test(x[1])), rf && rf.l.slice(0, 4));
  const adj = Object.values(H).flat().filter(e => e.k === 'adj').length, get = Object.values(H).flat().filter(e => e.k === 'get').length;
  ok('입수 공지(get)와 조정(adj)이 둘 다 있다', adj > 500 && get > 500, { adj, get });

  // ①-2 공식 참조 데이터(data/ms_refs.json) — 조정 항목 아래 표
  const RF = path.join(ROOT, 'data', 'ms_refs.json');
  const refs = fs.existsSync(RF) ? JSON.parse(fs.readFileSync(RF, 'utf8')) : { byPage: {} };
  const recs = Object.values(refs.byPage || {}).flat();
  ok('참조 데이터 표가 700개 이상', recs.length >= 700, recs.length);
  /* 공식 목록은 2025-06 ~ 11 이 비어 있다 — 빈 달에서 멈추면 그 너머(2020-07 ~ 2025-05)를 통째로 놓친다(실제로 그랬다) */
  const oldest = recs.map(r => r.d).sort()[0] || '';
  ok('2021년 이전 표까지 있다 (가장 오래된 ' + oldest + ')', !!oldest && oldest < '2021-01-01', oldest);
  /* 옛 틀(기체 구분 주석 없음 · parseLegacy) — 2023-06-22 공지는 9기 */
  const legacyN = recs.filter(r => r.d === '2023-06-22').length;
  ok('옛 틀 공지(2023-06-22)의 표를 읽었다 (' + legacyN + ')', legacyN >= 8, legacyN);
  const jpOnly = recs.filter(r => r.jpOnly);
  ok('한국어판이 없는 공지(일본어판 단독)의 표도 담았다 (' + jpOnly.length + ')',
    jpOnly.length >= 10 && jpOnly.every(r => !r.ref && r.refJa && (r.refJa.rows || []).length), jpOnly.length);
  /* 2026-01 이전 공지는 기체 구분 번호가 전각(「１機目」)이라 파서가 하나도 못 읽었다 — 다시 깨지면 여기서 운다 */
  for (const d of ['2025-12-25', '2026-01-29']) {
    const n = recs.filter(r => r.d === d).length;
    ok(d + ' 공지(전각 번호 틀)의 표를 읽었다 (' + n + ')', n >= 10, n);
  }
  const tbl = r => r.ref || r.refJa;            // 일본어판 단독은 한국어 표가 없다
  ok('표마다 열과 줄이 있다', recs.every(r => tbl(r) && (tbl(r).cols || []).length && (tbl(r).rows || []).length),
    recs.filter(r => !(tbl(r) && (tbl(r).cols || []).length)).slice(0, 2));
  const AT = require('./lib/history_refs.js').attachRefs(H, refs.byPage || {});
  ok('표가 거의 다 위키 조정 항목 아래에 붙는다 (따로 세운 것 ' + AT.standalone + ')', recs.length && AT.attached / recs.length >= 0.95,
    { 붙음: AT.attached, 따로: AT.standalone });

  /* ①-3 배포 순서 — 오프라인판(폰 OTA)은 공식 공지 · 참조 데이터를 받은 **뒤에** 빌드돼야 한다.
     예전엔 받기 전에 한 번만 빌드해 새 「조정 후」 줄이 폰에 한 배포 늦게 들어갔다(2026-11-16 코드 리뷰). */
  {
    const U = fs.readFileSync(path.join(ROOT, 'tools', 'update.js'), 'utf8');
    const at = U.indexOf("runSoft('extract_patchnotes.js')"), lastBuild = U.lastIndexOf("run('build.js')");
    ok('배포: 공식 공지를 받은 뒤에 오프라인판을 다시 빌드한다', at > 0 && lastBuild > at, { 수집: at, 마지막빌드: lastBuild });
  }

  // ③ 사이트판 — 따로 떨어진 파일 · HTML 에는 주소만
  const WEB = path.join(ROOT, 'dist', 'web');
  if (fs.existsSync(path.join(WEB, 'index.html'))) {
    const files = fs.readdirSync(WEB).filter(f => /^history\.[0-9a-f]{10}\.json$/.test(f));
    const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
    ok('사이트판: history.<지문>.json 이 하나 있다', files.length === 1, files);
    ok('사이트판: HTML 에는 주소만 실린다(자료를 안 싣는다)',
      files.length === 1 && html.includes('GBO2_HISTORY_URL="' + files[0] + '"') && !html.includes("GBO2_HISTORY_RAW='"));
    const hd = fs.existsSync(path.join(WEB, '_headers')) ? fs.readFileSync(path.join(WEB, '_headers'), 'utf8') : '';
    ok('사이트판: 이력 파일은 오래 캐시(이름에 지문)', /\/history\.\*\s*\n\s*Cache-Control: public, max-age=31536000, immutable/.test(hd));
  } else console.log('  SKIP 사이트판(dist/web 없음)');

  // ② 화면 (오프라인판)
  let findChrome, GBO2Browser;
  try { ({ findChrome } = require('./lib/wiki_fetch.js')); GBO2Browser = require('./lib/browser.js'); }
  catch { console.log('SKIP  puppeteer 없음'); return done(); }
  const CHROME = findChrome();
  const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  if (!CHROME || !fs.existsSync(FILE)) { console.log('SKIP  Chrome 또는 dist 없음'); return done(); }
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const pg = await br.newPage();
    await pg.setViewport({ width: 1500, height: 1000 });
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
    await pg.goto('file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20'), { waitUntil: 'load', timeout: 180000 });
    await sleep(3500);
    await pg.evaluate(() => { try { localStorage.removeItem('gbo2.histFold'); localStorage.removeItem('gbo2.histFilter'); } catch (e) {} });

    // RF 겔구그로 파츠 화면까지
    await pg.evaluate(() => {
      const i = document.querySelector('#msQuery');
      i.value = 'RF 겔구그'; i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(800);
    await pg.evaluate(() => document.querySelector('.ms-card').click());
    await sleep(1100);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1200);

    const before = await pg.evaluate(() => ({
      folded: document.querySelector('#histPanel').classList.contains('folded'),
      body: document.querySelector('#histBody').childElementCount,
      raw: typeof window.GBO2_HISTORY_RAW === 'string'
    }));
    ok('처음엔 접혀 있고 아무것도 안 그린다', before.folded && before.body === 0, before);
    ok('오프라인판은 이력을 글자로 실어 둔다', before.raw);

    // 진짜 마우스로 펼친다 — 가려진 것을 누르지 않게 그 자리에 무엇이 있는지 먼저 본다
    await pg.evaluate(() => document.querySelector('#histFold').scrollIntoView({ block: 'center' }));
    await sleep(300);
    const at = await pg.evaluate(() => {
      const b = document.querySelector('#histFold').getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, ok: !!hit && !!hit.closest('#histFold') };
    });
    ok('펼치기 버튼이 그 자리에서 눌린다', at.ok, at);
    await pg.mouse.click(at.x, at.y);
    await sleep(1500);
    const want = (H['6640'] || []).length, wantAdj = (H['6640'] || []).filter(e => e.k === 'adj').length;
    const open = await pg.evaluate(() => {
      const ents = [...document.querySelectorAll('#histBody .hist-ent')];
      const txt = [...document.querySelectorAll('#histBody .hist-what, #histBody .pn-wl')].map(e => e.textContent);
      const ja = txt.filter(t => /[ぁ-んァ-ヶ]/.test(t));
      return { folded: document.querySelector('#histPanel').classList.contains('folded'), n: ents.length,
        first: ents[0] && ents[0].querySelector('.hist-date').textContent, cnt: document.querySelector('#histCount').textContent,
        lines: txt.length, ja: ja.length, jaEx: ja.slice(0, 3), up: document.querySelectorAll('#histBody .pn-wl.up').length };
    });
    ok('펼치면 그 기체의 항목이 전부 그려진다 (' + want + '건)', !open.folded && open.n === want && want > 0, open);
    ok('맨 위가 최신 날짜', open.first === (H['6640'] || [])[0].d, open.first);
    ok('건수를 머리에 적는다', new RegExp('^' + want + '건$').test(open.cnt), open.cnt);
    ok('오름 표시(▲)가 보인다', open.up > 0, open.up);
    ok('한국어 모드에서 일본어 줄이 1% 미만', open.lines > 0 && open.ja / open.lines < 0.01, { 줄: open.lines, 일본어: open.ja, 예: open.jaEx });
    const refShown = await pg.evaluate(() => {
      const ent = [...document.querySelectorAll('#histBody .hist-ent')].find(e => /2026-10-29/.test(e.querySelector('.hist-date').textContent));
      const t = ent && ent.querySelector('.hist-ref table.pn-rt');
      return t ? { cols: t.querySelectorAll('tr:first-child th').length, rows: t.querySelectorAll('tr').length, open: ent.querySelector('.hist-ref').open } : null;
    });
    ok('RF 겔구그 2026-10-29 조정 아래에 공식 참조 데이터 표가 펼쳐져 있다', !!refShown && refShown.cols >= 3 && refShown.rows >= 2 && refShown.open, refShown);

    // 「성능 조정만」
    const fb = await pg.evaluate(() => {
      const b = document.querySelector('#histFilter button[data-v="adj"]');
      const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, ok: !!hit && !!hit.closest('#histFilter') };
    });
    ok('「성능 조정만」 이 그 자리에서 눌린다', fb.ok, fb);
    await pg.mouse.click(fb.x, fb.y);
    await sleep(600);
    const fl = await pg.evaluate(() => ({ n: document.querySelectorAll('#histBody .hist-ent').length,
      allAdj: [...document.querySelectorAll('#histBody .hist-ent')].every(e => e.classList.contains('adj')),
      cnt: document.querySelector('#histCount').textContent }));
    ok('「성능 조정만」 은 조정 항목만 남긴다 (' + wantAdj + '건)', fl.n === wantAdj && fl.allAdj && wantAdj < want, fl);

    // 접으면 다시 머리줄만
    const at2 = await pg.evaluate(() => { const b = document.querySelector('#histFold').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await pg.mouse.click(at2.x, at2.y);
    await sleep(400);
    const shut = await pg.evaluate(() => {
      const b = document.querySelector('#histBody');
      return { folded: document.querySelector('#histPanel').classList.contains('folded'), shown: b.getClientRects().length };
    });
    ok('다시 접으면 본문이 숨는다', shut.folded && shut.shown === 0, shut);
    ok('스크립트 오류 없음', errs.length === 0, errs);

    /* ④ 받기 실패 — 칸을 다시 펼칠 때만 다시 시도한다. 화면이 다시 그려질 때마다(파츠를 낄 때마다) 시도하면
       인터넷이 끊긴 동안 「불러오는 중」 과 실패 안내가 번갈아 깜빡였다(2026-11-16 코드 리뷰). 실린 글자를 깨뜨려 실패를 만든다. */
    const pg2 = await br.newPage();
    await pg2.setViewport({ width: 1500, height: 1000 });
    await pg2.evaluateOnNewDocument(() => { try { localStorage.setItem('gbo2.histFold', '1'); } catch (e) {} });
    await pg2.goto('file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20'), { waitUntil: 'load', timeout: 180000 });
    await sleep(3500);
    await pg2.evaluate(() => { const i = document.querySelector('#msQuery'); i.value = 'RF 겔구그'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(800);
    await pg2.evaluate(() => document.querySelector('.ms-card').click());
    await sleep(1100);
    await pg2.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1200);
    await pg2.evaluate(() => { window.__histRaw = window.GBO2_HISTORY_RAW; window.GBO2_HISTORY_RAW = '{깨진 글자'; document.querySelector('#histFold').click(); });
    await sleep(800);
    const fail1 = await pg2.evaluate(() => document.querySelector('#histBody').textContent);
    ok('받기 실패를 안내한다', /불러오지 못했습니다/.test(fail1), fail1.slice(0, 60));
    /* 파츠를 하나 끼워 화면을 다시 그리게 하고, **같은 순간** 칸의 글을 읽는다(다시 받으면 여기서 「불러오는 중」 이 된다) */
    const after = await pg2.evaluate(() => {
      const t = document.querySelector('#partList .part-tile') || document.querySelector('#partList > *');
      if (t) t.click();
      return { tile: !!t, text: document.querySelector('#histBody').textContent };
    });
    ok('실패 뒤 화면이 다시 그려져도 다시 받지 않는다(깜빡임 없음)', after.tile && /불러오지 못했습니다/.test(after.text) && !/불러오는 중/.test(after.text), after);
    await pg2.evaluate(() => { window.GBO2_HISTORY_RAW = window.__histRaw; const b = document.querySelector('#histFold'); b.click(); b.click(); });
    await sleep(1200);
    const retry = await pg2.evaluate(() => document.querySelectorAll('#histBody .hist-ent').length);
    ok('칸을 다시 펼치면 다시 받는다', retry > 0, retry);
    await pg2.close();
  } finally { await br.close(); }
  done();
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

function done() {
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}

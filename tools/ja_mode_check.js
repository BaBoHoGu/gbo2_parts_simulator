// 일본어 모드(?lang=ja)로 전 화면·모달을 열어 **보이는 글자에 한글이 남는지** 훑는다.
//
//   node tools/ja_mode_check.js            검사
//   node tools/ja_mode_check.js --list     남은 한글 조각을 많이 나온 순으로 보인다(표 data/i18n/ui_ja.json 을 채울 때)
//
// 왜 필요한가 — 일본어 모드는 그려진 글자를 문구 표로 바꾼다(src/i18n.js 의 jaText). 표에 없는 문구는
// **조용히** 한국어로 남는다. ja_leak_check 의 거울이다(그쪽은 한국어 모드에 일본어가 새는지 본다).
//
// 일부러 봐 주는 것:
//   · 언어 고르기의 「한국어」 — 한국어로 돌아가는 단추는 한국어로 적는다.
//   · 「🌐 언어 / 言語」 처럼 두 말을 같이 적은 칸.
// 검사 뒤에는 ?lang 없이 다시 열어 **한국어 모드가 그대로인지**도 본다(고른 말은 기억되므로, 지운 뒤에).
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const LIST = process.argv.includes('--list');

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
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1600, height: 1000 });
  await pg.goto(FILE + '?lang=ja', { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  const res = await pg.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const HANGUL = /[가-힣]/;
    const OK_KO = /^(✓\s*)?한국어$|^🌐 언어 \/|화면 언어 · 表示言語/;
    const click = (sel, ms) => { const e = document.querySelector(sel); if (e) e.click(); return wait(ms || 600); };
    const shown = e => e.getClientRects().length > 0;
    const left = new Map();     // 남은 조각 → 나온 수(화면 전체)
    let kept = 0;               // 일부러 안 옮긴 칸(사용자 글 · 픽업 이름)
    const scan = where => {
      let chars = 0, nodes = 0, bad = 0;
      const ex = [];
      const one = (t, cls) => {
        if (!HANGUL.test(t) || OK_KO.test(t)) return;
        bad++;
        if (ex.length < 4) ex.push(t.slice(0, 40) + ' <' + cls + '>');
        left.set(t.slice(0, 80), (left.get(t.slice(0, 80)) || 0) + 1);
      };
      const walk = n => {
        if (n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE') return;
        if (n.nodeType === 3) {
          const t = n.nodeValue.trim();
          if (!t) return;
          const p = n.parentElement;
          if (!p || !shown(p)) return;
          nodes++; chars += t.length;
          // 사람이 쓴 글(갤러리 제목·작성자·설명)과 한국 Steam 공지에서 뽑은 픽업 이름은 옮기지 않는다 — 따로 센다
          if (p.closest('.sc-name, .sc-author, .sc-desc') || (p.tagName === 'A' && p.closest('td'))) { if (HANGUL.test(t)) kept++; return; }
          one(t, String(p.className || p.tagName).slice(0, 26));
          return;
        }
        if (n.nodeType === 1 && n.tagName !== 'BODY' && !shown(n)) return;
        if (n.nodeType === 1) for (const a of ['title', 'placeholder', 'aria-label']) {
          const v = n.getAttribute && n.getAttribute(a);
          if (v) one(v.trim(), '@' + a);
        }
        for (const c of n.childNodes) walk(c);
      };
      walk(document.body);
      return { where, chars, nodes, n: bad, ex };
    };
    const pick = async q => {
      const qi = document.querySelector('#msQuery');
      qi.value = q; qi.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(1000);
      const card = document.querySelector('#msList .ms-card');
      if (card) { card.click(); await wait(1800); }
      return !!card;
    };

    const out = [];
    const lang = window.GBO2i18n && window.GBO2i18n.lang;
    if (document.body.classList.contains('info-open')) await click('#infoClose', 400);
    out.push(scan('기체 선택'));

    await click('#galleryBtn', 1300); out.push(scan('갤러리'));
    // 일본어 모드는 올리기를 막고 일본어로 알린다(서버가 일본어 글을 거절하므로)
    await click('#galleryUpload', 500);
    const upload = {
      modal: !!document.querySelector('#uploadModal') && !document.querySelector('#uploadModal').hidden,
      toast: (document.querySelector('#toast') || {}).textContent || ''
    };
    await click('#galleryBack', 600);
    await click('#tokenBtn', 1300);   out.push(scan('토큰'));   await click('#tokenBack', 600);

    await click('#codexBtn', 1000);
    out.push(scan('스킬 도감'));
    await click('#codexList .codex-item', 600);
    out.push(scan('스킬 도감 · 상세'));
    await click('#codexView .seg-btn[data-v="unmod"]', 700);
    await click('#codexList .codex-item', 500);
    out.push(scan('스킬 도감 · 계산 안 함'));
    await click('#codexBack', 800);

    if (!await pick('V2')) return { err: '기체를 못 골랐다 — 일본어 모드에서 검색이 죽었다', lang };
    out.push(scan('파츠 적용'));
    await click('#partList > *', 600);
    out.push(scan('파츠 끼운 뒤'));
    const sk = document.querySelector('#skillListBtn');
    if (sk) { sk.click(); await wait(1000); out.push(scan('기체 스킬 패널')); await click('#mskillClose', 500); }

    // 무장 하나를 펴서 상세(備考 칩·방향 배율)까지 본다
    const wrow = document.querySelector('.weapon');
    if (wrow) { wrow.click(); await wait(800); out.push(scan('무장 상세')); wrow.click(); await wait(300); }
    // 모달·화면 — 열고 재고 닫는다(안 열리면 건너뛴다: 「고루 들렀다」 가 바닥을 막는다)
    const visit = async (open, where, close) => {
      const b = document.querySelector(open);
      if (!b) return;
      b.click(); await wait(1200);
      out.push(scan(where));
      if (close) await click(close, 500);
    };
    await visit('#compareBtn', '비교', '#compareModalClose');
    await visit('#load', '저장 목록', '#savedModalClose');
    await visit('#pngBtn', 'PNG 카드', '#pngClose');
    await visit('#planBtn', '강화 플랜', '#planBack');
    /* 패치노트 — 밸런스 패치에서 기체 하나를 편다. 본문은 공식 일본어 공지(a.ja)를 보인다.
       일본어판과 자리가 어긋난 기체는 한국어로 남으므로(추출기가 담지 않는다), 이 화면은 첫 기체만 본다. */
    await click('#patchBtn', 1200);
    await click('#pnBalBtn', 800);
    const pc = [...document.querySelectorAll('#pnAdjusted .pn-card')].find(e => e.getClientRects().length);
    if (pc) {
      pc.click(); await wait(800);
      for (const d of document.querySelectorAll('#pnDetail details')) d.open = true;
      await wait(300);
      if (document.querySelector('#pnDetail') && !document.querySelector('#pnDetail').hidden) out.push(scan('패치노트 · 기체 상세'));
    }
    await click('#patchBack', 600);

    await click('#duelBtn', 1200);
    if (document.querySelector('#duelModal') && !document.querySelector('#duelModal').hidden) {
      out.push(scan('대결'));
      const q2 = document.querySelector('.duel-side[data-side="R"] .ds-search');
      if (q2) { q2.value = 'ザク'; q2.dispatchEvent(new Event('input', { bubbles: true })); await wait(800); }
      const mrow = document.querySelector('.duel-side[data-side="R"] .ds-msrow');
      if (mrow) {
        mrow.click(); await wait(1000);
        for (const side of ['L', 'R']) { const w = document.querySelector('.duel-side[data-side="' + side + '"] .ds-w'); if (w) { w.click(); await wait(600); } }
        out.push(scan('대결 · 무장 고른 뒤'));
      }
    }
    return { out, lang, kept, upload, left: [...left].sort((a, b) => b[1] - a[1]) };
  });

  // 한국어 모드가 그대로인가 — 고른 말을 지우고 ?lang 없이 다시 연다
  await pg.evaluate(() => { try { localStorage.removeItem('gbo2.lang'); } catch (e) {} });
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await sleep(3000);
  const ko = await pg.evaluate(() => ({
    lang: window.GBO2i18n && window.GBO2i18n.lang,
    htmlLang: document.documentElement.lang,
    kana: (document.body.innerText.match(/[ぁ-ゖァ-ヺ]/g) || []).length,
    hangul: (document.body.innerText.match(/[가-힣]/g) || []).length
  }));

  /* 언어 메뉴를 **진짜 마우스로** 누른다(⋯ → 🌐 → 日本語, 다시 → 한국어). 가려진 단추를 el.click() 으로 누르면
     통과해 버리므로, 누를 자리의 맨 위 요소가 그 단추인지 먼저 본다. */
  // sel 이 「글자:…」 이면 ⋯ 메뉴(.more-menu — 원래 단추를 복사해 id 가 없다)에서 그 글자를 가진 항목을 찾는다
  const press = async sel => {
    const at = await pg.evaluate(s => {
      const pool = s.startsWith('글자:') ? document.querySelectorAll('.more-menu .png-menu-item') : document.querySelectorAll(s);
      const want = s.slice(3);
      const e = [...pool].find(x => x.getClientRects().length && (!s.startsWith('글자:') || x.textContent.includes(want)));
      if (!e) return null;
      const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hit: !!top && (top === e || e.contains(top)) };
    }, sel);
    if (!at || !at.hit) return at ? 'covered' : 'missing';
    await pg.mouse.click(at.x, at.y);
    await sleep(500);
    return 'ok';
  };
  const menu = [];
  const pickLang = async target => {
    const steps = [await press('#topbarMore'), await press('글자:言語')];
    if (steps.some(s => s !== 'ok')) { menu.push({ target, steps }); return null; }
    const nav = pg.waitForNavigation({ waitUntil: 'load', timeout: 180000 }).catch(() => null);
    steps.push(await press('글자:' + target));
    if (steps[2] === 'ok') await nav;
    await sleep(3000);
    const lang = await pg.evaluate(() => window.GBO2i18n && window.GBO2i18n.lang);
    menu.push({ target, steps, lang });
    return lang;
  };
  const toJa = await pickLang('日本語');
  const toKo = await pickLang('한국어');
  await br.close();

  if (res.err) { console.log('FAIL  ' + res.err + ' (lang=' + res.lang + ')'); process.exit(1); }
  for (const s of res.out)
    console.log('  ' + (s.where + '                      ').slice(0, 22)
      + ('       ' + s.chars).slice(-7) + '자 ' + ('    ' + s.nodes).slice(-4) + '칸   '
      + (s.n ? '한글 ' + s.n + '  ' + s.ex.join(' · ') : '—'));
  const total = res.out.reduce((a, s) => a + s.n, 0), nodes = res.out.reduce((a, s) => a + s.nodes, 0);
  console.log('\n  남은 한글 칸 ' + total + ' / ' + nodes + '  (서로 다른 조각 ' + res.left.length + ') · 일부러 둔 칸(사용자 글·픽업 이름) ' + res.kept);
  if (LIST) { for (const [t, n] of res.left) console.log('   ' + n + '× ' + t); }
  console.log('');

  ok('?lang=ja 로 일본어 모드가 켜진다', res.lang === 'ja', { lang: res.lang });
  ok('화면을 고루 들렀다 (15곳 이상)', res.out.length >= 15, { 들른곳: res.out.length });
  ok('화면마다 글자를 실제로 읽었다 (200자 이상)', res.out.every(s => s.chars < 200 ? false : true),
    res.out.filter(s => s.chars < 200).map(s => s.where + ' ' + s.chars + '자'));
  /* 바닥만 막는다. 처음엔 3%(약 450칸)였는데 그러면 새 화면 하나쯤은 통째로 한국어여도 통과했다 —
     지금 0칸이라 0.5% 로 조인다. 빠진 문구 자체는 아래 소스 검사가 한 건도 놓치지 않는다. */
  ok('남은 한글이 보이는 칸의 0.5% 이하', total <= nodes * 0.005, { 남은칸: total, 전체칸: nodes });
  /* 소스 기준 — 화면을 돌며 보는 것은 열어 본 화면뿐이다. 생성기에게 직접 묻는다(규칙을 여기 베끼지 않는다). */
  const src = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'build_ui_ja.js'), '--check'], { encoding: 'utf8' });
  let miss = null;
  try { miss = JSON.parse(String(src.stdout).trim().split('\n').pop()).missing; } catch (e) { /* 아래에서 실패로 */ }
  ok('소스의 한국어 문구가 번역 표에 다 있다 (node tools/build_ui_ja.js --todo=… 로 채울 것)',
    src.status === 0 && Array.isArray(miss) && !miss.length, miss ? miss.slice(0, 10) : String(src.stdout).slice(-300));
  ok('?lang 없이 열면 한국어 모드 (일본어 모드가 새지 않는다)', ko.lang === 'ko' && ko.htmlLang !== 'ja' && ko.hangul > 200, ko);
  ok('일본어 모드에서 갤러리 올리기는 막히고 일본어로 알린다',
    res.upload && !res.upload.modal && /日本語モードではご利用いただけない/.test(res.upload.toast), res.upload);
  ok('⋯ → 🌐 → 日本語 를 누르면 일본어로 바뀐다', toJa === 'ja', menu[0]);
  ok('⋯ → 🌐 → 한국어 를 누르면 한국어로 돌아온다', toKo === 'ko', menu[1]);
  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

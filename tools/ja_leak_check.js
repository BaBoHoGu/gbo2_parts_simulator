// 전 화면·모달을 열어 **보이는 글자에 일본어가 남는지** 훑는다.
//
//   node tools/ja_leak_check.js
//
// 왜 필요한가 — 이 앱은 한국어로 읽는 것이 전부인데, 번역이 빠진 자리는 **조용히** 원문이 나온다.
// 사전은 **문장 전체**가 열쇠라, 잘라 낸 조각을 넘기면 오류 없이 일본어가 그대로 찍힌다.
// 실제로 「계산 안 함」 화면을 만들 때 그렇게 나왔고, 사람이 눈으로 봐야만 드러났다.
// smoke 도 같은 검사를 하지만 **기체 선택·파츠 적용 두 화면만** 들른다 —
// 어제 만든 화면은 그 두 곳에 없어서, 일본어를 달고 배포될 뻔했다. 그래서 전 화면으로 넓힌다.
//
// 두 가지는 일부러 봐 준다:
//   · codex-jp — 번역이 원문과 다를 때 **원문 이름을 일부러 같이 보여 주는 칸**이다(ui.js).
//   · 한자는 가나와 달리 한국어 표기에도 쓰여(「제간」 등) 거짓 경보가 나므로, 화면 글자는
//     **가나만** 잡는다.
const fs = require('fs');
const path = require('path');
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

/* ── 사전 쪽: 번역된 글에 일본어 문장부호가 남지 않았는가 ──
   「・사격 보정 ＋25」처럼 **글자는 한국어인데 부호만 일본어**인 것은 위 화면 훑기(가나)로는
   안 잡힌다. 앱은 낼 때 jaPunct 로 반각에 맞추므로, 그 규칙이 살아 있는지 소스에서 확인한다. */
function punctRule() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  const has = /const skTr = s => \(s \? jaPunct\(/.test(src);
  const marks = ['・', '＋', '－', '：', '％', '×', '（', '）'];
  let n = 0;
  for (const f of ['skills.json', 'skill_text.json']) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', f), 'utf8'));
    for (const v of Object.values(d))
      if (typeof v === 'string' && marks.some(m => v.includes(m))) n++;
  }
  return { has, n };
}

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1600, height: 1000 });
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  const res = await pg.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const KANA = /[ぁ-ゖァ-ヺ]/;
    const click = (sel, ms) => { const e = document.querySelector(sel); if (e) e.click(); return wait(ms || 600); };

    /** 보이는 글자만 훑는다. 숨은 가지는 통째로 건너뛴다 —
     *  안 그러면 아직 안 연 화면의 글까지 세어 어디가 문제인지 알 수 없다.
     *
     *  숨김 판정에 offsetParent 를 쓰면 안 된다. **position:fixed 는 언제나 null 이라**
     *  이 앱의 모달(피탄 시뮬 등)이 통째로 안 보이는 것으로 걸러진다 —
     *  처음 이렇게 짰다가 뒤 네 화면이 전부 「파츠 화면을 또 센 값」으로 나왔고,
     *  일본어 0 이라는 거짓 통과를 받았다. 실제로 자리를 차지하는지로 본다. */
    const shown = e => e.getClientRects().length > 0;
    const scan = where => {
      const bad = [];
      let chars = 0, nodes = 0;
      const walk = n => {
        if (n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE') return;
        if (n.nodeType === 3) {
          const t = n.nodeValue.trim();
          if (!t) return;
          const p = n.parentElement;
          if (!p || !shown(p)) return;
          nodes++; chars += t.length;
          // 원문을 **일부러** 같이 보여 주는 칸은 봐 준다
          if (String(p.className || '').includes('codex-jp')) return;
          if (KANA.test(t)) bad.push({ t: t.slice(0, 40), cls: String(p.className || p.tagName).slice(0, 26) });
          return;
        }
        if (n.nodeType === 1 && n.tagName !== 'BODY' && !shown(n)) return;
        for (const c of n.childNodes) walk(c);
      };
      walk(document.body);
      return { where, chars, nodes, n: bad.length, ex: bad.slice(0, 4) };
    };

    const out = [];
    if (document.body.classList.contains('info-open')) await click('#infoClose', 400);
    out.push(scan('기체 선택'));

    await click('#galleryBtn', 1300); out.push(scan('갤러리')); await click('#galleryBack', 600);
    await click('#tokenBtn', 1300);   out.push(scan('토큰'));   await click('#tokenBack', 600);

    await click('#codexBtn', 1000);
    out.push(scan('스킬 도감'));
    await click('#codexList .codex-item', 600);
    out.push(scan('스킬 도감 · 상세'));
    await click('#codexView .seg-btn[data-v="unmod"]', 700);
    await click('#codexList .codex-item', 500);
    out.push(scan('스킬 도감 · 계산 안 함'));
    await click('#codexBack', 800);

    const q = document.querySelector('#msQuery');
    q.value = 'V2 어설트 버스터'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(1000);
    const card = document.querySelector('#msList .ms-card');
    if (!card) return { err: '기체를 못 골랐다 — 검색이 죽었거나 이름이 바뀌었다' };
    card.click(); await wait(1800);
    out.push(scan('파츠 적용'));
    await click('#partList > *', 600);
    out.push(scan('파츠 끼운 뒤'));

    // 무장 머리의 🛠스킬 — 버튼은 #skillListBtn, 열리는 것은 #mskillInline 이다
    const sk = document.querySelector('#skillListBtn');
    if (!sk) return { err: '기체 스킬 버튼(#skillListBtn)이 없다' };
    sk.click(); await wait(1000);
    if (!document.querySelector('#mskillInline').getClientRects().length)
      return { err: '기체 스킬 패널이 안 열렸다' };
    out.push(scan('기체 스킬 패널'));
    await click('#mskillClose', 500);

    await click('#pietanBtn', 900);
    const pq = document.querySelector('#pietanQuery');
    if (!pq || !pq.getClientRects().length) return { err: '피탄 시뮬이 안 열렸다' };
    pq.value = '자쿠'; pq.dispatchEvent(new Event('input', { bubbles: true })); await wait(900);
    const rows = [...document.querySelectorAll('#pietanList .pietan-row')];
    if (!rows.length) return { err: '피탄 시뮬에서 적 기체를 못 찾았다' };
    rows[0].click(); await wait(1300);
    out.push(scan('피탄 시뮬'));
    /* 적 무장까지 골라야 격파·경직 계산이 그려진다 — 거기가 원문이 가장 많이 지나는 자리다.
       무장도 같은 #pietanList 에 pietan-row 로 그려지고, 머리줄(whead)은 누를 것이 아니다. */
    const ws = [...document.querySelectorAll('#pietanList .pietan-row:not(.pietan-whead)')];
    if (!ws.length) return { err: '피탄 시뮬에서 적 무장을 못 찾았다' };
    ws[0].click(); await wait(1000);
    out.push(scan('피탄 시뮬 · 무장 고른 뒤'));

    return { out };
  });

  await br.close();

  if (res.err) { console.log('FAIL  ' + res.err); process.exit(1); }
  const out = res.out;
  for (const s of out)
    console.log('  ' + (s.where + '                      ').slice(0, 22)
      + ('       ' + s.chars).slice(-7) + '자 ' + ('    ' + s.nodes).slice(-4) + '칸   '
      + (s.n ? '일본어 ' + s.n + '  ' + s.ex.map(e => e.t + ' <' + e.cls + '>').join(' · ') : '—'));
  console.log('');

  // ① 들를 화면을 다 들렀는가 — 하나라도 안 열리면 「일본어 0」은 거짓 통과다
  ok('전 화면·모달을 들렀다 (10곳 이상)', out.length >= 10, { 들른곳: out.length });
  /* ② 정말 글자를 봤는가. 화면이 안 그려졌는데 통과하는 것을 막는다.
     가장 적은 화면이 200자는 돼야 한다 — 빈 화면은 100자를 넘지 않는다. */
  const thin = out.filter(s => s.chars < 200);
  ok('화면마다 글자를 실제로 읽었다 (200자 이상)', thin.length === 0,
    thin.map(s => s.where + ' ' + s.chars + '자'));
  /* ③ 같은 화면을 두 번 세지 않았는가.
     모달이 안 열리면 **뒤에 깔린 화면을 그대로 다시 세고**, 글자 수까지 똑같이 나온다 —
     그래도 「일본어 0」이라 통과해 버린다. 처음 이 검사가 그렇게 헛돌았다(뒤 네 줄이 같은 값).
     화면이 다르면 글자 수가 한 자도 안 겹칠 리 없으므로, 겹치면 안 열린 것으로 본다. */
  const seen = new Map(), dup = [];
  for (const s of out) {
    if (seen.has(s.chars)) dup.push(seen.get(s.chars) + ' = ' + s.where + ' (' + s.chars + '자)');
    seen.set(s.chars, s.where);
  }
  ok('화면마다 다른 것을 쟀다 (안 열린 곳이 없다)', dup.length === 0, dup);
  // ④ 본론
  const leak = out.filter(s => s.n > 0);
  ok('보이는 글자에 일본어가 남지 않았다', leak.length === 0,
    leak.map(s => ({ 화면: s.where, 건수: s.n, 예: s.ex })));

  const p = punctRule();
  console.log('\n번역 사전에 일본어 문장부호가 남은 문장 ' + p.n + ' — 앱이 낼 때 맞춘다');
  ok('낼 때 문장부호를 맞추는 규칙이 살아 있다 (skTr → jaPunct)', p.has,
    { 힌트: '사전을 고치지 말 것 — 생성물이라 다시 만들면 되돌아간다' });

  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

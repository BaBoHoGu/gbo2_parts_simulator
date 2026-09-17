// 상단바가 한 줄에 서고, 접은 것들이 메뉴에 그대로 있는지 실측한다.
//
//   node tools/topbar_check.js
//
// 왜 필요한가 — 버튼은 「기능을 더할 때마다 하나씩」 늘어난다. 14개가 됐을 때
// 1500·1280px 에서 두 줄로 접혔고, 그제야 눈에 띄었다. 두 줄이 되는 순간을 잡는다.
//
// **감춘 것이 사라지면 안 된다.** 상단바에서 뺀 버튼은 반드시 메뉴 어딘가에 있어야 한다 —
// 그것만 보는 검사를 따로 둔다(줄 수만 보면 「다 지워서 통과」가 가능하다).
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

// 파츠 화면에서 닿을 수 있어야 하는 것 전부 — 상단바에 있든 메뉴에 있든
const MUST_REACH = ['#openAuto', '#pietanBtn', '#compareBtn', '#save', '#share', '#pngBtn',
  '#uploadBtn', '#load', '#importBtn', '#ownedBtn', '#updateBtn',
  '#galleryBtn', '#codexBtn', '#tokenBtn'];

(async () => {
  for (const w of [1920, 1500, 1280]) {
    const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const pg = await br.newPage();
    await pg.setViewport({ width: w, height: 950 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(3500);
    await pg.evaluate(() => {
      const i = document.querySelector('#msQuery');
      i.value = '건담 Ez8'; i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(800);
    await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
    await sleep(1300);

    const bar = await pg.evaluate(() => {
      const b = document.querySelector('.topbar');
      const vis = [...b.querySelectorAll('button')].filter(x => x.getBoundingClientRect().width > 0);
      return { h: Math.round(b.getBoundingClientRect().height), n: vis.length,
        names: vis.map(x => x.textContent.trim()) };
    });
    // 한 줄이면 60px 을 안 넘는다(두 줄이면 90px 을 넘었다)
    ok(w + 'px 에서 상단바가 한 줄이다', bar.h <= 60, '높이 ' + bar.h + 'px · 버튼 ' + bar.n + '개');

    if (w === 1500) {
      // 상단바에 보이거나, 두 메뉴 중 하나에 있어야 한다
      const reach = await pg.evaluate(async sels => {
        const seen = new Set();
        for (const s of sels) {
          const e = document.querySelector(s);
          if (e && e.getBoundingClientRect().width > 0) seen.add(s);
        }
        const open = async id => {
          document.querySelector(id).click();
          await new Promise(r => setTimeout(r, 200));
          const m = document.querySelector('.more-menu');
          const txt = m ? [...m.querySelectorAll('.pm-t')].map(x => x.textContent.trim()) : [];
          if (m) m.remove();
          return txt;
        };
        const menus = (await open('#exportMenuBtn')).concat(await open('#topbarMore'));
        for (const s of sels) {
          const e = document.querySelector(s);
          if (e && menus.includes(e.textContent.trim())) seen.add(s);
        }
        return { missing: sels.filter(s => !seen.has(s)), menus };
      }, MUST_REACH);
      ok('감춘 버튼이 전부 메뉴에서 닿는다', reach.missing.length === 0, reach.missing.join(' '));
      ok('내보내기 메뉴가 비어 있지 않다', reach.menus.length >= 8, reach.menus.join(' · '));
    }
    await br.close();
  }

  // 폰 — 더 접히지만 역시 하나도 사라지면 안 된다
  const br2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg2 = await br2.newPage();
  await pg2.emulate({ viewport: { width: 390, height: 860, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' });
  await pg2.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(3500);
  await pg2.evaluate(() => {
    const i = document.querySelector('#msQuery');
    i.value = '건담 Ez8'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(800);
  await pg2.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(1300);
  const ph = await pg2.evaluate(async sels => {
    const b = document.querySelector('.topbar');
    const seen = new Set();
    for (const s of sels) {
      const e = document.querySelector(s);
      if (e && e.getBoundingClientRect().width > 0) seen.add(s);
    }
    const open = async id => {
      document.querySelector(id).click();
      await new Promise(r => setTimeout(r, 220));
      const m = document.querySelector('.more-menu');
      const txt = m ? [...m.querySelectorAll('.pm-t')].map(x => x.textContent.trim()) : [];
      if (m) m.remove();
      return txt;
    };
    const menus = (await open('#exportMenuBtn')).concat(await open('#topbarMore'));
    for (const s of sels) {
      const e = document.querySelector(s);
      if (e && menus.includes(e.textContent.trim())) seen.add(s);
    }
    return { h: Math.round(b.getBoundingClientRect().height),
      missing: sels.filter(s => !seen.has(s)) };
  }, MUST_REACH);
  await br2.close();
  ok('폰에서도 상단바가 한 줄이다', ph.h <= 60, '높이 ' + ph.h + 'px');
  ok('폰에서도 감춘 버튼이 전부 메뉴에서 닿는다', ph.missing.length === 0, ph.missing.join(' '));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

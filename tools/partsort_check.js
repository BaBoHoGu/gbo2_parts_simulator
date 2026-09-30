// 파츠를 달아도 목록이 '가능 → 장착 중 → 불가' 로 묶여 있는가.
//
// 왜 필요한가 — 예전에는 필터가 바뀔 때만 정렬하고 장착하는 동안에는 순서를 얼렸다.
// 손가락 밑에서 타일이 움직이지 않게 하려던 것인데, 파츠 5개를 달면 막힌 것 124개가
// 아직 달 수 있는 것들 사이에 끼어들고 목록이 24 덩어리로 끊겼다 —
// 쓰는 사람은 회색 타일 수십 개를 지나며 되는 것을 찾아야 했다(사용자 지적).
// 정렬은 눈에 띄는 기능이 아니라 조용히 되돌아가기 쉽다. 실제 화면에서 재서 지킨다.
const GBO2Browser = require('./lib/browser.js');   // 크롬 임시 프로필 정리가 프로세스를 죽이지 않게
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome'].find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

(async () => {
  if (!CHROME) { console.log('  크롬을 못 찾아 건너뜁니다.'); process.exit(0); }
  const b = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--allow-file-access-from-files'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1400, height: 900 });
  await pg.goto('file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/'),
    { waitUntil: 'load', timeout: 120000 });
  const wait = ms => pg.evaluate(t => new Promise(r => setTimeout(r, t)), ms);
  await wait(1800);

  await pg.evaluate(() => {
    const c = document.querySelector('#msList .ms-card, #msList .ms-row');
    if (c) c.click();
  });
  await wait(1500);

  // 슬롯을 많이 먹는 파츠부터 다섯 개 단다 — 그래야 막히는 것이 많아진다
  let put = 0;
  for (let i = 0; i < 5; i++) {
    const did = await pg.evaluate(() => {
      const free = [...document.querySelectorAll('#partList .part-tile')]
        .filter(x => x.getClientRects().length && !x.classList.contains('on')
          && !x.classList.contains('blocked') && !x.classList.contains('banned'));
      const size = t => (String(t.textContent).match(/\d+/g) || ['0']).map(Number)
        .reduce((a, v) => a + v, 0);
      free.sort((a, b) => size(b) - size(a));
      if (!free[0]) return false;
      free[0].click();
      return true;
    });
    if (!did) break;
    put++;
    await wait(450);
  }
  ok('파츠를 다섯 개 달았다', put === 5, { 단개수: put });

  const m = await pg.evaluate(() => {
    const tiles = [...document.querySelectorAll('#partList .part-tile')]
      .filter(t => t.getClientRects().length);
    const st = tiles.map(t => t.classList.contains('on') ? 'E'
      : (t.classList.contains('blocked') || t.classList.contains('banned')) ? 'X' : 'O');
    const lastO = st.lastIndexOf('O');
    const stuck = lastO < 0 ? 0 : st.slice(0, lastO).filter(s => s === 'X').length;
    let runs = 0;
    for (let i = 0; i < st.length; i++) if (i === 0 || st[i] !== st[i - 1]) runs++;
    // 순서가 '가능(0) → 장착 중(1) → 불가(2)' 로 단조로운가
    const rank = { O: 0, E: 1, X: 2 };
    const monotone = st.every((s, i) => i === 0 || rank[s] >= rank[st[i - 1]]);
    return { 타일: st.length, 가능: st.filter(s => s === 'O').length,
      장착중: st.filter(s => s === 'E').length, 막힘: st.filter(s => s === 'X').length,
      끼어든막힘: stuck, 덩어리: runs, 단조: monotone, 앞30: st.slice(0, 30).join('') };
  });

  ok('막힌 파츠가 되는 것들 사이에 끼어들지 않는다', m.끼어든막힘 === 0, m);
  ok('가능 → 장착 중 → 불가 순서가 무너지지 않는다', m.단조 === true, m.앞30);
  // 덩어리는 많아야 셋이다(가능·장착중·불가). 상황에 따라 빈 묶음이 있으면 더 적다.
  ok('목록이 세 덩어리 이하로 묶인다', m.덩어리 <= 3, { 덩어리: m.덩어리, 앞30: m.앞30 });
  ok('그래도 달 수 있는 것이 남아 있다 (검사가 헛돌지 않게)', m.가능 > 0, { 가능: m.가능 });

  await b.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL 검사 자체가 실패: ' + e.message); process.exit(1); });

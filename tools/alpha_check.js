// 복합확장α 실측 — 실제 Chrome 으로 dist 를 띄워 「공격」 파츠 장착 + 확장 α 선택 시
// 무장 표의 리로드/OH 표기가 실제로 줄어드는지 본다.
//   node tools/alpha_check.js
//
// 배경: 계산부(damage.js)는 맞는데 무장 표를 그리는 호출이 expansion 인자를 빠뜨려
// 화면에만 반영이 안 된 적이 있다(2026-08-29). 계층 테스트로는 안 잡혀서 실측을 남긴다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 무장 표에서 리로드/OH 로 보이는 초 값들을 순서대로 긁는다.
// 리로드/OH 칸은 .w-reload 로 찾는다. 예전엔 '마지막 .w-col' 로 잡았는데,
// 무장 표에 열이 하나 늘자(국부 보정) 조용히 엉뚱한 칸을 읽었다.
const readTimes = () => [...document.querySelectorAll('#weaponList > *')]
  .map(row => {
    const c = row.querySelector('.w-reload');
    return c ? c.textContent.replace(/\s+/g, ' ').trim() : null;
  })
  .filter(t => t && t !== '—');

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);

  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(800);

  // 「공격」 파츠를 하나 장착한다 (사격 강화 프로그램 계열).
  const equipped = await pg.evaluate(() => {
    const tiles = [...document.querySelectorAll('#partList .part-tile')];
    const t = tiles.find(x => /사격 강화 프로그램/.test(x.textContent));
    if (!t) return null;
    t.click();
    return t.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
  });
  if (!equipped) { console.log('FAIL  공격 파츠를 찾지 못했습니다'); await br.close(); process.exit(1); }
  await sleep(600);
  console.log('장착한 공격 파츠: ' + equipped);

  // 확장 스킬 선택지 확인
  const opts = await pg.evaluate(() => [...document.querySelectorAll('#expansion option')].map(o => ({ v: o.value, t: o.textContent.trim() })));
  const alpha = opts.find(o => /複合拡張α|복합확장α/.test(o.v + o.t));
  if (!alpha) { console.log('FAIL  확장 α 선택지가 없습니다'); await br.close(); process.exit(1); }

  const setExp = async v => {
    await pg.evaluate(val => {
      const s = document.querySelector('#expansion');
      s.value = val;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, v);
    await sleep(700);
    return pg.evaluate(readTimes);
  };

  const none = await setExp(opts[0].v);
  const withA = await setExp(alpha.v);

  console.log('\n확장 없음 : ' + none.slice(0, 6).join(' | '));
  console.log('확장 α    : ' + withA.slice(0, 6).join(' | '));

  const changed = none.filter((v, i) => withA[i] !== undefined && withA[i] !== v).length;
  await br.close();

  if (!none.length) { console.log('\nFAIL  무장 시간 값을 읽지 못했습니다 (선택자 확인 필요)'); process.exit(1); }
  if (changed === 0) { console.log('\nFAIL  확장 α 를 켜도 리로드/OH 표기가 그대로입니다'); process.exit(1); }
  console.log('\nPASS  확장 α 로 ' + changed + '개 무장의 리로드/OH 표기가 줄었습니다');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

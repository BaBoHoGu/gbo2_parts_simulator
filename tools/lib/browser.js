// 헤드리스 크롬을 띄우는 모든 도구가 함께 쓰는 실행기.
//
// **왜 있는가** — puppeteer 는 임시 프로필을 만들고 프로세스가 끝날 때 지운다.
// 윈도우가 그 안의 lockfile 을 아직 잡고 있으면 지우기가 실패하는데, 그것이
// **미처리 예외**로 터져 Node 를 통째로 죽인다:
//     EBUSY: resource busy or locked, unlink '...\puppeteer_dev_chrome_profile-xxxx\lockfile'
// 2026-09-30 배포가 수집·빌드를 다 마치고 「✔ 반영 완료」까지 찍은 뒤 이것으로 멈췄다.
// 우리 일과 아무 상관 없는 뒷정리 하나가 배포 전체를 세운 셈이다.
// 검사 도구 32개가 저마다 크롬을 띄우므로 같은 일이 거기서도 날 수 있고,
// 검사가 죽으면 실패로 잡혀 똑같이 배포가 멈춘다.
//
// **자리를 우리가 정한다.** userDataDir 를 주면 puppeteer 는 그 폴더를 지우려 들지
// 않는다. 치우는 것은 우리가 하되 실패해도 넘어간다 — 임시 폴더라 남아도 해롭지 않다.
//
// puppeteer 를 감싸는 방법은 쓸 수 없다. puppeteer-core 의 export 는 ES 모듈
// 네임스페이스([object Module])라 바인딩이 **읽기 전용**이고, 비엄격 모드에서는
// 대입이 조용히 무시된다(실제로 감싼 줄 알았는데 원본이 불리고 있었다).
// 그래서 부르는 쪽이 이 launch 를 쓰도록 한다.
//
//   const GBO2Browser = require('./lib/browser.js');
//   const browser = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new' });
const fs = require('fs');
const os = require('os');
const path = require('path');

let seq = 0;
const mine = new Set();          // 우리가 만든 프로필 — 끝날 때 한 번 더 치운다
let exitHooked = false;

/** 잠겨 있을 수 있으니 몇 번 나눠 시도한다. 끝내 못 지워도 넘어간다. */
function rmQuiet(dir, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
    catch { /* 아직 잠겨 있다 */ }
  }
  return false;
}

/* 지난 실행이 남긴 찌꺼기를 쓸어 담는다.
   닫기 직후에는 크롬이 파일을 놓지 않아 못 지우는 일이 있고, 도구가 close 없이
   끝나기도 한다(process.exit). 터지지는 않지만 검사 한 번에 아홉 개씩 쌓였다.
   **한 시간 넘은 것만** 지운다 — 지금 돌고 있는 다른 실행의 것을 건드리면 안 된다. */
let swept = false;
function sweepOld() {
  if (swept) return;
  swept = true;
  const tmp = os.tmpdir();
  const cutoff = Date.now() - 60 * 60 * 1000;
  let names;
  try { names = fs.readdirSync(tmp); } catch { return; }
  for (const n of names) {
    if (!/^gbo2-chrome-/.test(n)) continue;
    const p = path.join(tmp, n);
    try { if (fs.statSync(p).mtimeMs < cutoff) rmQuiet(p, 1); } catch { /* 넘어간다 */ }
  }
}

/**
 * 크롬을 띄운다. 쓰는 쪽은 puppeteer.launch 대신 이것을 부른다.
 * opts 는 그대로 넘긴다 — userDataDir 를 직접 준 경우에는 손대지 않는다.
 */
async function launch(opts = {}) {
  const puppeteer = require('puppeteer-core');
  if (opts && opts.userDataDir) return puppeteer.launch(opts);

  sweepOld();
  if (!exitHooked) {
    // 닫지 않고 끝나는 경우(예외로 빠져나갈 때)도 남기지 않는다
    process.on('exit', () => { for (const d of mine) rmQuiet(d, 2); });
    exitHooked = true;
  }
  const dir = path.join(os.tmpdir(), 'gbo2-chrome-' + process.pid + '-' + (seq++));
  mine.add(dir);
  const browser = await puppeteer.launch({ ...opts, userDataDir: dir });
  const origClose = browser.close.bind(browser);
  browser.close = async function () {
    await origClose().catch(() => {});
    rmQuiet(dir);
    mine.delete(dir);
  };
  return browser;
}

module.exports = { launch, rmQuiet };

// 검사가 **정해진 시간을 통째로 기다리지 않게** 하는 도우미.
//
// 왜 — 자동 구성을 돌리는 검사 넷이 `sleep(20000~25000)` 으로 기다렸다. 합 91초다.
//   실제로 끝나는 데 걸리는 시간과 무관하게 매번 그만큼 쉰다. 배포가 느린 큰 이유의 하나였다.
//
// **짐작으로 기다리지 않는다.** 앱에 끝났다는 신호가 이미 있다(src/ui.js runAuto):
//     state.running = true;  btn.disabled = true;      ← 돌기 시작
//     renderAutoResults(picks); ...                     ← 결과를 다 그린 뒤
//     finally { state.running = false; btn.disabled = false; }   ← 끝
//   버튼이 **풀렸다는 것**은 결과가 이미 그려졌다는 뜻이다. 그래서 후보가 나타나기만
//   기다리면 안 된다 — 중간 상태를 읽어 흔들릴 수 있다. 둘을 **같이** 본다.
//
// 못 끝나면 **같은 시간에 타임아웃**한다. 그래서 뒤따르는 검사는 전과 똑같이 걸린다 —
// 빨라지기만 하고 느슨해지지 않는다.
'use strict';

/**
 * 자동 구성이 끝날 때까지. 끝나면 true, 시간이 다 되면 false.
 * @param {object} pg   puppeteer 페이지
 * @param {number} ms   최대 대기(전에 쓰던 sleep 과 같은 값을 준다)
 */
async function waitAutoDone(pg, ms) {
  try {
    await pg.waitForFunction(() => {
      const b = document.querySelector('#runAuto');
      if (!b || b.disabled) return false;                 // 아직 돌고 있다
      return !!document.querySelector('#autoResults .auto-cand');
    }, { timeout: ms, polling: 150 });
    return true;
  } catch { return false; }
}

/** 어떤 것이 나타날 때까지. 나타나면 true, 시간이 다 되면 false. */
async function waitSel(pg, sel, ms) {
  try { await pg.waitForSelector(sel, { timeout: ms }); return true; }
  catch { return false; }
}

module.exports = { waitAutoDone, waitSel };

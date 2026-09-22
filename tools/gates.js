// 검사를 **전부** 돌린다 — 배포가 이것 하나만 부르면 된다.
//
//   node tools/gates.js            전부 (동시 4개)
//   node tools/gates.js --jobs=1   하나씩 (로그를 순서대로 보고 싶을 때)
//   node tools/gates.js --fast     Chrome 안 쓰는 것만 (몇 초)
//
// 왜 만드나 — 배포가 부르던 검사는 smoke·ja_leak_check·ui_check **셋뿐**이었다.
// 저장소에는 검사가 스물여덟 개 있는데 나머지는 사람이 기억해서 손으로 돌려야 했다.
// 2026-09-22 에 그 대가를 치렀다: 번역이 어긋난 7칸(「스러스터」·「강경 직유」)과
// 무장 설명 번역 누락 10건을 **배포 게이트가 아니라 내가 손으로 돌린 검사**가 잡았다.
// 배포만 돌렸으면 그대로 나갔다.
//
// 목록을 손으로 적지 않는다. 손으로 적으면 **새로 만든 검사가 또 빠진다** — 그게 바로
// 이 문제의 뿌리였다. tools/ 를 훑어 주워 담고, 뺄 것만 이유와 함께 아래에 적는다.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS = __dirname;

/** 검사가 아니거나 배포에 걸면 안 되는 것 — 반드시 **이유**를 함께 적는다. */
const EXCLUDE = {
  'font_scale_check.js': '검사가 아니라 손으로 전후를 비교하는 도구다 (이전 dist 를 인자로 받는다)',
  'gates.js': '이 파일',
};

/** 인자가 필요한 검사. ui_check 는 --shots 를 줘야 걸렸을 때 화면을 남긴다 —
 *  안 주면 「UI 점검에 걸렸다」는 말만 있고 무엇이 어긋났는지 볼 그림이 없다. */
const ARGS = { 'ui_check.js': ['--shots'] };

/** Chrome 을 띄우지 않는 것 — --fast 로 이것만 돌릴 수 있다. */
const isFast = f => !fs.readFileSync(path.join(TOOLS, f), 'utf8').includes('puppeteer');

const ARG = process.argv.slice(2);
const FAST = ARG.includes('--fast');
const JOBS = Math.max(1, Number((ARG.find(a => a.startsWith('--jobs=')) || '').slice(7)) || 4);

const all = fs.readdirSync(TOOLS)
  .filter(f => f.endsWith('.js'))
  .filter(f => /_check\.js$|^check_|^smoke\.js$/.test(f))
  .filter(f => !EXCLUDE[f])
  .sort();
const gates = FAST ? all.filter(isFast) : all;

const run = f => new Promise(resolve => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [path.join(TOOLS, f), ...(ARGS[f] || [])], { cwd: ROOT });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', code => resolve({ f, code, out, sec: Math.round((Date.now() - t0) / 1000) }));
});

(async () => {
  console.log(`검사 ${gates.length}개를 돌립니다 (동시 ${JOBS}개${FAST ? ' · Chrome 안 쓰는 것만' : ''})\n`);
  const queue = gates.slice();
  const results = [];
  const worker = async () => {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      const r = await run(f);
      results.push(r);
      // 통과한 것은 한 줄로, 걸린 것은 왜인지 그대로 보여 준다
      const line = (r.out.split('\n').filter(x => /PASS \/ |통과|SKIP/.test(x)).pop() || '').trim();
      const mark = r.code === 0 ? (/SKIP/.test(r.out) ? 'SKIP' : ' OK ') : 'FAIL';
      console.log(`  [${mark}] ${(f.replace('.js', '') + '                      ').slice(0, 22)}`
        + `${('   ' + r.sec).slice(-4)}초  ${line.slice(0, 46)}`);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));

  const bad = results.filter(r => r.code !== 0);
  if (bad.length) {
    console.log('\n' + '─'.repeat(60));
    for (const r of bad) {
      console.log(`\n■ ${r.f} — 걸린 내용`);
      // FAIL 줄과 그 뒤 몇 줄만 — 전체를 쏟으면 무엇이 문제인지 안 보인다
      const lines = r.out.split('\n');
      const hit = lines.map((l, i) => (/FAIL|실패|오류/.test(l) ? i : -1)).filter(i => i >= 0);
      const show = new Set();
      for (const i of hit.slice(0, 6)) for (let j = i; j < Math.min(i + 5, lines.length); j++) show.add(j);
      for (const i of [...show].sort((a, b) => a - b)) console.log('   ' + lines[i]);
    }
  }
  const okN = results.length - bad.length;
  console.log(`\n${bad.length ? '✗' : '✔'} 검사 ${results.length}개 — 통과 ${okN} · 실패 ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
})();

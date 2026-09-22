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
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const TOOLS = __dirname;

/** 검사가 아니거나 배포에 걸면 안 되는 것 — 반드시 **이유**를 함께 적는다. */
const EXCLUDE = {
  'font_scale_check.js': '검사가 아니라 손으로 전후를 비교하는 도구다 (이전 dist 를 인자로 받는다)',
  'gates.js': '이 파일',
  // 투표 한도 시험은 갤러리에 **구성이 5개 이상** 있어야 도는데, 올리기가 1분에 한 건이라
  // 배포마다 5분을 더 써야 한다. 값어치에 비해 너무 비싸 손으로 돌리는 도구로 둔다.
  //   npx wrangler pages dev --port 8788 --local  후  node tools/vote_check.js
  'vote_check.js': '구성 5개를 미리 올려야 하는데 업로드가 1분에 한 건이라 배포에 넣기엔 비싸다',
};

/** 로컬 서버(wrangler pages dev)가 있어야 도는 검사인가. */
const needsServer = f => fs.readFileSync(path.join(TOOLS, f), 'utf8').includes('localhost:8788');

/** 인자가 필요한 검사. ui_check 는 --shots 를 줘야 걸렸을 때 화면을 남긴다 —
 *  안 주면 「UI 점검에 걸렸다」는 말만 있고 무엇이 어긋났는지 볼 그림이 없다. */
const ARGS = { 'ui_check.js': ['--shots'] };

/** --fast 로 돌릴 것 — Chrome 도, 로컬 서버도 안 쓰는 것.
 *  서버 쪽을 넣으면 안 된다: 갤러리 검사는 올리기가 1분에 한 건이라 혼자 122초를 쓴다.
 *  그러면 「빠른 검사」가 2분짜리가 되어, 자주 도는 자리(배포본의 update.bat)에서 쓸 수 없다. */
const isFast = f => {
  const t = fs.readFileSync(path.join(TOOLS, f), 'utf8');
  return !t.includes('puppeteer') && !t.includes('localhost:8788');
};

const ARG = process.argv.slice(2);
const FAST = ARG.includes('--fast');
const JOBS = Math.max(1, Number((ARG.find(a => a.startsWith('--jobs=')) || '').slice(7)) || 4);

const all = fs.readdirSync(TOOLS)
  .filter(f => f.endsWith('.js'))
  .filter(f => /_check\.js$|^check_|^smoke\.js$/.test(f))
  .filter(f => !EXCLUDE[f])
  .sort();
const gates = FAST ? all.filter(isFast) : all;

/* 로컬 서버를 **직접** 띄운다.
   여태 gallery_pw_check 는 서버가 없어 매번 SKIP 이었다 — 공유 갤러리는 배포 때
   한 번도 검사되지 않았다는 뜻이다. 상태는 매번 **새 폴더**에 둔다:
   표·비밀번호 잠금이 쌓이면 같은 검사가 돌릴 때마다 다른 결과를 낸다(실제로 19/1 → 14/6).
   시크릿은 .dev.vars(더미, .gitignore)에서 읽는다 — 진짜 값은 Cloudflare 에만 있다. */
const PORT = 8788;
const STATE = path.join(os.tmpdir(), 'gbo2-gates-' + process.pid);

const portBusy = () => new Promise(resolve => {
  const sock = net.connect({ port: PORT, host: '127.0.0.1' });
  const done = v => { sock.destroy(); resolve(v); };
  sock.on('connect', () => done(true));
  sock.on('error', () => done(false));
  setTimeout(() => done(false), 1500);
});

const ready = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/api/builds');
      if (r.ok) return true;
    } catch { /* 아직 */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
};

/* **동기로** 죽여야 한다. spawn 으로 띄우면 이 프로세스가 먼저 끝나 taskkill 이 안 돌고,
   서버가 남는다 — 그러면 다음 실행이 포트를 못 잡는다(실제로 9개가 쌓여 있었다). */
function killTree(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); }
  catch { try { process.kill(pid); } catch { /* 이미 죽었으면 말고 */ } }
}

/* 서버와 검사가 **같은 SIGN_KEY** 를 봐야 관리자 토큰이 맞는다.
   서버는 .dev.vars 에서 읽고, 검사는 process.env 에서 읽는다 — 여기서 이어 준다.
   안 이어 주면 「관리자는 비밀번호 없이 지운다」 하나만 조용히 실패한다. */
/* 없으면 만든다 — .dev.vars 는 .gitignore 라 **다른 PC·배포본에는 없다.**
   그러면 갤러리 검사가 「서버 설정이 끝나지 않았습니다 (WHO_SALT)」로 실패해
   배포가 통째로 막힌다(실측 확인). 여기 값은 로컬 검사 전용 더미로, 진짜 시크릿과
   아무 상관이 없다 — 진짜 값은 Cloudflare 에만 있다(wrangler pages secret put). */
function ensureDevVars() {
  const f = path.join(ROOT, '.dev.vars');
  if (fs.existsSync(f)) return;
  fs.writeFileSync(f,
    '# 로컬 검사 전용 더미값 — 진짜 비밀값이 아니다. tools/gates.js 가 없으면 만든다.' + '\n'
    + '# 진짜 시크릿은 Cloudflare 에만 있다(wrangler pages secret put). 이 파일은 .gitignore 에 있다.' + '\n'
    + 'WHO_SALT=local-check-dummy-salt-not-a-secret' + '\n'
    + 'SIGN_KEY=local-check-dummy-sign-key-not-a-secret' + '\n');
  console.log('  · 로컬 검사용 .dev.vars 를 만들었습니다 (더미값 · 저장소에 안 올라갑니다)');
}

/** **쓸 때** 읽는다. 미리 읽으면 ensureDevVars 가 그 실행에서 만든 파일을 못 본다 —
 *  처음 도는 PC 에서만 관리자 토큰이 조용히 어긋나는, 찾기 어려운 꼴이 된다. */
function readDevVars() {
  try {
    const t = fs.readFileSync(path.join(ROOT, '.dev.vars'), 'utf8');
    const o = {};
    for (const line of t.split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m) o[m[1]] = m[2];
    }
    return o;
  } catch { return {}; }
}

const run = f => new Promise(resolve => {
  const t0 = Date.now();
  const env = needsServer(f) ? { ...process.env, ...readDevVars() } : process.env;
  const p = spawn(process.execPath, [path.join(TOOLS, f), ...(ARGS[f] || [])], { cwd: ROOT, env });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', code => resolve({ f, code, out, sec: Math.round((Date.now() - t0) / 1000) }));
});

(async () => {
  console.log(`검사 ${gates.length}개를 돌립니다 (동시 ${JOBS}개${FAST ? ' · Chrome 안 쓰는 것만' : ''})\n`);

  let srv = null;
  if (gates.some(needsServer)) {
    if (await portBusy()) {
      /* 이미 떠 있는 서버에 대고 검사하면 **남의 상태**를 보게 된다 —
         실제로 그렇게 표가 쌓인 옛 서버에 대고 재다가 결과가 들쭉날쭉했다.
         조용히 쓰지 말고 멈춘다. */
      console.log(`  ✗ 포트 ${PORT} 가 이미 쓰이고 있습니다 — 그 서버에 대고 재면 남의 상태를 봅니다.`);
      console.log('    먼저 그 서버를 내려 주세요 (wrangler 를 물고 있는 node 프로세스).');
      process.exit(1);
    }
    ensureDevVars();
    fs.mkdirSync(STATE, { recursive: true });
    /* wrangler 를 **node 로 직접** 부른다. npx 를 쓰면 윈도에서 npx.cmd 가 되는데,
       최신 node 는 shell 없이 .cmd 를 못 띄우고(EINVAL), shell:true 로 하면 인자가
       escape 되지 않는다는 경고가 뜬다 — 경로에 공백·한글이 있는 이 저장소에서는 실제로 위험하다. */
    const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (!fs.existsSync(wrangler)) {
      console.log('  · wrangler 가 없어 갤러리 검사는 건너뜁니다 (npm install).');
    } else {
      srv = spawn(process.execPath, [wrangler, 'pages', 'dev', '--port', String(PORT),
        '--local', '--persist-to', STATE], { cwd: ROOT, stdio: 'ignore' });
    }
    if (srv && !(await ready())) {
      console.log('  · 로컬 서버를 못 띄웠습니다 — 갤러리 검사는 건너뜁니다.');
      killTree(srv.pid); srv = null;
    } else if (srv) {
      console.log('  · 갤러리 검사용 로컬 서버를 띄웠습니다 (상태는 매번 새로)\n');
    }
  }
  const stopServer = () => {
    if (!srv) return;
    killTree(srv.pid);
    try { fs.rmSync(STATE, { recursive: true, force: true }); } catch { /* 지워지면 좋고 */ }
    srv = null;
  };
  process.on('exit', stopServer);
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
  stopServer();

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

// `-Site`(사이트만 운영) 모드가 제대로 묶여 있는가.
//   node tools/sitemode_check.js
//
// ■ 왜 — 사용자 지시(2026-10-12): **앞으로는 사이트만 운영한다.** PC 판·APK 는
//   말할 때만 만든다. 그러니 평소 배포가 APK 를 빌드하거나 ZIP 을 올리면 안 된다.
//
// ■ 특히 위험한 것 — `Publish-Pc` 는 `release\` 의 **가장 최근 ZIP** 을 집어 올린다.
//   `-Site` 는 ZIP 을 만들지 않으므로, 실수로 부르면 **지난번 ZIP 이 최신인 척** 올라간다.
//   그 사고는 조용하다(업로드는 성공한다) — 그래서 자로 막는다.
//
// ■ 이 자는 **배선**을 본다. update.ps1 은 노드에서 돌려 보기엔 무거워(망·크롬·APK)
//   글을 읽어 확인하고, **거부 동작 하나는 실제로 돌려** 본다(망이 필요 없다).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const PS = path.join(ROOT, 'update.ps1');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

if (!fs.existsSync(PS)) { console.log('SKIP  update.ps1 이 없다'); process.exit(0); }
const src = fs.readFileSync(PS, 'utf8');
/* 줄 단위로 본다 — 주석줄은 배선이 아니다 */
const code = src.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');

/* ── ① 스위치가 있다 ─────────────────────────────────────────────── */
const param = (code.match(/^param\(.*\)$/m) || [''])[0];
ok('param 에 -Site 가 있다', /\[switch\]\$Site\b/.test(param), param.slice(0, 160));
ok('사용법 주석에 -Site 를 적어 뒀다', /update\.ps1 -Site/.test(src));

/* ── ② APK 를 만들지 않는다 ──────────────────────────────────────── */
/* **호출부**를 집어야 한다 — 그냥 Build-Apk 를 찾으면 함수 정의 줄이 먼저 걸린다(자가 틀렸다). */
const apk = (code.match(/^.*\{ *Build-Apk *\}.*$/m) || [''])[0];
ok('-Site 면 Build-Apk 를 부르지 않는다', /-not \$Site/.test(apk), apk.trim());

/* ── ③ ZIP 을 올리지 않는다 — 가장 중요한 한 줄 ───────────────────
   `if ($Site) { ... }` 줄에 Publish-Pc 가 **없어야** 한다. 있으면 낡은 ZIP 이 올라간다. */
const siteLine = (code.match(/^\s*if \(\$Site\) \{.*\}\s*$/m) || [''])[0];
ok('-Site 게시 줄이 있다', !!siteLine.trim(), siteLine);
ok('-Site 는 Publish-Pc 를 부르지 않는다 (낡은 ZIP 이 올라간다)',
  !!siteLine.trim() && !/Publish-Pc/.test(siteLine), siteLine.trim());
ok('-Site 는 사이트를 게시한다', /Publish-Site/.test(siteLine), siteLine.trim());
ok('-Site 는 폰 OTA 도 올린다 (이미 깐 사람이 멈추지 않게)',
  /Publish-Ota/.test(siteLine), siteLine.trim());
/* -Release 는 ZIP 을 만드는 쪽이라 그대로 있어야 한다 — 「말할 때만」의 그 길이다. */
ok('-Release 로는 여전히 ZIP 을 만든다 (말할 때 쓰는 길)',
  /if \(\$Release\) \{/.test(code) && /build_release\.js/.test(src));
ok('-Publish 는 여전히 Publish-Pc 를 부른다',
  /if \(\$Publish\) \{[^}]*Publish-Pc/.test(code));

/* ── ④ 검사는 전체로 돈다 — 사이트도 배포다 ───────────────────────── */
const fast = (code.match(/^.*gateArgs \+= '--fast'.*$/m) || [''])[0];
ok('-Site 에서도 검사를 전체로 돈다 (--fast 가 아니다)',
  /\$Site/.test(fast), fast.trim());

/* ── ⑤ 섞어 쓰기를 **실제로** 거부하는가 ──────────────────────────
   여기만은 글이 아니라 돌려서 본다. 망도 크롬도 필요 없다 — 인자 검사에서 바로 멈춘다.

   ■ **사본을 임시 폴더에서 돌린다.** 진짜 파일을 그 자리에서 돌렸더니, 가드를 빼고
     심었을 때 자가 **실제 배포를 시작했다**(픽업 일정을 받기 시작했다). 자가 배포를
     일으키면 안 된다. 사본은 $PSScriptRoot 아래에 dist·release·tools 가 없어
     모든 게시 단계가 스스로 「건너뜁니다」로 빠진다 — 거부만 안전하게 재진다. */
const TMP = path.join(os.tmpdir(), 'gbo2-sitemode-check');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const COPY = path.join(TMP, 'update.ps1');
fs.copyFileSync(PS, COPY);
let ran = null;
try {
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-File', COPY, '-Site', '-Publish'],
    { cwd: TMP, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
  ran = { code: 0, out: '' };
} catch (e) {
  ran = { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
}
/* 사본이 **배포 쪽으로 넘어가지 않았는지** 함께 본다 — 거부가 먼저여야 한다. */
const 넘어감 = /픽업 일정|OTA 게시|사이트 게시|배포 패키지/.test(ran.out || '');
fs.rmSync(TMP, { recursive: true, force: true });
ok('-Site 와 -Publish 를 같이 주면 멈춘다', ran && ran.code !== 0, ran && ran.code);
ok('멈출 때 어느 길을 쓰라고 알려 준다',
  !!ran && /-Release -Publish/.test(ran.out) && /-Site/.test(ran.out),
  (ran && ran.out || '').slice(0, 180));
/* 거부가 **아무것도 하기 전에** 와야 한다. 뒤에 있으면 그 사이에 데이터를 받고
   게시까지 손을 댄다 — 자가 배포를 일으킨 적이 있다(그래서 사본으로 돌린다). */
ok('거부가 배포 단계보다 먼저다 (아무것도 안 하고 멈춘다)', !넘어감,
  (ran && ran.out || '').slice(0, 180));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

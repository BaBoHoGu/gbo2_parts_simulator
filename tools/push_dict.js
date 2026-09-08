// 공유 갤러리의 화이트리스트(dict)를 Firebase 에 올린다 — 배포 파이프라인이 부른다.
//
//   node tools/push_dict.js            dist/firebase-dict.json 을 dict 노드에 통째로 쓴다
//   node tools/push_dict.js --check    쓰지 않고 로그인·읽기만 확인한다
//
// 왜 필요한가: 보안 규칙이 기체·파츠 이름을 dict 와 대조한다. 데이터 갱신으로 기체가 늘면
// 사전도 같이 올려야 하고, 안 올리면 그 기체로 만든 구성은 업로드가 조용히 거부된다.
// 사용자 눈에는 이유가 안 보이므로 사람 손에 맡기면 안 된다.
//
// 자격 증명은 환경 변수로 받는다(GBO2_DICT_EMAIL / GBO2_DICT_PASSWORD).
// 저장소는 공개라 파일에 넣을 수 없다 — update.ps1 이 DPAPI 로 암호화해 두고 여기로 넘긴다.
// 이 계정은 dict 만 쓸 수 있다(dictWriters). 관리자 계정과 달리 글을 지우지 못한다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 주소·API 키는 앱과 같은 값이어야 한다 — 두 벌로 두지 않고 share.js 에서 읽는다
const share = fs.readFileSync(path.join(ROOT, 'src', 'share.js'), 'utf8');
const pick = (k) => {
  const m = share.match(new RegExp(k + ":\\s*'([^']+)'"));
  if (!m) throw new Error(`src/share.js 에서 ${k} 를 못 찾았습니다`);
  return m[1];
};
const DB = pick('db');
const KEY = pick('key');

const fail = (msg) => { console.log(msg); process.exit(1); };

async function main() {
  const email = process.env.GBO2_DICT_EMAIL;
  const password = process.env.GBO2_DICT_PASSWORD;
  if (!email || !password) fail('자격 증명이 없습니다 (GBO2_DICT_EMAIL / GBO2_DICT_PASSWORD).');

  const check = process.argv.includes('--check');
  const src = path.join(ROOT, 'dist', 'firebase-dict.json');
  if (!check && !fs.existsSync(src)) fail('dist/firebase-dict.json 이 없습니다 (make_share_dict.js --dict 를 먼저 실행).');

  // ── 로그인 ────────────────────────────────────────────────
  const lr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  }).catch(() => null);
  const lj = lr && await lr.json().catch(() => null);
  if (!lr || !lr.ok || !lj || !lj.idToken) {
    const why = (lj && lj.error && lj.error.message) || '연결 실패';
    fail(`사전 계정 로그인 실패: ${why}`);
  }
  const token = lj.idToken;

  // ── 쓰기 권한이 있는 계정인지 먼저 확인 ────────────────────
  // (dictWriters 는 공개 읽기라 토큰 없이도 볼 수 있다. 400MB 를 밀어 넣고 나서
  //  권한이 없다는 걸 아는 것보다, 올리기 전에 아는 편이 낫다.)
  const wr = await fetch(`${DB}/dictWriters/${lj.localId}.json`).catch(() => null);
  const wj = wr && await wr.json().catch(() => null);
  if (!wj) fail(`이 계정은 사전을 쓸 수 없습니다 — 콘솔에서 dictWriters/${lj.localId} 를 true 로 추가하세요.`);

  if (check) {
    console.log(`사전 계정 확인 완료 (uid ${lj.localId}) — 올릴 준비가 돼 있습니다.`);
    return;
  }

  // ── 올리기 ────────────────────────────────────────────────
  const body = fs.readFileSync(src, 'utf8');
  const dict = JSON.parse(body);
  const n = (o) => Object.keys(o || {}).length;
  const pr = await fetch(`${DB}/dict.json?auth=${token}&print=silent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body
  }).catch(() => null);
  if (!pr || !pr.ok) {
    const t = pr ? await pr.text().catch(() => '') : '연결 실패';
    fail(`사전 올리기 실패 (${pr ? pr.status : '-'}): ${t.slice(0, 200)}`);
  }

  // ── 되읽어 확인 ───────────────────────────────────────────
  // 200 만 믿지 않는다. 부분적으로 올라간 사전은 낡은 사전보다 나쁘다
  // (있던 기체까지 업로드가 막힌다). 마지막 기체·파츠가 실제로 들어갔는지 본다.
  const last = (o) => Object.keys(o).pop();
  const probes = [['ms', last(dict.ms)], ['parts', last(dict.parts)], ['exp', last(dict.exp)]];
  for (const [kind, name] of probes) {
    const r = await fetch(`${DB}/dict/${kind}/${encodeURIComponent(name)}.json?auth=${token}`).catch(() => null);
    const j = r && await r.json().catch(() => null);
    if (!j) fail(`사전을 올렸지만 되읽지 못했습니다 (${kind}/${name}) — 콘솔에서 확인하세요.`);
  }

  console.log(`사전 올리기 완료 — 기체 ${n(dict.ms)} · 파츠 ${n(dict.parts)} · 확장 ${n(dict.exp)}`);
}

main().catch(e => fail('사전 올리기 중 오류: ' + e.message));

// 갤러리 서버의 횟수 제한이 **한꺼번에 던진 요청**에도 지켜지는가.
//
//   node tools/gates.js 가 로컬 서버(localhost:8788)를 띄워 준다. 혼자 돌릴 때는
//   npx wrangler pages dev --port 8788 --local  을 먼저.
//
// 2026-10-19 버그 탐색 — 비밀번호 시도 수를 「읽고 → 비교하고 → +1 써서」 셌더니,
// 오답 20개를 동시에 던지면 20개가 모두 같은 옛 횟수(0)를 읽어 **전부 비교됐다**
// (「10분에 5번」 이 「한 묶음에 무제한」). 관리자 로그인도 같았다. 지금은 비교 전에
// 질의 하나로 세어(bumpTry) 저마다 다른 번호를 받는다. 옛 코드로 돌리면 이 검사가 운다.
//
// 요청마다 **임의의 IP 머리**(CF-Connecting-IP)를 붙인다 — 이 검사가 잠근 칸이
// 같은 서버를 쓰는 gallery_pw_check 의 칸과 섞이지 않게. (진짜 Cloudflare 는 이 머리를
// 손님이 못 바꾼다. 로컬 서버만 받아 준다.)
const API = process.env.VOTE_API || 'http://localhost:8788/api';
const r255 = () => 1 + Math.floor(Math.random() * 254);
const IP = '10.' + r255() + '.' + r255() + '.' + r255();
const jf = (p, opt = {}) => fetch(API + p, {
  ...opt, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, ...(opt.headers || {}) }
}).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
};
const N = 20, MAX = 5;

(async () => {
  try { await fetch(API + '/builds'); }
  catch { console.log('SKIP  로컬 서버가 없습니다 (npx wrangler pages dev --port 8788 --local)'); process.exit(0); }

  const bl = await jf('/builds');
  const list = (bl.json && bl.json.builds) || [];
  const MS = list.length ? list[0].ms : 'ジム_LV1', EXP = list.length ? list[0].exp : '射撃補正拡張';
  // 지문이 겹치지 않게 파츠 조합을 난수로 고른다(돌릴 때마다 「이미 올라온 구성」 이 되지 않게)
  const PARTS = ['強化フレーム_LV1', '強化フレーム_LV2', '強化フレーム_LV3', '強化フレーム_LV4',
    '強化フレーム_LV5', '新型フレーム_LV1', '新型フレーム_LV2', '新型フレーム_LV3'];
  const pick = () => { const m = r255(); return PARTS.filter((_, k) => (m >> k) & 1); };
  const body = parts => JSON.stringify({ ms: MS, stage: 0, exp: EXP, expLv: 1, parts,
    title: '경합시험', author: '시험', desc: '', ver: 'test', pw: 'pass1234' });

  console.log('== 올리기 1분 제한 (서로 다른 구성 10개를 동시에) ==');
  const ups = await Promise.all(Array.from({ length: 10 }, () => jf('/builds', { method: 'POST', body: body(pick()) })));
  const okUp = ups.filter(r => r.status === 200);
  ok('하나만 올라간다', okUp.length === 1, ups.map(r => r.status));
  ok('500 이 없다 (같은 구성이 겹쳐도 「이미 올라온 구성」 으로 답한다)', ups.every(r => r.status < 500), ups.map(r => r.status));
  const id = okUp[0] && okUp[0].json && okUp[0].json.id;

  if (id) {
    console.log('\n== 본인 삭제 비밀번호 (오답 ' + N + '개를 동시에) ==');
    const dels = await Promise.all(Array.from({ length: N }, (_, i) =>
      jf('/builds/' + id, { method: 'DELETE', body: JSON.stringify({ pw: 'wrong' + i }) })));
    const tried = dels.filter(r => r.status === 403).length;
    ok(MAX + '번까지만 비교된다', tried <= MAX, { 비교됨: tried, 상태: [...new Set(dels.map(r => r.status))] });
    const right = await jf('/builds/' + id, { method: 'DELETE', body: JSON.stringify({ pw: 'pass1234' }) });
    ok('잠긴 동안은 맞는 비밀번호도 거절', right.status === 429, right);
  } else {
    ok('경합 시험용 구성을 올렸다', false, ups.map(r => r.json && r.json.code));
  }

  console.log('\n== 관리자 로그인 (오답 ' + N + '개를 동시에) ==');
  const adm = await Promise.all(Array.from({ length: N }, (_, i) =>
    jf('/admin', { method: 'POST', body: JSON.stringify({ password: 'nope-' + i }) })));
  if (adm.every(r => r.json && r.json.code === 'cfg')) {
    // 로컬 .dev.vars 에 관리자 해시가 없으면 비교 전에 막힌다 — 잴 것이 없다
    console.log('  SKIP 관리자 해시가 로컬에 없다 (ADMIN_PW_SHA256)');
  } else {
    const tried = adm.filter(r => r.status === 401).length;
    ok(MAX + '번까지만 비교된다', tried <= MAX, { 비교됨: tried, 상태: [...new Set(adm.map(r => r.status))] });
  }

  /* 투표 하루 한도(추천 5) — 서로 다른 기체 10개에 한 기기로 동시에 추천한다. 예전엔 「센 다음 넣기」 라
     10개가 모두 「아직 0개」 를 읽어 다 들어갔다(2026-10-24 버그 탐색). 기기 id 는 돌릴 때마다 새로. */
  console.log('\n== 투표 하루 한도 (서로 다른 기체 10개를 동시에 추천) ==');
  const DEV = 'race' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const msNames = [...new Set(require('../data/msData.json').map(m => m.MS名.normalize('NFC').replace(/_LV\d+$/i, '')))].slice(0, 10);
  const vs = await Promise.all(msNames.map(t =>
    jf('/votes', { method: 'POST', headers: { 'X-GBO2-Device': DEV }, body: JSON.stringify({ kind: 'ms', target: t, dir: 1 }) })));
  const placed = vs.filter(r => r.status === 200).length;
  ok('추천은 5개까지만 들어간다', placed <= 5 && placed >= 1, { 들어감: placed, 상태: vs.map(r => r.status) });
  ok('500 이 없다', vs.every(r => r.status < 500), vs.map(r => r.status));
  const after = await jf('/votes?kind=ms', { headers: { 'X-GBO2-Device': DEV } });
  ok('남은 추천 횟수가 음수가 아니다', after.json && after.json.left && after.json.left.up >= 0, after.json && after.json.left);

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

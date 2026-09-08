// 공유 갤러리 보안 규칙 실측.
//   node tools/share_rules_check.js
//
// 통과해야 할 것과 **막혀야 할 것**을 모두 시험한다. 규칙은 조용히 느슨해지기 쉬워서
// (한 줄만 잘못 써도 전 세계 쓰기가 열린다) 배포 전에 매번 돌릴 수 있게 도구로 둔다.
const KEY = process.env.GBO2_FB_KEY || 'AIzaSyDR86iaIqH_y9jweHzCwD1sGZGwf35T33o';
const DB = process.env.GBO2_FB_DB || 'https://gbo2-parts-share-default-rtdb.asia-southeast1.firebasedatabase.app';

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (!cond && extra ? '  — ' + extra : ''));
  cond ? pass++ : fail++;
};

/** 새 익명 계정 하나 (uid 마다 속도 제한이 따로라 시험을 격리할 수 있다) */
async function newUser() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });
  const j = await r.json();
  return { token: j.idToken, uid: j.localId };
}
const put = (path, body, token) =>
  fetch(`${DB}/${path}.json${token ? '?auth=' + token : ''}`, { method: 'PUT', body: JSON.stringify(body) });
const get = (path, token) => fetch(`${DB}/${path}.json${token ? '?auth=' + token : ''}`);

/** 업로드 직전에 찍는 속도 제한 노드. 서버 시각 sentinel 을 쓴다. */
const touch = (u) => put(`throttle/${u.uid}`, { '.sv': 'timestamp' }, u.token);

/** 규칙을 통과해야 하는 정상 구성 한 건 */
const goodBuild = (u, over = {}) => ({
  ms: 'ジム・スナイパー_LV1',
  p0: '強化フレーム_LV1',
  stage: 6,
  exp: '拡張スキル無し',
  expLv: 5,
  at: { '.sv': 'timestamp' },
  uid: u.uid,
  ver: '2026-09-07',
  ...over
});

(async () => {
  console.log('DB: ' + DB + '\n');

  // ── 읽기 권한 ────────────────────────────────────────────────
  ok('builds 읽기 공개', (await get('builds')).status === 200);
  ok('blocked 읽기 공개', (await get('blocked')).status === 200);
  ok('dict 는 클라이언트가 못 읽는다', (await get('dict')).status === 401);

  // ── 사전이 실제로 들어갔나 (규칙을 통해 간접 확인) ─────────────
  // 정상 업로드가 통과하면 dict 가 있는 것이다(없으면 ms validate 에서 걸린다).

  // ── 정상 업로드 ──────────────────────────────────────────────
  const u1 = await newUser();
  ok('익명 로그인', !!u1.token);
  const TESTKEY = '_ruletest_' + Date.now();
  {
    const t = await touch(u1);
    ok('throttle 쓰기', t.status === 200, await t.text());
    const r = await put(`builds/${TESTKEY}`, goodBuild(u1), u1.token);
    ok('정상 구성 업로드', r.status === 200, await r.text());
  }

  // ── 속도 제한 ────────────────────────────────────────────────
  {
    const t = await touch(u1);   // 60초 안 지났으므로 거부돼야 한다
    ok('1분 내 재업로드 차단(throttle)', t.status === 401, 'status ' + t.status);
  }

  // ── throttle 없이 바로 쓰기 ──────────────────────────────────
  {
    const u = await newUser();
    const r = await put(`builds/_nothrottle_${Date.now()}`, goodBuild(u), u.token);
    ok('throttle 없이 업로드 차단', r.status === 401, 'status ' + r.status);
  }

  // ── 검증 실패해야 하는 것들 (매번 새 계정 + throttle) ─────────
  const deny = async (label, over, keyPrefix) => {
    const u = await newUser();
    await touch(u);
    const body = goodBuild(u, over);
    const r = await put(`builds/${keyPrefix}_${Date.now()}`, body, u.token);
    ok(label, r.status === 401, 'status ' + r.status + ' (통과해 버림)');
  };
  await deny('모르는 기체 거부', { ms: 'ナニカ・ヘンナキタイ_LV9' }, '_bad_ms');
  await deny('모르는 파츠 거부', { p0: 'ニセパーツ_LV1' }, '_bad_part');
  await deny('9번째 파츠 칸 거부', { p8: '強化フレーム_LV1' }, '_p8');
  await deny('이상한 강화 단계 거부', { stage: 5 }, '_stage');
  await deny('확장 LV 범위 밖 거부', { expLv: 9 }, '_explv');
  await deny('모르는 확장 스킬 거부', { exp: 'ナニカ拡張' }, '_exp');
  await deny('정의 안 한 필드 거부', { evil: 'x' }, '_extra');
  await deny('날짜 위조 거부', { at: 1 }, '_at');
  await deny('uid 사칭 거부', { uid: 'somebodyelse' }, '_uid');
  await deny('제목 길이 초과 거부', { title: '가'.repeat(25) }, '_title');
  await deny('필수 필드 누락 거부', { ver: null }, '_missing');

  // ── 중복(같은 키) ────────────────────────────────────────────
  {
    const u = await newUser();
    await touch(u);
    const r = await put(`builds/${TESTKEY}`, goodBuild(u), u.token);
    ok('같은 구성(같은 키) 재업로드 차단', r.status === 401, 'status ' + r.status);
  }

  // ── 남의 글 수정·삭제 ────────────────────────────────────────
  {
    const u = await newUser();
    await touch(u);
    const r = await fetch(`${DB}/builds/${TESTKEY}.json?auth=${u.token}`, { method: 'DELETE' });
    ok('남의 글 삭제 차단', r.status === 401, 'status ' + r.status);
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  console.log(`\n※ 시험용으로 남은 항목: builds/${TESTKEY}`);
  console.log('   콘솔에서 지워 주세요 (규칙상 클라이언트는 삭제할 수 없습니다).');
  process.exit(fail ? 1 : 0);
})();

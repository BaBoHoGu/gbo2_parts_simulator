// 갤러리 삭제 비밀번호를 **실제로 도는 서버**에 대고 검증한다.
//
//   npx wrangler pages dev --port 8788 --local     ← 먼저 띄운다
//   node tools/gallery_pw_check.js                  ← 그다음 이것
//
// 규칙이 서버에만 있어 코드를 읽어서는 맞는지 알 수 없다. 특히 확인해야 하는 것:
//   · 비밀번호 없이 올리면 거절되는가 (필수)
//   · 틀린 비밀번호로 남의 글이 지워지지 않는가
//   · 맞는 비밀번호면 지워지는가
//   · 관리자는 비밀번호 없이 지워지는가 (기존 동작이 그대로인가)
//   · 여러 번 틀리면 잠기는가
const API = process.env.VOTE_API || 'http://localhost:8788/api';

const jf = (path, opt = {}) => fetch(API + path, {
  ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) }
}).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

// 같은 지문이 되지 않게 파츠를 조금씩 바꿔 가며 올린다.
const PARTS = ['強化フレーム_LV1', '強化フレーム_LV2', '強化フレーム_LV3', '強化フレーム_LV4',
  '強化フレーム_LV5', '新型フレーム_LV1', '新型フレーム_LV2', '新型フレーム_LV3'];
// 비트마스크로 파츠 조합을 고른다. 시작점을 난수로 잡아 돌릴 때마다 다른 조합이
// 나오게 한다 — 안 그러면 두 번째 실행부터 전부 「이미 올라온 구성」이 된다.
let seq = 1 + Math.floor(Math.random() * 200);
let lastParts = null;
async function put(pw, same) {
  const mask = (seq++ % 254) + 1;
  const parts = same && lastParts ? lastParts : PARTS.filter((_, i) => mask & (1 << i));
  lastParts = parts;
  const body = {
    ms: MS_NAME, stage: 0, exp: EXP_NAME, expLv: 1, parts,
    title: '비번시험' + seq, author: '시험', desc: '', ver: 'test'
  };
  if (pw !== null) body.pw = pw;
  return jf('/builds', { method: 'POST', body: JSON.stringify(body) });
}
const del = (id, pw, token) => jf('/builds/' + id, {
  method: 'DELETE',
  headers: token ? { Authorization: 'Bearer ' + token } : {},
  body: pw === null ? undefined : JSON.stringify({ pw })
});

let MS_NAME = '', EXP_NAME = '';

/* 이 점검은 로컬 서버(wrangler pages dev)가 떠 있어야 돈다. 없을 때 그냥 두면
   처리 안 된 fetch 예외로 **죽어 버려서**, 한꺼번에 돌릴 때 진짜 실패와 구분이 안 됐다.
   token_check 처럼 조용히 건너뛴다 — 없는 것은 실패가 아니다. */
async function serverUp() {
  try { await fetch(API + '/builds', { method: 'GET' }); return true; }
  catch { return false; }
}

(async () => {
  if (!await serverUp()) {
    console.log('SKIP  로컬 서버가 없습니다 (npx wrangler pages dev --port 8788 --local)');
    process.exit(0);
  }
  // 서버 사전에 있는 기체 이름 하나가 필요하다 — 이미 올라온 구성에서 빌려 온다.
  const bl = await jf('/builds');
  const list = (bl.json && bl.json.builds) || [];
  MS_NAME = list.length ? list[0].ms : 'ジム_LV1';
  EXP_NAME = list.length ? list[0].exp : '射撃補正拡張';
  console.log('기준 기체: ' + MS_NAME + ' · 기존 구성 ' + list.length + '개');
  console.log('※ 올리기는 1분에 한 건이라, 이 시험은 throttle 표를 비운 상태에서 돌려야 합니다.');

  console.log('\n== 올릴 때 비밀번호는 필수 ==');
  let r = await put(null);
  ok('비밀번호 없이 올리면 거절', r.status === 400 && r.json && r.json.code === 'pw', r.json);
  r = await put('ab');
  ok('3자 이하는 거절', r.status === 400 && r.json && r.json.code === 'pw', r.json);
  r = await put('a b c d');
  ok('공백이 들어가면 거절', r.status === 400 && r.json && r.json.code === 'pw', r.json);

  console.log('\n== 본인 삭제 ==');
  r = await put('pass1234');
  const id = r.json && r.json.id;
  ok('비밀번호를 걸고 올라감', !!id, r.json);
  if (!id) { done(); return; }

  const after = await jf('/builds');
  const mine = ((after.json && after.json.builds) || []).find(b => b.id === id);
  ok('목록에 hasPw 가 true 로 온다', !!(mine && mine.hasPw === true), mine && { hasPw: mine.hasPw });
  ok('비밀번호 값 자체는 안 나온다', !!mine && !JSON.stringify(mine).includes('pass1234'));

  r = await del(id, 'wrong999');
  ok('틀린 비밀번호로는 못 지운다', r.status === 403 && r.json && r.json.code === 'pw', r.json);

  let still = await jf('/builds');
  ok('틀린 뒤에도 구성이 그대로 있다',
    ((still.json && still.json.builds) || []).some(b => b.id === id));

  r = await del(id, 'pass1234');
  ok('맞는 비밀번호면 지워진다', r.status === 200 && r.json && r.json.ok, r.json);
  still = await jf('/builds');
  ok('목록에서 사라졌다', !((still.json && still.json.builds) || []).some(b => b.id === id));

  console.log('\n== 여러 번 틀리면 잠긴다 ==');
  await new Promise(s => setTimeout(s, 61_000));   // 1분에 한 건
  r = await put('lock1234');
  const id2 = r.json && r.json.id;
  ok('시험용 구성을 다시 올림', !!id2, r.json);
  if (id2) {
    let locked = null;
    for (let i = 0; i < 6; i++) {
      const x = await del(id2, 'nope' + i);
      if (x.status === 429) { locked = i; break; }
    }
    // 앞선 시험에서 이미 1번 틀렸으므로 5번째 안에 잠겨야 한다
    ok('다섯 번 안에 잠긴다 (429)', locked !== null, { locked });
    const x = await del(id2, 'lock1234');
    ok('잠긴 동안에는 맞는 비밀번호도 안 먹는다', x.status === 429, x.json);
  }

  console.log('\n== 관리자는 영향 없음 ==');
  // 관리자 비밀번호는 **쓰지 않는다** — 저장소에도 이 시험에도 들어가면 안 된다.
  // 로컬 dev 는 SIGN_KEY 시크릿이 비어 있으므로, 서버의 issueAdminToken 과 같은
  // 방식으로 토큰을 직접 만들어 관리자 갈래만 확인한다. 원격에는 통하지 않는다.
  {
    const token = await forgeAdminToken(process.env.SIGN_KEY || '');
    if (id2) {
      const x = await del(id2, null, token);
      ok('관리자는 비밀번호 없이 지운다', x.status === 200 && x.json && x.json.ok, x.json);
      // 관리자 삭제는 blocked 에 넣는다 — 같은 구성이 다시 올라오면 안 된다
      await new Promise(s => setTimeout(s, 61_000));
      // 같은 구성을 그대로 다시 올려 본다 — blocked 가 듣는지 보는 것이 목적이다
      const again = await put('lock1234', true);
      ok('관리자가 내린 구성은 다시 안 올라간다',
        [400, 403].includes(again.status) && again.json && ['dup', 'blocked'].includes(again.json.code), again.json);
    }
  }
  done();
})();

/** 서버의 issueAdminToken 과 같은 서명 — 로컬 dev 전용(시크릿이 빈 값일 때만 맞는다). */
async function forgeAdminToken(signKey) {
  const { createHmac } = await import('node:crypto');
  const exp = Date.now() + 60000;
  const sig = createHmac('sha256', signKey).update('admin:' + exp).digest('base64')
    .replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
  return exp + '.' + sig;
}

function done() {
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}

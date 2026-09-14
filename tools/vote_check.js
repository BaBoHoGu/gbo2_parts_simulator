// 투표 규칙을 **실제로 도는 서버**에 대고 검증한다 — 한도·토글·갈래 분리·기기 분리.
//
//   npx wrangler pages dev --port 8788 --local     ← 먼저 띄운다
//   node tools/vote_check.js                        ← 그다음 이것
//
// 규칙이 서버에만 있어서 코드를 읽어서는 맞는지 알 수 없다. 한도는 날짜·방향·갈래·기기가
// 얽혀 있어 특히 그렇다 — 방향을 바꿀 때 한도를 두 번 쓰는 실수를 여기서 잡았다.
// 로컬 D1 이 비어 있으면 구성이 없어 한도 시험을 못 하므로, 없으면 시험용 구성을 넣는다.
const API = process.env.VOTE_API || 'http://localhost:8788/api';
const DEV_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const DEV_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const post = (dev, body) => fetch(API + '/votes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-GBO2-Device': dev },
  body: JSON.stringify(body)
}).then(r => r.json());
const get = (dev, kind) => fetch(API + '/votes?kind=' + kind, {
  headers: { 'X-GBO2-Device': dev }
}).then(r => r.json());

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

(async () => {
  // 실제 구성 id 를 가져온다
  const bl = await fetch(API + '/builds').then(r => r.json());
  const ids = (bl.builds || []).map(b => b.id);
  console.log('구성 ' + ids.length + '개');
  if (ids.length < 5) { console.log('구성이 5개 미만이라 한도 시험을 다 못 합니다'); }

  console.log('\n== 기본 ==');
  let r = await post(DEV_A, { kind: 'build', target: ids[0], dir: 1 });
  ok('추천이 들어감', r.ok && r.totals[ids[0]] && r.totals[ids[0]][0] === 1, r);
  ok('내 표로 잡힘', r.mine[ids[0]] === 1, r.mine);
  ok('남은 추천 4', r.left.up === 4, r.left);

  console.log('\n== 토글 (같은 방향 다시) ==');
  r = await post(DEV_A, { kind: 'build', target: ids[0], dir: 1 });
  ok('표가 거둬짐', r.ok && !(r.totals[ids[0]] && r.totals[ids[0]][0]), r.totals);
  ok('한도가 되돌아옴', r.left.up === 5, r.left);

  console.log('\n== 방향 바꾸기 ==');
  await post(DEV_A, { kind: 'build', target: ids[0], dir: 1 });
  r = await post(DEV_A, { kind: 'build', target: ids[0], dir: -1 });
  ok('추천 0 · 비추 1', r.totals[ids[0]][0] === 0 && r.totals[ids[0]][1] === 1, r.totals);
  ok('추천 한도 되돌아오고 비추 하나 씀', r.left.up === 5 && r.left.down === 2, r.left);
  await post(DEV_A, { kind: 'build', target: ids[0], dir: 0 });   // 정리

  console.log('\n== 비추 한도 3 ==');
  for (let i = 0; i < Math.min(3, ids.length); i++) await post(DEV_A, { kind: 'build', target: ids[i], dir: -1 });
  r = await get(DEV_A, 'build');
  ok('비추 3개 쓰면 0 남음', r.left.down === 0, r.left);
  if (ids.length > 3) {
    r = await post(DEV_A, { kind: 'build', target: ids[3], dir: -1 });
    ok('4번째 비추는 거절', !r.ok && r.code === 'limit', r);
  }
  ok('추천은 아직 5 남음 (방향끼리 안 나눠 씀)', (await get(DEV_A, 'build')).left.up === 5);

  console.log('\n== 갈래 분리 (구성 vs 기체) ==');
  r = await post(DEV_A, { kind: 'ms', target: 'ガンダムEz8', dir: -1 });
  ok('기체 비추가 따로 들어감', r.ok && r.left.down === 2, r);
  ok('구성 쪽 비추는 그대로 0', (await get(DEV_A, 'build')).left.down === 0);

  console.log('\n== 기기 분리 ==');
  r = await get(DEV_B, 'build');
  ok('다른 기기는 한도가 가득', r.left.up === 5 && r.left.down === 3, r.left);
  ok('다른 기기에도 집계는 보임', Object.keys(r.totals).length > 0, r.totals);
  ok('다른 기기의 내 표는 비어 있음', Object.keys(r.mine).length === 0, r.mine);

  console.log('\n== 잘못된 입력 ==');
  ok('없는 구성 거절', !(await post(DEV_A, { kind: 'build', target: 'nope', dir: 1 })).ok);
  ok('모르는 기체 거절', !(await post(DEV_A, { kind: 'ms', target: 'ナイモノ', dir: 1 })).ok);
  ok('이상한 방향 거절', !(await post(DEV_A, { kind: 'build', target: ids[0], dir: 5 })).ok);
  ok('모르는 갈래 거절', !(await post(DEV_A, { kind: 'zzz', target: ids[0], dir: 1 })).ok);
  const noDev = await fetch(API + '/votes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'build', target: ids[0], dir: 1 })
  }).then(r => r.json());
  ok('기기 id 없으면 거절', !noDev.ok && noDev.code === 'dev', noDev);

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

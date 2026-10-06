// /api/videos 가 **걸러야 할 것을 거르고, 할당량을 지키는가**.
//   node tools/videos_api_check.js
/* D1 과 유튜브를 시늉으로 끼워 넣는다.
   배포 한 번이 비싸서가 아니라, 여기서 잡히는 버그를 거기서 잡으면 사용자가 먼저 본다.
   (시늉이 진짜 자료를 덮지 않게 — 아무것도 디스크에 쓰지 않는다) */
const path = require('path');
const ROOT = path.join(__dirname, '..').split(path.sep).join('/');
const u = p => 'file:///' + encodeURI(ROOT + '/' + p);

let pass = 0, fail = 0;
const ok = (l, g, x) => { console.log((g ? '  PASS ' : '  FAIL ') + l
  + (!g && x != null ? '  — ' + JSON.stringify(x) : '')); g ? pass++ : fail++; };

/** 아주 작은 D1 시늉 — 이 함수가 쓰는 네 가지 질의만 안다. */
function fakeDB() {
  const videos = new Map(), ytq = new Map();
  const prep = (sql) => ({
    bind(...a) { this.a = a; return this; },
    async first() {
      if (/FROM videos/.test(sql)) return videos.get(this.a[0]) || null;
      if (/FROM ytq/.test(sql)) { const n = ytq.get(this.a[0]); return n == null ? null : { n }; }
      return null;
    },
    async run() {
      if (/INSERT INTO ytq/.test(sql)) { const d = this.a[0]; ytq.set(d, (ytq.get(d) || 0) + 1); return; }
      if (/INSERT INTO videos/.test(sql)) {
        videos.set(this.a[0], { data: this.a[1], n: this.a[2], at: this.a[3] }); return;
      }
    },
    async all() { return { results: [] }; }
  });
  return { prepare: prep, async batch(xs) { for (const x of xs) await x.run(); },
           _videos: videos, _ytq: ytq };
}

/** 유튜브 시늉 — 실제로 샜던 제목들을 섞어 둔다. 걸러지는지 보려는 것이다. */
const SEARCH_ITEMS = [
  { id: 'aaa', title: '【バトオペ2】強化内容が"激アツ"過ぎる！！【ヘイズル・アウスラ】', ch: '小倉', views: 42700 },
  { id: 'bbb', title: '『バトオペ２』ヘイズルアウスラ！ヒートブレード強化でテイクダウンと火力の両立', ch: 'オンドレヤス', views: 93134 },
  // ↓ 아래 셋은 **들어오면 안 되는 것**이다
  { id: 'ccc', title: '【バトオペ２】射撃強化されたってことはそういうことゴリね？ヘイズル・アウスラ GAU【解説】', ch: 'トム肉', views: 11361 },
  { id: 'ddd', title: '【ガンプラ】ディテールはポイントを絞れ！【改造】MG ガンダムヘイズルアウスラ', ch: 'Chop', views: 12525 },
  { id: 'eee', title: '『バトオペ２』ドム！最古参機が超強化で', ch: 'x', views: 168356 }
];

function fakeFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes('/search?')) {
      return { ok: true, async json() { return { items: SEARCH_ITEMS.map(v => ({ id: { videoId: v.id } })) }; } };
    }
    return { ok: true, async json() {
      return { items: SEARCH_ITEMS.map(v => ({
        id: v.id,
        snippet: { title: v.title, channelTitle: v.ch, publishedAt: '2026-09-28T00:00:00Z' },
        statistics: { viewCount: String(v.views) },
        contentDetails: { duration: 'PT8M36S' } })) };
    } };
  };
}

const call = (mod, env, ms) =>
  mod.onRequestGet({ request: new Request('https://x/api/videos?ms=' + encodeURIComponent(ms)), env });

(async () => {
  const mod = await import(u('functions/api/videos.js'));
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = fakeFetch(calls);
  try {
    const env = { DB: fakeDB(), YT_API_KEY: 'dummy' };

    // ① 모르는 기체는 거절한다 (우리 키로 아무거나 검색하는 창구가 되면 안 된다)
    const r0 = await call(mod, env, '없는기체');
    ok('모르는 기체를 거절한다', r0.status === 400, { status: r0.status });
    ok('그때 유튜브를 부르지 않는다', calls.length === 0, { 부른횟수: calls.length });

    // ② 정상 — 거를 것은 걸러지는가
    const r1 = await call(mod, env, 'ヘイズル・アウスラ');
    const j1 = await r1.json();
    const ids = j1.videos.map(v => v.id);
    ok('영상을 돌려준다', j1.ok && j1.videos.length > 0, j1);
    ok('GAU 영상이 안 들어온다', !ids.includes('ccc'), ids);
    ok('건프라 영상이 안 들어온다', !ids.includes('ddd'), ids);
    ok('다른 기체(ドム) 영상이 안 들어온다', !ids.includes('eee'), ids);
    ok('조회수 많은 순이다', ids[0] === 'bbb', ids);
    ok('재생 시간을 읽는다', j1.videos[0].len === '8:36', j1.videos[0].len);
    ok('검색어에 게임 이름이 들어간다', calls[0].includes(encodeURIComponent('バトオペ2')), calls[0].slice(0, 90));
    ok('1년 이내로 묶는다', calls[0].includes('publishedAfter'), calls[0].slice(0, 90));
    ok('조회수 순으로 요청한다', calls[0].includes('order=viewCount'), calls[0].slice(0, 90));

    // ③ 두 번째는 캐시에서 — 유튜브를 다시 부르지 않아야 한다 (할당량이 걸린 문제다)
    const before = calls.length;
    const r2 = await call(mod, env, 'ヘイズル・アウスラ');
    const j2 = await r2.json();
    ok('두 번째는 유튜브를 다시 안 부른다', calls.length === before, { 추가호출: calls.length - before });
    ok('캐시임을 밝힌다', j2.cached === true, j2);

    // ④ LV 이 붙어도 같은 칸을 쓴다
    const before2 = calls.length;
    await call(mod, env, 'ヘイズル・アウスラ_LV2');
    ok('LV 을 떼고 같은 캐시를 쓴다', calls.length === before2, { 추가호출: calls.length - before2 });

    // ⑤ 영상이 0개인 기체도 적어 둔다 (안 적으면 열 때마다 할당량을 태운다)
    const r3 = await call(mod, env, 'ドム');     // 시늉 결과에 ドム 영상이 하나 있다
    const j3 = await r3.json();
    ok('ドム 칸에는 ドム 영상만', j3.videos.every(v => v.id === 'eee'), j3.videos.map(v => v.id));
    const before3 = calls.length;
    await call(mod, env, 'ドム');
    ok('0개든 아니든 두 번째는 캐시', calls.length === before3, { 추가호출: calls.length - before3 });

    // ⑥ 키가 없으면 꺼졌다고 답한다 (화면은 절을 숨긴다)
    const r4 = await call(mod, { DB: fakeDB() }, 'ドム');
    const j4 = await r4.json();
    ok('키가 없으면 off 로 답한다', j4.ok && j4.off === true && j4.videos.length === 0, j4);

    // ⑦ 하루 한도 — 넘으면 유튜브를 안 부르고 busy 로 답한다
    const env2 = { DB: fakeDB(), YT_API_KEY: 'dummy' };
    const day = Math.floor((Date.now() - 8 * 3600e3) / 86400e3);
    env2.DB._ytq.set(day, 999);
    const n0 = calls.length;
    const r5 = await call(mod, env2, 'ドム');
    const j5 = await r5.json();
    ok('한도를 넘으면 유튜브를 안 부른다', calls.length === n0, { 추가호출: calls.length - n0 });
    ok('그때 busy 로 답한다', j5.ok && j5.busy === true && j5.videos.length === 0, j5);

    // ⑧ 유튜브가 거절하면 이유를 남긴다 (키 틀림/제한/할당량이 서로 다른 일이다)
    globalThis.fetch = async () => ({ ok: false, status: 403,
      async text() { return '{"error":{"errors":[{"reason":"accessNotConfigured"}]}}'; } });
    const r6 = await call(mod, { DB: fakeDB(), YT_API_KEY: 'dummy' }, 'ドム');
    const j6 = await r6.json();
    ok('거절 이유를 그대로 남긴다', j6.err === 'accessNotConfigured', j6);
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

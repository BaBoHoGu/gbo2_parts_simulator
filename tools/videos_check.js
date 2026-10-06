// 추천 영상의 이름 자가 **실제로 오염을 막는가**.
//   node tools/videos_check.js
//
// 이 자는 조용히 샌다. 실제로 두 번 샜다:
//   · 「ヘイズル・アウスラ」 칸에 「ヘイズル・アウスラ GAU」 영상이 1위권으로 들어왔다
//     (자료는 ［GAU装備］인데 제목은 装備 를 흘린다).
//   · 같은 칸에 「【ガンプラ】…MG ガンダムヘイズルアウスラ」 건프라 영상이 들어왔다
//     (이름은 정확히 맞지만 게임 영상이 아니다).
// 둘 다 「그럴듯해서」 눈으로는 안 보인다. 그래서 **진짜로 샜던 제목을 심어** 걸리는지 본다.
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra != null ? '  — ' + JSON.stringify(extra, null, 1) : ''));
  good ? pass++ : fail++;
};

(async () => {
  const V = await import('file://' + path.join(ROOT, 'functions', 'lib', 'videos.js').replace(/\\/g, '/'));
  const { pickMs, isGameVideo, queryOf, aliasesOf, MS_BASE, filterFor } = V;

  /* ── 0. 자가 헛돌지 않는지 ───────────────────────────────────────────
     이름이 하나도 안 실려 있으면 아래 검사가 전부 「안 걸린다」로 통과해 버린다. */
  ok('기체 이름이 실려 있다', MS_BASE.size > 300, { 기체: MS_BASE.size });

  /* ── 1. 진짜로 샜던 제목들 ───────────────────────────────────────── */
  const LEAKED = [
    { why: 'GAU 변형이 본체 칸으로 샜다',
      title: '【バトオペ２】射撃強化されたってことはそういうことゴリね？ヘイズル・アウスラ GAU【解説】',
      notMs: 'ヘイズル・アウスラ', wantMs: 'ヘイズル・アウスラ［GAU装備］' },
    { why: 'GAU 변형(대괄호 그대로 적은 제목)',
      title: '『バトオペ２』ヘイズル・アウスラ[GAU装備]！これがサイコガンダムの力！',
      notMs: 'ヘイズル・アウスラ', wantMs: 'ヘイズル・アウスラ［GAU装備］' },
    { why: 'RFドム 가 ドム 칸으로 샜다 (제목은 전각 ＲＦ)',
      title: '『バトオペ２』ＲＦドム！新世代のドスコイリファイン親方',
      notMs: 'ドム', wantMs: 'RFドム' },
    { why: 'ドム・レゾナンス (제목은 중점을 흘린다)',
      title: '『バトオペ２』ドムレゾナンス！遂に強化！高コスト強襲機級の突破力',
      notMs: 'ドム', wantMs: 'ドム・レゾナンス【TB】' },
    { why: 'リック・ドムⅡ(GH) 가 ドム 칸으로',
      title: '「バトオペ2」オバチュ格闘LV2付き格闘補正115!リック・ドムⅡ（GH）LV4',
      notMs: 'ドム', wantMs: 'リック・ドムⅡ（GH）' },
    { why: 'νガンダム 가 ガンダム 칸으로',
      title: '『バトオペ２』νガンダム[DFF装備]！共振後のとんでもない火力',
      notMs: 'ガンダム', wantMs: 'νガンダム' },
    { why: '육전형 건담 WR 이 본체 칸으로',
      title: '「バトオペ2」継続的な高火力投射!陸戦型ガンダム［WR装備］LV5!',
      notMs: '陸戦型ガンダム', wantMs: '陸戦型ガンダム［WR装備］' }
  ];
  for (const c of LEAKED) {
    const got = pickMs(c.title);
    ok('안 샌다: ' + c.why, got !== c.notMs,
      { 제목: c.title.slice(0, 36), 뽑힌것: got, 샜던곳: c.notMs });
    // 「본체가 아니다」만으로는 약하다 — 엉뚱한 제3의 기체로 가도 통과해 버린다.
    if (MS_BASE.has(c.wantMs)) {
      ok('제 기체로 간다: ' + c.wantMs, got === c.wantMs, { 뽑힌것: got });
    } else {
      console.log('  (건너뜀) 자료에 없는 기체: ' + c.wantMs);
    }
  }

  /* ── 1-나. 배포하고 나서야 보인 두 가지 ──────────────────────────
     앞의 LEAKED 는 다 막았는데도 실제 화면에 이것들이 들어왔다.
     「상위 5개를 눈으로 본다」를 안 했으면 그대로 남았을 것이다. */
  {
    /* ① 자료에 변형만 있고 본체가 없는 집안. 「ガンダム試作2号機」는 ［BB仕様］·［MLRS］
       둘로만 있어서 그 이름을 아무도 못 가져갔고, 그 틈으로 더 짧은 「ガンダム」가 이겼다. */
    const t = '『バトオペ２』ガンダム試作２号機！待ちに待った時が来た二段階チャージビームバズーカの広範囲爆風';
    ok('변형만 있는 집안이 짧은 이름으로 안 샌다', pickMs(t) !== 'ガンダム', { 뽑힌것: pickMs(t) });
    ok('그 영상은 어느 칸에도 안 들어간다', filterFor('ガンダム', [{ title: t, ch: 'バトオペ2' }]).length === 0);

    /* ② 꼬리 해시태그는 뭉뚱그린 말이 많다. 전 기체 이야기 영상이 「#ガンダム」 하나로
       초대 건담 칸에 들어왔다. */
    const h = '【バトオペ2】実装機の残弾、そろそろヤバい説【ゲコ動画】#機動戦士ガンダムバトルオペレーション2 #ゆっくり実況 #ガンダム';
    ok('꼬리 해시태그만으로는 그 기체로 치지 않는다', pickMs(h) !== 'ガンダム', { 뽑힌것: pickMs(h) });

    /* 거꾸로 — 본문(괄호 안)에 적힌 이름은 그대로 잡혀야 한다. 태그를 지운다고
       멀쩡한 것까지 놓치면 칸이 통째로 빈다. */
    const g = 'MS界の大谷翔平　【陸戦型ガンダム】#gbo2 #切り抜き #バトオペ2';
    ok('본문에 적힌 이름은 그대로 잡는다', pickMs(g) === '陸戦型ガンダム', { 뽑힌것: pickMs(g) });
    ok('태그를 지워도 게임 영상인 것은 안다', isGameVideo(g, ''));
  }

  /* ── 2. 게임 영상이 아닌 것 ──────────────────────────────────────── */
  const NOT_GAME = [
    '【ガンプラ】ディテールはポイントを絞れ！【改造】MG ガンダムヘイズルアウスラ',
    'ガンプラ製作 HG ドム 筆塗り全塗装'
  ];
  for (const t of NOT_GAME) {
    ok('게임 영상이 아니다: ' + t.slice(0, 24), !isGameVideo(t, ''), { 제목: t });
  }
  // 거꾸로 — 진짜 게임 영상을 게임이 아니라고 하면 칸이 통째로 빈다
  const GAME = [
    '【バトオペ2】強化内容が"激アツ"過ぎる！！【ヘイズル・アウスラ】',
    '『バトオペ２』ドム！最古参機が超強化で頼れるハイスペック前線汎用機に',
    '450に参戦した異常火力なアッガイ索敵型Lv4で与ダメ17万超え!?【バトオペ2実況】'
  ];
  for (const t of GAME) {
    ok('게임 영상이 맞다: ' + t.slice(0, 24), isGameVideo(t, ''), { 제목: t });
  }

  /* ── 3. 검색어 ──────────────────────────────────────────────────── */
  ok('괄호를 펴고 끝말을 뗀다', queryOf('ヘイズル・アウスラ［GAU装備］') === 'ヘイズル・アウスラ GAU',
    { 나온것: queryOf('ヘイズル・アウスラ［GAU装備］') });
  /* 괄호가 없는 이름의 型 까지 떼면 「ザクⅡFS」가 돼 본체에 묻힌다 — 24건 났던 자리다. */
  ok('괄호 없는 이름의 끝말은 안 뗀다', queryOf('ザクⅡFS型') === 'ザクⅡFS型',
    { 나온것: queryOf('ザクⅡFS型') });

  /* ── 4. 모든 기체가 제 이름으로 자기를 찾는가 ────────────────────
     제목을 지어서 재는 거라 약한 검사다(내가 만든 글자로 내 규칙을 잰다). 그래도
     ③ 처럼 **변형이 본체로 묻히는** 꼴은 여기서 걸린다 — 실제로 24건을 여기서 잡았다. */
  const miss = [];
  for (const n of MS_BASE) {
    for (const form of [n, queryOf(n)]) {
      const got = pickMs('【バトオペ2】' + form + 'が強すぎる');
      if (got !== n) miss.push({ 기체: n, 적은꼴: form, 뽑힌것: got });
    }
  }
  ok('제 이름을 적으면 자기가 뽑힌다 (전 기체)', miss.length === 0, miss.slice(0, 10));

  /* ── 5. 별명이 겹치는 기체가 없는가 ──────────────────────────────
     두 기체가 같은 별명을 쓰면 **가를 방법이 없다.** 새 기체가 들어와 겹치면 여기서 운다. */
  const seen = new Map(), clash = [];
  for (const n of MS_BASE) for (const a of aliasesOf(n)) {
    if (seen.has(a) && seen.get(a) !== n) clash.push({ 별명: a, 기체: [seen.get(a), n] });
    else seen.set(a, n);
  }
  ok('두 기체가 같은 별명을 쓰지 않는다', clash.length === 0, clash.slice(0, 10));

  /* ── 6. 비어 있을 때 본체로 채우지 않는가 (사용자 결정 A) ──────── */
  /* 조회수·길이를 채워 둔다 — 이 검사가 보려는 것은 **이름 가리기**지 쓸모 규칙이 아니다.
     값을 비워 두면 규칙에 걸려 「A안이 동작한다」가 거짓으로 통과한다(실제로 그랬다). */
  const wrOnly = [
    { title: '「バトオペ2」継続的な高火力投射!陸戦型ガンダム［WR装備］LV5!', ch: 'x', views: 9000, sec: 500 },
    { title: '【バトオペ２】即ヨロケの数だけで何とかするWR軍団 陸戦型ガンダムWR', ch: 'x', views: 9000, sec: 500 }
  ];
  ok('본체 칸은 변형 영상으로 채우지 않는다 (A안)',
    filterFor('陸戦型ガンダム', wrOnly).length === 0,
    filterFor('陸戦型ガンダム', wrOnly).map(v => v.title));
  ok('변형 칸에는 제 영상이 들어온다',
    filterFor('陸戦型ガンダム［WR装備］', wrOnly).length === 2,
    filterFor('陸戦型ガンダム［WR装備］', wrOnly).map(v => v.title));

  /* ── 7. 쓸모 규칙 (사용자 결정: 최소 1,000회 · 3분 하한 · 쇼츠 제외 · 채널 제외) ──
     실제로 도무 칸 3위가 「ギードムくんの日常(スパガン編) #shorts」 였다 — 1분짜리
     개그 쇼츠인데 1.8만회라 조회수만 보면 올라온다. */
  {
    const { RULES, whyBlocked } = V;
    ok('규칙 값이 정한 대로다', RULES.minViews === 1000 && RULES.minSec === 180 && RULES.dropShorts === true,
      { minViews: RULES.minViews, minSec: RULES.minSec, dropShorts: RULES.dropShorts });

    const good = { title: '【バトオペ2】ドム解説', ch: 'x', views: 20000, sec: 500 };
    ok('멀쩡한 것은 통과한다', whyBlocked(good) === null, whyBlocked(good));

    ok('#shorts 는 길이와 무관하게 뺀다',
      whyBlocked({ ...good, title: '【バトオペ2】ギードムくんの日常(スパガン編) #shorts', sec: 400 }) === 'shorts');
    ok('조회수가 모자라면 뺀다', whyBlocked({ ...good, views: 999 }) === 'views');
    ok('조회수가 딱 기준이면 넣는다', whyBlocked({ ...good, views: 1000 }) === null);
    ok('3분 미만은 뺀다', whyBlocked({ ...good, sec: 179 }) === 'short');
    ok('3분이면 넣는다', whyBlocked({ ...good, sec: 180 }) === null);

    /* 길이를 모르는 영상(라이브 등)은 **빼지 않는다.** 모른다고 버리면 멀쩡한 것을 잃는다. */
    ok('길이를 모르면 길이로 빼지 않는다', whyBlocked({ ...good, sec: 0 }) === null);

    /* 채널 제외 — 지금 목록은 비어 있다. 비었다고 검사까지 비우면,
       나중에 채널을 적었을 때 동작하는지 아무도 모른다. 값을 넣어 본다. */
    ok('채널 목록이 비어 있으면 아무도 안 막는다', whyBlocked(good, { blockChannels: [] }) === null);
    ok('적어 둔 채널은 막는다', whyBlocked(good, { blockChannels: ['X'] }) === 'channel');
    ok('채널 비교는 대소문자·공백을 안 따진다',
      whyBlocked({ ...good, ch: '  오구라 / Kokura ' }, { blockChannels: ['오구라 / kokura'] }) === 'channel');

    // 거르기가 실제로 목록에서 빠지는가 (규칙만 통과하고 목록엔 남는 일이 없게)
    const mixed = [good, { ...good, title: '【バトオペ2】ドム #shorts' }, { ...good, views: 10 }];
    ok('filterFor 가 규칙까지 건다', filterFor('ドム', mixed).length === 1,
      filterFor('ドム', mixed).map(v => v.title));
  }

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

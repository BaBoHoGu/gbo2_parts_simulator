// 게임 패치노트 — 파서·자료·화면을 잰다.
//   node tools/patchnote_check.js
//
// 왜 — 공식 공지 HTML 은 흠이 많다(닫는 </td> 누락, 여는 <tr> 누락, 배치 두 가지,
// 「<변형 시>」처럼 태그가 아닌 <...>, 마커가 機目/기目 로 갈림). 옆 프로젝트 BP 의
// parser.py 가 그걸 다 밟아 봤기에 옮겨 왔다 — **옮긴 값은 그 흠 목록이다.**
// 그래서 여기서는 흠마다 작은 HTML 을 지어 넣고 파서가 견디는지 본다.
// 회귀가 나면 화면은 멀쩡히 뜨고 **내용만 조용히 빈다** — 그래서 재야 한다.
//
// 화면 쪽은 「고른 날짜 칸이 크다」·「레일이 미끄러진다」·「기체를 누르면 내역이 나온다」를
// **눈금으로** 잰다. 낱말이 있는지 보는 검사는 아무것도 지키지 못한다(이 저장소에서 데였다).
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'tools', 'lib', 'patchnote_parse.js'));
const FILL = require(path.join(ROOT, 'tools', 'lib', 'patchnote_fill.js'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* ── ① 파서가 공식 HTML 의 흠을 견디는가 ─────────────────────────── */
/* 실물 그대로의 마커 꼴. 처음에 「<!-- ▼▼▼1機目▼▼▼ -->」로 짧게 지어 넣었더니
   파서가 하나도 못 읽어 자가 전부 울었다 — **가짜 자료가 틀린 것이었다.**
   실제 공지는 대시가 수십 개이고, 대시와 ▼ 사이가 **전각 공백(U+3000)** 이다.
   자의 자료가 실물과 다르면, 자는 멀쩡한 파서를 틀렸다고 하거나(이번) 반대로
   실물에서만 깨지는 흠을 못 본다. 그래서 받은 공지에서 그대로 베꼈다. */
const DASH = '-'.repeat(41);
const IDSP = '　';
const mk = (n, kanji) => '<!--' + DASH + IDSP + '▼▼▼▼▼' + n + kanji + '目▼▼▼▼▼' + IDSP + DASH + '->';
const marker = n => mk(n, '機');
const markerKo = n => mk(n, '기');

{
  // 결합형 — 한 table 에 thead(헤더)+tbody(내용). 닫는 </td> 를 일부러 뺀다.
  const html = marker(1)
    + '<table><thead><tr><th>실루엣 건담 개량형</th></tr></thead><tbody>'
    + '<tr><td>기체 성능</td><td>・기체 HP 「21000」→「24000」으로 상승</td></tr>'
    + '<tr><td>사격 주무장<td>헤비 머신건<td>【통상 사격】<br>・히트율 「9%」→「8%」로 경감'
    + '</tbody></table>';
  const u = P.parseNotice(html);
  ok('결합형 + 닫는 </td> 누락을 읽는다', u.length === 1 && u[0].sections[0].rows.length === 2,
    u.length ? u[0].sections[0].rows : u);
  const r = u[0] && u[0].sections[0].rows[1];
  ok('3칸 행을 [카테고리·무장·내용] 으로 가른다',
    !!r && r.category === '사격 주무장' && r.weapon === '헤비 머신건' && r.changes.length === 2, r);
  ok('<br> 로 줄을 가른다', !!r && r.changes[0] === '【통상 사격】', r && r.changes);
}

{
  // 분리형 — 헤더만 있는 표 다음에 내용만 있는 표. 라벨 행과 내용 행이 따로 온다.
  const html = marker(1)
    + '<table><thead><tr><th>베르가 기로스</th></tr></thead></table>'
    + '<table><tbody>'
    + '<tr><td>부무장</td><td>샷 랜서</td></tr>'
    + '<tr><td colspan="3">・쿨타임 「4.0」→「3.5」로 단축</td></tr>'
    + '</tbody></table>';
  const u = P.parseNotice(html);
  ok('분리형(헤더 표 + 내용 표)을 읽는다', u.length === 1 && u[0].sections.length === 1, u);
  const r = u[0] && u[0].sections[0].rows[0];
  ok('직전 라벨 행을 내용 행에 이어 붙인다',
    !!r && r.category === '부무장' && r.weapon === '샷 랜서', r);
}

{
  // 여는 <tr> 가 빠진 행 — </tr> 로 쪼개야 살아난다.
  const html = marker(1)
    + '<table><thead><tr><th>드라이센</th></tr></thead><tbody>'
    + '<tr><td>기체 성능</td><td>・스러스터 「75」→「80」으로 상승</td></tr>'
    + '<td>부무장</td><td>발칸포</td></tr>'
    + '<td colspan="3">・탄 수 「60」→「80」으로 증가</td></tr>'
    + '</tbody></table>';
  const u = P.parseNotice(html);
  ok('여는 <tr> 가 빠진 행도 읽는다', u.length === 1 && u[0].sections[0].rows.length === 2,
    u.length ? u[0].sections[0].rows.map(r => r.category) : u);
}

{
  // 「<변형 시>」는 태그가 아니라 본문이다 — 지우면 어느 모드의 값인지 사라진다.
  const html = marker(1)
    + '<table><thead><tr><th>제타 건담 &lt;변형 시&gt;</th></tr></thead><tbody>'
    + '<tr><td>기체 성능</td><td>・<변형 시> 스피드 「130」→「140」으로 상승</td></tr>'
    + '</tbody></table>';
  const u = P.parseNotice(html);
  const line = u[0] && u[0].sections[0].rows[0].changes[0];
  ok('태그가 아닌 <...> 를 본문으로 남긴다', !!line && line.includes('<변형 시>'), line);
}

{
  // 마커가 「N기目」(2026.09 부터 반쯤 한글화)로 와도 갈라야 한다.
  const body = '<table><thead><tr><th>갼 개량형</th></tr></thead><tbody>'
    + '<tr><td>기체 성능</td><td>・선회 「75」→「78」로 상승</td></tr></tbody></table>';
  ok('「N機目」 마커를 읽는다', P.parseNotice(marker(1) + body).length === 1);
  ok('「N기目」 마커도 읽는다 (2026.09 부터)', P.parseNotice(markerKo(1) + body).length === 1);
  ok('마커가 없으면 패치노트가 아니라고 본다', P.looksLikePatchnote(body) === false);
}

{
  // 참조데이터(COST·승률)는 버리고, 조정 의도는 **담는다.**
  const html = marker(1)
    + '<table><thead><tr><th>갼 개량형</th></tr></thead><tbody>'
    + '<tr><td>기체 성능</td><td>・선회 「75」→「78」로 상승</td></tr></tbody></table>'
    + '<table><tbody><tr><td>조정 의도</td></tr>'
    + '<tr><td>・승률이 평균을 밑돌아 강화했습니다.</td></tr></tbody></table>'
    + '<table><tbody><tr><td>참조데이터</td><td>COST</td><td>승률</td></tr>'
    + '<tr><td>750</td><td>47.8</td><td>→ 48.0</td></tr></tbody></table>';
  const u = P.parseNotice(html);
  ok('참조데이터(COST) 표는 본문에 섞이지 않는다', u[0].sections.length === 1,
    u[0].sections.map(s => s.header));
  ok('조정 의도를 따로 담는다',
    u[0].intent.length === 1 && u[0].intent[0].includes('승률'), u[0].intent);
}

{
  // 서브섹션(변형·변신) — 첫 섹션이 메인, 나머지가 서브.
  const html = marker(1)
    + '<table><thead><tr><th>제타 건담</th></tr></thead><tbody>'
    + '<tr><td>기체 성능</td><td>・HP 「18000」→「19000」으로 상승</td></tr></tbody></table>'
    + '<table><thead><tr><th>&lt;웨이브 라이더 변형 시&gt;</th></tr></thead><tbody>'
    + '<tr><td>기체 성능</td><td>・스피드 「210」→「220」으로 상승</td></tr></tbody></table>';
  const u = P.parseNotice(html);
  ok('변형 서브섹션을 같은 기체로 묶는다', u.length === 1 && u[0].sections.length === 2,
    u.map(x => x.sections.length));
  ok('첫 섹션만 메인이다',
    u[0].sections[0].isSub === false && u[0].sections[1].isSub === true,
    u[0].sections.map(s => s.isSub));
}

/* ── ② 쌓인 자료가 멀쩡한가 ──────────────────────────────────────── */
const DATA = path.join(ROOT, 'data', 'patchnotes.json');
if (!fs.existsSync(DATA)) {
  console.log('  (건너뜀) data/patchnotes.json 이 없다 — node tools/extract_patchnotes.js 먼저');
} else {
  const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const ps = d.patches || [];
  ok('패치가 하나 이상 있다', ps.length > 0, { 패치: ps.length });
  ok('최신이 먼저다 (화면이 첫 칸을 기본으로 고른다)',
    ps.every((p, i) => i === 0 || ps[i - 1].date >= p.date), ps.map(p => p.date));
  ok('날짜 꼴이 YYYY-MM-DD 다', ps.every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date)),
    ps.map(p => p.date).filter(x => !/^\d{4}-\d{2}-\d{2}$/.test(x)));

  const ads = ps.flatMap(p => p.adjusted || []);
  /* ③ 사용자가 정한 시작일(2026-08-27)보다 앞선 칸은 없어야 한다.
     옛 칸을 안 자르면 레일만 길어지고, 그 시절 추가 기체 기록은 우리에게 없어 반쪽이 된다. */
  ok('2026-08-27 보다 앞선 날짜가 없다', ps.every(p => p.date >= '2026-08-27'),
    ps.filter(p => p.date < '2026-08-27').map(p => p.date));

  ok('조정 기체가 있다', ads.length > 0, { 기체: ads.length });
  /* 내용이 빈 기체가 섞이면 「눌렀는데 아무것도 안 나오는」 카드가 된다. */
  const empty = ads.filter(a => !(a.sections || []).some(s => (s.rows || []).length));
  ok('모든 조정 기체에 변경 내역이 있다', empty.length === 0, empty.map(a => a.ko).slice(0, 8));
  /* 이름이 안 붙은 기체는 이미지도 못 띄우고 우리 기체로 이어지지도 않는다. */
  const noMs = ads.filter(a => !a.ms);
  ok('모든 조정 기체가 우리 기체와 이어졌다', noMs.length === 0, noMs.map(a => a.ko).slice(0, 8));

  const msAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
  const stems = new Set(msAll.map(m => String(m['MS名']).replace(/_LV\d+$/, '')));
  const ghost = ads.filter(a => a.ms && !stems.has(a.ms));
  ok('이어진 이름이 실제 기체다', ghost.length === 0, ghost.map(a => a.ms).slice(0, 8));
  const ghostAdd = ps.flatMap(p => p.added || []).filter(a => !stems.has(a.ms));
  ok('추가 기체도 실제 기체다', ghostAdd.length === 0, ghostAdd.map(a => a.ms).slice(0, 8));

  /* 지어낸 말이 섞이지 않았는가 — 공식은 「」 로 값을 감싼다. 한 줄이라도 있어야 한다. */
  const withNum = ads.filter(a => (a.sections || []).some(s => (s.rows || [])
    .some(r => (r.changes || []).some(c => /「[^」]*」→「[^」]*」/.test(c)))));
  ok('공식 수치 표기(「A」→「B」)가 살아 있다', withNum.length > ads.length * 0.5,
    { 수치있는기체: withNum.length, 전체: ads.length });

  /* 추가 기체가 그 주기 안의 날짜인가 — 주기를 잘못 담으면 다른 패치에 뜬다. */
  const dates = ps.map(p => p.date).sort();
  let outside = [];
  for (const p of ps) {
    const i = dates.indexOf(p.date);
    const to = dates[i + 1] || '9999-99-99';
    for (const a of p.added || []) if (!(a.at >= p.date && a.at < to)) outside.push(p.date + '/' + a.ms + '@' + a.at);
  }
  ok('추가 기체가 제 패치 주기 안에 있다', outside.length === 0, outside.slice(0, 6));

  /* ② 주간으로 갈렸는가. 게임은 **목요일**에 갱신한다 — 날짜가 요일에 흩어져 있으면
     우리 기록(업데이트를 돌린 날)을 그대로 쓴 것이다. 그러면 같은 주 추가가 여러 칸으로 갈린다. */
  {
    const dow = d => new Date(d + 'T00:00:00+09:00').getDay();
    const thu = ps.filter(p => dow(p.date) === 4).length;
    ok('날짜 칸이 거의 다 목요일이다 (게임 갱신 요일)', thu >= ps.length - 1,
      { 목요일: thu, 전체: ps.length, 아닌것: ps.filter(p => dow(p.date) !== 4).map(p => p.date) });
    ok('조정만 있는 주와 추가만 있는 주가 둘 다 있다',
      ps.some(p => (p.adjusted || []).length && !(p.added || []).length) ||
      ps.some(p => !(p.adjusted || []).length && (p.added || []).length),
      ps.map(p => p.date + ':' + p.kind));
    ok('칸마다 갈래가 적혀 있다', ps.every(p => ['balance', 'add', 'both'].includes(p.kind)),
      ps.filter(p => !['balance', 'add', 'both'].includes(p.kind)).map(p => p.date + ':' + p.kind));
    /* 추가 기체 날짜는 **위키에서 고친 것**이 대부분이어야 한다. 전부 우리 기록이면
       위키 조회가 통째로 안 돌고 있다는 뜻인데, 겉으로는 날짜가 그럴싸해 안 보인다. */
    const adds = ps.flatMap(p => p.added || []);
    const fromWiki = adds.filter(a => a.날짜출처 === '위키').length;
    ok('추가 기체 날짜가 대부분 위키에서 왔다', adds.length > 0 && fromWiki > adds.length * 0.6,
      { 위키: fromWiki, 전체: adds.length });
    ok('추가 기체가 제 날짜 칸에 담겼다',
      ps.every(p => (p.added || []).every(a => a.at === p.date)),
      ps.flatMap(p => (p.added || []).filter(a => a.at !== p.date).map(a => p.date + '/' + a.ms + '@' + a.at)).slice(0, 6));
    /* **공식과 맞대 본 자리.** 2026-10-08 공지에 있는 신규 기체는 캐논 건담뿐이다
       (사용자가 짚어 공식에서 확인했다). 가브스레이 LV4 는 2026-07-09(DP 교환),
       데스티니 건담 LV2 는 2026-08-20(STEAM판)에 들어왔는데, 우리 미러가 10-08 에야
       보는 바람에 둘 다 10-08 추가로 적혀 있었다. 날짜 창을 좁히면 그대로 되돌아간다. */
    const oct8 = ps.find(p => p.date === '2026-10-08');
    if (oct8) {
      const names = (oct8.added || []).map(a => a.ms);
      ok('2026-10-08 추가 기체는 캐논 건담뿐이다 (공식과 같다)',
        names.length === 1 && names[0] === 'キャノンガンダム', names);
    }
    ok('가브스레이·데스티니는 10-08 추가가 아니다',
      !ps.some(p => p.date === '2026-10-08'
        && (p.added || []).some(a => a.ms === 'ガブスレイ' || a.ms === 'デスティニーガンダム')),
      (ps.find(p => p.date === '2026-10-08') || {}).added);
  }

  /* ③ 위키 상세 수치 — 공식이 생략한 값을 채운다. */
  {
    const withWiki = ads.filter(a => (a.wiki || []).length);
    ok('조정 기체에 위키 상세 수치가 붙었다', withWiki.length === ads.length,
      { 붙은것: withWiki.length, 전체: ads.length,
        빠진것: ads.filter(a => !(a.wiki || []).length).map(a => a.ko).slice(0, 6) });
    /* 수치가 **실제로** 들어 있는가 — 줄만 있고 숫자가 없으면 값이 없는 것이다. */
    const num = withWiki.filter(a => a.wiki.some(w => /\d+\s*→\s*\d+/.test(w.text)));
    ok('위키 줄에 「A → B」 수치가 있다', num.length > ads.length * 0.8,
      { 수치있는기체: num.length, 전체: ads.length });
    /* LV 별로 적혀 있는가 — 공식은 대표값 하나뿐이라 이게 위키를 쓰는 이유다. */
    const lv = withWiki.filter(a => a.wiki.some(w => /[Ll][Vv]\d.*[Ll][Vv]\d/.test(w.text)));
    ok('LV 별 수치가 들어 있다 (공식은 대표값 하나뿐)', lv.length > 0,
      { LV별: lv.length });
    ok('올림·내림 표식이 들어 있다', withWiki.some(a => a.wiki.some(w => w.buff === true)));
  }

  /* ④ 참조 데이터 — 「조정 후」는 한 달 뒤에 덧붙는다. */
  {
    const withRef = ads.filter(a => a.ref && (a.ref.rows || []).length);
    ok('조정 기체에 참조 데이터가 붙었다', withRef.length === ads.length,
      { 붙은것: withRef.length, 전체: ads.length });
    ok('참조 데이터에 칸 이름이 있다',
      withRef.every(a => (a.ref.cols || []).length >= 3),
      withRef.filter(a => (a.ref.cols || []).length < 3).map(a => a.ko).slice(0, 5));
    const after = withRef.filter(a => a.ref.rows.some(r => /조정\s*후/.test(r.label)));
    ok('지난 패치들에는 「조정 후」 전적이 들어왔다', after.length > 0, { 조정후있음: after.length });
    /* 가장 최근 패치는 아직 결과가 없어야 정상이다 — 있으면 날짜를 잘못 읽은 것이다. */
    const newest = ps.find(p => (p.adjusted || []).length);
    const newestAfter = (newest.adjusted || []).filter(a => a.ref && a.ref.rows.some(r => /조정\s*후/.test(r.label))).length;
    ok('가장 최근 조정 패치에는 아직 「조정 후」가 없다 (한 달 뒤에 붙는다)',
      newestAfter === 0, { 날짜: newest.date, 조정후있음: newestAfter });
    ok('「–」 같은 빈 칸은 걸러졌다',
      withRef.every(a => !(a.ref.cols || []).some(c => /^[–\-—]$/.test(c))),
      withRef.filter(a => (a.ref.cols || []).some(c => /^[–\-—]$/.test(c))).map(a => a.ko).slice(0, 5));
  }

  /* ⑤ 공식이 생략한 수치를 위키에서 채웠는가. */
  {
    let tried = 0, filled = 0, bad = [];
    for (const a of ads) for (const sec of a.sections || []) for (const row of sec.rows || []) {
      (row.changes || []).forEach((line, i) => {
        const f = row.fill && row.fill[i];
        if (/^[【[]/.test(line)) {
          if (f) bad.push('소제목에 값을 붙였다: ' + line);
          return;
        }
        if (FILL.HAS_NUM.test(line)) {
          /* 공식이 이미 적은 줄에 **배지**를 또 붙이면 두 수치가 싸운다 — 그건 막는다.
             다만 「(더불어 상위 LV도 상승)」 줄의 **LV 쪼개기**는 공식이 안 적은 것이라 허용한다. */
          if (f && f.from) bad.push('공식이 이미 적은 줄에 또 붙였다: ' + line);
          if (f && f.lv && !/상위\s*LV/.test(line)) bad.push('상위 LV 줄이 아닌데 LV 를 붙였다: ' + line);
          return;
        }
        if (!FILL.keyOf(line)) { if (f) bad.push('항목어가 없는 줄에 붙였다: ' + line); return; }
        /* 수치 줄이 아닌 것(「~할 수 있게 변경」·「스킬 … 추가」)은 시도로 세지 않는다. */
        if (/(?:할 수 있게|할 수 있도록|가능하게|대응)\s*변경$|(?:추가|삭제|통합|변경)$/.test(line.trim())) {
          if (f && f.from) bad.push('수치 줄이 아닌데 붙였다: ' + line);
          return;
        }
        tried++;
        if (f && f.from) {
          filled++;
          if (!/\d/.test(f.from) || !/\d/.test(f.to)) bad.push('숫자가 아닌 값: ' + line + ' [' + f.from + '→' + f.to + ']');
        }
      });
    }
    ok('공식이 생략한 수치를 위키에서 채운다', filled > 0, { 채움: filled, 시도: tried });
    ok('채운 비율이 60% 이상이다', tried > 0 && filled / tried >= 0.6,
      { 비율: (filled / tried * 100).toFixed(1) + '%', 채움: filled, 시도: tried });
    ok('엉뚱한 자리에 붙이지 않았다', bad.length === 0, bad.slice(0, 5));

    /* 「(더불어 상위 LV도 상승)」 줄 — 공식은 대표 LV 하나만 적는다.
       위키가 적어 둔 LV 별 수치를 그 줄에 달아야 한다(사용자 지시). */
    let lvLines = 0, lvWant = 0;
    const lvBad = [];
    for (const a2 of ads) for (const sec of a2.sections || []) for (const row of sec.rows || []) {
      (row.changes || []).forEach((line, i2) => {
        if (!/상위\s*LV/.test(line)) return;
        lvWant++;
        const f = row.fill && row.fill[i2];
        if (!f || !f.lv) return;
        lvLines++;
        if (f.lv.length < 2) lvBad.push("LV 가 하나뿐인데 붙였다: " + line);
        if (f.lv.some(x => !/\d/.test(x.from) || !/\d/.test(x.to)))
          lvBad.push("숫자가 아닌 LV 값: " + line);
      });
    }
    ok("「상위 LV」 줄에 LV 별 수치를 단다", lvWant > 0 && lvLines > lvWant * 0.5,
      { 붙은줄: lvLines, 상위LV줄: lvWant });
    ok("LV 값이 둘 이상이고 숫자다", lvBad.length === 0, lvBad.slice(0, 4));

    /* **틀린 채움 하나를 못 박는다.** 위키가 「集束：9%→8%　集束：80%→70%」처럼
       모드 표시를 두 번 같게 적은 자료가 있다. 그대로 쓰면 집속 줄에 통상 값이 붙는다
       — 화면에서 눈으로 잡았다. 다시 들어오면 여기서 운다. */
    const sg = ads.find(a => /실루엣 건담 개량형/.test(a.ko));
    if (sg) {
      let focusHeat = null;
      for (const sec of sg.sections || []) for (const row of sec.rows || []) {
        if (!/헤비 머신건/.test(row.weapon || '')) continue;
        let mode = null;
        (row.changes || []).forEach((line, i) => {
          if (/^[【[]/.test(line)) { mode = /집속/.test(line) ? '집속' : '통상'; return; }
          if (mode === '집속' && /히트율/.test(line)) focusHeat = (row.fill && row.fill[i]) || false;
        });
      }
      ok('모드 표시가 어긋난 위키 값은 안 쓴다 (집속 히트율)', focusHeat === false || focusHeat === null,
        { 붙은값: focusHeat });
    }

    /* **값이 맞는 자리에 붙었는가.** 비율만 재면 무장을 잘못 짚어도 비율은 오히려 오른다
       — 실제로 무장 맞춤을 꺼서 심었더니 자가 안 울었다. 아는 값 몇 개를 못 박는다.
       지난 패치 기록은 더 안 바뀌므로(쌓아 두는 자료다) 이 값들은 늙지 않는다. */
    const anchors = [
      ['실루엣 건담 개량형', '헤비 머신건', '위력 상승', '3000', '3200'],
      ['실루엣 건담 개량형', '헤비 머신건', '비틀거림 축적치 상승', '40%', '80%'],
      ['실루엣 건담 개량형', '베스바', '연사 속도 상승', '225발/분', '240발/분'],
      /* 위키가 라벨을 줄여 적는 자리 — 「下格補正上昇」(闘 가 빠진다).
         대응표에 온전한 꼴만 두면 이 줄이 영영 안 붙는다(끄고 켜서 재 보니 1줄 차이). */
      ['유니콘 건담[각성]', '타격', '하격투 보정 상승', '300%（100%x3）', '360%(120%x3)']
    ];
    for (const [msKo, weap, line, from, to] of anchors) {
      let got = null;
      const m = ads.find(x => x.ko === msKo);
      for (const sec of (m && m.sections) || []) for (const row of sec.rows || []) {
        if (!(row.weapon || '').includes(weap)) continue;
        (row.changes || []).forEach((ln, k) => {
          if (ln.includes(line) && row.fill && row.fill[k]) got = row.fill[k];
        });
      }
      ok('아는 값이 제자리에 붙는다 — ' + weap + ' / ' + line,
        !!got && got.from === from && got.to === to, { 붙은값: got, 있어야할값: from + '→' + to });
    }
  }

  /* ⑤-2 값 고르기 규칙 — 밟았던 함정을 작은 자료로 다시 밟아 본다. */
  {
    ok('「Lv1：」 앞머리를 떼고 대표 수치쌍을 뽑는다',
      JSON.stringify(FILL.firstPair('Lv1：200 → 230 Lv2：250 → 280')) === '["200","230"]',
      FILL.firstPair('Lv1：200 → 230 Lv2：250 → 280'));
    ok('「※…」 꼬리는 값에서 뗀다',
      JSON.stringify(FILL.firstPair('40% → 80% ※非集束時は調整無し')) === '["40%","80%"]',
      FILL.firstPair('40% → 80% ※非集束時は調整無し'));
    ok('집속 구간만 골라 뽑는다',
      JSON.stringify(FILL.pickPair('非集束：20% → 25% 集束：50% → 65%', '集束')) === '["50%","65%"]',
      FILL.pickPair('非集束：20% → 25% 集束：50% → 65%', '集束'));
    ok('통상 구간만 골라 뽑는다',
      JSON.stringify(FILL.pickPair('非集束：20% → 25% 集束：50% → 65%', '非集束')) === '["20%","25%"]',
      FILL.pickPair('非集束：20% → 25% 集束：50% → 65%', '非集束'));
    ok('찾는 모드가 없는 값은 안 쓴다',
      FILL.pickPair('集束：50% → 65%', '非集束') === null,
      FILL.pickPair('集束：50% → 65%', '非集束'));
    ok('같은 모드 표시가 두 번이면 안 쓴다 (위키 오기)',
      FILL.pickPair('集束：9% → 8% 集束：80% → 70%', '集束') === null,
      FILL.pickPair('集束：9% → 8% 集束：80% → 70%', '集束'));
    ok('「秒」는 떼고 정수는 .0 으로 맞춘다',
      FILL.koValue('2秒') === '2.0' && FILL.koValue('225発/分') === '225발/분',
      [FILL.koValue('2秒'), FILL.koValue('225発/分')]);
    /* 무장 꼬리 — 위키가 기체명을 축약해도 꼬리는 같다. */
    ok('무장 이름은 「용」 뒤 꼬리로 맞춘다',
      FILL.tailKey('실루엣 건담 개량형용 헤비 머신건') === FILL.tailKey('SG 개량형용 헤비 머신건'),
      [FILL.tailKey('실루엣 건담 개량형용 헤비 머신건'), FILL.tailKey('SG 개량형용 헤비 머신건')]);
    ok('「용」이 없는 이름은 통째로 쓴다',
      FILL.tailKey('메가 머신 캐논×2') === FILL.tailKey('메가 머신 캐논 x2'));

    /* **무장을 제대로 짚는가** — 같은 항목을 가진 무장이 둘일 때 갈라내야 한다.
       실제 자료로만 재면 못 잡는다: 첫 후보가 우연히 정답인 기체가 많아,
       무장 맞춤을 통째로 꺼도 앵커가 통과했다(심어서 확인). 작은 자료로 똑바로 묻는다. */
    {
      const idx = [
        { tail: '헤비머신건', label: 'よろけ値上昇', value: '10% → 20%' },
        { tail: '빔사벨', label: 'よろけ値上昇', value: '70% → 90%' }
      ];
      ok('같은 항목을 가진 무장이 둘이면 꼬리로 갈라낸다',
        FILL.lookup(idx, '빔사벨', 'よろけ値') === '70% → 90%',
        FILL.lookup(idx, '빔사벨', 'よろけ値'));
      ok('꼬리가 아무것도 안 맞으면 (후보가 여럿이라) 안 쓴다',
        FILL.lookup(idx, '없는무장이름', 'よろけ値') === null,
        FILL.lookup(idx, '없는무장이름', 'よろけ値'));
      /* 앞/뒤 4글자 규칙 — 위키 축약을 잇되, 다른 무장은 안 잇는다. */
      const idx2 = [{ tail: 'sl부속헤비머신건', label: '威力上昇', value: '100 → 200' }];
      ok('위키 축약은 앞/뒤 4글자로 잇는다',
        FILL.lookup(idx2, '샷랜서부속헤비머신건', '威力') === '100 → 200');
      const idx3 = [{ tail: '샷랜서[타돌]', label: '威力上昇', value: '1 → 2' }];
      ok('비슷해 보여도 다른 무장은 안 잇는다 (샷랜서 ↔ 샷랜서[타돌])',
        FILL.lookup(idx3, '샷랜서', '威力') === null,
        FILL.lookup(idx3, '샷랜서', '威力'));

      /* **소거법** — 확실한 짝을 떼고 양쪽에 하나씩 남으면 그 둘이 짝이다.
         이름이 전혀 달라도 정해진다(「로켓 런처」↔「R·런처」). 이것 없이는
         머리글자로 줄인 무장이 영영 안 붙는다. */
      const pm = FILL.pairWeapons(['빔사벨', '로켓런처'], ['빔사벨', 'r런처']);
      ok('남은 하나끼리는 소거법으로 짝짓는다',
        pm.get('로켓런처') === 'r런처', [...pm]);
      const pm2 = FILL.pairWeapons(['빔사벨', '로켓런처', '빔포'], ['빔사벨', 'r런처', 'bc']);
      ok('둘 이상 남으면 아무것도 정하지 않는다',
        pm2.get('로켓런처') === undefined && pm2.get('빔포') === undefined, [...pm2]);
      ok('같은 이름은 그대로 짝이다', pm.get('빔사벨') === '빔사벨');

      /* 「상위 LV」 쪼개기 — **둘 이상일 때만** 쓴다.
         하나뿐이면 공식이 이미 적은 그 값이라 덧붙이면 같은 수가 두 번 나온다.
         실제 자료에는 하나뿐인 경우가 없어 자료로는 못 잰다 — 함수에 바로 묻는다. */
      ok('LV 가 둘 이상일 때만 쪼갠다',
        FILL.lvBreakdown('Lv1：200 → 230') === null,
        FILL.lvBreakdown('Lv1：200 → 230'));
      ok('LV 가 여럿이면 다 뽑는다',
        (FILL.lvBreakdown('Lv1：200 → 230 Lv2：250 → 280') || []).length === 2,
        FILL.lvBreakdown('Lv1：200 → 230 Lv2：250 → 280'));
      ok('숫자가 아닌 것은 LV 로 안 센다',
        FILL.lvBreakdown('Lv1：없음 → 있음') === null,
        FILL.lvBreakdown('Lv1：없음 → 있음'));
    }
  }
}
/* ── ③ 화면에서 **진짜로 눌러 본다** ───────────────────────────── */
(async () => {
  const DIST = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  if (!fs.existsSync(DIST)) {
    console.log('  (건너뜀) dist 가 없다 — node tools/build.js 먼저');
  } else {
    const GBO2Browser = require('./lib/browser.js');
    const { findChrome } = require('./lib/wiki_fetch.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const br = await GBO2Browser.launch({
      executablePath: findChrome(), headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files']
    });
    const pg = await br.newPage();
    await pg.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
    await pg.goto('file:///' + DIST.replace(/\\/g, '/').replace(/ /g, '%20'),
      { waitUntil: 'load', timeout: 180000 });
    await sleep(2500);

    /* 버튼이 **갤러리 오른쪽**에 있는가 — 사용자가 지정한 자리다. */
    const place = await pg.evaluate(() => {
      const g = document.querySelector('#galleryBtn'), p = document.querySelector('#patchBtn');
      if (!g || !p) return null;
      const a = g.getBoundingClientRect(), b = p.getBoundingClientRect();
      return { right: b.left >= a.right - 1, text: p.textContent.trim(), x: [a.right, b.left] };
    });
    ok('패치노트 버튼이 갤러리 오른쪽에 있다', !!place && place.right === true, place);

    /* 가려진 것을 눌러도 click() 은 통한다 — 실제로 닿는지 보고 진짜 마우스로 누른다. */
    const hit = await pg.evaluate(() => {
      const b = document.querySelector('#patchBtn');
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { reach: !!top && (top === b || b.contains(top)), x, y };
    });
    ok('그 버튼이 실제로 눌리는 자리에 있다', hit.reach === true, hit);
    await pg.mouse.click(hit.x, hit.y);
    await sleep(900);

    const rail = await pg.evaluate(() => {
      const box = document.querySelector('#pnRail');
      if (!box) return null;
      const items = [...box.querySelectorAll('.pn-date')];
      const on = box.querySelector('.pn-date.on');
      return {
        shown: !document.querySelector('#screenPatch').offsetParent === false,
        n: items.length,
        onH: on ? on.getBoundingClientRect().height : 0,
        offH: items.filter(e => e !== on).map(e => e.getBoundingClientRect().height),
        onText: on ? on.textContent.replace(/\s+/g, ' ').trim() : '',
        transform: box.style.transform || '(없음)',
        added: document.querySelectorAll('#pnAdded .pn-card').length,
        adjusted: document.querySelectorAll('#pnAdjusted .pn-card').length,
        detailHidden: document.querySelector('#pnDetail').hidden,
        mask: document.querySelector('#pnRail').parentElement.classList.contains('over'),
        over: (() => { const r = document.querySelector('#pnRail'), b = r.parentElement;
          return r.scrollHeight - b.clientHeight > 1; })()
      };
    });
    ok('패치노트 화면이 열린다', !!rail && rail.n > 0, rail);
    ok('날짜 칸이 여러 개다', !!rail && rail.n >= 2, rail && rail.n);
    /* 「현재 날짜 박스는 크게, 다른 박스들은 작게」 — 눈금으로 잰다. */
    ok('고른 날짜 칸이 나머지보다 크다',
      !!rail && rail.onH > 0 && rail.offH.length > 0 && rail.offH.every(h => rail.onH > h + 4),
      rail && { 고른것: rail.onH, 나머지: rail.offH });
    /* 기본으로 열리는 칸은 **가장 최근 주**다. 그 주에 밸런스 조정이 없을 수도 있다
       (주간 칸으로 가른 뒤로는 대부분의 주가 기체 추가뿐이다). 조정 쪽을 재려면
       조정이 있는 주로 옮겨야 한다 — 안 옮기고 「조정 카드가 있다」를 재면,
       멀쩡한 앱이 틀렸다고 나온다(실제로 그랬다). */
    const moved = await pg.evaluate(async () => {
      const items = [...document.querySelectorAll('#pnRail .pn-date')];
      const t = items.find(e => /조정/.test(e.textContent));
      if (!t) return { found: false };
      t.click();
      await new Promise(r => setTimeout(r, 600));
      return { found: true, label: t.textContent.replace(/\s+/g, ' ').trim() };
    });
    ok('밸런스 조정이 있는 주가 레일에 있다', moved.found === true, moved);
    await sleep(500);
    rail.adjusted = await pg.evaluate(() => document.querySelectorAll('#pnAdjusted .pn-card').length);
    ok('조정 기체 카드가 그려졌다', rail.adjusted > 0, rail.adjusted);
    ok('처음에는 변경 내역이 닫혀 있다', !!rail && rail.detailHidden === true);
    /* 마스크는 **넘치는가와 같아야** 한다. 처음엔 「꺼져 있어야 한다」로 못 박았는데,
       날짜 칸이 5개에서 14개로 늘자 넘치기 시작해 멀쩡한 동작이 틀렸다고 울었다.
       고정값이 아니라 **조건과 묶어** 잰다. */
    ok('마스크가 넘침 여부와 같다', rail.mask === rail.over,
      { 마스크: rail.mask, 넘침: rail.over });

    /* 「슬라이드 식」 — 다른 날짜를 누르면 레일이 **움직인다.**
       레일은 끝이 비지 않게 조여 두었다(안 그러면 패치가 적을 때 위가 통째로 빈다).
       그래서 다 들어가는 높이에서는 움직일 일이 없다 — **넘치는 높이로 줄여 놓고** 잰다.
       이렇게 재지 않으면 「패치가 적어서 안 움직인 것」과 「미끄러짐이 깨진 것」을 못 가른다. */
    /* 640px 으로 줄인다. 420px 까지 줄였더니 레일 상자가 170px 밖에 안 돼,
       고른 칸(85px)을 가운데 두면 **이웃 칸이 온전히 안 들어가** 누를 것이 없었다.
       넘치기는 하되(레일 1050px) 이웃이 보이는 높이라야 미끄러짐을 잴 수 있다. */
    await pg.setViewport({ width: 1500, height: 640, deviceScaleFactor: 1 });
    /* 창을 줄인 것만으로 레일이 다시 잡히는지 본다 — 다시 그리지 않는다.
       여기서 눌러 다시 그려 버리면 「크기가 바뀌어도 다시 잰다」를 못 잰다. */
    await pg.evaluate(() => window.dispatchEvent(new Event('resize')));
    await sleep(600);
    await sleep(700);
    const overflow = await pg.evaluate(() => {
      const rail = document.querySelector('#pnRail'), box = rail.parentElement;
      return { over: rail.scrollHeight - box.clientHeight, t: rail.style.transform,
        mask: box.classList.contains('over') };
    });
    ok('줄인 높이에서는 레일이 넘친다 (미끄러짐을 잴 수 있다)', overflow.over > 20, overflow);
    ok('넘칠 때는 끝을 흐리는 마스크가 켜진다', overflow.over > 20 && overflow.mask === true, overflow);

    /* 미끄러짐은 **맨 아래 날짜를 골랐을 때**로 잰다.
       처음엔 「아무 안 고른 칸이나 눌러 transform 이 바뀌는가」로 쟀는데, 고른 칸이
       위쪽이면 가운데 맞춤이 0 으로 조여져 **누르기 전후가 둘 다 0** 이었다 —
       앱은 멀쩡한데 자가 울었다. 맨 아래 칸은 반드시 레일이 올라와야 보인다.
       (여기서는 el.click() 을 쓴다 — 그 칸은 일부러 화면 밖에 둔 것이고,
        닿는지는 바로 위에서 보이는 칸으로 따로 쟀다.) */
    const before = await pg.evaluate(() => document.querySelector('#pnRail').parentElement.scrollTop);
    const slid = await pg.evaluate(async () => {
      const items = [...document.querySelectorAll('#pnRail .pn-date')];
      const last = items[items.length - 1];
      last.click();
      await new Promise(r => setTimeout(r, 700));
      /* 누르면 레일을 **통째로 다시 그린다** — 들고 있던 `last` 는 떨어져 나간
         옛 요소다. 그걸 재면 on 도 false 고 자리도 옛 값이라 멀쩡한 앱이 틀렸다고 나온다.
         누른 뒤에는 **다시 찾아서** 잰다. */
      const rail = document.querySelector('#pnRail'), box = rail.parentElement;
      const now = rail.querySelector('.pn-date.on');
      const b = box.getBoundingClientRect();
      const o = now ? now.getBoundingClientRect() : { top: 0, bottom: 0 };
      return {
        transform: box.scrollTop,
        label: now ? now.textContent.replace(/\s+/g, ' ').trim() : '(없음)',
        on: !!now && now === rail.lastElementChild,
        top: Math.round(o.top - b.top), bottom: Math.round(b.bottom - o.bottom),
        adjusted: document.querySelectorAll('#pnAdjusted .pn-card').length,
        added: document.querySelectorAll('#pnAdded .pn-card').length
      };
    });
    ok('맨 아래 날짜가 골라진다', slid.on === true, slid);

    /* ① **모든 날짜가 미끄러진다.** 예전엔 위쪽 칸들이 전부 0 으로 눌려 눌러도
       아무것도 안 움직였다(사용자가 「슬라이드가 안 된다」고 한 것이 이것이다).
       양 끝에 여백을 둔 뒤로는 어느 칸을 골라도 가운데로 와야 한다 — 눈금으로 잰다. */
    await pg.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
    await sleep(800);
    const wheel = await pg.evaluate(async () => {
      const out = [];
      const items = () => [...document.querySelectorAll("#pnRail .pn-date")];
      for (let i = 0; i < items().length; i++) {
        items()[i].click();
        await new Promise(r => setTimeout(r, 430));
        const rail = document.querySelector("#pnRail"), box = rail.parentElement;
        const on = rail.querySelector(".pn-date.on");
        const b = box.getBoundingClientRect(), o = on.getBoundingClientRect();
        out.push({ t: String(box.scrollTop),
          inside: o.top >= b.top - 1 && o.bottom <= b.bottom + 1,
          off: Math.round((o.top + o.height / 2) - (b.top + b.height / 2)) });
      }
      return out;
    });
    /* 고른 칸은 **늘 온전히 보여야** 한다. 가운데까지 올라오는지는 자리에 달렸다 —
       위쪽 칸은 더 올릴 데가 없어 맨 위에 선다(여백을 끝쪽에만 두기 때문이다). */
    ok("고른 날짜가 늘 상자 안에 온전히 보인다",
      wheel.length > 2 && wheel.every(x => x.inside), wheel.map(x => x.inside));
    /* 아래쪽 날짜를 고르면 레일이 **따라 올라와야** 한다 — 안 그러면 안 보이는 것을 고른 셈이다. */
    ok("아래쪽 날짜를 고르면 레일이 따라온다",
      Number(wheel[wheel.length - 1].t) > Number(wheel[0].t) + 20,
      { 맨위: wheel[0].t, 맨아래: wheel[wheel.length - 1].t });

    /* **누르지 않고도 훑을 수 있어야 한다.** 날짜를 하나씩 눌러 옮기는 것만 재면
       「굴릴 수 없게 막아도」 통과한다 — 실제로 overflow 를 막아 심었는데 안 울었다.
       사용자가 말한 불편이 바로 이것이라, 진짜 휠을 굴려 잰다. */
    /* 맨 위 날짜로 올려 두고 잰다. 앞 검사가 마지막 날짜에서 끝나 **이미 바닥**이라,
       거기서 아래로 굴리면 움직일 자리가 없어 멀쩡한데도 울었다(재서 봤다). */
    await pg.evaluate(async () => {
      document.querySelectorAll('#pnRail .pn-date')[0].click();
      await new Promise(r => setTimeout(r, 650));
    });
    await sleep(300);
    const seat = await pg.evaluate(() => {
      const b = document.querySelector("#pnRail").parentElement;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2,
        top: b.scrollTop, span: b.scrollHeight - b.clientHeight };
    });
    ok("레일에 굴릴 여지가 있다", seat.span > 20, seat);
    await pg.mouse.move(seat.x, seat.y);
    await pg.mouse.wheel({ deltaY: 300 });
    await sleep(600);
    const wheeled = await pg.evaluate(() => {
      const b = document.querySelector("#pnRail").parentElement;
      const q = b.getBoundingClientRect();
      const seen = [...b.querySelectorAll(".pn-date")].filter(e => {
        const r = e.getBoundingClientRect();
        return r.top >= q.top - 1 && r.bottom <= q.bottom + 1;
      }).length;
      return { top: b.scrollTop, seen,
        onStill: (b.querySelector(".pn-date.on") || {}).textContent || "" };
    });
    ok("휠로 굴릴 수 있다 (누르지 않고 훑는다)", wheeled.top > seat.top + 20,
      { 전: seat.top, 후: wheeled.top });
    ok("굴려도 고른 날짜는 그대로다", /\d/.test(wheeled.onStill), wheeled);
    /* 굴린 뒤 그 날짜를 다시 누르면 가운데로 돌아와야 한다 — 안 그러면 「눌러도 안 되네」가 된다. */
    const recenter = await pg.evaluate(async () => {
      const b = document.querySelector("#pnRail").parentElement;
      b.querySelector(".pn-date.on").click();
      await new Promise(r => setTimeout(r, 650));
      const on = b.querySelector(".pn-date.on");
      const q = b.getBoundingClientRect(), o = on.getBoundingClientRect();
      return { inside: o.top >= q.top - 1 && o.bottom <= q.bottom + 1,
        off: Math.round((o.top + o.height / 2) - (q.top + q.height / 2)) };
    });
    /* 굴려서 시야 밖으로 보낸 뒤 그 날짜를 누르면 **다시 보여야** 한다.
       가운데까지 올지는 자리에 달렸다(맨 위 칸은 더 올릴 데가 없다) — 보이는지를 잰다. */
    ok("굴린 뒤 같은 날짜를 눌러도 다시 보인다", recenter.inside === true, recenter);

    /* ② 카드가 충분히 크다 — 작으면 오른쪽이 휑하다(사용자 지적). */
    const csz = await pg.evaluate(() => {
      const c = document.querySelector("#pnAdjusted .pn-card") || document.querySelector("#pnAdded .pn-card");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const img = c.querySelector("img");
      return { w: Math.round(r.width), h: Math.round(r.height),
        img: img ? Math.round(img.getBoundingClientRect().width) : 0 };
    });
    /* 화면에도 LV 줄이 나와야 한다 — 자료에만 있으면 아무 소용이 없다. */
    const lvUi = await pg.evaluate(async () => {
      const t = [...document.querySelectorAll("#pnRail .pn-date")].find(e => /조정/.test(e.textContent));
      if (t) { t.click(); await new Promise(r => setTimeout(r, 600)); }
      const cards = [...document.querySelectorAll("#pnAdjusted .pn-card")];
      let best = 0, bn = -1;
      for (let i = 0; i < cards.length; i++) {
        cards[i].click();
        await new Promise(r => setTimeout(r, 230));
        const k = document.querySelectorAll("#pnDetail .pn-lv").length;
        if (k > bn) { bn = k; best = i; }
      }
      cards[best].click();
      await new Promise(r => setTimeout(r, 400));
      if (document.querySelector("#pnDetail").hidden) {
        cards[best].click(); await new Promise(r => setTimeout(r, 400));
      }
      const rows = [...document.querySelectorAll("#pnDetail .pn-lv")];
      return { n: rows.length,
        texts: rows.slice(0, 3).map(e => e.textContent.replace(/\s+/g, " ").trim()),
        /* 공식 줄 **바로 아래**여야 한다 — 엉뚱한 데 붙으면 어느 줄 값인지 모른다. */
        afterLine: rows.every(e => e.previousElementSibling
          && e.previousElementSibling.classList.contains("pn-ln")) };
    });
    ok("화면에 LV 별 수치가 나온다", lvUi.n > 0, lvUi);

    /* **하단 묶음 차례** — 조정 의도 → 참조 데이터 → 상세 수치 (사용자 지시).
       차례가 섞여도 셋 다 있기는 하므로 「있는가」만 보면 못 잡는다. 자리를 잰다. */
    const order = await pg.evaluate(() => {
      const box = document.querySelector("#pnDetail");
      const want = ["pn-intent", "pn-ref", "pn-wiki"];
      const got = [...box.children]
        .map(e => want.find(c => e.classList && e.classList.contains(c)))
        .filter(Boolean);
      return { got, want };
    });
    ok("하단 묶음 차례가 의도 → 참조 → 상세다",
      order.got.length >= 2
      && order.got.join(",") === order.want.filter(w => order.got.includes(w)).join(","),
      order);
    ok("LV 줄이 공식 줄 바로 아래 붙는다", lvUi.afterLine === true, lvUi);
    ok("LV 줄에 LV 와 수치가 함께 있다",
      lvUi.texts.length > 0 && lvUi.texts.every(t => /LV\d/.test(t) && /\d+\s*→\s*\d+/.test(t)), lvUi.texts);

    ok("카드가 작지 않다", !!csz && csz.w >= 220 && csz.h >= 70 && csz.img >= 56, csz);

    /* ④ 밸런스 패치 걸개 — 켜면 조정 있는 날만 남고, 끄면 되돌아온다.
       「켜지는가」만 보면 안 된다. 걸러 놓고 오른쪽이 비면 망가진 것으로 보인다. */
    /* 걸개를 **조정 없는 날에서** 켠다. 조정 있는 날에서 켜면 「걸러진 날에 있었을 때
       옮겨 주는가」가 한 번도 안 밟힌다 — 그 줄을 지워 심었더니 자가 안 울었다. */
    const filt = await pg.evaluate(async () => {
      const noBal = [...document.querySelectorAll("#pnRail .pn-date")].find(e => !/조정/.test(e.textContent));
      if (noBal) { noBal.click(); await new Promise(r => setTimeout(r, 550)); }
      const startedOnAdd = !!noBal;
      const n0 = document.querySelectorAll("#pnRail .pn-date").length;
      document.querySelector("#pnBalBtn").click();
      await new Promise(r => setTimeout(r, 700));
      const left = [...document.querySelectorAll("#pnRail .pn-date")];
      const r = { n0, n1: left.length, startedOnAdd,
        allBal: left.every(e => /조정/.test(e.textContent)),
        pressed: document.querySelector("#pnBalBtn").getAttribute("aria-pressed"),
        adj: document.querySelectorAll("#pnAdjusted .pn-card").length };
      document.querySelector("#pnBalBtn").click();
      await new Promise(r2 => setTimeout(r2, 600));
      r.back = document.querySelectorAll("#pnRail .pn-date").length;
      r.pressedOff = document.querySelector("#pnBalBtn").getAttribute("aria-pressed");
      return r;
    });
    ok("걸개를 켜면 날짜가 줄어든다", filt.n1 > 0 && filt.n1 < filt.n0, filt);
    ok("남은 날짜가 모두 조정 있는 날이다", filt.allBal === true, filt);
    ok("걸개가 눌린 것으로 보인다", filt.pressed === "true" && filt.pressedOff === "false", filt);
    ok("조정 없는 날에서 걸개를 켰다 (옮기기를 실제로 밟는다)", filt.startedOnAdd === true, filt);
    ok("걸러도 오른쪽이 비지 않는다 (가까운 조정 날로 옮긴다)", filt.adj > 0, filt);
    ok("걸개를 끄면 되돌아온다", filt.back === filt.n0, filt);
    ok('그러려면 레일이 굴러간다 (scrollTop 이 바뀐다)',
      slid.transform !== before && slid.transform > 0,
      { 전: before, 후: slid.transform });
    ok('미끄러진 뒤 그 칸이 상자 안에 온전히 보인다',
      slid.top >= -1 && slid.bottom >= -1, slid);
    /* 날짜를 바꾸면 오른쪽도 그 날짜의 것으로 다시 그려져야 한다.
       조정만 있는 주도, 추가만 있는 주도 있으니 **둘 중 하나는** 있어야 한다. */
    ok('바꾼 날짜의 내용이 그려진다', slid.adjusted + slid.added > 0,
      { 조정: slid.adjusted, 추가: slid.added, 날짜: slid.label });

    /* 기체를 누르면 **공식 원문**이 나오는가. 자료와 글자를 맞대 본다.
       높이를 되돌린다 — 미끄러짐을 재려고 420px 로 줄여 둔 채로 누르면 카드가
       화면 밖이라 안 닿는다(실제로 그래서 자가 울었다). 누를 자리는 보이게 해 놓고 잰다. */
    await pg.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
    await sleep(700);
    const detail = await pg.evaluate(() => {
      const c = document.querySelector('#pnAdjusted .pn-card');
      c.scrollIntoView({ block: 'center' });
      const r = c.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { reach: !!top && (top === c || c.contains(top)), x, y, name: c.textContent.trim() };
    });
    ok('조정 기체 카드가 눌리는 자리에 있다', detail.reach === true, detail);
    await pg.mouse.click(detail.x, detail.y);
    await sleep(700);
    const shown = await pg.evaluate(() => {
      const box = document.querySelector('#pnDetail');
      return {
        hidden: box.hidden,
        rows: box.querySelectorAll('.pn-row').length,
        /* 줄의 **제 글자만** 읽는다. 채운 수치 배지(.pn-num)는 줄 안에 들어 있어서
           통째로 읽으면 「공식 글줄」과 안 맞는다 — 자가 거기서 울었다. */
        lines: [...box.querySelectorAll('.pn-ln')].map(e => {
          const c = e.cloneNode(true);
          c.querySelectorAll('.pn-num').forEach(x => x.remove());
          return c.textContent.trim();
        }),
        nums: [...box.querySelectorAll('.pn-num')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
        intent: box.querySelectorAll('.pn-intent').length,
        head: (box.querySelector('.pn-dhead strong') || {}).textContent || ''
      };
    });
    ok('기체를 누르면 변경 내역이 나온다', shown.hidden === false && shown.rows > 0, shown.rows);
    ok('내역에 글줄이 있다', shown.lines.length > 0, shown.lines.length);
    /* 공식 수치 표기가 화면까지 살아 왔는가 — 중간에 지워지면 뜻이 사라진다. */
    ok('화면 글줄에 공식 수치 표기(「A」→「B」)가 있다',
      shown.lines.some(l => /「[^」]*」→「[^」]*」/.test(l)), shown.lines.slice(0, 3));
    ok('조정 의도 칸이 있다', shown.intent > 0, shown.intent);
    /* 채운 수치가 화면에 **배지로** 붙는가. 그리고 그 값이 자료와 같은가 —
       화면이 제 말을 지어내면 여기서 걸린다. */
    ok('채운 수치 배지가 화면에 나온다', shown.nums.length > 0, shown.nums.slice(0, 4));
    if (fs.existsSync(DATA)) {
      const d2 = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      const all = new Set();
      for (const p2 of d2.patches || []) for (const a2 of p2.adjusted || [])
        for (const sec of a2.sections || []) for (const row of sec.rows || [])
          (row.fill || []).forEach(f => f && all.add((f.from + '→' + f.to).replace(/\s+/g, '')));
      const odd = shown.nums.filter(n => !all.has(n.replace(/\s+/g, '')));
      ok('배지 값이 모두 자료에서 온 것이다', odd.length === 0, odd.slice(0, 4));
    }

    /* ③④ 가 화면까지 왔는가. 자료에만 있고 화면에 안 그려지면 아무 소용이 없다. */
    const extra = await pg.evaluate(async () => {
      const box = document.querySelector('#pnDetail');
      const w = box.querySelector('.pn-wiki'), r = box.querySelector('.pn-ref');
      if (w) w.open = true;
      if (r) r.open = true;
      await new Promise(x => setTimeout(x, 250));
      return {
        wiki: w ? [...w.querySelectorAll('.pn-wl')].map(e => e.textContent.trim()) : [],
        up: w ? w.querySelectorAll('.pn-wl.up').length : 0,
        refRows: r ? r.querySelectorAll('.pn-rt tr').length : 0,
        refCells: r ? [...r.querySelectorAll('.pn-rt td')].map(e => e.textContent.trim()) : [],
        afterRow: r ? r.querySelectorAll('.pn-rt tr.after').length : 0,
        note: r ? r.querySelectorAll('.pn-note').length : 0
      };
    });
    ok('위키 상세 수치가 화면에 나온다', extra.wiki.length > 0, extra.wiki.length);
    ok('그 줄에 「A → B」 수치가 보인다',
      extra.wiki.some(l => /\d+\s*→\s*\d+/.test(l)), extra.wiki.slice(0, 3));
    ok('올림 표식이 표시된다', extra.up > 0, extra.up);
    ok('참조 데이터 표가 그려진다', extra.refRows >= 2 && extra.refCells.length > 0,
      { 행: extra.refRows, 칸: extra.refCells.length });
    /* 「조정 후」 행이 있으면 눈에 띄게, 없으면 **왜 없는지**를 적어야 한다.
       둘 다 아니면 사용자는 빠진 것인지 아직 안 나온 것인지 알 수 없다. */
    ok('「조정 후」가 있거나, 없다고 적혀 있다',
      (extra.afterRow > 0) !== (extra.note > 0),
      { 조정후행: extra.afterRow, 안내문: extra.note });

    /* 위 검사는 **지금 열어 둔 기체 하나**만 본다. 그 기체에 「조정 후」가 있으면
       안내문 쪽 가지는 한 번도 안 밟힌다 — 실제로 안내문을 지워 심었는데 안 울었다.
       두 경우를 다 밟는다: 결과가 들어온 옛 패치(위에서 봤다)와,
       아직 안 들어온 **가장 최근 조정 패치**. */
    const fresh2 = await pg.evaluate(async () => {
      const items = [...document.querySelectorAll('#pnRail .pn-date')];
      const t = items.find(e => /조정/.test(e.textContent));   // 레일은 최신이 먼저다
      if (!t) return null;
      t.click();
      await new Promise(r => setTimeout(r, 650));
      const c = document.querySelector('#pnAdjusted .pn-card');
      if (!c) return null;
      /* 앞 검사가 이미 펼쳐 둔 상태일 수 있다. 카드는 **누를 때마다 토글**이라
         그대로 누르면 닫힌다 — 열릴 때까지 확인한다(실제로 닫혀서 자가 울었다). */
      c.click();
      await new Promise(r => setTimeout(r, 450));
      if (document.querySelector('#pnDetail').hidden) {
        c.click();
        await new Promise(r => setTimeout(r, 450));
      }
      const box = document.querySelector('#pnDetail');
      const r2 = box.querySelector('.pn-ref');
      if (r2) r2.open = true;
      await new Promise(r => setTimeout(r, 250));
      return {
        date: t.textContent.replace(/\s+/g, ' ').trim(),
        afterRow: r2 ? r2.querySelectorAll('.pn-rt tr.after').length : -1,
        note: r2 ? r2.querySelectorAll('.pn-note').length : -1
      };
    });
    ok('가장 최근 조정 패치로 갈 수 있다', !!fresh2, fresh2);
    ok('아직 결과가 없는 패치에는 **없다고 적혀 있다**',
      !!fresh2 && fresh2.afterRow === 0 && fresh2.note > 0, fresh2);

    /* 자료에 있는 글줄과 **같은 글자**인가 — 화면이 제 말을 지어내지 않는지 본다. */
    if (fs.existsSync(DATA)) {
      const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      /* 변경 내역 글줄 **과 조정 의도 글줄**을 다 모은다. 의도를 빼놓았더니
         멀쩡한 의도 문장이 「자료에 없는 글」로 잡혔다 — 자가 반만 보고 있었다. */
      const all = new Set((d.patches || []).flatMap(p => (p.adjusted || []).flatMap(a => [
        ...(a.sections || []).flatMap(s => (s.rows || []).flatMap(r => r.changes || [])),
        ...(a.intent || [])
      ])));
      const unknown = shown.lines.filter(l => !all.has(l));
      /* **읽은 줄이 있어야 뜻이 있다.** 빈 목록이면 「어긋난 줄 0」이라 통과해 버린다 —
         내역이 통째로 안 뜨는 회귀를 이 검사가 거들어 숨길 뻔했다(실제로 그랬다). */
      ok('화면 글줄이 모두 자료에서 온 것이다',
        shown.lines.length > 0 && unknown.length === 0,
        { 읽은줄: shown.lines.length, 어긋난줄: unknown.slice(0, 4) });
    }

    /* 되돌아가기 — 막힌 화면을 만들지 않는다. */
    await pg.evaluate(() => document.querySelector('#patchBack').click());
    await sleep(600);
    const back = await pg.evaluate(() => ({
      cls: document.body.className,
      patchShown: !!document.querySelector('#screenPatch').offsetParent
    }));
    ok('돌아가기가 패치노트 화면을 닫는다',
      back.patchShown === false && !/view-patch/.test(back.cls), back);

    await br.close();
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

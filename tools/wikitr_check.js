// 위키 「アップデート履歴」 한글화가 제대로 되는가.
//   node tools/wikitr_check.js
//
// 왜 — 위키 이력은 **수치 변화의 가장 완전한 기록**이다. 공식 공지가 389개를 적을 때
// 위키는 423개를 적는다(2026-10-10 실측). 공식이 아예 말하지 않은 변화까지 들어 있다.
// 일본어라 접어 둘 수밖에 없던 것을 옮겨, 그 전부가 읽히게 했다.
//
// **공식 표기가 이긴다**(사용자 지시). 위키와 공식이 다른 말을 쓰면 공식을 따른다:
//     連射性能 → 「연사 속도」          (공식이 그렇게 쓴다)
//     切り替え時間 → 「무장 전환 시간」   (공식)
//     ASL(自動標準補正) → 「ASL(자동 조준 보정)」 (공식. 위키 쪽 오기도 받는다)
// 이 자는 그 세 가지를 **글자로 못 박는다** — 사전을 손대다 되돌리면 여기서 운다.
//
// 그리고 **지어내지 않는다** — 사전에 없는 말은 원문으로 남는다. 얼마나 남았는지를 센다.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const TR = require(path.join(ROOT, 'tools', 'lib', 'wiki_tr.js'));
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* ── ① 공식 표기가 이긴다 ─────────────────────────────────────── */
const official = [
  ['連射性能上昇', '연사 속도 상승', '위키는 連射性能, 공식은 연사 속도'],
  ['切り替え時間短縮', '무장 전환 시간 단축', '공식은 「무장 전환 시간」'],
  ['ASL(自動標準補正)範囲拡大', 'ASL(자동 조준 보정) 범위 확대', '위키 오기(標準)도 공식 표기로'],
  ['ASL(自動照準補正)の範囲拡大', 'ASL(자동 조준 보정) 범위 확대', '위키의 다른 꼴도 같게'],
  ['よろけ値上昇', '비틀거림 축적치 상승', '공식 용어'],
  ['下格補正上昇', '하격투 보정 상승', '위키가 줄여 적은 꼴(闘 빠짐)'],
  ['リロード時間短縮', '재장전 단축', '공식은 「재장전」'],
  ['爆発のヒット回数増加', '폭발의 히트 횟수 증가', '공식 용어']
];
for (const [ja, want, why] of official) {
  const got = TR.trLine(ja);
  ok('공식 표기를 따른다 — ' + ja + ' → ' + want + '  (' + why + ')', got === want, { 나온것: got });
}

/* ── ② 조립 — 스킬·무장 이름은 **이미 있는 사전**을 쓴다 ─────────── */
ok('기체 스킬 이름을 스킬 사전에서 가져온다',
  TR.trLine('機体スキル「ダメージコントロール」LV上昇') === '기체 스킬「대미지 컨트롤」LV 상승',
  TR.trLine('機体スキル「ダメージコントロール」LV上昇'));
ok('무장 이름을 무장 사전에서 가져온다',
  TR.trLine('SG改用ヘビーマシンガン') === 'SG 개량형용 헤비 머신건',
  TR.trLine('SG改用ヘビーマシンガン'));
/* 무장 표에 없는 이름도 **같은 규칙**으로 옮긴다 — 규칙을 두 벌로 적지 않으려고 빌려 쓴다. */
ok('표에 없는 무장 이름도 같은 규칙으로 옮긴다',
  TR.trLine('ウインチキャノン') === '윈치 캐논', TR.trLine('ウインチキャノン'));
/* 동작어로 끝나는 줄을 이름으로 보면 문장이 통째로 음역된다 — 그러면 안 된다. */
ok('항목 줄을 무장 이름으로 착각하지 않는다',
  TR.trLine('ヒート率軽減') === '히트율 경감', TR.trLine('ヒート率軽減'));

/* ── ③ 값 줄 ──────────────────────────────────────────────────── */
ok('초·발/분 단위를 옮긴다',
  TR.trLine('40秒 → 30秒') === '40초 → 30초'
  && TR.trLine('225発/分 → 240発/分') === '225발/분 → 240발/분',
  [TR.trLine('40秒 → 30秒'), TR.trLine('225発/分 → 240発/分')]);
ok('※주석을 옮긴다',
  TR.trLine('集束：40% → 80% ※非集束時は調整無し') === '집속：40% → 80% ※통상시는 조정 없음',
  TR.trLine('集束：40% → 80% ※非集束時は調整無し'));
/* 숫자는 손대지 않는다 — 옮기다 숫자가 바뀌면 자료가 거짓이 된다. */
{
  const src = 'Lv1：3000 → 3200 Lv2：3300 → 3600';
  const got = TR.trLine(src);
  const num = s => (String(s).match(/\d+/g) || []).join(',');
  ok('숫자는 그대로 둔다', num(got) === num(src), { 전: num(src), 후: num(got) });
}

/* ── ④ 자료 전체 ──────────────────────────────────────────────── */
const DATA = path.join(ROOT, 'data', 'patchnotes.json');
if (!fs.existsSync(DATA)) {
  console.log('  (건너뜀) data/patchnotes.json 이 없다');
} else {
  const pn = rd('data', 'patchnotes.json');
  const all = pn.patches.flatMap(p => (p.adjusted || []).flatMap(a => a.wiki || []));
  ok('이력 줄이 쌓여 있다', all.length > 300, { 줄: all.length });
  ok('모든 줄에 한국어가 붙어 있다', all.every(x => x.ko != null),
    all.filter(x => x.ko == null).slice(0, 3));
  const left = all.filter(x => TR.hasJa(x.ko != null ? x.ko : x.text));
  ok('일본어가 남은 줄이 없다', left.length === 0,
    { 남은줄: left.length, 보기: left.slice(0, 4).map(x => x.ko || x.text) });
  /* 옮긴 뒤에도 **값은 그대로**여야 한다 — 통째로 세어 맞댄다. */
  const num = s => (String(s).match(/\d+/g) || []).join(',');
  const broke = all.filter(x => x.ko && num(x.ko) !== num(x.text));
  ok('옮기는 동안 숫자가 바뀌지 않았다', broke.length === 0,
    broke.slice(0, 3).map(x => ({ 전: x.text, 후: x.ko })));
}

/* ── ⑤ 화면에서 ──────────────────────────────────────────────── */
(async () => {
  const DIST = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  if (!fs.existsSync(DIST)) {
    console.log('  (건너뜀) dist 가 없다 — node tools/build.js 먼저');
  } else {
    const GBO2Browser = require('./lib/browser.js');
    const { findChrome } = require('./lib/wiki_fetch.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const br = await GBO2Browser.launch({ executablePath: findChrome(), headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files'] });
    const pg = await br.newPage();
    await pg.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 });
    await pg.goto('file:///' + DIST.replace(/\\/g, '/').replace(/ /g, '%20'),
      { waitUntil: 'load', timeout: 180000 });
    await sleep(2500);
    /* 위키가 다 따라온(공지 뒤 21일 지난) 조정 패치를 고른다 — patchnote_check 와 같은 유예.
       패치 다음 날엔 가장 최근 패치에 위키 이력이 아직 없어 「0줄」 로 실패했다(2026-10-30). */
    const cut = (() => { const d = new Date(); d.setDate(d.getDate() - 21);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    const r = await pg.evaluate(async (cut) => {
      document.querySelector('#patchBtn').click();
      await new Promise(x => setTimeout(x, 1000));
      const ds = [...document.querySelectorAll('#pnRail .pn-date')].filter(e => /조정/.test(e.textContent));
      const t = ds.find(e => String(e.title || '').slice(0, 10) <= cut) || ds[0];
      if (!t) return null;
      t.click();
      await new Promise(x => setTimeout(x, 600));
      const c = document.querySelector('#pnAdjusted .pn-card');
      c.click();
      await new Promise(x => setTimeout(x, 450));
      const box = document.querySelector('#pnDetail');
      if (box.hidden) { c.click(); await new Promise(x => setTimeout(x, 450)); }
      const w = box.querySelector('.pn-wiki');
      if (w) w.open = true;
      await new Promise(x => setTimeout(x, 300));
      const rows = [...box.querySelectorAll('.pn-wl')];
      return {
        n: rows.length,
        ja: rows.filter(e => /[ぁ-んァ-ヶ一-鿿]/.test(e.textContent)).length,
        titled: rows.filter(e => e.title).length,
        summary: (box.querySelector('.pn-wiki summary') || {}).textContent || ''
      };
    }, cut);
    ok('화면에 위키 이력이 나온다', !!r && r.n > 0, r);
    ok('화면 글줄에 일본어가 남지 않았다', !!r && r.ja === 0, r);
    /* 원문을 숨기지 않는다 — 옮긴 말이 미덥지 않을 때 확인할 길이 있어야 한다. */
    ok('옮긴 줄은 마우스를 올리면 원문이 보인다', !!r && r.titled > 0, r);
    ok('제목에서 「일본어 원문」을 뗐다', !!r && !/일본어/.test(r.summary), r && r.summary);
    await br.close();
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

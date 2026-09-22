// 무장 수치를 **앱이 읽어 낸 값**으로 검수한다 — 원문과 대조하고, 못 읽는 말이 늘면 잡는다.
//
//   node tools/weapon_value_check.js
//
// 왜 필요한가 — 이 저장소에서 나온 버그가 거의 다 같은 부류였다:
//   선회 「＋100%」를 「+10」으로 자름(15기) · 누적치 배수 하나 누락(153무장) ·
//   태클·점프를 이동 축으로(7종) · 무장의 적 내성 감소 미반영(35무장) ·
//   실드 무시 미반영(24무장) · 집속 필수 무장 누락(103무장) · ZERO 초기소비 증발(3기)
// 전부 **데이터에 값이 있는데 앱이 잘못 읽거나 안 쓴** 것이고, 사람이 우연히 봐야만 드러났다.
// 스킬은 skill_value_check 가 덮고(그 검사 하나가 15기를 잡았다), 파츠는 part_effect_check 가
// 「끼워서 수치가 바뀌는가」로 덮는다. **무장에는 그런 검사가 없었다.**
//
// 짜면서 두 번 헛돌았다. 남겨 둔다 — 같은 함정을 또 밟지 않으려고:
//   ① 소스에서 정규식을 긁어 맞춰 보려 했더니 느슨한 것 하나(`([\d.]+)`)가 5,047 조각을
//      전부 삼켜 「누락 0」이라는 거짓 통과가 나왔다. 그래서 **앱의 진짜 파서**를 부른다.
//   ② 「피해 쪽 배수 = 누적치 쪽 배수」로 가두려 했더니 324건이 걸렸는데 **버그는 0** 이었다 —
//      연속발사(206)는 앱이 일부러 안 세고, 나머지는 원문이 두 칸에 다르게 적혀 있다.
//      가둘 수 없는 것은 가두지 않는다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra, null, 1) : '')); }
};

/* ── 못 읽는 말이 늘지 않는가 (낱말 자물쇠) ──
   備考 조각에 든 일본어 낱말이 소스 어디에도 안 나오면, 앱은 그 말을 **아예 모른다.**
   지금 그런 조각이 455개(33종류)다. 대부분은 일부러 안 읽는 것(倍率 → 집속 위력에 이미 반영 ·
   N格/横格 → mods.melee 로 들어감)이라 0 으로 만들 수 없다.
   그래서 **늘지 않는 것**을 가둔다 — 데이터가 갱신돼 새 표기가 들어오면 여기서 걸린다.
   국부·거점·부위 보정은 「넣지 않기로」 정한 자리라 세지 않는다. */
const VOCAB_MAX = 455;
function vocabMiss() {
  const src = ['src/ui.js', 'src/damage.js', 'src/core.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const weapons = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'weapons.json'), 'utf8'));
  const JA = /[ぁ-ゖァ-ヺ一-鿿]{2,}/g;
  const SKIP = /局部補正|拠点補正|頭部補正|脚部補正|背部補正|頭部・|脚部・|脚部倍率|シールド補正/;
  const known = seg => {
    for (const t of (seg.match(JA) || []))
      for (let n = t.length; n > 2; n--)
        for (let i = 0; i + n <= t.length; i++) if (src.includes(t.slice(i, i + n))) return true;
    return false;
  };
  const miss = new Map();
  let segs = 0;
  for (const v of Object.values(weapons)) {
    for (const w of (v.weapons || [])) {
      for (const seg of String((w.info || {})['備考'] || '').split(/\s*\/\s*/)) {
        const t = seg.trim();
        if (!t || !/\d/.test(t) || SKIP.test(t)) continue;
        segs++;
        if (known(t)) continue;
        const m = /^([^0-9：:＋+－-]{1,20}?)\s*[：:]?\s*[＋+－-]?\s*[\d?？]/.exec(t);
        const k = m ? m[1].trim() : t.slice(0, 16);
        miss.set(k, (miss.get(k) || 0) + 1);
      }
    }
  }
  let n = 0;
  for (const c of miss.values()) n += c;
  return { segs, n, kinds: miss.size, top: [...miss].sort((a, b) => b[1] - a[1]).slice(0, 5) };
}

/* ── 무장 설명(備考)이 전부 한글이 되는가 ──
   사전은 **備考 문장 전체**가 열쇠다. 그래서 위키가 한 글자만 고쳐도 열쇠가 어긋나
   그 무장만 조용히 일본어로 돌아간다 — 오류도 안 나고 개수도 안 변한다.
   실제로 카풀 두 기체에서 그렇게 났다(위키가 채워지며 새 무장 5종 + 기존 5종의 문구가 바뀜).
   화면 훑기(ja_leak_check)로는 못 잡는다 — 3,272종을 다 열어 볼 수는 없어서다.
   그래서 **데이터에서** 센다. `node tools/translate_notes.js` 가 메꾼다. */
function noteCoverage() {
  const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, ...f), 'utf8'));
  const dict = rd(['data', 'i18n', 'weapon_note.json']);
  const weapons = rd(['data', 'weapons.json']);
  const KANA = /[ぁ-ゖァ-ヺ]/;
  let tot = 0;
  const miss = [], ja = [];
  for (const v of Object.values(weapons)) {
    for (const w of (v.weapons || [])) {
      const note = String(((w.info || {})['備考']) || '');
      if (!note) continue;
      tot++;
      const ko = dict[note];
      const who = (v.names || ['?'])[0] + ' / ' + w.name;
      if (ko == null) miss.push(who);
      else if (KANA.test(ko)) ja.push(who);
    }
  }
  return { tot, miss, ja };
}

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  const r = await pg.evaluate(() => {
    const T = window.GBO2UiTest, W = T.weaponData();
    const stag = [], foe = [];
    let n = 0, withStag = 0, withFoe = 0;
    for (const v of Object.values(W)) {
      for (const w of (v.weapons || [])) {
        n++;
        const note = String((w.info || {})['備考'] || '');

        /* ── ① 누적치 — 원문의 수를 **다 쓰는가** ──
           「20% x2発 x3射」에서 앞의 x2 만 읽어 153 무장이 실제보다 낮게 나왔던 자리다.
           괄호는 집속값이라 세지 않는다(「5% x10（7% x10）」의 뒤쪽 x10). */
        const raw = String((w.mods && w.mods.stagger) || '');
        if (raw) {
          withStag++;
          const st = T.parseStagger(w);
          const bare = raw.replace(/[（(][^）)]*[）)]/g, '');
          const pm = bare.match(/(\d+(?:\.\d+)?)\s*%/);
          const xs = [...bare.matchAll(/[x×]\s*(\d+)/g)].map(m => Number(m[1]));
          const wantP = pm ? Number(pm[1]) : 0;
          const wantN = xs.reduce((a, b) => a * b, 1);
          if (st.pct !== wantP || st.pellets !== wantN)
            stag.push({ ms: v.names[0], w: w.name, raw, got: st, want: { pct: wantP, pellets: wantN } });
        }

        /* ── ② 읽어 낸 값이 원문에 **있는 수**인가 ──
           지어내거나 자른 값을 잡는다(스킬 쪽에서 「旋回 ＋100%」→＋10 이 그렇게 났다). */
        const cut = T.weaponFoeArmorCut(w);
        if (cut) {
          withFoe++;
          if (!new RegExp('(?:^|[^0-9])' + cut + '(?:[^0-9]|$)').test(note))
            foe.push({ ms: v.names[0], w: w.name, cut, note: note.slice(0, 60) });
        }
      }
    }
    return { n, withStag, withFoe, stag, foe };
  });

  await br.close();

  console.log('무장 ' + r.n + '건 — 누적치 표기 ' + r.withStag + ' · 적 내성 감소 ' + r.withFoe + '\n');

  /* 「下記参照(150%)」 하나는 본문에 값이 없고 괄호에만 있다. 앱이 괄호값을 쓰는 것이
     이 한 건에서는 더 쓸모 있어 그대로 둔다 — 늘어나면 여기서 걸린다. */
  ok('누적치가 원문의 배수를 다 쓴다 (예외 1건)', r.stag.length <= 1, r.stag.slice(0, 5));
  ok('적 내성 감소 값이 원문에 있는 수다', r.foe.length === 0, r.foe.slice(0, 5));
  // 0 이면 「아무것도 안 쟀다」로도 통과한다 — 실제로 쟀는지 개수로 확인한다
  ok('잴 것이 실제로 있었다', r.withStag > 2000 && r.withFoe >= 30, { 누적치: r.withStag, 내성감소: r.withFoe });

  const v = vocabMiss();
  console.log('\n낱말 자물쇠 — 숫자 든 조각 ' + v.segs + ' · 소스가 모르는 말 ' + v.n + '조각 / ' + v.kinds + '종류');
  console.log('  많은 것: ' + v.top.map(([k, c]) => k + ' ' + c).join(' · '));
  ok('앱이 모르는 표기가 늘지 않았다 (' + VOCAB_MAX + ' 이하)', v.n <= VOCAB_MAX, { 지금: v.n, 자물쇠: VOCAB_MAX });
  ok('자물쇠가 헐거워지지 않았다 (줄었으면 낮춰 잠글 것)', v.n >= VOCAB_MAX - 40, { 지금: v.n, 자물쇠: VOCAB_MAX });

  const nc = noteCoverage();
  console.log('\n무장 설명 — 備考 있는 무장 ' + nc.tot + '종 · 번역 없음 ' + nc.miss.length
    + ' · 번역에 일본어 남음 ' + nc.ja.length);
  ok('무장 설명이 전부 한글로 나온다', nc.miss.length === 0 && nc.ja.length === 0,
    { 번역없음: nc.miss.slice(0, 5), 일본어: nc.ja.slice(0, 5), 메꾸는법: 'node tools/translate_notes.js' });
  ok('설명을 실제로 셌다 (3000종 이상)', nc.tot > 3000, { 센것: nc.tot });

  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

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
const GBO2Browser = require('./lib/browser.js');   // 크롬 임시 프로필 정리가 프로세스를 죽이지 않게
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
const VOCAB_MAX = 456;   // was 455 — 2026-11-06 브룩켕: 倍率 2 · 最長 1, 새 종류 없음(33종류 그대로)
function vocabMiss() {
  const src = [require('./lib/uisrc.js').readUi(), ...['src/damage.js', 'src/core.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))].join('\n');
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

/* 사전을 보는 검사(무장 이름·설명·「null」)는 **tools/dict_check.js 로 옮겼다.**
   이 파일은 Chrome 이 없으면 첫머리에서 빠져나가는데, 하필 그 자리(배포본의 update.bat)가
   사전이 깨지는 사고가 나던 곳이었다 — 정작 거기서 검사가 안 돌고 있었다.
   여기 남는 것은 **브라우저로 앱의 파서를 직접 불러야** 알 수 있는 것들뿐이다. */

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
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
    /* ── ③ 전각 표기 ──
       MSN-04FF 사자비 「2発同時発射ｘ４回攻撃」 · 「40%ｘ2発ｘ4射」: 정규식 \d 는 전각 숫자를 못 읽고
       [x×] 는 ｘ 를 못 읽어, 피해 2히트(실제 8) · 누적치 1히트(실제 8)로 나왔다(2026-11-06 사용자 지적).
       ①의 대조식도 같은 눈을 가져 함께 통과했다 — 그래서 **문자 자체**가 없는지 본다. */
    const wide = [];
    for (const v of Object.values(W)) for (const w of (v.weapons || [])) {
      const txt = [...Object.values(w.info || {}), ...Object.values(w.mods || {})].map(String).join(' ');
      if (/[０-９ｘ]|Ｘ\s*\d/.test(txt)) wide.push(v.names[0] + ' ' + w.name);
    }
    const dh = Object.values(W).flatMap(v => v.names[0].startsWith('MSN-04FF') ? (v.weapons || []) : [])
      .find(w => /［照射］/.test(w.name));
    const dhFm = dh && T.fireMult(dh), dhSt = dh && T.parseStagger(dh);

    /* ── ④ 방아쇠 한 번의 횟수를 다 세는가 ──
       「18回攻撃」(하이뉴 집중포화 등 22종)을 1히트로, 「15発連続発射 x2回攻撃」을 1히트로,
       「2発同時発射 x2基 x2射 x3回攻撃」을 4히트로 셌다(2026-11-06 사용자 지적에서 번짐).
       반대로 조건이 붙은 값(「スキル発動中、… x3回攻撃」)은 평소 값이 아니다. */
    const countBad = [];
    let bareN = 0;
    for (const v of Object.values(W)) for (const w of (v.weapons || [])) {
      if (w.type === 'melee') continue;
      const m = /(?:^| \/ )(\d+)回攻撃/.exec(String((w.info || {})['備考'] || ''));
      if (!m) continue;
      bareN++;
      const got = (T.fireMult(w).nc || {}).n;
      if (got !== Number(m[1])) countBad.push(v.names[0] + ' ' + w.name + ' ' + got + '≠' + m[1]);
    }
    const fmOf = (ms, name, on) => {
      const v = Object.values(W).find(v => v.names[0] === ms + '_LV1');
      const w = v && v.weapons.find(w => w.name === name);
      const f = w && T.fireMult(w, on);
      return f && f.nc ? f.nc.n : null;
    };
    const counts = {
      '유니콘 각성 실드 판넬 15×2': [fmOf('ユニコーンガンダム［覚醒］', 'シールド・ファンネル［射出］'), 30],
      '내러티브 B2 2×13×2': [fmOf('ナラティブガンダム［B2装備］', 'S・B・ガトリングx2［射出］'), 52],
      '델타 카이 2×2×2×3': [fmOf('ガンダムデルタカイ', 'P・F・ファンネルx2［挟撃］'), 24],
      '델타 카이 n_i_t_r_o 켬 2×2×2×5': [fmOf('ガンダムデルタカイ', 'P・F・ファンネルx2［挟撃］', true), 40],
      '뉴건담 협격 평소 6×2': [fmOf('νガンダム', 'フィン・ファンネルx6［挟撃］'), 12],
      '뉴건담 협격 스킬 켬 6×3': [fmOf('νガンダム', 'フィン・ファンネルx6［挟撃］', true), 18],
      '밴시 노른 착탄·폭발 2회': [fmOf('バンシィ・ノルン', '［R・L］瞬光式徹甲榴弾'), 2],
      '설치 판넬 「累計46回」 은 방아쇠 횟수가 아니다': [fmOf('ナイチンゲール', 'ファンネルx4［設置］'), 4],
      '回攻撃 없는 연속 발사는 안 곱한다 (4発同時発射 x12発連続発射)': [fmOf('マ・クベ専用グフ', 'マ・クベ専用グフ用F・V［斉射］'), 4],
      // 2026-11-11 버그 탐색: 가타카나 「ニ発」(二 오기) · 「x2腕」 · 「x2丁」 를 못 읽었다
      'V2AB 베스버 「ニ発同時発射」 = 2': [fmOf('V2アサルトバスターガンダム', 'ヴェスバーx2'), 2],
      '함마 함마 「3発同時発射 x2腕」 = 6': [fmOf('ハンマ・ハンマ', '有線アーム式ビーム砲x2［挟撃］'), 6],
      'ZⅡ 「8発同時発射 x2丁」 = 16': [fmOf('ΖⅡ', 'ΖⅡ用C・バズーカ［散弾］x2'), 16]
    };
    return { n, withStag, withFoe, stag, foe, wide, countBad, bareN, counts,
      dh: dh ? { nc: dhFm.nc && dhFm.nc.n, ch: dhFm.ch && dhFm.ch.n, pct: dhSt.pct, pellets: dhSt.pellets } : null };
  });

  await br.close();

  console.log('무장 ' + r.n + '건 — 누적치 표기 ' + r.withStag + ' · 적 내성 감소 ' + r.withFoe + '\n');

  /* 「下記参照(150%)」 하나는 본문에 값이 없고 괄호에만 있다. 앱이 괄호값을 쓰는 것이
     이 한 건에서는 더 쓸모 있어 그대로 둔다 — 늘어나면 여기서 걸린다. */
  ok('누적치가 원문의 배수를 다 쓴다 (예외 1건)', r.stag.length <= 1, r.stag.slice(0, 5));
  ok('적 내성 감소 값이 원문에 있는 수다', r.foe.length === 0, r.foe.slice(0, 5));
  ok('무장 값 칸에 전각 숫자·ｘ 가 없다 (수집 때 반각으로 바꾼다)', r.wide.length === 0, r.wide.slice(0, 5));
  ok('D・H・ファンネル［照射］ = 2발 × 4회 (피해 8히트 · 누적치 40% × 8)',
    r.dh && r.dh.nc === 8 && r.dh.ch === 8 && r.dh.pct === 40 && r.dh.pellets === 8, r.dh);
  ok('「N回攻撃」 만 적힌 무장의 피해 히트가 N 이다', r.countBad.length === 0, r.countBad.slice(0, 5));
  ok('「N回攻撃」 만 적힌 무장을 실제로 쟀다', r.bareN >= 20, r.bareN);
  for (const [label, [got, want]] of Object.entries(r.counts)) ok(label + ' = ' + want, got === want, got);
  // 0 이면 「아무것도 안 쟀다」로도 통과한다 — 실제로 쟀는지 개수로 확인한다
  ok('잴 것이 실제로 있었다', r.withStag > 2000 && r.withFoe >= 30, { 누적치: r.withStag, 내성감소: r.withFoe });

  const v = vocabMiss();
  console.log('\n낱말 자물쇠 — 숫자 든 조각 ' + v.segs + ' · 소스가 모르는 말 ' + v.n + '조각 / ' + v.kinds + '종류');
  console.log('  많은 것: ' + v.top.map(([k, c]) => k + ' ' + c).join(' · '));
  ok('앱이 모르는 표기가 늘지 않았다 (' + VOCAB_MAX + ' 이하)', v.n <= VOCAB_MAX, { 지금: v.n, 자물쇠: VOCAB_MAX });
  ok('자물쇠가 헐거워지지 않았다 (줄었으면 낮춰 잠글 것)', v.n >= VOCAB_MAX - 40, { 지금: v.n, 자물쇠: VOCAB_MAX });

  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

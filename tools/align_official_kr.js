// 공식 한국어판(bo2.ggame.jp/kr) 표기로 사전을 맞춘다. 1회성 교정.
//   node tools/align_official_kr.js [--dry]
//
// 공지·개발 일지는 게임 내 스킬·무장 설명을 그대로 인용하므로 게임 내 표기로 본다.
// 예외 하나: 「よろけ」는 공식이 「비틀거림」이지만 「경직」을 유지한다 —
// 커뮤니티 통용 표기이고 지시서 용어집이 「비틀거림」을 ✗로 지정했다.
const fs = require('fs');
const path = require('path');
const dry = process.argv.includes('--dry');
const sample = process.argv.includes('--sample');
let shown = 0;

// 순서가 곧 규칙이다. 긴 것·좁은 것부터 — 「피해」를 먼저 바꾸면
// 「받는 피해」·「여 피해」가 사라져 被/与 구분이 무너진다.
const RULES = [
  [/속성피 피해/g, '속성 받는 대미지'],   // 射撃属性被ダメージ
  [/피 ?피해/g, '받는 대미지'],           // 被ダメージ
  [/받는 피해/g, '받는 대미지'],
  [/부여 피해/g, '가한 대미지'],          // 与ダメージ
  [/여 피해/g, '가한 대미지'],
  [/주는 피해/g, '가한 대미지'],
  [/피해/g, '대미지'],                    // ダメージ (마지막)
  [/스러스터/g, '슬러스터'],
  [/병장/g, '무장'],
  [/컴포지트 모터/g, '콤퍼짓 모터'],
  [/깔때기/g, '판넬'],                    // ファンネル
  [/정지 촬영/g, '정지 사격'],            // 停止撃ち
  [/이 기술/g, '본 스킬'],                // 本スキル
  [/사이코 ?뮤직/g, '사이코뮤 잭'],       // サイコミュジャック
  [/꽁꽁 박합|꽁꽂이|꽁꽂|경합\(鍔迫り合い\)/g, '격투 맞부딪힘'],
];
// 원문에 그 한자가 있을 때만 바꾼다. 「두부」(豆腐)·「배부」(配付) 같은
// 엉뚱한 말을 건드리지 않기 위한 조건이다.
const KEYED = [
  [/脚部/, /각부/g, '다리'], [/頭部/, /두부/g, '머리'],
  [/背部/, /배부/g, '등'], [/左腕/, /좌완/g, '왼팔'],
];
// 「자기」 단독 치환은 금지 — 이미 「자기 기체」·「자기군」이 든 칸이 있어
// 「자기 기체 기체」가 된다. 뒤에 붙는 말을 보고 비켜 간다.
const SELF = /자기(?!\s?기체|군|의|는|가|장|력|만|도|를)/g;

const PROT = /(「[^」]*」|'[^']*'|"[^"]*"|【[^】]*】)/g;
const num = s => (String(s).match(/\d+(?:\.\d+)?/g) || []).join(',');

function convert(k, v) {
  const seg = s => {
    let t = RULES.reduce((a, [re, to]) => a.replace(re, to), s);
    for (const [jp, re, to] of KEYED) if (jp.test(k)) t = t.replace(re, to);
    if (/自機/.test(k)) t = t.replace(SELF, '자기 기체');
    return t;
  };
  return v.split(PROT).map((x, i) => i % 2 ? x : seg(x)).join('');
}

let total = 0, skipped = 0;
for (const f of ['skill_text', 'weapon_note', 'weapons', 'parts', 'ms', 'misc']) {
  const p = path.join(__dirname, '..', 'data', 'i18n', f + '.json');
  let o; try { o = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  let n = 0;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') {
      const t = convert(k, v);
      if (t === v) continue;
      if (num(t) !== num(v)) { skipped++; continue; }
      if (sample && shown < 6 && /자기|속성피|여 피해|병장|각부|좌완|깔때기|꽁/.test(v)) {
        console.log(`JP  ${k.slice(0, 58)}
전  ${v.slice(0, 100)}
후  ${t.slice(0, 100)}
`);
        shown++;
      }
      if (!dry) o[k] = t; n++;
    } else if (v && typeof v === 'object') {
      for (const fld of ['n', 'd']) {
        if (typeof v[fld] !== 'string') continue;
        const t = convert(k, v[fld]);
        if (t === v[fld]) continue;
        if (num(t) !== num(v[fld])) { skipped++; continue; }
        if (!dry) v[fld] = t; n++;
      }
    }
  }
  if (n && !dry) fs.writeFileSync(p, JSON.stringify(o, null, 1) + '\n', 'utf8');
  console.log(`  ${f.padEnd(12)} ${n}칸`);
  total += n;
}
console.log(`공식 표기 정렬 ${total}칸 · 숫자가 바뀌어 건너뛴 칸 ${skipped}`);

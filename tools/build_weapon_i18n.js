// 무장명 한글 사전(data/i18n/weapons.json)을 규칙 기반으로 만든다.
//   node tools/build_weapon_i18n.js
//
// 1) 「<기체명>用」 접두사는 기존 기체 사전(ms.json)으로 옮긴다
// 2) 용어 사전(weapon_terms.json)을 긴 표기부터 치환한다
// 3) 남은 가타카나는 음역한다 (영어 외래어라 완벽하진 않아 리포트로 남긴다)
//
// 사람이 손본 결과는 weapons.override.json 에 두면 항상 우선 적용된다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N = path.join(ROOT, 'data', 'i18n');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const weapons = readJson(path.join(ROOT, 'data', 'weapons.json'));
const msDict = readJson(path.join(I18N, 'ms.json'));
const terms = readJson(path.join(I18N, 'weapon_terms.json'));
const overridePath = path.join(I18N, 'weapons.override.json');
const override = fs.existsSync(overridePath) ? readJson(overridePath) : {};

const NFC = s => s.normalize('NFC');

/* ---------- 가타카나 음역 ---------- */
// 두 글자 조합(拗音)을 먼저 보고, 그다음 한 글자를 본다.
const KANA2 = {
  'ヴァ': '바', 'ヴィ': '비', 'ヴェ': '베', 'ヴォ': '보',
  'ファ': '파', 'フィ': '피', 'フェ': '페', 'フォ': '포',
  'ティ': '티', 'ディ': '디', 'デュ': '듀', 'テュ': '튜', 'トゥ': '투', 'ドゥ': '두',
  'シャ': '샤', 'シュ': '슈', 'ショ': '쇼', 'シェ': '셰', 'スィ': '시',
  'ジャ': '자', 'ジュ': '주', 'ジョ': '조', 'ジェ': '제', 'ズィ': '지',
  'チャ': '차', 'チュ': '추', 'チョ': '초', 'チェ': '체',
  'キャ': '캬', 'キュ': '큐', 'キョ': '쿄', 'クァ': '콰', 'クィ': '퀴', 'クェ': '퀘', 'クォ': '쿼',
  'ギャ': '갸', 'ギュ': '규', 'ギョ': '교', 'グァ': '과',
  'ニャ': '냐', 'ニュ': '뉴', 'ニョ': '뇨', 'ヒャ': '햐', 'ヒュ': '휴', 'ヒョ': '효',
  'ビャ': '뱌', 'ビュ': '뷰', 'ビョ': '뵤', 'ピャ': '퍄', 'ピュ': '퓨', 'ピョ': '표',
  'ミャ': '먀', 'ミュ': '뮤', 'ミョ': '묘', 'リャ': '랴', 'リュ': '류', 'リョ': '료',
  'ツァ': '차', 'ツィ': '치', 'ツェ': '체', 'ツォ': '초',
  'ウィ': '위', 'ウェ': '웨', 'ウォ': '워', 'イェ': '예'
};
const KANA1 = {
  'ア': '아', 'イ': '이', 'ウ': '우', 'エ': '에', 'オ': '오',
  'カ': '카', 'キ': '키', 'ク': '쿠', 'ケ': '케', 'コ': '코',
  'ガ': '가', 'ギ': '기', 'グ': '구', 'ゲ': '게', 'ゴ': '고',
  'サ': '사', 'シ': '시', 'ス': '스', 'セ': '세', 'ソ': '소',
  'ザ': '자', 'ジ': '지', 'ズ': '즈', 'ゼ': '제', 'ゾ': '조',
  'タ': '타', 'チ': '치', 'ツ': '츠', 'テ': '테', 'ト': '토',
  'ダ': '다', 'ヂ': '지', 'ヅ': '즈', 'デ': '데', 'ド': '도',
  'ナ': '나', 'ニ': '니', 'ヌ': '누', 'ネ': '네', 'ノ': '노',
  'ハ': '하', 'ヒ': '히', 'フ': '후', 'ヘ': '헤', 'ホ': '호',
  'バ': '바', 'ビ': '비', 'ブ': '부', 'ベ': '베', 'ボ': '보',
  'パ': '파', 'ピ': '피', 'プ': '푸', 'ペ': '페', 'ポ': '포',
  'マ': '마', 'ミ': '미', 'ム': '무', 'メ': '메', 'モ': '모',
  'ヤ': '야', 'ユ': '유', 'ヨ': '요',
  'ラ': '라', 'リ': '리', 'ル': '루', 'レ': '레', 'ロ': '로',
  'ワ': '와', 'ヲ': '오', 'ヴ': '브',
  'ァ': '아', 'ィ': '이', 'ゥ': '우', 'ェ': '에', 'ォ': '오',
  'ャ': '야', 'ュ': '유', 'ョ': '요', 'ー': ''
};

/** 받침을 앞 음절에 합친다. ン→ㄴ, ッ→ㅅ */
const JONG = { 'ン': 4, 'ッ': 19 };
function attachJong(out, kana) {
  const last = out[out.length - 1];
  const code = last ? last.charCodeAt(0) - 0xAC00 : -1;
  if (code >= 0 && code < 11172 && code % 28 === 0) {
    out[out.length - 1] = String.fromCharCode(0xAC00 + code + JONG[kana]);
  } else if (kana === 'ン') out.push('은');
}

function translitKana(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    const two = s.slice(i, i + 2);
    if (KANA2[two]) { out.push(KANA2[two]); i += 2; continue; }
    const one = s[i];
    if (JONG[one]) { attachJong(out, one); i++; continue; }
    if (KANA1[one] !== undefined) { out.push(KANA1[one]); i++; continue; }
    out.push(one); i++;
  }
  return out.join('');
}

/* ---------- 이름 변환 ---------- */
const msNames = Object.keys(msDict).sort((a, b) => b.length - a.length);
const termKeys = Object.keys(terms).filter(k => !k.startsWith('_')).sort((a, b) => b.length - a.length);

/** 한글·영숫자끼리 맞닿을 때만 공백을 넣는다 (「・」「［」 옆에는 넣지 않는다) */
const wordish = c => c && /[가-힣A-Za-z0-9]/.test(c);
/** 숫자 바로 뒤(3연장 등)와 한글+영문 경계는 붙여 쓴다 */
const noGap = (a, b) => /[0-9]/.test(a) || /[0-9]/.test(b);
function joinParts(parts) {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    const prev = out[out.length - 1];
    if (out && wordish(prev) && wordish(p[0]) && !noGap(prev, p[0])) out += ' ';
    out += p;
  }
  return out;
}

function translate(name) {
  let s = NFC(name);

  // 1) 「<기체명>用」 접두사
  const hit = msNames.find(m => s.startsWith(NFC(m) + '用'));
  let prefix = '';
  if (hit) { prefix = msDict[hit] + '용'; s = s.slice(NFC(hit).length + 1); }

  // 2) 용어 사전 (긴 것부터). 번역한 자리는 인덱스 마커로 표시해 둔다.
  //    공백으로 감싸면 용어가 붙어 있을 때 경계가 어긋난다.
  const hits = [];
  for (const k of termKeys) {
    if (!s.includes(k)) continue;
    s = s.split(k).join('{{' + hits.length + '}}');
    hits.push(terms[k]);
  }

  // 3) 마커 사이(= 아직 일본어인 부분)만 음역한다
  const parts = s.split(/\{\{(\d+)\}\}/)
    .map((seg, i) => (i % 2 ? hits[Number(seg)] : translitKana(seg)));

  const ko = joinParts(prefix ? [prefix, ...parts] : parts);
  // 기존 기체·파츠 사전과 표기를 맞춘다 — 「・」는 공백, 전각 괄호는 ASCII 로
  return ko
    .replace(/・/g, ' ')
    .replace(/［/g, '[').replace(/］/g, ']')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/＆/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\s+([\])])/g, '$1').replace(/([[(])\s+/g, '$1')
    // 「型」「式」은 앞말에 붙는 접미사다 — 따로 떼면 「육전 형 실드」처럼 어색해진다
    .replace(/([가-힣]) (형|식)(?![가-힣])/g, '$1$2')
    .trim();
}

/* ---------- 실행 ---------- */
const names = new Set();
for (const page of Object.values(weapons)) for (const w of page.weapons) names.add(w.name);

const dict = {};
const leftover = [];
for (const n of [...names].sort()) {
  const ko = override[n] || translate(n);
  dict[n] = ko;
  if (/[ぁ-んァ-ヶ一-龯]/.test(ko)) leftover.push(n + ' → ' + ko);
}

const dest = path.join(I18N, 'weapons.json');
fs.writeFileSync(dest, JSON.stringify(dict, null, 1));

const done = names.size - leftover.length;
console.log(`무장명 ${names.size}종 → 한글 ${done}종 (${(done / names.size * 100).toFixed(1)}%)`);
console.log('→', path.relative(process.cwd(), dest), (fs.statSync(dest).size / 1024).toFixed(0) + 'KB');
if (leftover.length) {
  console.log(`\n일본어가 남은 항목 ${leftover.length}건 (weapon_terms.json 에 용어를 더하면 줄어듭니다)`);
  console.log('  ' + leftover.slice(0, 20).join('\n  '));
}

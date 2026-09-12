// 번역 잔여 문제 감사 — 대조 검사(check_glossary)가 안 보는 자리를 훑는다.
//   node tools/audit_translation.js [출력.json]
// 대조 검사는 정해 둔 핵심어 6종만 본다. 그 밖의 오역은 여기서 잡는다.
// 오탐을 줄이려고 「원문에 이 말이 있으면 정상」 조건을 함께 둔다.
const fs = require('fs');
const path = require('path');
const F = ['skill_text', 'weapon_note'];
// [갈래, 설명, 번역쪽 패턴, 이 원문이면 오탐]
const CAT = [
  ['피피해', '被ダメージ → 「피 피해」·「속성피」 (바른말: 받는 피해)', /피 ?피해|속성피/, null],
  ['여피해', '与ダメージ → 「여 피해」·「부여 피해」 (바른말: 주는 피해)', /여 피해|부여 피해/, null],
  ['자기', '自機 → 「자기」 (재귀대명사로 읽힌다. 바른말: 자기[自機]·아군기)', /자기(?![의는가])/, null],
  ['판넬', 'ファンネル → 「깔때기」 (바른말: 판넬)', /깔때기/, null],
  ['정지사격', '停止撃ち → 「정지 촬영」 (바른말: 정지 사격)', /정지 촬영/, null],
  ['츠바제리', '鍔迫り合い → 「꽁꽂이」·「꽁꽁 박합」 (바른말: 칼겨룸)', /꽁/, null],
  ['튕겨냄', '弾く → 「연주」 (바른말: 튕겨낸다)', /연주/, /弾く|弾き/],
  ['본스킬', '本スキル → 「이 기술」 (다른 칸은 「본 스킬」)', /이 기술/, null],
  ['사이코뮤잭', 'サイコミュジャック → 「사이코 뮤직」', /사이코 ?뮤직/, null],
  ['경직잔재', 'よろけ 잔재 「충격」·「여유」', /충격|여유/, /衝撃|余裕/],
];
const out = { _설명: '대조 검사가 안 보는 잔여 오역. Claude Code ' + new Date().toISOString().slice(0, 10), _요약: {} };
for (const [id, desc, re, ok] of CAT) {
  const rows = [];
  for (const f of F) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'i18n', f + '.json'), 'utf8'));
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'string' || !re.test(v)) continue;
      if (ok && ok.test(k)) continue;          // 원문이 실제로 그 말이면 오탐
      rows.push({ 파일: f, 원문: k, 현재: v });
    }
  }
  out._요약[id] = rows.length;
  out[id] = { 설명: desc, 목록: rows };
}
const dst = process.argv[2] || 'translation_audit.json';
fs.writeFileSync(dst, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(Object.entries(out._요약).map(([k, n]) => k + ' ' + n).join(' · '));
console.log('합계 ' + Object.values(out._요약).reduce((a, b) => a + b, 0) + '칸 → ' + dst);

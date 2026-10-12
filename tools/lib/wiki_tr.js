// 위키 「アップデート履歴」(패치 내역) 줄을 한국어로 옮긴다.
//
// 왜 — 위키 이력은 **수치 변화의 가장 완전한 기록**이다. 공식 공지가 389개를 적을 때
// 위키는 423개를 적는다(2026-10-10 실측). 공식이 아예 말하지 않은 변화까지 들어 있다.
// 그런데 일본어라 접어 둘 수밖에 없었다 — 옮기면 그 423개가 전부 읽힌다.
//
// **공식 표기가 이긴다**(사용자 지시). 위키와 공식이 다른 말을 쓰면 공식을 따른다 —
// 게임 안에서 보이는 말이기 때문이다. 예: 連射性能 → 「연사 속도」(공식), 切り替え時間 →
// 「무장 전환 시간」(공식), ASL(自動標準補正) → 「ASL(자동 조준 보정)」(공식. 위키 쪽 오기도 받는다).
//
// **지어내지 않는다.** 사전에 없는 말은 일본어 원문 그대로 남는다 — 옮긴 척하는 것보다
// 안 옮긴 티가 나는 쪽이 낫다. 얼마나 남았는지는 자(wikitr_check)가 센다.
//
// 이름은 **이미 있는 사전**을 쓴다. 스킬은 skill_text.json·skills.json, 무장은 weapons.json.
// 여기에 또 적으면 두 벌이 되어 언젠가 갈린다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const rd = p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return {}; } };

const TERMS = (() => {
  const raw = rd('data/i18n/wiki_terms.json');
  /* 긴 표기부터 — 「オーバーヒート復帰時間」이 「オーバーヒート」보다 먼저 걸려야 한다. */
  return Object.entries(raw).filter(([k]) => !k.startsWith('_'))
    .sort((a, b) => b[0].length - a[0].length);
})();

const SKILL = Object.assign({}, rd('data/i18n/skills.json'), rd('data/i18n/skill_text.json'));
const WEAPON = rd('data/i18n/weapons.json');
/* 위키 이력에는 무장 표에 **없는 이름**이 나온다(ウインチキャノン · ビーム・ガトリングx2 등).
   무장명 사전을 만드는 그 규칙을 그대로 빌려 쓴다 — 여기에 또 적으면 두 벌이 되어 갈라진다.
   (build_weapon_i18n 은 직접 돌렸을 때만 사전을 다시 만든다. require 는 규칙만 가져온다) */
let WTR = null;
try { WTR = require('../build_weapon_i18n.js').translate; } catch (e) { WTR = null; }

const NFC = s => String(s == null ? '' : s).normalize('NFC');
/** 스킬·무장 사전에서 찾는다(앞뒤 공백·전각 차이를 넘기려고 NFC 로 맞춘다) */
const skillKo = ja => SKILL[NFC(ja)] || null;
const weaponKo = ja => WEAPON[NFC(ja)] || null;

/** 일본어 글자가 남아 있는가 — 안 옮겨진 것을 세는 데 쓴다 */
const hasJa = s => /[ぁ-んァ-ヶ一-鿿]/.test(String(s || ''));

/** 동작어로 끝나는 줄 = 항목이지 이름이 아니다 — 이름인 줄 알고 음역하면 문장이 부서진다 */
const ACTION_END = /(上昇|低下|短縮|軽減|延長|増加|減少|緩和|付与|統合|拡大|改善|変更|追加|削除|向上|強化|弱体|低減|解除|付加|可能)$/;

/**
 * 한 줄을 옮긴다.
 *
 * 차례가 중요하다:
 *   ① 무장 이름이면 통째로 바꾼다 — 안쪽 낱말을 먼저 건드리면 이름이 부서진다.
 *   ② 「スキル「X」」 의 X 는 스킬 사전으로 — 용어 치환이 X 안을 헤집지 않게 먼저 뗀다.
 *   ③ 남은 글을 용어 사전으로 긴 것부터.
 */
function trLine(text) {
  let s = NFC(text);
  if (!s) return '';

  // ① 줄 전체가 무장 이름인 경우(이력은 무장을 한 줄로 적는다)
  const w = weaponKo(s);
  if (w) return w;
  /* 사전에 없는 무장 이름이면 같은 규칙으로 옮긴다. **이름처럼 생긴 줄만** —
     동작어로 끝나거나 값(→·콜론)이 든 줄은 이름이 아니다. 잘못 넘기면 문장이 통째로 음역된다. */
  if (WTR && !/→|[：:]/.test(s) && !ACTION_END.test(s) && /[ァ-ヶー]/.test(s)) {
    const byRule = WTR(s);
    if (byRule && !hasJa(byRule)) return byRule;
  }

  // ② 스킬 이름을 먼저 떼어 자리표로 바꾼다
  const held = [];
  /* 사전에 **있는** 이름만 떼어 둔다. 없는데도 떼면 그 안의 말이 용어 치환을 못 받아
     「能力UP「覚醒（B）」」처럼 중첩된 이름이 통째로 일본어로 남는다(실제로 그랬다). */
  s = s.replace(/「([^」]+)」/g, (m, inner) => {
    const ko = skillKo(inner);
    if (!ko) return m;
    held.push('「' + ko + '」');
    return '\u0000' + (held.length - 1) + '\u0000';
  });

  // ③ 용어 — 긴 것부터
  for (const [ja, ko] of TERMS) if (s.includes(ja)) s = s.split(ja).join(ko);

  // 자리표를 되돌린다
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => held[Number(i)]);

  /* 동작어 앞에 공백을 넣어 뒀으므로 겹친 공백을 정리한다.
     「LV1-4機体：」 처럼 콜론 앞뒤가 붙는 자리는 건드리지 않는다. */
  return s.replace(/\s+/g, ' ').replace(/\s+([,.)\]」])/g, '$1').trim();
}

/** 이력 줄 목록을 통째로 — { depth, text, buff } 에 ko 를 더해 돌려준다 */
function trLines(lines) {
  if (!Array.isArray(lines)) return lines;
  return lines.map(x => {
    const ko = trLine(x.text);
    /* 옮긴 뒤에도 일본어가 남았는지 적어 둔다 — 화면이 원문을 함께 보여 줄 수 있다. */
    return ko === x.text ? { ...x, ko } : { ...x, ko, left: hasJa(ko) };
  });
}

module.exports = { trLine, trLines, hasJa, TERMS, skillKo, weaponKo };

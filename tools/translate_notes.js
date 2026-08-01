// 무장 備考(설명)를 온라인 번역(구글)으로 한글화해 data/i18n/weapon_note.json 캐시.
//   node tools/translate_notes.js
// - 備考는 원본 <br>(→' / ') 로 나뉜 불릿 목록. gtx 가 다중 불릿을 한 세그먼트로 보고
//   잘라 반환하므로, ' / ' 로 쪼개 불릿별로 번역 후 재조합한다(불릿 캐시로 중복 제거).
// - 캐시에 있으면 건너뜀(증분). 실패분은 원문 유지, 다음 실행에 재시도.
const fs = require('fs');
const path = require('path');
const { translate: one, hasJa, sleep } = require('./lib/mt.js');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const rdSafe = (...p) => { try { return rd(...p); } catch { return {}; } };

// MT 가 게임 용어(よろけ→"괜찮아", ひるみ→"히루미")를 오역하므로, 빈출 정형 불릿은 직접 번역한다.
// 값이 들어가는 항목은 패턴(regex)으로, 고정 문구는 정확 일치로 처리하고, 나머지만 MT 로 넘긴다.
const NOTE_PATTERNS = [
  [/^よろけ値：(.+)$/, '비틀림 수치: $1'],
  [/^非集束よろけ値：(.+)$/, '비집속 비틀림 수치: $1'],
  [/^集束よろけ値：(.+)$/, '집속 비틀림 수치: $1'],
  [/^局部補正：(.+)$/, '국부 보정: $1'],
  [/^シールド補正：(.+)$/, '실드 보정: $1'],
  [/^集束時間：(.+)$/, '집속 시간: $1'],
  [/^切替時間：(.+)$/, '전환 시간: $1'],
  [/^倍率：(.+)$/, '배율: $1'],
  [/^効果時間は?[、,]?\s*(.+)$/, '효과 시간: $1'],
  [/^約(.+?)長押しでロックオン$/, '약 $1 길게 눌러 록온']
];
// 스킬명 사전(스킬 패널 번역분) — 備考의 「スキル「XXX」対応」 XXX 를 옮긴다.
const SKILL_NAMES = rdSafe('data', 'i18n', 'skill_text.json');
// 값에 남는 단위를 우리말로 (패턴 값·MT 결과 공통). 発 은 「발사」처럼 이미 번역된 곳엔 없다.
const cleanUnits = s => String(s).replace(/秒/g, '초').replace(/倍/g, '배').replace(/発/g, '발').replace(/回/g, '회');
const NOTE_EXACT = {
  '移動射撃可': '이동 사격 가능', 'ブースト射撃可': '부스트 사격 가능', '空中射撃可': '공중 사격 가능',
  'ジャンプ射撃可': '점프 사격 가능', '射撃時静止': '사격 시 정지', '集束可': '집속 가능',
  '集束必須': '집속 필수', '集束中移動可': '집속 중 이동 가능', 'よろけ有': '비틀림 있음',
  '大よろけ有': '큰 비틀림 있음', '即撃ちよろけ有': '즉시발사 비틀림 있음', '集束時よろけ有': '집속 시 비틀림 있음',
  '集束時大よろけ有': '집속 시 큰 비틀림 있음', 'ひるみ有': '움찔 있음', 'のけぞり有': '젖혀짐 있음',
  'ユニット貫通効果有': '유닛 관통 효과 있음', '集束時ユニット貫通効果有': '집속 시 유닛 관통 효과 있음',
  'ユニット貫通効果': '유닛 관통 효과', 'ASL（自動照準補正）有': 'ASL(자동 조준 보정) 있음',
  '照準誘導効果有': '조준 유도 효과 있음', '照準補正有': '조준 보정 있음', 'Eパック式弾数所持': 'E팩식 탄수 보유',
  '連撃不可': '연격 불가', '左右交互発射': '좌우 교대 발사', '武装Lvは機体Lv依存': '무장 LV는 기체 LV 의존',
  '水中時使用不可': '수중 시 사용 불가', '＜通常時＞使用可': '<통상시> 사용 가능', '＜変形時＞使用可': '<변형시> 사용 가능',
  '＜変身時＞使用可': '<변신시> 사용 가능', '二発同時発射': '2발 동시 발사', '三発同時発射': '3발 동시 발사',
  '高速移動中にロックオン＆射出可': '고속 이동 중 록온&사출 가능', 'ロックオン後高速移動可': '록온 후 고속 이동 가능',
  'ロックオン後ブースト移動可': '록온 후 부스트 이동 가능', '移動射撃不可': '이동 사격 불가',
  '射撃時静止（移動射撃可）': '사격 시 정지(이동 사격 가능)', 'ダウン有': '다운 있음',
  '曲射': '곡사', '直射': '직사', 'ダメージリアクション無し': '데미지 리액션 없음'
};
// 정형 불릿을 우리말로. 처리했으면 문자열, 아니면 null(→ MT).
function curated(b) {
  if (NOTE_EXACT[b] != null) return cleanUnits(NOTE_EXACT[b]);
  const sk = b.match(/^スキル「(.+?)」(対応|発動|付与)$/);
  if (sk) return '스킬 「' + (SKILL_NAMES[sk[1]] || sk[1]) + '」 ' + { 対応: '대응', 発動: '발동', 付与: '부여' }[sk[2]];
  for (const [re, ko] of NOTE_PATTERNS) { const m = b.match(re); if (m) return cleanUnits(b.replace(re, ko)); }
  return null;
}

(async () => {
  const weapons = rd('data', 'weapons.json');
  const cache = rdSafe('data', 'i18n', 'weapon_note.json');

  // 고유 備考 수집 (info + 레벨별 raw)
  const notes = new Set();
  for (const id in weapons) for (const x of weapons[id].weapons) {
    if (x.info && x.info['備考']) notes.add(x.info['備考']);
    for (const l of Object.values(x.levels || {})) if (l.raw && l.raw['備考']) notes.add(l.raw['備考']);
  }
  const todo = [...notes].filter(n => !cache[n]);
  console.log(`번역 대상 고유 備考 ${todo.length}개 (캐시 ${Object.keys(cache).length})`);

  const partCache = new Map();
  async function trPart(p) {
    if (partCache.has(p)) return partCache.get(p);
    const cur = curated(p);                 // 정형 불릿은 MT 안 거치고 정확 번역
    if (cur != null) { partCache.set(p, cur); return cur; }
    const ko = await one(p);
    const v = (ko && !hasJa(ko)) ? cleanUnits(ko) : null;   // MT 결과에 남은 단위도 정리
    partCache.set(p, v);
    await sleep(80);
    return v;
  }
  let done = 0, failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const jp = todo[i];
    const kos = [];
    let ok = true;
    for (const p of jp.split(' / ')) {
      const kp = await trPart(p.trim());
      if (kp == null) { ok = false; kos.push(p.trim()); } else kos.push(kp);
    }
    cache[jp] = kos.join(' / ');
    ok ? done++ : failed++;
    if (i % 15 === 0 || i === todo.length - 1) {
      fs.writeFileSync(path.join(ROOT, 'data', 'i18n', 'weapon_note.json'), JSON.stringify(cache, null, 1) + '\n');
      process.stdout.write(`\r  번역 ${i + 1}/${todo.length} (불릿 ${partCache.size})`);
    }
  }
  console.log(`\n완료: 신규 ${done} · 실패/잔존 ${failed} → data/i18n/weapon_note.json (총 ${Object.keys(cache).length})`);
})().catch(e => console.log('translate_notes 경고: ' + e.message));

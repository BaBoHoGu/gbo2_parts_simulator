// 무장 備考(설명)를 온라인 번역(구글)으로 한글화해 data/i18n/weapon_note.json 캐시.
//   node tools/translate_notes.js
// - 備考는 원본 <br>(→' / ') 로 나뉜 불릿 목록. gtx 가 다중 불릿을 한 세그먼트로 보고
//   잘라 반환하므로, ' / ' 로 쪼개 불릿별로 번역 후 재조합한다(불릿 캐시로 중복 제거).
// - 캐시에 있으면 건너뜀(증분). 실패분은 원문 유지, 다음 실행에 재시도.
const fs = require('fs');
const path = require('path');
const { translate: one, hasJa, sleep } = require('./lib/mt.js');
const { protect, post } = require('./lib/glossary.js');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const rdSafe = (...p) => { try { return rd(...p); } catch { return {}; } };

// MT 가 게임 용어(よろけ→"괜찮아", ひるみ→"히루미")를 오역하므로, 빈출 정형 불릿은 직접 번역한다.
// 값이 들어가는 항목은 패턴(regex)으로, 고정 문구는 정확 일치로 처리하고, 나머지만 MT 로 넘긴다.
const NOTE_PATTERNS = [
  [/^よろけ値：(.+)$/, '경직치: $1'],
  [/^非集束よろけ値：(.+)$/, '비집속 경직치: $1'],
  [/^集束よろけ値：(.+)$/, '집속 경직치: $1'],
  [/^局部補正：(.+)$/, '국부 보정: $1'],
  [/^シールド補正：(.+)$/, '실드 보정: $1'],
  [/^集束時間：(.+)$/, '집속 시간: $1'],
  [/^切替時間：(.+)$/, '전환 시간: $1'],
  [/^倍率：(.+)$/, '배율: $1'],
  // 「効果時間：15秒」·「効果時間は、30秒」만. 「は?」를 선택으로 두면
  // 「効果時間終了後、…使用不可」까지 먹어 뒷문장이 일본어로 남는다.
  [/^効果時間(?:：|は[、,]?\s*)(.+)$/, '효과 시간: $1'],
  [/^約(.+?)長押しでロックオン$/, '약 $1 길게 눌러 록온']
];
// 스킬명 사전(스킬 패널 번역분) — 備考의 「スキル「XXX」対応」 XXX 를 옮긴다.
const SKILL_NAMES = rdSafe('data', 'i18n', 'skill_text.json');
// 값에 남는 단위·낱말을 우리말로. MT 는 「x3射」·「450発/分」처럼 숫자에 붙은
// 단위를 자주 남긴다 — 덩어리가 아니라 낱글자라 재번역보다 치환이 정확하다.
const UNITS = [['秒','초'],['倍','배'],['発','발'],['回','회'],['射','사'],['分','분'],
  ['等','등'],['最大','최대'],['ヒット','히트'],['腕','팔'],['門','문'],['丁','정'],['基','기'],['合計','합계'],['約','약'],['他','기타'],['共鳴','공명']];
const cleanUnits = s => UNITS.reduce((a, [ja, ko]) => a.split(ja).join(ko), String(s));
const NOTE_EXACT = {
  /* ブースト射撃 계열은 「고속 이동」으로 적는다(사용자 결정, 2026-09-23).
     저장소 안에서 「부스트 사격 가능」과 「고속 이동 사격 가능」이 갈려 있었다 —
     정형표는 부스트, 쌓인 캐시는 대부분 고속 이동이었다. 게임에서 ブースト移動 과
     高速移動 은 같은 동작이고, 한 불릿에 둘이 같이 나오는 자리는 **0건**이라 헷갈릴 일이 없다.
     스킬 **이름**의 「부스트」(EX 부스트·오버 부스트·슈팅 부스트…)는 고유명사라 그대로 둔다. */
  '移動射撃可': '이동 사격 가능', 'ブースト射撃可': '고속 이동 사격 가능', '空中射撃可': '공중 사격 가능',
  'スキル発動中、ブースト射撃可': '스킬 발동 중 고속 이동 사격 가능',
  'スキル発動中ブースト射撃可': '스킬 발동 중 고속 이동 사격 가능',
  'ブースト射撃不可': '고속 이동 사격 불가',
  'ジャンプ射撃可': '점프 사격 가능', '射撃時静止': '사격 시 정지', '集束可': '집속 가능',
  '集束必須': '집속 필수', '集束中移動可': '집속 중 이동 가능', 'よろけ有': '경직 있음',
  '大よろけ有': '강경직 있음', '即撃ちよろけ有': '즉시발사 경직 있음', '集束時よろけ有': '집속 시 경직 있음',
  '集束時大よろけ有': '집속 시 강경직 있음', 'ひるみ有': '움찔 있음', 'のけぞり有': '젖혀짐 있음',
  // 「無」를 안 적어 두면 MT 가 「음찔무」처럼 음차하거나 아예 떨어뜨려 **뜻이 뒤집힌다**
  'ひるみ無': '움찔 없음', '非集束時ひるみ無': '비집속시 움찔 없음',
  'ユニット貫通効果有': '유닛 관통 효과 있음', '集束時ユニット貫通効果有': '집속 시 유닛 관통 효과 있음',
  'ユニット貫通効果': '유닛 관통 효과', 'ASL（自動照準補正）有': 'ASL(자동 조준 보정) 있음',
  '照準誘導効果有': '조준 유도 효과 있음', '照準補正有': '조준 보정 있음', 'Eパック式弾数所持': 'E팩식 탄수 보유',
  '連撃不可': '연격 불가', '左右交互発射': '좌우 교대 발사', '武装Lvは機体Lv依存': '무장 LV는 기체 LV 의존',
  '水中時使用不可': '수중 시 사용 불가', '＜通常時＞使用可': '<통상시> 사용 가능', '＜変形時＞使用可': '<변형시> 사용 가능',
  '＜変身時＞使用可': '<변신시> 사용 가능', '二発同時発射': '2발 동시 발사', '三発同時発射': '3발 동시 발사',
  '高速移動中にロックオン＆射出可': '고속 이동 중 록온&사출 가능', 'ロックオン後高速移動可': '록온 후 고속 이동 가능',
  'ロックオン後ブースト移動可': '록온 후 고속 이동 가능', '移動射撃不可': '이동 사격 불가',
  '射撃時静止（移動射撃可）': '사격 시 정지(이동 사격 가능)', 'ダウン有': '다운 있음',
  '曲射': '곡사', '直射': '직사', 'ダメージリアクション無し': '데미지 리액션 없음'
};
// 스킬명을 사전에서 찾는다. 그냥 찾으면 두 가지로 빗나간다.
//   · 「ＺＥＲＯシステム」(전각)은 있는데 「ZEROシステム」(반각)은 없다 — 같은 스킬의 표기 흔들림
//   · 사전 키에 위키의 불확실 표시 「?」가 붙어 있다(「フィン・ノズル制御機構?」)
// 못 찾으면 일본어로 떨어지고, 그 결과가 캐시에 남아 다시 시도되지 않았다.
const wide = s => s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
function skillName(jp) {
  for (const k of [jp, jp + '?', jp.replace(/\?$/, '')]) if (SKILL_NAMES[k]) return strip(SKILL_NAMES[k]);
  // 전·반각을 맞춰 한 번 더
  const w = wide(jp);
  for (const k of Object.keys(SKILL_NAMES)) if (wide(k).replace(/\?$/, '') === w) return strip(SKILL_NAMES[k]);
  return jp;
}
// 사전값 끝의 「?」는 위키의 불확실 표시라 이름의 일부가 아니다.
const strip = v => String(v).replace(/\?+$/, '').trim();

// 정형 불릿을 우리말로. 처리했으면 문자열, 아니면 null(→ MT).
function curated(b) {
  if (NOTE_EXACT[b] != null) return cleanUnits(NOTE_EXACT[b]);
  const sk = b.match(/^スキル「(.+?)」(対応|発動|付与)$/);
  if (sk) return '스킬 「' + skillName(sk[1]) + '」 ' + { 対応: '대응', 発動: '발동', 付与: '부여' }[sk[2]];
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

  /* 이미 쌓인 캐시도 훑어 고친다 — 번역기는 캐시에 있는 칸을 건너뛰므로,
     post() 를 새로 넣어도 예전에 어긋난 채 저장된 칸에는 손이 닿지 않는다.
     사전은 생성물이지만 이 캐시만은 다시 만들어지지 않으니, 여기서 스스로 고치게 둔다. */
  {
    let fixed = 0;
    for (const [k, v] of Object.entries(cache)) {
      if (typeof v !== 'string') continue;
      const p = post(v);
      if (p !== v) { cache[k] = p; fixed++; }
    }
    /* 이미 저장된 칸의 **뜻이 틀린 불릿**만 정형표 값으로 고친다.
       캐시는 다시 안 만들어지므로 정형표에 낱말을 새로 넣어도 옛 칸에는 손이 안 닿는다 —
       「ひるみ無」가 「움찔」(반대 뜻)로 굳어 있던 것이 그래서였다.

       **정형표 전체로 맞추면 안 된다.** 한 번 그렇게 했더니 「ブースト射撃可」가 382칸에서
       「고속 이동 사격 가능」 → 「부스트 사격 가능」으로 밀렸다. 그건 틀린 게 아니라
       **말이 갈린 것**이고(저장소 안에서 둘 다 쓰인다), 어느 쪽으로 할지는 사람이 정할 일이다.
       그래서 여기 적은 것만 고친다. 고칠 것이 생기면 이유와 함께 한 줄씩 더한다. */
    const REPAIR = new Set([
      'ひるみ無', '非集束時ひるみ無',   // 「움찔」로 굳어 **반대 뜻**이 됐다 (2026-09-23, 4칸)
      // ブースト射撃 계열 — 「부스트」와 「고속 이동」이 갈려 있었다 (사용자 결정: 고속 이동)
      'ブースト射撃可', 'スキル発動中、ブースト射撃可', 'スキル発動中ブースト射撃可',
      'ブースト射撃不可', 'ロックオン後ブースト移動可',
    ]);
    for (const [jp, ko] of Object.entries(cache)) {
      if (typeof ko !== 'string') continue;
      const a = jp.split(' / '), b = ko.split(' / ');
      if (a.length !== b.length) continue;
      let hit = false;
      for (let i = 0; i < a.length; i++) {
        if (!REPAIR.has(a[i])) continue;
        const want = NOTE_EXACT[a[i]];
        if (want != null && b[i] !== cleanUnits(want)) { b[i] = cleanUnits(want); hit = true; }
      }
      if (hit) { cache[jp] = b.join(' / '); fixed++; }
    }
    if (fixed) {
      /* 바로 저장한다. 번역할 것이 없으면 아래 쓰기 자리에 영영 안 닿아,
         고친 것이 메모리에만 남고 파일은 그대로였다(실제로 그렇게 났다). */
      fs.writeFileSync(path.join(ROOT, 'data', 'i18n', 'weapon_note.json'), JSON.stringify(cache, null, 1) + '\n');
      console.log(`  표기가 어긋나 있던 ${fixed}칸을 고쳐 저장했습니다 (MT 가 되돌려 놓은 말)`);
    }
  }
  const todo = [...notes].filter(n => !cache[n]);
  console.log(`번역 대상 고유 備考 ${todo.length}개 (캐시 ${Object.keys(cache).length})`);

  const partCache = new Map();
  async function trPart(p) {
    if (partCache.has(p)) return partCache.get(p);
    const cur = curated(p);                 // 정형 불릿은 MT 안 거치고 정확 번역
    // 패턴은 값을 그대로 통과시킨다. 값이 문장이면(「効果時間はリミッター解除前と連動」)
    // 일본어가 남으므로, 그럴 땐 정형 처리를 버리고 MT 로 넘긴다.
    if (cur != null && !hasJa(cur)) { partCache.set(p, cur); return cur; }
    const ko = post(await one(protect(p)));   // 게임 용어를 한글로 먼저 박아 두고 보낸다
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

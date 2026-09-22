// ms_skills.json 의 스킬명·효과·설명을 온라인 번역(구글)으로 한글화해 data/i18n/skill_text.json 캐시.
//   node tools/translate_skills.js
// - 중복 텍스트는 한 번만 번역(고유 ~1천 개). 캐시에 있으면 건너뜀(증분).
// - 스킬명은 기존 사전(data/i18n/skills.json) 우선. 분류·모드 라벨은 UI 에서 하드코딩(여기서 안 함).
// - 인터넷 필요(업데이트 단계 1회성). 실패분은 남겨 두고(원문) 다음 실행에 재시도.
const fs = require('fs');
const path = require('path');
const { translate: one, hasJa, sleep } = require('./lib/mt.js');
const { protect, post } = require('./lib/glossary.js');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const rdSafe = (...p) => { try { return rd(...p); } catch { return {}; } };
// 배치(줄바꿈 묶음)는 요청이 길어지면 구글이 잘라 반환하거나 세그먼트가 어긋나
// 숫자·내용이 누락된다. 텍스트가 최대 414자로 짧아 개별 번역이 안전·정확하다.

(async () => {
  const skills = rd('data', 'ms_skills.json');
  const nameDict = rdSafe('data', 'i18n', 'skills.json');   // 기존 스킬명 사전 (jp→ko)
  const cache = rdSafe('data', 'i18n', 'skill_text.json');

  // 고유 텍스트 수집
  const names = new Set(), texts = new Set();
  for (const modes of Object.values(skills)) for (const m of modes) for (const s of m.skills) {
    if (s.name) names.add(s.name);
    if (s.eff) texts.add(s.eff);
    if (s.desc) texts.add(s.desc);
  }
  // 스킬명: 기존 사전 우선, 없으면 MT 대상
  for (const n of names) {
    if (cache[n]) continue;
    if (nameDict[n] && !hasJa(nameDict[n])) cache[n] = nameDict[n];
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
    if (fixed) {
      /* 바로 저장한다. 번역할 것이 없으면 아래 쓰기 자리에 영영 안 닿아,
         고친 것이 메모리에만 남고 파일은 그대로였다(실제로 그렇게 났다). */
      fs.writeFileSync(path.join(ROOT, 'data', 'i18n', 'skill_text.json'), JSON.stringify(cache, null, 1) + '\n');
      console.log(`  표기가 어긋나 있던 ${fixed}칸을 고쳐 저장했습니다 (MT 가 되돌려 놓은 말)`);
    }
  }
  const todo = [...new Set([...names, ...texts])].filter(t => !cache[t]);
  console.log(`번역 대상 고유 텍스트 ${todo.length}개 (캐시 ${Object.keys(cache).length})`);

  // gtx 는 「・A / ・B / …」 다중 불릿을 한 세그먼트로 보고 ~73자에서 잘라 반환한다.
  // 그래서 ' / '(=원본 <br>) 로 쪼개 불릿별로 번역하고 다시 잇는다 — 각 불릿은 짧아 안 잘린다.
  const partCache = new Map();
  async function trPart(p) {
    if (partCache.has(p)) return partCache.get(p);
    // 게임 용어를 한글로 먼저 박아 두고 보낸다. 안 그러면 gtx 가
    // 「よろけ」를 「쑥쑥」·「잡음」으로 옮기거나 문장에서 통째로 빼 버린다.
    const ko = post(await one(protect(p)));
    const v = (ko && !hasJa(ko)) ? ko : null;
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
    cache[jp] = kos.join(' / ');   // 일부 실패해도 나머지는 번역돼 저장
    ok ? done++ : failed++;
    if (i % 15 === 0 || i === todo.length - 1) {
      fs.writeFileSync(path.join(ROOT, 'data', 'i18n', 'skill_text.json'), JSON.stringify(cache, null, 1) + '\n');
      process.stdout.write(`\r  번역 ${i + 1}/${todo.length} (불릿 ${partCache.size})`);
    }
  }
  console.log(`\n완료: 신규 번역 ${done} · 실패/잔존 ${failed} → data/i18n/skill_text.json (총 ${Object.keys(cache).length})`);
})().catch(e => console.log('translate_skills 경고: ' + e.message));

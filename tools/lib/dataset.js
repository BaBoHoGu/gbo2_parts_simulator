// 데이터 로딩 중 **여러 도구가 똑같이 해야 하는 부분**만 모아 둔다.
//
// 왜 있나: 앱(build.js)은 gbo2.jp 에 아직 없는 기체·파츠를 additions 파일에서 보태 넣는다.
// 그런데 공유 갤러리 사전(make_share_dict.js)은 그 병합을 안 했다. 결과로 앱에는 있는 기체가
// 사전에는 없어서, 그 기체로 만든 구성은 업로드가 거부됐다(가브스레이 LV4 로 실제 발생).
// 사용자에게는 「올릴 수 없는 구성」으로만 보여 원인을 알 수 없었다.
//
// 같은 규칙을 두 군데 적어 두면 또 어긋난다. 그래서 여기 한 벌만 둔다.
const fs = require('fs');
const path = require('path');

/**
 * 미러에 아직 없는 기체를 보탠다. 이미 같은 MS名 이 있으면 건너뛴다
 * → 나중에 공식에 반영되면 이 추가분은 자동으로 무시된다.
 * @returns {number} 실제로 보탠 수
 */
function mergeMsAdditions(root, msData) {
  const p = path.join(root, 'data', 'msData.additions.json');
  if (!fs.existsSync(p)) return 0;
  const adds = JSON.parse(fs.readFileSync(p, 'utf8'));
  const have = new Set(msData.map(m => m.MS名));
  let n = 0;
  for (const m of adds) if (m && m.MS名 && !have.has(m.MS名)) { msData.push(m); have.add(m.MS名); n++; }
  return n;
}

/**
 * 미러에 아직 없는 파츠를 위키 값으로 보강한다.
 * 미러에 같은 이름이 생기면 그쪽이 이기고 추가분은 자동으로 빠진다.
 * @returns {number} 실제로 보탠 수
 */
function mergePartAdditions(root, parts) {
  const p = path.join(root, 'data', 'parts.additions.json');
  if (!fs.existsSync(p)) return 0;
  const add = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const [cat, list] of Object.entries(add)) {
    if (cat.startsWith('_') || !Array.isArray(list)) continue;   // _주석 같은 메타 키는 건너뛴다
    if (!parts[cat]) parts[cat] = [];
    const have = new Set(parts[cat].map(x => x.name));
    for (const it of list) {
      if (!it || typeof it !== 'object' || !it.name) continue;    // 문자열 등 잘못된 항목 방어
      if (have.has(it.name)) continue;
      parts[cat].push(it); have.add(it.name); n++;
    }
  }
  return n;
}

/**
 * 원본 강화리스트 표에 빠진 레벨을 위키 값으로 보강한다.
 * 기체는 그 레벨을 쓰는데 정의가 없으면 앱이 효과를 아예 모른다(화면에도 계산에도 안 잡힘).
 * 같은 (항목, 레벨) 이 원본에 생기면 원본이 이긴다 — 미러가 갱신되면 저절로 무시된다.
 * @returns {number} 실제로 보탠 레벨 수
 */
function mergeFullstAdditions(root, fullst) {
  const p = path.join(root, 'data', 'fullst.additions.json');
  if (!fs.existsSync(p)) return 0;
  const add = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const [name, levels] of Object.entries(add)) {
    if (name.startsWith('_') || !Array.isArray(levels)) continue;   // _주석 같은 메타 키
    const def = fullst.find(d => d.name === name);
    if (!def || !Array.isArray(def.levels)) continue;               // 없는 항목은 지어내지 않는다
    for (const lv of levels) {
      if (!lv || typeof lv.level !== 'number') continue;
      if (def.levels.some(x => Number(x.level) === Number(lv.level))) continue;   // 원본 우선
      def.levels.push(lv); n++;
    }
    def.levels.sort((a, b) => Number(a.level) - Number(b.level));
  }
  return n;
}

/**
 * 강화리스트 값 교정 — gbo2.jp 값이 위키와 다를 때 위키 쪽으로 맞춘다.
 * gbo2.jp 는 공식이 아닌 팬 사이트라, 수치는 위키(atwiki)가 더 정확한 경우가 많다.
 * 없는 레벨을 보태는 것은 mergeFullstAdditions 가 한다 — 여기는 '교정' 만 한다.
 * @returns {number} 실제로 고친 효과 수
 */
function applyFullstOverride(root, fullst) {
  const p = path.join(root, 'data', 'fullst.override.json');
  if (!fs.existsSync(p)) return 0;
  const ov = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const [name, byLevel] of Object.entries(ov)) {
    if (name.startsWith('_') || !byLevel || typeof byLevel !== 'object') continue;
    const def = fullst.find(d => d.name === name);
    if (!def) continue;                                   // 없는 항목은 만들지 않는다
    for (const [lvNo, effects] of Object.entries(byLevel)) {
      const lv = (def.levels || []).find(x => Number(x.level) === Number(lvNo));
      if (!lv || !effects) continue;                      // 없는 레벨도 만들지 않는다(그건 additions 의 일)
      for (const [k, v] of Object.entries(effects)) {
        if (k.startsWith('_')) continue;                  // _왜 같은 메모
        if (!(k in (lv.effects || {}))) continue;         // 원본에 없는 키는 교정 대상이 아니다
        if (lv.effects[k] === v) continue;
        lv.effects[k] = v; n++;
      }
    }
  }
  return n;
}

module.exports = { mergeMsAdditions, mergePartAdditions, mergeFullstAdditions, applyFullstOverride };

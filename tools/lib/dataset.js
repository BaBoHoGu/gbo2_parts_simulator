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

/**
 * gbo2.jp 가 아직 반영 못 한 스탯·슬롯을 위키 값으로 — data/msData.override.json(extract_ms_wiki.js 가 만든다).
 * 빌드와 위키 이력 반영(extract_history_reflect)이 같은 기체 데이터를 봐야 해서 여기로 옮겼다(2026-10-27).
 */
function applyMsOverride(root, msData) {
  const p = path.join(root, 'data', 'msData.override.json');
  if (!fs.existsSync(p)) return { n: 0, ms: 0 };
  const override = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const m of msData) {
    const ov = override[m.MS名];
    if (ov) for (const [k, v] of Object.entries(ov)) { m[k] = v; n++; }
  }
  return { n, ms: Object.keys(override).length };
}
/**
 * 위키 「アップデート履歴」 로 확인한 손고정값 — data/msData.manual.json. override 보다 **나중에** 얹는다.
 * (extract_ms_wiki 는 「위키 스탯표와 일치하면 교정 해제」 를 해서, 표가 낡은 칸은 override 에 두면 지워진다.)
 */
function applyMsManual(root, msData) {
  const p = path.join(root, 'data', 'msData.manual.json');
  if (!fs.existsSync(p)) return { n: 0, ms: 0 };
  const fix = (JSON.parse(fs.readFileSync(p, 'utf8')) || {}).fix || {};
  let n = 0;
  for (const m of msData) {
    const f = fix[m.MS名];
    if (f) for (const [k, d] of Object.entries(f)) { m[k] = d.value; n++; }
  }
  return { n, ms: Object.keys(fix).length };
}

/**
 * 공식 조정 값 고정 —위키 표가 공식 조정 공지를 덜 반영했을 때 공식 쪽으로 맞춘다.
 * 근거 순서는 「공식 조정 공지 > 위키 > gbo2.jp」(사용자 확인 2026-10-27). 어긋남은 tools/official_check.js 가 찾는다.
 *
 * 항목마다 was(박을 당시의 데이터 값)를 든다. **지금 값이 was 일 때만** 고친다 —
 *   지금 == value → 위키가 따라잡았다. 할 일 없음(지워도 된다)
 *   지금 == was   → 아직 필요하다. 고친다
 *   그 밖        → 그 뒤 조정이 또 있었다. 손대지 않는다(manualpin_check 가 FAIL 로 알린다)
 * msData.manual.json 이 새 조정을 옛 값으로 되돌렸던 사고(2026-10-05)를 되풀이하지 않으려고 이렇게 짰다.
 *
 * 꼴
 *   무장 { kind:'weapon', page, weapon, path:'levels.1.power' | 'info.発射 間隔', value, was }
 *   스킬 { kind:'skill',  ms, name, row:{ msLv, lv }(고칠 행을 지금 값으로 고른다), field:'lv'|'msLv', value, was }
 * @returns {{ applied:number, caught:number, moved:object[], missing:object[] }}
 */
function officialPinsOf(root) {
  const p = path.join(root, 'data', 'official.override.json');
  if (!fs.existsSync(p)) return [];
  return (JSON.parse(fs.readFileSync(p, 'utf8')).pins || []);
}
function pinTarget(pin, { weapons, msSkills, msData }) {
  if (pin.kind === 'ms') {
    // 기체 칸 { kind:'ms', ms:'X_LV3', field:'HP', value, was } — msData 가 없으면(공식 대조 등) 건너뛴다
    const m = (msData || []).find(x => String(x.MS名).normalize('NFC') === pin.ms);
    if (!m || !(pin.field in m)) return null;
    return { get: () => m[pin.field], set: v => { m[pin.field] = v; } };
  }
  if (pin.kind === 'weapon') {
    const w = ((weapons[pin.page] || {}).weapons || []).find(x => x.name === pin.weapon);
    if (!w) return null;
    const keys = pin.path.split('.');
    let o = w;
    for (const k of keys.slice(0, -1)) { if (!o || typeof o !== 'object') return null; o = o[k]; }
    if (!o || typeof o !== 'object' || !(keys[keys.length - 1] in o)) return null;
    return { get: () => o[keys[keys.length - 1]], set: v => { o[keys[keys.length - 1]] = v; } };
  }
  if (pin.kind === 'skill') {
    // ms_skills 는 기체 → 스킬 배열(또는 모드별 묶음). 이름 + 고를 행의 조건으로 한 행만 집는다
    const rows = [];
    const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') {
      if (typeof v.name === 'string' && 'lv' in v) rows.push(v); else Object.values(v).forEach(walk); } };
    walk((msSkills || {})[pin.ms]);   // 스킬 데이터를 안 넘긴 도구(무장 설명 번역 등)는 스킬 고정을 건너뛴다
    const hit = rows.filter(r => r.name === pin.name
      && Object.entries(pin.row || {}).every(([k, v]) => r[k] === v || (k === pin.field && r[k] === pin.value)));
    if (hit.length === 0) return null;
    return { get: () => hit[0][pin.field], set: v => { for (const r of hit) r[pin.field] = v; } };
  }
  return null;
}
function applyOfficialPins(root, data) {
  return applyPins(officialPinsOf(root), data);
}
/**
 * 위키 이력 반영 — 위키 기체 페이지 하단 「アップデート履歴」 에만 적고 표는 안 고친 칸.
 * data/history.reflect.json 은 tools/extract_history_reflect.js 가 만든다(위키 캐시는 커밋하지 않으니 결과를 파일로 남긴다).
 * 공식값 고정 **뒤에** 얹는다 — 같은 칸이면 공식이 먼저 고쳐 놓아 여기서는 was 가 안 맞아 건너뛴다(공식이 이긴다).
 * enabled 가 false 면 아무것도 안 한다(목록을 사람이 확인한 뒤 켠다).
 */
function historyReflectOf(root) {
  const p = path.join(root, 'data', 'history.reflect.json');
  if (!fs.existsSync(p)) return { enabled: false, pins: [] };
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { enabled: !!o.enabled, pins: o.pins || [] };
}
function applyHistoryReflect(root, data) {
  const h = historyReflectOf(root);
  return h.enabled ? applyPins(h.pins, data) : { applied: 0, caught: 0, moved: [], missing: [], off: true };
}
/**
 * 빌드와 같은 순서로 두 고정을 다 얹는다(공식 → 이력). 무장 데이터를 읽는 도구는 이걸 거쳐야 앱과 같은 글을 본다 —
 * 備考 를 고친 칸(집속 시간 등)은 문구가 바뀌어, 원본만 보던 translate_notes · dict_check 가 그 문구를 몰라
 * 앱에서 일본어로 나올 뻔했다(2026-10-27).
 */
function applyAllPins(root, data) {
  return { official: applyOfficialPins(root, data), history: applyHistoryReflect(root, data) };
}
function applyPins(pins, data) {
  const out = { applied: 0, caught: 0, moved: [], missing: [] };
  for (const pin of pins) {
    const t = pinTarget(pin, data);
    if (!t) { out.missing.push(pin); continue; }
    const now = t.get();
    if (JSON.stringify(now) === JSON.stringify(pin.value)) { out.caught++; continue; }
    if (JSON.stringify(now) !== JSON.stringify(pin.was)) { out.moved.push({ ...pin, now }); continue; }
    t.set(pin.value); out.applied++;
  }
  return out;
}

module.exports = { mergeMsAdditions, mergePartAdditions, mergeFullstAdditions, applyFullstOverride,
  applyMsOverride, applyMsManual,
  officialPinsOf, applyOfficialPins, historyReflectOf, applyHistoryReflect, applyPins, applyAllPins };

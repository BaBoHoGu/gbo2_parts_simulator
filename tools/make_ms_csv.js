// 모든 기체를 CSV 로 정리한다 → dist/gbo2_MS_DATA.csv
//   node tools/make_ms_csv.js
// 컬럼: COST · 기체명(LV) · LV · 카테고리(강습/범용/지원) · 희소도(★수)
// build.js 와 동일하게 msData.json + additions + override 를 병합해 쓴다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const rdSafe = (...p) => { try { return rd(...p); } catch { return null; } };

const msData = rd('data', 'msData.json');
// 공식 미러에 아직 없는 추가 기체 병합 (같은 MS名 이 이미 있으면 스킵)
const adds = rdSafe('data', 'msData.additions.json');
if (Array.isArray(adds)) { const have = new Set(msData.map(m => m.MS名)); for (const m of adds) if (!have.has(m.MS名)) msData.push(m); }
// 위키 교정(override) 적용 — 코스트·속성·희소도 등이 보정될 수 있다
const ov = rdSafe('data', 'msData.override.json');
if (ov) for (const m of msData) { const o = ov[m.MS名]; if (o) for (const [k, v] of Object.entries(o)) m[k] = v; }

// 한글명 사전 (수동 우선, 자동 번역 밑에 깔기) + 카테고리(속성) 사전
const norm = s => String(s || '').normalize('NFC');
const msDict = { ...(rdSafe('data', 'i18n', 'ms.auto.json') || {}), ...rd('data', 'i18n', 'ms.json') };
const attrKo = rd('data', 'i18n', 'misc.json').attr;   // { 汎用:'범용', 強襲:'강습', 支援:'지원' }

const msName = name => {                                // T.msName 과 동일: 한글명 + LV 표기
  const m = norm(name).match(/^(.*?)(_LV\d+)?$/);
  return (msDict[m[1]] || name) + (m[2] ? ' ' + m[2].slice(1) : '');
};
const lvOf = name => Number((String(name).match(/_LV(\d+)/) || [])[1]) || 1;
const baseOf = name => norm(name).replace(/_LV\d+$/, '');
const rarityOf = m => (m.レアリティ || '').length;      // ☆/★ 문자열 길이 = 희소도

// 일부 LV 엔 레어리티가 비어 있어(네로 LV3 등) 같은 기체의 다른 LV 값으로 채운다.
const rarByBase = new Map();
for (const m of msData) { const r = rarityOf(m); const b = baseOf(m.MS名); if (r > (rarByBase.get(b) || 0)) rarByBase.set(b, r); }
// 소스에 레어리티가 아예 없는 기체 수동 보정 (base 이름 → ★수)
const RARITY_FIX = { 'アクト・ハイザック': 2 };

const rows = msData.map(m => ({
  cost: Number(m.コスト) || 0,
  name: msName(m.MS名),
  lv: lvOf(m.MS名),
  cat: attrKo[m.属性] || m.属性 || '',
  rarity: rarityOf(m) || rarByBase.get(baseOf(m.MS名)) || RARITY_FIX[baseOf(m.MS名)] || ''   // 결측은 공백
})).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'ko') || a.lv - b.lv);

const esc = v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const header = ['COST', '기체명(LV)', 'LV', '카테고리', '희소도'];
const csv = [header, ...rows.map(r => [r.cost, r.name, r.lv, r.cat, r.rarity])]
  .map(row => row.map(esc).join(',')).join('\r\n');

const out = path.join(ROOT, 'dist', 'gbo2_MS_DATA.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '﻿' + csv + '\r\n');   // BOM — Excel 한글 깨짐 방지
console.log('생성:', path.relative(ROOT, out), '· 기체', rows.length, '종');

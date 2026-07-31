// 신규 기체·파츠를 온라인 번역(구글)으로 자동 한글화한다. update 가 재빌드 전에 호출한다.
//   node tools/auto_translate.js
//
// - 인터넷 필요(업데이트 단계 1회성). 배포본은 이 결과를 인라인해 완전 오프라인으로 돈다.
// - 수작업 사전(ms.json / parts.json)에 있는 항목은 절대 건드리지 않는다(그게 항상 우선).
// - 이미 *.auto.json 에 있는 항목은 건너뛴다(캐시 — 매번 다시 번역하지 않음).
// - 번역 실패(오프라인·차단)면 기체·파츠명은 음차로 폴백하고, 남는 건 사람 검토로 안내한다.
const fs = require('fs');
const path = require('path');
const { translate, hasJa, sleep } = require('./lib/mt.js');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const rdSafe = (...p) => { try { return rd(...p); } catch { return {}; } };
const write = (rel, obj) => fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 1) + '\n');

let translitName = s => s;                       // 음차 폴백
try { translitName = require('./build_ms_i18n.js').translitName; } catch { /* 선택적 */ }

const base = n => n.normalize('NFC').replace(/_LV\d+$/, '');

(async () => {
  let net = true;

  // ── 1) 기체명 ──
  const msData = rd('data', 'msData.json');
  const msDict = rd('data', 'i18n', 'ms.json');
  const msAuto = rdSafe('data', 'i18n', 'ms.auto.json');
  const newMs = [...new Set(msData.map(m => base(m.MS名)))].filter(n => !msDict[n] && !msAuto[n]);
  let okMs = 0; const leftMs = [];
  for (const n of newMs) {
    const t = net ? await translate(n) : null;
    if (t == null) net = false;                                  // 한 번 실패하면 이후는 폴백만
    const ko = (t && !hasJa(t)) ? t : (translitName(n) || n);
    msAuto[n] = ko; okMs++;
    if (hasJa(ko)) leftMs.push(n + ' → ' + ko);
    if (t) await sleep(200);
  }
  write('data/i18n/ms.auto.json', msAuto);

  // ── 2) 파츠 (이름 n + 설명 d) ──
  const parts = rd('data', 'parts.json');
  const partDict = rd('data', 'i18n', 'parts.json');
  const partAuto = rdSafe('data', 'i18n', 'parts.auto.json');
  const allParts = Object.values(parts).flat();
  const newParts = allParts.filter(p => !partDict[p.name] && !partAuto[p.name]);
  let okP = 0; const leftP = [];
  for (const p of newParts) {
    const m = p.name.match(/^(.*?)(_LV\d+)?$/);
    const nameBase = m[1], lv = m[2] ? ' ' + m[2].slice(1) : '';
    const nRaw = net ? await translate(nameBase) : null;
    if (nRaw == null && net) net = false;
    if (nRaw) await sleep(200);
    const dRaw = (net && p.description) ? await translate(p.description) : null;
    if (dRaw == null && p.description && net) net = false;
    if (dRaw) await sleep(200);
    const n = ((nRaw && !hasJa(nRaw)) ? nRaw : (translitName(nameBase) || nameBase)) + lv;
    const d = (dRaw && !hasJa(dRaw)) ? dRaw : (p.description || '');
    partAuto[p.name] = { n, d };
    okP++;
    if (hasJa(n) || hasJa(d)) leftP.push(p.name);
  }
  write('data/i18n/parts.auto.json', partAuto);

  console.log(`온라인 번역: 신규 기체 ${okMs}종 · 파츠 ${okP}종 자동 한글화`
    + (net ? '' : ' (일부/전부 오프라인 폴백)'));
  if (leftMs.length || leftP.length) {
    console.log('\n※ 번역이 부족해 일본어가 남은 항목 — 수작업 사전에 넣어 다듬어 주세요:');
    leftMs.forEach(x => console.log('   기체: ' + x));
    leftP.forEach(n => console.log('   파츠: ' + n + ' → ' + JSON.stringify(partAuto[n])));
  }
})().catch(e => { console.log('auto_translate 경고: ' + e.message + ' — 번역 건너뜀'); });

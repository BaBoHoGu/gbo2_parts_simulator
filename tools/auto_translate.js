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

/**
 * 예전 규칙으로 캐시된 반쪽 번역을 걷어낸다.
 * 지금은 일본어가 남으면 아예 안 넣지만, 그 전에 들어간 항목(「緊急修復모주루」)은
 * 캐시 적중이라 영영 다시 시도되지 않는다. 시작할 때 한 번 훑어 지운다.
 * @returns {number} 지운 개수
 */
function purgeStale(obj, val) {
  let n = 0;
  for (const k of Object.keys(obj)) if (hasJa(val(obj[k]))) { delete obj[k]; n++; }
  return n;
}

(async () => {
  let net = true;

  // ── 1) 기체명 ──
  const msData = rd('data', 'msData.json');
  const msDict = rd('data', 'i18n', 'ms.json');
  const msAuto = rdSafe('data', 'i18n', 'ms.auto.json');
  const staleMs = purgeStale(msAuto, v => String(v));
  const newMs = [...new Set(msData.map(m => base(m.MS名)))].filter(n => !msDict[n] && !msAuto[n]);
  let okMs = 0; const leftMs = [];
  for (const n of newMs) {
    const t = net ? await translate(n) : null;
    if (t == null) net = false;                                  // 한 번 실패하면 이후는 폴백만
    const ko = (t && !hasJa(t)) ? t : (translitName(n) || n);
    // 일본어가 남은 결과는 **캐시에 넣지 않는다**.
    // 음차 폴백은 가나만 옮기고 한자는 그대로 두어 「緊急修復모주루」 같은 반쪽 이름이 나온다.
    // 예전엔 그걸 그대로 사전에 넣어, 화면에 '번역된 척' 하는 이름이 나가고 다음 실행에서
    // 캐시 적중으로 영영 다시 시도하지 않았다(실제로 그 상태로 배포까지 나갔다).
    // 넣지 않으면 화면에 원문이 그대로 보여 눈에 띄고, smoke 의 「전수 번역」 검사가 잡는다.
    if (hasJa(ko)) { leftMs.push(n + ' → ' + ko); continue; }
    msAuto[n] = ko; okMs++;
    if (t) await sleep(200);
  }
  write('data/i18n/ms.auto.json', msAuto);

  // ── 2) 파츠 (이름 n + 설명 d) ──
  const parts = rd('data', 'parts.json');
  const partDict = rd('data', 'i18n', 'parts.json');
  const partAuto = rdSafe('data', 'i18n', 'parts.auto.json');
  const staleP = purgeStale(partAuto, v => String((v && v.n) || '') + ' ' + String((v && v.d) || ''));
  if (staleMs || staleP) console.log(`옛 반쪽 번역 정리: 기체 ${staleMs} · 파츠 ${staleP}종 (다시 시도합니다)`);
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
    // 기체와 같은 규칙 — 한쪽이라도 일본어가 남으면 캐시하지 않고 다음 실행에 다시 시도한다.
    if (hasJa(n) || hasJa(d)) { leftP.push(p.name + ' → ' + n); continue; }
    partAuto[p.name] = { n, d };
    okP++;
  }
  write('data/i18n/parts.auto.json', partAuto);

  console.log(`온라인 번역: 신규 기체 ${okMs}종 · 파츠 ${okP}종 자동 한글화`
    + (net ? '' : ' (일부/전부 오프라인 폴백)'));
  if (leftMs.length || leftP.length) {
    // 사전에 넣지 않았으므로 화면에는 원문(일본어)이 그대로 나온다 — smoke 가 배포를 막는다.
    console.log('\n※ 번역이 부족해 자동 사전에 넣지 않은 항목 — 수작업 사전에 넣어 주세요');
    console.log('   (그대로 두면 화면에 일본어로 나오고 배포 전 점검에서 걸립니다):');
    leftMs.forEach(x => console.log('   기체: ' + x));
    leftP.forEach(x => console.log('   파츠: ' + x));
  }
})().catch(e => { console.log('auto_translate 경고: ' + e.message + ' — 번역 건너뜀'); });

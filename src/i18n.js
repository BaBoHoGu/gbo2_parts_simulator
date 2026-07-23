/* ------------------------------------------------------------------
 * 일본어 → 한국어 표시 변환
 * 사전(GBO2_I18N)은 빌드 시 인라인된다. 계산은 항상 원본 일본어 키로
 * 이루어지고, 여기서는 화면에 보이는 문자열만 바꾼다.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  const raw = window.GBO2_I18N || { ms: {}, parts: {}, kind: {}, attr: {} };

  // 원본 데이터에 결합문자(バ = ハ+゛) 형태가 섞여 있어 NFC로 맞춰 조회한다.
  const norm = s => (typeof s === 'string' ? s.normalize('NFC') : s);
  const table = obj => {
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) m.set(norm(k), v);
    return m;
  };

  const MS = table(raw.ms);
  const PARTS = table(raw.parts);
  const KIND = table(raw.kind);
  const ATTR = table(raw.attr);

  /** 기체명. `_LV3` 접미사는 사전에 없으므로 떼었다가 다시 붙인다. */
  function msName(name) {
    if (!name) return '';
    const m = norm(name).match(/^(.*?)(_LV\d+)?$/);
    const ko = MS.get(m[1]);
    if (!ko) return name;
    return ko + (m[2] ? ' ' + m[2].slice(1) : '');
  }

  const partEntry = name => PARTS.get(norm(name));
  const partName = name => (partEntry(name) || {}).n || name;
  const partDesc = (name, fallback) => (partEntry(name) || {}).d || fallback || '';
  const kindName = k => (k ? KIND.get(norm(k)) || k : k);
  const attrName = a => (a ? ATTR.get(norm(a)) || a : a);

  window.GBO2i18n = { msName, partName, partDesc, kindName, attrName, norm };
})();

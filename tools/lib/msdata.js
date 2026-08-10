// msData 공용 유틸.
const fs = require('fs');
const path = require('path');

/**
 * gbo2.jp 미러가 wiki_url 을 비워 보낸 기체(ゴトラタン 등)를 msData.override.json 의
 * wiki_url 로 보정한다. 그래야 페이지↔기체 매핑이 서서 무장·스킬을 받아온다.
 * @param {object[]} msData
 * @param {string} root  프로젝트 루트
 * @returns {object[]} 같은 배열(제자리 수정)
 */
function applyWikiOverride(msData, root) {
  const p = path.join(root, 'data', 'msData.override.json');
  if (!fs.existsSync(p)) return msData;
  let ov;
  try { ov = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return msData; }
  for (const m of msData) { const o = ov[m.MS名]; if (o && o.wiki_url) m.wiki_url = o.wiki_url; }
  return msData;
}

module.exports = { applyWikiOverride };

// 한 기체의 무장·스킬을 위키에서 받아 한 번에 붙인다 (누락 기체 수동 복구용 · 2차 보험).
//   node tools/add_mech.js "ゴトラタン"          이름으로 페이지 ID 자동 조회
//   node tools/add_mech.js "ゴトラタン" 7794      페이지 ID 를 직접 지정 (조회 생략)
//
// 하는 일: 위키 페이지ID 확인 → msData.override.json 에 wiki_url 기록 →
//   raw/wiki 캐시(헤드리스) → 무장·스킬 추출 → 번역 → 재빌드.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { fetchWikiHtml, resolvePageIds } = require('./lib/wiki_fetch.js');

const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const run = (script, args = []) => {
  console.log('\n$ node tools/' + script + ' ' + args.join(' '));
  execFileSync(process.execPath, [path.join('tools', script), ...args], { cwd: ROOT, stdio: 'inherit' });
};

const name = process.argv[2];
let pageId = process.argv[3];
if (!name) { console.log('사용법: node tools/add_mech.js "기체명(일본어)" [페이지ID]'); process.exit(1); }

(async () => {
  // 1) 페이지 ID 확인
  if (!pageId) {
    console.log(`■ 위키에서 "${name}" 페이지 조회…`);
    const map = await resolvePageIds();
    pageId = map.get(name) || map.get(name.replace(/_LV\d+$/, ''));
    if (!pageId) { console.log(`✘ 위키 機体一覧 에서 "${name}" 를 못 찾았습니다. 페이지 ID 를 직접 넘겨 주세요.`); process.exit(1); }
    console.log(`  → pages/${pageId}`);
  }
  const wikiUrl = `https://w.atwiki.jp/battle-operation2/pages/${pageId}.html`;

  // 2) msData.override.json 에 wiki_url 기록 (해당 base 의 모든 LV 엔트리에)
  const ovPath = path.join(ROOT, 'data', 'msData.override.json');
  const ov = fs.existsSync(ovPath) ? rd('data', 'msData.override.json') : {};
  const base = name.replace(/_LV\d+$/, '');
  const targets = rd('data', 'msData.json').filter(m => m.MS名 === name || m.MS名.replace(/_LV\d+$/, '') === base);
  const names = targets.length ? targets.map(m => m.MS名) : [name];
  for (const n of names) ov[n] = { ...(ov[n] || {}), wiki_url: wikiUrl };
  fs.writeFileSync(ovPath, JSON.stringify(ov, null, 1) + '\n');
  console.log(`■ override 기록: ${names.join(', ')} → ${wikiUrl}`);

  // 3) 위키 HTML 캐시 (헤드리스 Chrome — Cloudflare 통과)
  console.log('■ 위키 페이지 수신(헤드리스)…');
  const out = path.join(ROOT, 'raw', 'wiki');
  fs.mkdirSync(out, { recursive: true });
  const r = await fetchWikiHtml([pageId], (id, html) => fs.writeFileSync(path.join(out, id + '.html'), html));
  if (!r.ok.length) { console.log('✘ 위키 페이지 수신 실패(Cloudflare/네트워크). 잠시 후 다시 시도하세요.'); process.exit(1); }

  // 4) 추출 → 번역 → 빌드
  run('extract_weapons.js', ['--merge']);
  run('extract_ms_skills.js', ['--merge']);
  run('find_buff_skills.js', ['--ui', '--merge']);
  run('build_weapon_i18n.js');
  run('translate_skills.js');
  run('translate_notes.js');
  run('build.js');

  // 5) 결과 확인
  const w = rd('data', 'weapons.json')[pageId];
  const sk = rd('data', 'ms_skills.json')[base];
  console.log(`\n✔ 완료 — ${name}: 무장 ${w ? w.weapons.length : 0}종 · 스킬 ${sk ? sk.reduce((a, m) => a + (m.skills || []).length, 0) : 0}개`);
  if (!w || !w.weapons.length) console.log('  ⚠ 무장이 비었습니다 — 위키에 무장 표가 아직 없을 수 있습니다.');
})().catch(e => { console.log('add_mech 오류:', e.message); process.exit(1); });

// Firebase RTDB 의 공유 구성을 Cloudflare D1 로 옮긴다.
//
//   node tools/migrate_gallery.js            → raw/migrate_gallery.sql 을 만든다(적용은 안 함)
//   node tools/migrate_gallery.js --purge    → 시험 데이터를 지우는 문장도 함께 넣는다
//
// 만들어진 SQL 은 update.ps1 이 아니라 손으로 한 번만 적용한다:
//   wrangler d1 execute gbo2-gallery --remote --file=raw/migrate_gallery.sql --yes
//
// 옮기는 김에 바로잡는 것
//   · 키 인코딩 되돌리기 — RTDB 키에 [ ] 를 못 써 ( ) 로 바꿔 저장했다. D1 은 제약이 없다.
//   · 무과금 판정 — 예전 데이터에는 없던 값이라 파츠 표로 지금 정한다.
//   · 작성자 — 필수가 되기 전 글은 비어 있을 수 있다. 비면 '익명' 으로 채운다
//     (D1 스키마가 NOT NULL 이고, 빈 이름은 화면에서도 읽히지 않는다).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RTDB = 'https://gbo2-parts-share-default-rtdb.asia-southeast1.firebasedatabase.app';

const fromKey = n => String(n).replace(/\(/g, '[').replace(/\)/g, ']');
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

const ticket = (JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parts.recycle.json'), 'utf8')) || {}).ticket || {};

(async () => {
  const r = await fetch(`${RTDB}/builds.json`);
  if (!r.ok) { console.error('Firebase 에서 받지 못했습니다: ' + r.status); process.exit(1); }
  const all = (await r.json()) || {};
  const bl = await fetch(`${RTDB}/blocked.json`).then(x => x.ok ? x.json() : null).catch(() => null) || {};

  const lines = [];
  if (process.argv.includes('--purge')) {
    lines.push('-- 이관 전 정리 (배포 점검 때 넣은 시험 데이터)');
    lines.push('DELETE FROM builds;');
    lines.push('DELETE FROM throttle;');
    lines.push('');
  }
  let n = 0, skipped = 0;
  for (const [id, v] of Object.entries(all)) {
    if (!v || bl[id]) { skipped++; continue; }
    const parts = [];
    for (let i = 0; i < 8; i++) if (v['p' + i]) parts.push(fromKey(v['p' + i]));
    if (!parts.length) { skipped++; continue; }
    const free = parts.every(p => ticket[p] != null) ? 1 : 0;
    const author = (v.author || '').trim() || '익명';
    lines.push(`INSERT OR REPLACE INTO builds (id, ms, stage, exp, exp_lv, parts, title, author, descr, free, ver, who, at) VALUES (`
      + [q(id), q(fromKey(v.ms)), Number(v.stage) || 0, q(fromKey(v.exp)), Number(v.expLv) || 1,
         q(JSON.stringify(parts)), q(v.title || '(제목 없음)'), q(author),
         v.desc ? q(v.desc) : 'NULL', free, q(v.ver || ''), q('migrated'), Number(v.at) || Date.now()].join(', ')
      + ');');
    n++;
  }
  const out = path.join(ROOT, 'raw', 'migrate_gallery.sql');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.log(`Firebase 구성 ${Object.keys(all).length}건 → 옮길 것 ${n}건 (건너뜀 ${skipped})`);
  console.log('→ ' + path.relative(ROOT, out));
})();

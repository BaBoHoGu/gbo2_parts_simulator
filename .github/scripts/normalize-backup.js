// 백업 JSON 을 '키 순서까지 고정된' 모양으로 다시 쓴다.
//   node .github/scripts/normalize-backup.js <입력> <출력>
//
// API 가 주는 JSON 은 키 순서가 보장되지 않는다. 그대로 커밋하면 내용이 하나도
// 안 바뀌었는데도 매번 diff 가 생겨 6시간마다 쓸모없는 커밋이 쌓인다.
// 정렬해 두면 실제로 글이 늘거나 지워졌을 때만 커밋된다 — 그래야 이력이 기록으로 쓸모가 있다.
const fs = require('fs');

const sortDeep = v => {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
};

const [, , src, dst] = process.argv;
let raw;
try { raw = fs.readFileSync(src, 'utf8'); } catch { raw = 'null'; }
let data;
try { data = JSON.parse(raw); } catch { data = null; }
// 아직 아무것도 안 올라왔으면 null 이 온다 — 빈 객체로 적어 두면 파일이 늘 존재한다
fs.writeFileSync(dst, JSON.stringify(sortDeep(data) ?? {}, null, 1) + '\n', 'utf8');
console.log(dst + ' — ' + Object.keys(data || {}).length + '건');

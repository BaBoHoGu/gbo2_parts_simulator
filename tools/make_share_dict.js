// 공유 갤러리용 화이트리스트(사전)를 만든다 — Firebase Realtime Database 에 가져올 JSON.
//   node tools/make_share_dict.js            → dist/firebase-seed.json (처음 한 번, 루트에 가져오기)
//   node tools/make_share_dict.js --dict     → dist/firebase-dict.json (이후 갱신, dict 노드에 가져오기)
//
// 왜 필요한가: 보안 규칙은 base64 를 풀 수 없다. 그래서 업로드할 때 기체·파츠 이름을
// 따로 올리게 하고, 규칙이 이 사전에 있는 이름인지 대조한다.
//   ".validate": "root.child('dict/ms').child(newData.val()).exists()"
// 사전에 없는 이름은 서버가 거부하므로, 장난 데이터가 애초에 들어오지 못한다.
//
// 키 인코딩: RTDB 키에는 . $ # [ ] / 를 못 쓴다. 파츠 34종이 [ ] 를 쓰므로 ( ) 로 바꾼다.
// (전수 확인: 기체 1,706 · 파츠 163 모두 인코딩 후 충돌 0건, 원래 ( ) 를 쓰는 이름도 0개)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

/** RTDB 키로 쓸 수 있게 바꾼다. 앱도 같은 함수를 쓴다. */
const toKey = n => String(n).replace(/\[/g, '(').replace(/\]/g, ')');

const msData = rd('data', 'msData.json');
const parts = [].concat(...Object.values(rd('data', 'parts.json')));

const dict = { ms: {}, parts: {}, exp: {} };
for (const m of msData) dict.ms[toKey(m.MS名)] = true;
for (const p of parts) dict.parts[toKey(p.name)] = true;
// 확장 스킬은 core.js 의 목록과 같아야 한다 — 여기 박아 두지 않고 그 파일에서 읽는다
const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
const expBlock = core.match(/const EXPANSION_SKILLS = \[([\s\S]*?)\];/);
if (!expBlock) throw new Error('core.js 에서 EXPANSION_SKILLS 를 못 찾았습니다');
for (const m of expBlock[1].matchAll(/'([^']+)'/g)) dict.exp[toKey(m[1])] = true;
dict.exp[toKey('拡張スキル無し')] = true;   // EXPANSION_NONE (상수명으로 적혀 있어 따로 넣는다)

const onlyDict = process.argv.includes('--dict');
const out = onlyDict ? dict : { dict };
const name = onlyDict ? 'firebase-dict.json' : 'firebase-seed.json';
const dest = path.join(ROOT, 'dist', name);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n', 'utf8');

const kb = (fs.statSync(dest).size / 1024).toFixed(0);
console.log(`${name} 생성 — 기체 ${Object.keys(dict.ms).length} · 파츠 ${Object.keys(dict.parts).length}`
  + ` · 확장 ${Object.keys(dict.exp).length} · ${kb} KB`);
console.log('  ' + dest);
console.log(onlyDict
  ? '  → 콘솔에서 dict 노드를 열고 「JSON 가져오기」'
  : '  → 콘솔 Realtime Database 루트에서 「JSON 가져오기」 (처음 한 번만)');

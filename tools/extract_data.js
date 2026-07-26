// Extracts the simulator's datasets out of the gbo2.jp production bundle.
//   parts.json  -> { 防御, 攻撃, 移動, 補助, 特殊 }  (custom parts, by category)
//   fullst.json -> 強化リスト definitions (name + per-level effects)
// msData.json is downloaded separately (it is a plain static asset).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 기본은 raw/app.js → data/ 이지만, 업데이트 감지용으로 소스·출력 경로를 넘길 수 있다.
//   node tools/extract_data.js [소스 app.js] [출력 폴더]
const SRC_PATH = process.argv[2] || path.join(ROOT, 'raw', 'app.js');
const OUT_DIR = process.argv[3] || path.join(ROOT, 'data');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function matchBracket(s, start) {
  let depth = 0, i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) break;
        i++;
      }
      i++; continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  throw new Error('unbalanced bracket from ' + start);
}

function readJsSingleQuoted(s, i) {
  let out = '';
  while (i < s.length) {
    if (s[i] === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
    if (s[i] === "'") return out;
    out += s[i]; i++;
  }
  throw new Error('unterminated string');
}

// The bundle maps categories to minified array identifiers:
//   const Fw={防御:oL,攻撃:lL,移動:cL,補助:uL,特殊:fL}
const mapMatch = src.match(/\{防御:(\w+),攻撃:(\w+),移動:(\w+),補助:(\w+),特殊:(\w+)\}/);
if (!mapMatch) throw new Error('category->identifier map not found');
const [, dfn, atk, mov, sup, spc] = mapMatch;
const catOf = { 防御: dfn, 攻撃: atk, 移動: mov, 補助: sup, 特殊: spc };

function readArray(ident) {
  // `ident=[{...}]` or `ident=JSON.parse('[{...}]')`
  const re = new RegExp('\\b' + ident + '\\s*=\\s*(JSON\\.parse\\(\\s*\')?\\[');
  const m = re.exec(src);
  if (!m) throw new Error('array not found: ' + ident);
  if (m[1]) {
    const strStart = src.indexOf("'", m.index) + 1;
    return JSON.parse(readJsSingleQuoted(src, strStart).replace(/\\'/g, "'"));
  }
  const brk = src.indexOf('[', m.index);
  return eval('(' + src.slice(brk, matchBracket(src, brk)) + ')');
}

const parts = {};
for (const [cat, ident] of Object.entries(catOf)) {
  parts[cat] = readArray(ident).map(p => ({ ...p, category: cat }));
  console.log(cat.padEnd(3), ident.padEnd(3), parts[cat].length);
}

// 強化リスト effect table: the array whose entries carry `levels[].effects`.
let fullst = null;
for (const m of src.matchAll(/\b(\w+)\s*=\s*\[\s*\{\s*name:"[^"]+",levels:\[/g)) {
  fullst = readArray(m[1]);
  console.log('fullst', m[1], fullst.length);
  break;
}
if (!fullst) throw new Error('fullst table not found');

const outDir = OUT_DIR;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'parts.json'), JSON.stringify(parts));
fs.writeFileSync(path.join(outDir, 'fullst.json'), JSON.stringify(fullst));
console.log('total parts', Object.values(parts).reduce((a, b) => a + b.length, 0));

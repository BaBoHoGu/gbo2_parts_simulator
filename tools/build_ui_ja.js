// 일본어 모드의 화면 문구 표(data/i18n/ui_ja.json)를 만든다 — 소스의 한국어 문자열을 뽑아 ko→ja 로 옮긴다.
//   node tools/build_ui_ja.js                   개수와 아직 표에 없는 문구 수를 보인다
//   node tools/build_ui_ja.js --todo=<파일>      표에 없는 문구를 {한국어: ""} JSON 으로 내보낸다(짧은 것부터)
//   node tools/build_ui_ja.js --merge=<파일>     {한국어: 일본어} JSON 을 표에 보탠다(빈 값은 건너뛴다)
//
// 왜 소스에서 뽑나 — 화면을 돌며 줍는 방식은 열어 보지 않은 상태·화면이 빠진다. 문자열은 소스에 다 있다.
// 문자열이 + 로 이어지거나 템플릿 ${} 로 끊긴 조각은 조각째 뽑는다 — 화면 층(jaText)이 글자 안에서
// 긴 조각부터 찾아 바꾸므로 조각 단위 표로도 이어 붙은 문장이 옮겨진다.
//
// 번역은 기계번역이 아니라 사람(또는 Claude)이 한다 — 게임 용어(よろけ·大よろけ…)를 MT 는 틀리게 옮긴다.
// 게임 데이터(기체·파츠·무장·스킬)는 원문이 일본어라 이 표에 없다 — 일본어 모드에서는 한국어 사전을 비워 원문이 나온다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { readUi } = require('./lib/uisrc.js');
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);

/* ── ① 뽑기 ─────────────────────────────────────────────────────────── */
const HANGUL = /[가-힣ㄱ-ㆎ]/;
/** JS 소스에서 문자열 · 템플릿 조각을 뽑는다(주석 · 정규식은 건너뛴다). 완벽한 해석기는 아니다 —
 *  결과는 번역할 **후보**일 뿐이라 조금 틀려도 코드에는 영향이 없다. */
function jsStrings(src) {
  const out = [];
  let i = 0, prev = '';
  const n = src.length;
  const regexOk = () => /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 7), i).trim());
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1] === 'n' ? ' ' : src[j + 1]; j += 2; continue; } if (src[j] === '\n') break; s += src[j++]; }
      out.push(s); i = j + 1; prev = 'x'; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { s += src[j + 1] === 'n' ? ' ' : src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          out.push(s); s = '';
          let depth = 1; j += 2;
          const st = j;
          while (j < n && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          out.push(...jsStrings(src.slice(st, j - 1)));
          continue;
        }
        s += src[j++];
      }
      out.push(s); i = j + 1; prev = 'x'; continue;
    }
    if (c === '/' && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '\n') break; j++; }
      i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}
/** HTML 의 글자 · 속성(title/placeholder/aria-label/alt) — <script>·<style>·주석은 뺀다 */
function htmlStrings(src) {
  const s = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const out = [];
  for (const m of s.matchAll(/(?:title|placeholder|aria-label|alt)="([^"]*)"/g)) out.push(m[1]);
  for (const m of s.matchAll(/>([^<>]+)</g)) out.push(m[1]);
  return out;
}
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const sources = [
  ['ui', readUi(ROOT)],
  ...['duel.js', 'token.js', 'share.js', 'core.js', 'damage.js', 'icons.js'].filter(f => fs.existsSync(path.join(ROOT, 'src', f))).map(f => [f, read('src', f)])
];
const raw = [];
for (const [, src] of sources) raw.push(...jsStrings(src));
for (const f of ['index.html', 'token.body.html']) if (fs.existsSync(path.join(ROOT, 'src', f))) raw.push(...htmlStrings(read('src', f)));
// 조각을 다듬는다: 앞뒤 공백·문장부호만 뺀 것, 한글이 있는 것만, HTML/CSS 조각은 뺀다
const frags = new Set();
const ENT = { '&mdash;': '—', '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&middot;': '·' };
for (const r of raw) {
  if (!r || !HANGUL.test(r)) continue;
  if (/=>|\bfunction\b/.test(r)) continue;
  // 태그가 섞인 조각은 태그로 갈라 글자 덩어리만 — 화면의 글자 마디에는 태그가 없다
  for (let s of r.split(/<[^>]*>|^[^<]*>|<[^>]*$/)) {
    s = s.replace(/&[a-z]+;/g, e => ENT[e] || e).replace(/\s+/g, ' ').trim();
    if (!s || !HANGUL.test(s) || s.length > 400) continue;
    frags.add(s);
  }
}
const all = [...frags].sort((a, b) => a.localeCompare(b, 'ko'));
const dest = path.join(ROOT, 'data', 'i18n', 'ui_ja.json');
const table = JSON.parse(fs.readFileSync(dest, 'utf8'));
table.phrases = table.phrases || {};
const todo = all.filter(s => !(s in table.phrases));
console.log('한국어 조각 ' + all.length + '개 · 표에 있음 ' + (all.length - todo.length) + ' · 새로 옮길 것 ' + todo.length);
const save = () => fs.writeFileSync(dest, JSON.stringify(table, null, 1) + '\n');
if (arg('todo')) {
  const o = {};
  todo.sort((a, b) => a.length - b.length || a.localeCompare(b, 'ko')).forEach(s => { o[s] = ''; });
  fs.writeFileSync(arg('todo'), JSON.stringify(o, null, 1) + '\n');
  console.log('→ ' + arg('todo'));
}
if (arg('merge')) {
  // JSON {한국어: 일본어} 또는 줄 목록(한 줄에 「한국어 ⟹ 일본어」 — 구분자 앞뒤 공백 하나씩은 구분자에 든다)
  const txt = fs.readFileSync(arg('merge'), 'utf8').replace(/^﻿/, '');
  const add = /\.json$/i.test(arg('merge')) ? JSON.parse(txt)
    : Object.fromEntries(txt.split(/\r?\n/).filter(l => l.includes('⟹')).map(l => { const k = l.indexOf('⟹'); return [l.slice(0, k).replace(/ $/, '').trim(), l.slice(k + 1).replace(/^ /, '').trim()]; }));
  let n = 0, bad = 0;
  const known = new Set(all);
  for (const [ko, ja] of Object.entries(add)) {
    if (!ja) continue;
    if (!known.has(ko)) console.log('  소스에 없는 문구: ' + ko);
    if (HANGUL.test(ja)) { bad++; console.log('  한글이 남음: ' + ko + ' → ' + ja); continue; }
    table.phrases[ko] = ja; n++;
  }
  save();
  console.log('보탬 ' + n + (bad ? ' · 건너뜀 ' + bad : '') + ' → 표 ' + Object.keys(table.phrases).length + '개');
}
// 소스 안의 일본어→한국어 대응표(['よろけ有', '비틀 있음'] 꼴)는 뒤집으면 **원문**이다 — 번역보다 이것이 이긴다.
// 한 한국어가 여러 원문에서 오면(「발」 ← 発·射) 정할 수 없으니 건너뛴다. 한 글자도 건너뛴다(조사·단위).
{
  const PAIR = /\['([^'\n]*[぀-ヿ一-鿿][^'\n]*)',\s*'([^'\n]*[가-힣][^'\n]*)'\]/g;
  const from = new Map();
  for (const [, src] of sources) for (const m of src.matchAll(PAIR)) {
    const ko = m[2].trim(), ja = m[1].trim();
    if (ko.length < 2 || HANGUL.test(ja)) continue;
    if (!from.has(ko)) from.set(ko, new Set());
    from.get(ko).add(ja);
  }
  let n = 0;
  for (const [ko, js] of from) {
    if (js.size !== 1 || !(ko in table.phrases) && !all.includes(ko)) continue;
    const ja = [...js][0];
    if (table.phrases[ko] !== ja) { table.phrases[ko] = ja; n++; }
  }
  if (n) { save(); console.log('대응표에서 원문으로 ' + n + '개'); }
}
// 화면 글자는 소스 문자열과 꼴이 조금 다르다 — 「— 」·「· 」·「※ 」 머리는 따로 그려지기도 하고,
// **강조** 는 굵은 글씨가 되어 별표가 빠진다. 그 꼴도 표에 둔다(번역에서 같은 머리를 떼어 낸다).
{
  let n = 0;
  const put = (k, v) => { if (k && v && k !== v && HANGUL.test(k) && !HANGUL.test(v) && !(k in table.phrases)) { table.phrases[k] = v; n++; } };
  for (const [k, v] of Object.entries(table.phrases)) {
    if (!v) continue;
    const m = k.match(/^([—·※‹]\s*)/);
    if (m) { const vm = v.match(/^([—·※‹]\s*)/); put(k.slice(m[1].length).trim(), vm ? v.slice(vm[1].length).trim() : v); }
    if (k.includes('**')) put(k.split('**').join(''), v.split('**').join(''));
  }
  if (n) { save(); console.log('머리·강조를 뗀 꼴 ' + n + '개'); }
}
// 소스에서 사라진 문구를 지우는 --prune 은 두지 않는다 — 화면에서 이어 붙어 생기는 꼴(「파츠확장[장갑]」 · 「히트당」)과
// 머리를 뗀 꼴은 소스 문자열로는 안 보여, 지우면 일본어 모드에 한글이 새는데 아무도 모른다(2026-10-23 실제로 74개를 지웠다).


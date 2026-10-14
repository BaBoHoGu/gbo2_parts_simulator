// 두 빌드의 **모든 요소 계산 스타일**을 맞댄다 — 사진에 안 찍히는 곳(숨은 화면·닫힌 메뉴)까지.
//
// ■ 왜 — cssdiff 는 사진이라 **화면에 보이는 것만** 잰다. 규칙을 합치거나(9단계) 층을 나누는(@layer)
//   정리는 숨은 화면·닫힌 메뉴·다른 크기에서도 결과가 같아야 한다. 그래서 4크기 × 4장면의
//   모든 요소(약 7만)의 계산 스타일을 맞댄다. 검사(gate)가 아니라 정리할 때 쓰는 손 도구다.
//   새로 들인 토큰 이름은 CS_IGNORE=--a,--b 로 뺀다(그 값이 쓰이는 속성은 그대로 비교된다).
//   스스로를 맞대면 0 이어야 한다 — 0 이 아니면 자가 흔들리는 것이다(localStorage·속성 순서를 그래서 막았다).
//   node tools/cstyle_diff.js <old.html> <new.html>
const path = require('path');
const ROOT = path.join(__dirname, '..');
const B = require(ROOT + '/tools/lib/browser.js');
const { findChrome } = require(ROOT + '/tools/lib/wiki_fetch.js');
const s = ms => new Promise(r => setTimeout(r, ms));
const url = f => 'file:///' + f.split(path.sep).join('/').split(' ').join('%20');
const VIEWS = [
  { tag: 'desk', w: 1500, h: 1000 }, { tag: 'lap', w: 1280, h: 720 },
  { tag: 'phone', w: 390, h: 844, mobile: true }, { tag: 'land', w: 844, h: 390, mobile: true },
];
const SCENES = [
  ['select', async pg => {}],
  ['build', async pg => {
    await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true })); });
    await s(500);
    await pg.evaluate(() => document.querySelector('#msList .ms-card').click()); await s(600);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); }); await s(900);
    await pg.evaluate(() => { [...document.querySelectorAll('#partList .part-tile')].slice(0, 3).forEach(t => t.click()); }); await s(600);
  }],
  ['duel', async pg => { await pg.evaluate(() => document.getElementById('duelBtn').click()); await s(900); }],
  ['codex', async pg => { await pg.evaluate(() => { const d = document.getElementById('duelClose'); if (d) d.click(); const c = document.getElementById('codexBtn'); if (c) c.click(); }); await s(900); }],
];
async function dump(br, file, v) {
  const ctx = await br.createBrowserContext(); const pg = await ctx.newPage();
  pg.on('dialog', d => d.accept('x').catch(() => {}));
  await pg.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 1, isMobile: !!v.mobile, hasTouch: !!v.mobile });
  await pg.evaluateOnNewDocument(() => { const t = new Date('2026-10-14T12:00:00+09:00').getTime(); Date.now = () => t; });
  await pg.goto(url(file), { waitUntil: 'load', timeout: 180000 }); await s(2400);
  const out = {};
  for (const [name, go] of SCENES) {
    await go(pg);
    out[name] = await pg.evaluate(() => {
      const res = {};
      const all = document.querySelectorAll('body *');
      let i = 0;
      for (const el of all) {
        let key = '', e = el;
        while (e && e !== document.body) {
          const par = e.parentElement;
          key = e.tagName + (e.id ? '#' + e.id : ':' + (par ? [...par.children].indexOf(e) : 0)) + '>' + key;
          if (e.id) break;
          e = par;
        }
        key += '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 40);
        i++;
        const cs = getComputedStyle(el);
        const parts = [];
        for (let j = 0; j < cs.length; j++) { const p = cs[j]; if (p.startsWith('transition') || p.startsWith('animation')) continue; parts.push(p + ':' + cs.getPropertyValue(p)); }
        for (const pe of ['::before', '::after']) {
          const c2 = getComputedStyle(el, pe);
          if (c2.content && c2.content !== 'none') parts.push(pe + ' ' + c2.content + '|' + c2.color + '|' + c2.background + '|' + c2.width + '|' + c2.height + '|' + c2.inset);
        }
        res[key] = parts.sort().join(';');
      }
      return res;
    });
  }
  await ctx.close();
  return out;
}
(async () => {
  const [A, Bf] = process.argv.slice(2);
  /* 새로 들인 토큰 이름은 비교에서 뺀다 — 값이 쓰이는 곳(color 등)은 그대로 비교된다 */
  const IGN = new Set((process.env.CS_IGNORE || '').split(',').filter(Boolean));
  const strip = obj => { for (const sc of Object.keys(obj)) for (const k of Object.keys(obj[sc]))
    obj[sc][k] = obj[sc][k].split(';').filter(x => !IGN.has(x.split(':')[0])).join(';'); return obj; };
  const br = await B.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  let diffs = 0, total = 0;
  for (const v of VIEWS) {
    const a = strip(await dump(br, A, v)), b = strip(await dump(br, Bf, v));
    for (const sc of Object.keys(a)) {
      const ka = Object.keys(a[sc]), kb = Object.keys(b[sc]);
      const only = ka.filter(k => !(k in b[sc])).length + kb.filter(k => !(k in a[sc])).length;
      if (only) console.log(v.tag, sc, '한쪽에만 있는 요소', only);
      for (const k of ka) {
        if (!(k in b[sc])) continue;
        total++;
        if (a[sc][k] !== b[sc][k]) {
          diffs++;
          if (diffs <= 15) {
            const pa = new Map((a[sc][k] || '').split(';').map(x => [x.split(':')[0], x]));
            const pb = new Map((b[sc][k] || '').split(';').map(x => [x.split(':')[0], x]));
            const d = [...new Set([...pa.keys(), ...pb.keys()])].filter(p => pa.get(p) !== pb.get(p)).slice(0, 4).map(p => (pa.get(p) || p + ':∅') + ' → ' + (pb.get(p) || '∅'));
            console.log(v.tag, sc, k, d.join(' | '));
          }
        }
      }
    }
  }
  console.log('요소×장면 ' + total + ' 중 다른 것 ' + diffs);
  await br.close();
  process.exit(diffs ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

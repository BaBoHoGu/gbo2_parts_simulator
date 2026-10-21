// PNG 카드(내보내기 → 이미지)의 글자가 **자기 칸 밖으로 나가거나 서로 겹치지 않는가**.
//   node tools/card_overflow_check.js        (먼저 node tools/build.js)
//
// ■ 왜 — 캔버스에 그린 글자는 밖에서 못 읽는다. 무장 표는 cardfit_check 가 재지만, 위쪽 두 패널은 재지 않아
//   긴 확장 스킬 이름이 왼쪽 패널을 132px 넘어 성능표를 덮었고, 내구 지표 끝의 「피해 -60%」가 패널 밖으로
//   잘렸다(2026-10-21 사용자 지적). 무장 표의 「기본 (+파츠) (+스킬)」 도 유형 글자 위로 올라갔다.
// ■ 자 — 모든 fillText 를 가로채 글자 상자를 적고, ① 왼쪽 패널 글자는 왼쪽 패널 안 ② 나머지는 카드 안쪽 경계 안
//   ③ 같은 줄 글자끼리 겹치지 않음 을 본다. 가장 긴 확장 스킬 · 경감 파츠 · 스킬 전부 켠 상태로, 요약·상세 둘 다.
'use strict';
const path0 = require('path');
const R = path0.join(__dirname, '..').split(path0.sep).join('/') + '/';
const GBO2Browser = require(R + 'tools/lib/browser.js');
const { findChrome } = require(R + 'tools/lib/wiki_fetch.js');
const path = require('path');
const URL = 'file:///' + (R + 'dist/gbo2-simulator.html').split(' ').join('%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MECHS = ['ヘイズル・アウスラ［GAU装備］', 'クロスボーン・ガンダムX2改', 'ジム・ドミナンス［水中用装備］'];
let pass = 0, fail = 0;
const PARTS_Q = ['교육형 컴퓨터[특방]', '신형 완충재', '내격투 장갑', '내빔 장갑', '내실탄 장갑'];

(async () => {
  const br = await GBO2Browser.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 200)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2500);
  // fillText 기록기
  await pg.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText;
    window.__ft = null;
    P.fillText = function (t, x, y, ...rest) {
      if (window.__ft && this.canvas.width > 2000) {
        const m = this.measureText(t), w = m.width;
        const a = this.textAlign;
        const l = a === 'right' || a === 'end' ? x - w : a === 'center' ? x - w / 2 : x;
        window.__ft.push({ t: String(t), l, r: l + w, y, font: this.font });
      }
      return orig.call(this, t, x, y, ...rest);
    };
  });
  for (const base of MECHS) for (const mode of ['summary', 'detail']) {
    const info = await pg.evaluate(async (base, PARTS_Q) => {
      const A = window.GBO2UiTest, w8 = x => new Promise(r => setTimeout(r, x));
      const ms = A.msData().filter(m => m.MS名.replace(/_LV\d+$/, '') === base).pop();
      if (!ms) return { err: '기체 없음 ' + base };
      A.setMs(ms); await w8(700);
      // 가장 긴 확장 스킬 · LV5
      const s = document.querySelector('#expansion');
      if (s) { let b = 0; [...s.options].forEach((o, i) => { if (o.text.length > s.options[b].text.length) b = i; }); s.selectedIndex = b; s.dispatchEvent(new Event('change', { bubbles: true })); }
      await w8(300);
      // 파츠 몇 개(경감 태그가 붙게)
      for (const q of PARTS_Q) {
        const i = document.querySelector('#partQuery'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); await w8(250);
        const t = document.querySelector('#partList > *'); if (t) { t.click(); await w8(250); }
      }
      const i = document.querySelector('#partQuery'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
      // 방어 스킬 체크 전부 · 발동 스킬 전부
      document.querySelectorAll('.build-stats input[type=checkbox]').forEach(c => { if (!c.checked && c.id !== 'lateChk') c.click(); });
      const sb = document.querySelector('#skillBtn'); if (sb) { sb.click(); await w8(200); document.querySelectorAll('#skillMenu input[type=checkbox]').forEach(c => { if (!c.checked) c.click(); }); document.body.click(); }
      await w8(400);
      return { name: ms.MS名, exp: s && s.options[s.selectedIndex].text };
    }, base, PARTS_Q);
    if (info.err) { console.log(info.err); continue; }
    await pg.evaluate(() => { window.__ft = []; });
    await pg.evaluate(mode => { document.querySelector('#pngBtn').click(); }, mode);
    await sleep(200);
    await pg.evaluate(mode => { const it = [...document.querySelectorAll('.png-menu-item')][mode === 'summary' ? 0 : 1]; if (it) it.click(); }, mode);
    await sleep(2500);
    const res = await pg.evaluate(() => {
      const ft = window.__ft || []; window.__ft = null;
      const cvsW = Math.max(...ft.map(f => f.r));
      // 카드 폭 W: 상세 1120 · 요약 1040 → 오른쪽 경계 W-44, 왼쪽 패널 경계 400, 오른쪽 패널 시작 440
      return ft;
    });
    const W = mode === 'detail' ? 1120 : 1040;
    const LEFT_R = 24 + 396 - 20, RIGHT_L = 24 + 396 + 20, RIGHT_R = W - 24 - 20;
    const bad = [];
    const wpY = (res.find(f => f.t === '무장 내역') || { y: Infinity }).y;
    const footY = Math.max(...res.filter(f => f.t === 'GBO2 커스텀 파츠 시뮬레이터').map(f => f.y), Infinity * -1);
    for (const f of res) {
      if (f.y >= footY - 1) continue;                      // 바닥글
      const inLeft = f.y < wpY - 1 && f.l < RIGHT_L - 10;  // 무장 표(전체 폭)는 왼쪽 패널이 아니다
      const lim = inLeft ? LEFT_R : RIGHT_R;
      if (f.r > lim + 0.5) bad.push('넘침 ' + Math.round(f.r - lim) + 'px 「' + f.t.slice(0, 40) + '」 (' + (inLeft ? '왼쪽 패널' : '오른쪽') + ')');
    }
    // 같은 줄 겹침
    const rows = {};
    for (const f of res) (rows[Math.round(f.y)] = rows[Math.round(f.y)] || []).push(f);
    for (const row of Object.values(rows)) {
      row.sort((a, b) => a.l - b.l);
      for (let i = 1; i < row.length; i++) if (row[i - 1].r > row[i].l + 1)
        bad.push('겹침 ' + Math.round(row[i - 1].r - row[i].l) + 'px 「' + row[i - 1].t.slice(0, 30) + '」 ↔ 「' + row[i].t.slice(0, 30) + '」');
    }
    const okk = bad.length === 0 && res.length > 40;
    console.log((okk ? '  PASS ' : '  FAIL ') + base + ' · ' + (mode === 'summary' ? '요약' : '상세') + ' 카드 — 글자 ' + res.length + '개가 칸을 안 넘고 안 겹친다');
    if (!okk) bad.slice(0, 8).forEach(b => console.log('      ' + b));
    okk ? pass++ : fail++;
    await pg.evaluate(() => { const c = document.querySelector('#pngModal .close, #pngClose, dialog[open] .modal-close'); if (c) c.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await sleep(300);
  }
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

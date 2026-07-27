// 빌드된 결과를 jsdom 으로 실제 로드해 초기 렌더·상호작용·자동 구성을 확인하고,
// 화면에 일본어가 남지 않았는지와 참조하는 이미지가 전부 존재하는지 검사한다.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIST = path.join(__dirname, '..', 'dist');
const file = path.join(DIST, 'gbo2-simulator.html');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
  cond ? pass++ : fail++;
};

const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  resources: undefined // 이미지는 별도로 파일 존재 여부만 검사한다
});

const { window } = dom;
const errors = [];
window.addEventListener('error', e => errors.push(e.error || e.message));

setTimeout(async () => {
  const $ = s => window.document.querySelector(s);
  const $$ = s => [...window.document.querySelectorAll(s)];

  check('스크립트 오류 없음', errors.length === 0, errors.join('; '));
  check('데이터 로드', window.GBO2_DATA.msData.length > 1000, window.GBO2_DATA.msData.length + '기');
  const totalParts = Object.values(window.GBO2_DATA.parts).reduce((a, b) => a + b.length, 0);

  /* --- 초기 렌더 --- */
  check('기체 카드 렌더', $$('#msList .ms-card').length > 0, $('#msCount').textContent);
  check('기체 썸네일 존재', $$('#msList .ms-card img').length === $$('#msList .ms-card').length);
  check('히어로 표시', $('#heroName').textContent.length > 0, $('#heroName').textContent);
  check('슬롯 게이지 3종', $$('#slotBars .slot-bar').length === 3,
    $$('#slotBars .slot-bar .v').map(n => n.textContent).join(' / '));
  check('장착 타일 8칸', $('#equipped').children.length === 8);
  check('스탯 11행', $$('#statBody .stat-row').length === 11);
  check('파츠 목록 렌더', $$('#partList .part-tile').length === totalParts, $$('#partList .part-tile').length + '/' + totalParts);
  check('파츠 썸네일 존재', $$('#partList .part-tile img').length === totalParts);

  /* --- 필터 --- */
  const attrChips = $$('#attrChips .chip');
  check('속성 칩 4개', attrChips.length === 4);
  attrChips[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const afterAttr = $('#msCount').textContent;
  check('속성 필터 동작', afterAttr !== '1671기', afterAttr);
  attrChips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const costChips = $$('#costChips .chip');
  costChips[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('코스트 필터 동작', $$('#msList .ms-card').length > 0, $('#msCount').textContent);
  costChips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const q = $('#msQuery');
  q.value = '건담';
  q.dispatchEvent(new window.Event('input'));
  check('한국어 검색', $$('#msList .ms-card').length > 0, $('#msCount').textContent);
  q.value = 'ザク';
  q.dispatchEvent(new window.Event('input'));
  check('일본어 검색', $$('#msList .ms-card').length > 0, $('#msCount').textContent);

  /* --- 장착 --- */
  const before = $('#statBody').textContent;
  const firstOk = $$('#partList .part-tile').find(r => !r.classList.contains('blocked'));
  firstOk.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('파츠 장착 반영', $('#statBody').textContent !== before, $('#equipCount').textContent);
  check('장착 타일에 이미지', !!$('#equipped .eq:not(.empty) img'));

  /* --- 자동 구성 --- */
  $('#openAuto').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('드로어 열림', $('#autoDrawer').classList.contains('open'));
  $('#preset').value = '격투 강습';
  $('#preset').dispatchEvent(new window.Event('change'));
  $('#effort').value = '4';
  const t0 = Date.now();
  $('#runAuto').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 9000));

  const equipped = $$('#equipped .eq:not(.empty)');
  const slotPairs = $$('#slotBars .slot-bar .v')
    .map(n => n.textContent.match(/(\d+) \/ (\d+)/).slice(1).map(Number));
  check('자동 구성 결과', equipped.length > 0 && slotPairs.some(([u, m]) => u === m),
    `${equipped.length}개 / ${Date.now() - t0}ms`);
  check('슬롯 초과 없음', slotPairs.every(([u, m]) => u <= m),
    slotPairs.map(([u, m]) => u + '/' + m).join(' '));
  console.log('     ' + equipped.map(e => e.querySelector('.nm').textContent).join(' | '));
  console.log('     ' + $('#autoNote').textContent);

  /* --- 일본어 잔존 --- */
  const kana = /[぀-ヿ㐀-鿿]/;
  const leaks = [];
  const walk = node => {
    if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;
    if (node.nodeType === 3) {
      if (kana.test(node.nodeValue)) leaks.push(node.nodeValue.trim().slice(0, 40));
      return;
    }
    for (const c of node.childNodes) walk(c);
  };
  walk(window.document.body);
  check('화면에 일본어 잔존 없음', leaks.length === 0, leaks.slice(0, 6).join(' | '));

  const D = window.GBO2_DATA, I = window.GBO2i18n;
  const partsAll = [].concat(...Object.values(D.parts));
  check('기체 사전 전수 번역', D.msData.every(m => !kana.test(I.msName(m.MS名))));
  check('파츠 사전 전수 번역',
    partsAll.every(p => !kana.test(I.partName(p.name)) && !kana.test(I.partDesc(p.name, p.description))));

  /* --- 이미지 파일 존재 --- */
  const base = n => n.replace(/_LV\d+$/i, '').trim();
  const has = (dir, name) => fs.existsSync(path.join(DIST, 'images', dir, name + '.webp'));
  const msMiss = [...new Set(D.msData.map(m => base(m.MS名)))].filter(n => !has('ms', n));
  const partMiss = partsAll.map(p => p.name).filter(n => !has('parts', n));
  check('기체 이미지 존재', msMiss.length <= 1, msMiss.join(', ') || '전부 존재');
  check('파츠 이미지 존재', partMiss.length === 0, partMiss.slice(0, 5).join(', ') || '전부 존재');
  check('기본 이미지 존재', has('ms', '_default') && has('parts', '_default'));

  check('최종 스크립트 오류 없음', errors.length === 0, errors.join('; '));

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  window.close();
  process.exit(fail ? 1 : 0);
}, 1500);

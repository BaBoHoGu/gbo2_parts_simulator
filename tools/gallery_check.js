// 공유 갤러리 실측 — 실제 Firebase 에 올리고, 목록에 뜨고, 눌러서 불러와지는지.
//   node tools/gallery_check.js
//
// 실제 백엔드를 쓰므로 데이터가 한 건 남는다. 마지막에 지울 키를 알려 준다
// (규칙상 클라이언트는 삭제할 수 없다 — 콘솔에서 지워야 한다).
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);

  // 앱이 켜질 때는 네트워크를 쓰지 않아야 한다 (오프라인 우선)
  const early = [];
  pg.on('request', r => { if (!/^file:/.test(r.url())) early.push(r.url().slice(0, 60)); });
  await sleep(800);
  check('앱 시작 시 네트워크 호출 없음', early.length === 0, early.join(' , '));

  // 기체 + 파츠 구성
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '짐 스나이퍼'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(800);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1400);
  await pg.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      const t = [...document.querySelectorAll('#partList .part-tile')].find(x => !x.classList.contains('blocked') && !x.classList.contains('on'));
      if (!t) break; t.click(); await new Promise(r => setTimeout(r, 120));
    }
  });
  await sleep(700);

  // 업로드 — 제목은 매번 다르게 해도 '구성'이 같으면 서버가 중복으로 막는다.
  // 그래서 파츠 조합을 시각으로 흔들지 않고, 실패해도 그 사유를 확인한다.
  const title = 'AUTOTEST ' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
  await pg.evaluate(t => { window.prompt = () => t; }, title);
  await pg.evaluate(() => document.querySelector('#galleryBtn').click());
  await sleep(1200);
  check('갤러리가 전체 화면으로 열린다', await pg.evaluate(() =>
    document.body.classList.contains('view-gallery') && !!document.querySelector('#screenGallery')));
  check('모달이 아니라 화면이다 (배경 덮개 없음)', await pg.evaluate(() =>
    !document.querySelector('.auto-modal-back:not([hidden])')));

  await pg.evaluate(() => document.querySelector('#galleryUpload').click());
  await sleep(9000);
  const up = await pg.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');
  console.log('   업로드 결과: ' + up);
  const uploaded = /올렸습니다/.test(up);
  const dup = /이미 같은 구성/.test(up);
  check('업로드 성공 (또는 이미 있음)', uploaded || dup, up);

  // 목록에 뜨는가
  await sleep(3000);
  const cards = await pg.evaluate(() => [...document.querySelectorAll('#galleryResults .auto-cand')].map(c => ({
    name: (c.querySelector('.sc-name') || {}).textContent || '',
    sub: (c.querySelector('.sc-sub') || {}).textContent || '',
    ms: (c.querySelector('.sc-msname') || {}).textContent || '',
    thumbs: c.querySelectorAll('.ac-thumb').length,
    stats: c.querySelectorAll('.ac-stats .ac-stat').length,
    dura: (c.querySelector('.sc-dura') || {}).textContent || ''
  })));
  check('목록에 카드가 뜬다', cards.length > 0, '0개');
  // 파츠가 0개인 구성도 올라올 수 있어, 요약 검사는 '파츠가 있는' 카드로 한다
  const idx = cards.findIndex(c => c.thumbs > 0);
  if (cards.length && idx >= 0) {
    const c = cards[idx];
    console.log('   첫 카드: ' + c.name + ' | ' + c.ms + ' | ' + c.sub);
    console.log('           파츠 ' + c.thumbs + '개 · 스탯 ' + c.stats + '칸 · ' + c.dura.replace(/\s+/g, ' ').slice(0, 60));
    check('저장 목록처럼 요약이 보인다 (스탯 10칸 + 내구 지표)', c.stats === 10 && /내구 지표/.test(c.dura));
    check('파츠 아이콘이 보인다', c.thumbs > 0);
    check('올린 시각·데이터 버전이 보인다', /전|방금/.test(c.sub) && /데이터/.test(c.sub), c.sub);
  }

  // 눌러서 내 구성으로 가져오기 — 파츠가 실린 카드로 확인한다
  await pg.evaluate(i => { document.querySelectorAll('#galleryResults .auto-cand')[i].click(); }, Math.max(0, idx));
  await sleep(1800);
  const after = await pg.evaluate(() => ({
    closed: !document.body.classList.contains('view-gallery'),
    toast: (document.querySelector('#toast') || {}).textContent || '',
    equipped: document.querySelectorAll('#equipped .eq:not(.empty)').length,
    ms: (document.querySelector('#heroName') || {}).textContent || '',
    view: ['select','build','gallery'].find(v => document.body.classList.contains('view-' + v)) || '?'
  }));
  check('가져오면 파츠 화면으로 돌아간다', after.closed && after.view === 'build', '지금 화면: ' + after.view);
  check('구성이 실제로 장착된다', after.equipped > 0, '장착 ' + after.equipped + '개');
  console.log('   ' + after.ms + ' · 파츠 ' + after.equipped + '개 · ' + after.toast);

  // 검색
  await pg.evaluate(() => document.querySelector('#galleryBtn').click());
  await sleep(2500);
  const before = await pg.evaluate(() => document.querySelectorAll('#galleryResults .auto-cand').length);
  await pg.evaluate(() => { const q = document.querySelector('#galleryQuery'); q.value = '없을것같은검색어zzz'; q.dispatchEvent(new Event('input')); });
  await sleep(600);
  const filtered = await pg.evaluate(() => document.querySelectorAll('#galleryResults .auto-cand').length);
  check('검색이 걸러 낸다', before > 0 && filtered === 0, `${before} → ${filtered}`);

  // 「돌아가기」 로 들어오기 전 화면으로 되돌아가는가
  await pg.evaluate(() => document.querySelector('#galleryBack').click());
  await sleep(700);
  check('돌아가기가 이전 화면으로 되돌린다',
    await pg.evaluate(() => document.body.classList.contains('view-build')));

  // 속성 칩 필터
  await pg.evaluate(() => document.querySelector('#galleryBtn').click());
  await sleep(2500);
  const chipRes = await pg.evaluate(async () => {
    const all = document.querySelectorAll('#galleryResults .auto-cand').length;
    const chip = [...document.querySelectorAll('#galleryAttrChips .chip')].find(c => c.textContent !== '전체');
    if (!chip) return null;
    chip.click();
    await new Promise(r => setTimeout(r, 400));
    return { all, after: document.querySelectorAll('#galleryResults .auto-cand').length, label: chip.textContent };
  });
  check('속성 칩이 목록을 거른다', !!chipRes && chipRes.after <= chipRes.all,
    chipRes ? `${chipRes.label}: ${chipRes.all} → ${chipRes.after}` : '칩 없음');

  // ── 파츠 0개 업로드 차단 ────────────────────────────────────────
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /돌아가기/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(700);
  await pg.evaluate(() => { const c = document.querySelector('#clearParts'); if (c) c.click(); });
  await sleep(700);
  await pg.evaluate(() => { window.prompt = () => '파츠없음시험'; });
  await pg.evaluate(() => document.querySelector('#galleryBtn').click());
  await sleep(1500);
  await pg.evaluate(() => document.querySelector('#galleryUpload').click());
  await sleep(2500);
  const zero = await pg.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');
  check('파츠 0개는 올릴 수 없다', /파츠를 하나 이상/.test(zero), zero);

  // ── 코스트·레벨·등급 칩이 있고 걸러 내는가 ──────────────────────
  const chips = await pg.evaluate(() => ({
    cost: document.querySelectorAll('#galleryCostChips .chip').length,
    lv: document.querySelectorAll('#galleryLvChips .chip').length,
    rarity: document.querySelectorAll('#galleryRarityChips .chip').length
  }));
  check('코스트·레벨·등급 칩이 있다', chips.cost > 5 && chips.lv === 5 && chips.rarity === 6,
    JSON.stringify(chips));
  const lvFilter = await pg.evaluate(async () => {
    const all = document.querySelectorAll('#galleryResults .auto-cand').length;
    const chip = [...document.querySelectorAll('#galleryLvChips .chip')].find(c => c.textContent === 'LV1');
    chip.click();
    await new Promise(r => setTimeout(r, 400));
    return { all, after: document.querySelectorAll('#galleryResults .auto-cand').length };
  });
  check('레벨 칩이 목록을 거른다', lvFilter.after <= lvFilter.all, `${lvFilter.all} → ${lvFilter.after}`);

  // ── 관리자: 로그인 전에는 삭제 버튼이 없어야 한다 ────────────────
  await pg.evaluate(() => {
    const chip = [...document.querySelectorAll('#galleryLvChips .chip')].find(c => c.textContent === '전체');
    if (chip) chip.click();
  });
  await sleep(500);
  const adm = await pg.evaluate(() => ({
    btn: !!document.querySelector('#galleryAdmin'),
    del: document.querySelectorAll('#galleryResults .sc-del').length,
    api: !!(window.GBO2Share && window.GBO2Share.adminLogin && window.GBO2Share.remove)
  }));
  check('관리자 버튼이 있다', adm.btn);
  check('로그인 전에는 삭제 버튼이 없다', adm.del === 0, '삭제 버튼 ' + adm.del + '개');
  check('관리자 API 가 노출돼 있다', adm.api);
  // 비밀번호가 앱 안에 박혀 있지 않은지 (가장 중요한 확인)
  const leak = await pg.evaluate(() => {
    const src = document.documentElement.innerHTML;
    return /password\s*[:=]\s*['"][^'"]{3,}/i.test(src);
  });
  check('앱에 비밀번호가 들어 있지 않다', !leak);

  // 관리자 로그인 UI — 비밀번호가 가려지는지
  const pwUi = await pg.evaluate(async () => {
    document.querySelector('#galleryAdmin').click();
    await new Promise(r => setTimeout(r, 300));
    const box = document.querySelector('#galleryAdminBox');
    const pw = document.querySelector('#adminPw');
    return { open: box && !box.hidden, type: pw && pw.type, email: !!document.querySelector('#adminEmail') };
  });
  check('관리자 버튼이 로그인 칸을 편다', pwUi.open);
  check('비밀번호가 가려진다 (type=password)', pwUi.type === 'password', '실제: ' + pwUi.type);
  check('이메일 칸이 있다', pwUi.email);

  // 아무 계정으로나 시도해도 관리자가 되지 않는다
  const bad = await pg.evaluate(async () => {
    document.querySelector('#adminEmail').value = 'nobody@example.com';
    document.querySelector('#adminPw').value = 'wrongpassword';
    document.querySelector('#adminGo').click();
    await new Promise(r => setTimeout(r, 6000));
    return {
      toast: (document.querySelector('#toast') || {}).textContent || '',
      admin: !!(window.GBO2Share && window.GBO2Share.isAdmin()),
      pwCleared: document.querySelector('#adminPw').value === ''
    };
  });
  check('잘못된 계정으로는 관리자가 안 된다', !bad.admin, bad.toast);
  check('실패해도 비밀번호를 화면에 남기지 않는다', bad.pwCleared);


  check('스크립트 오류 없음', errs.length === 0, errs.join(' / '));
  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n갤러리 실측 통과');
  if (uploaded) console.log('\n※ 시험 데이터가 올라갔습니다 — 콘솔에서 「' + title + '」 항목을 지워 주세요.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

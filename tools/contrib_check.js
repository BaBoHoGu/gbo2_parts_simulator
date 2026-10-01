// 「왜 이 파츠?」 기여도가 **자동 구성이 고를 때 쓴 자**와 같은 자인지 실측.
//   node tools/contrib_check.js
//
// 왜 바깥 자가 필요한가:
//   기여도를 makeScorer 로 재게 바꿨으니 「1위를 빼면 점수가 가장 많이 떨어진다」는
//   **정의상 참**이다 — 그걸 검사하면 허깨비다. 그래서 순위(점수 쪽 코드)와
//   역할 태그·상승 스탯(derivedMetrics 쪽 코드)이라는 **서로 다른 두 길**을 맞대 본다.
//
//   사격 가중치만 주면 1위는 공격 역할이어야 하고, 내구 가중치만 주면 내구여야 한다.
//   예전 순위식은 원시 가중합에 실효 지표를 전부 가중치 1 로 평평하게 더해서,
//   「사격 5」만 준 구성에서도 기동·내구가 같은 무게로 섞여 들었다.
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const fs = require('fs');
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

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra != null ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

// 기체 이름을 코드에 박지 않는다 — 데이터에서 고른다
const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const dict = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.auto.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.json'), 'utf8'))
};
// 레벨이 높은 기체일수록 파츠 칸이 넉넉해 구성이 여러 개 나온다
const target = msData.filter(m => /_LV4$/.test(String(m.MS名))).slice(0, 1)[0] || msData[0];
const targetName = dict[String(target.MS名).replace(/_LV\d+$/, '')] || String(target.MS名);

(async () => {
  const br = await GBO2Browser.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);

  // 기체 고르기
  await pg.evaluate(t => {
    const e = document.querySelector('#msQuery');
    if (e) { e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }
  }, targetName);
  await sleep(900);
  const picked = await pg.evaluate(() => {
    const c = document.querySelector('.ms-card');
    if (c) { c.click(); return true; }
    return false;
  });
  ok('기체를 골랐다 (' + targetName + ')', picked);
  if (!picked) { await br.close(); process.exit(1); }
  await sleep(1200);

  // 자동 구성 패널 열기
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /자동 구성/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(800);

  /* 가중치 칸은 #autoGrid 안에서 스탯마다 [가중치, 하한, 상한] 세 칸이 반복된다.
     라벨로 자리를 찾는다 — 인덱스를 박으면 스탯이 하나 늘 때 조용히 엉뚱한 칸을 만진다. */
  const setWeights = (map) => pg.evaluate((m) => {
    const grid = document.querySelector('#autoGrid');
    const kids = [...grid.children];
    const fire = (inp, v) => { inp.value = String(v); inp.dispatchEvent(new Event('input', { bubbles: true })); };
    let touched = 0, zeroed = 0;
    for (let i = 0; i < kids.length; i++) {
      if (!kids[i].classList.contains('lb')) continue;
      const label = kids[i].textContent.trim();
      const inp = kids[i + 1];
      if (!inp || inp.tagName !== 'INPUT') continue;
      if (label in m) { fire(inp, m[label]); touched++; }
      else { fire(inp, 0); zeroed++; }
    }
    return { touched, zeroed };
  }, map);

  const readWhy = async () => {
    await pg.evaluate(() => document.querySelector('#runAuto').click());
    await sleep(22000);
    return pg.evaluate(() => {
      const card = document.querySelector('#autoResults .auto-cand');
      if (!card) return null;
      const btn = card.querySelector('.ac-why');
      if (!btn) return null;
      btn.click();
      return [...card.querySelectorAll('.why-row')].map(r => ({
        part: (r.querySelector('.why-ptn') || {}).textContent || '',
        role: (r.querySelector('.why-role') || {}).textContent || '',
        stats: (r.querySelector('.why-stats') || {}).textContent || '',
        width: (r.querySelector('.why-bar-fill') || {}).style.width || ''
      }));
    });
  };

  // ① 사격 가중치만 — 1위는 공격 역할이어야 한다
  const wa = await setWeights({ '사격 보정': 5 });
  ok('가중치 칸을 찾아 설정했다', wa.touched === 1, wa);
  const atk = await readWhy();
  ok('「왜 이 파츠?」 줄이 나온다', !!(atk && atk.length), atk);
  if (atk && atk.length) {
    atk.slice(0, 4).forEach(r => console.log('    [공격] ' + r.part + ' · ' + r.role + ' · ' + r.stats.slice(0, 44)));
    ok('사격 가중치만 줬을 때 기여도 1위가 공격 역할이다', atk[0].role === '공격',
      { 일위: atk[0].part, 역할: atk[0].role, 상승: atk[0].stats.slice(0, 60) });

    /* 여기가 자의 핵심이다. 역할 태그만 보면 약하다 — 심어 보니 옛 순위식도 그건 통과했다.
       **크기**까지 본다: 사격 가중치만 줬으면 1위는 사격 기여가 가장 큰 파츠여야 한다.
       숫자는 순위를 만든 코드가 아니라 derivedMetrics 쪽이 적어 주므로 바깥 자다.
       (옛 순위식은 실효 사격 +20 을 주는 파츠를 +14 짜리 아래로 밀었다.) */
    const shootGain = r => {
      const eff = r.stats.match(/실효 사격 \+(\d+)/);
      if (eff) return Number(eff[1]);
      const raw = r.stats.match(/사격 보정 \+(\d+)/);
      return raw ? Number(raw[1]) : 0;
    };
    const gains = atk.map(shootGain);
    const maxGain = Math.max(...gains);
    ok('사격 기여가 가장 큰 파츠가 기여도 1위다', gains[0] === maxGain,
      { 일위: atk[0].part + ' (+' + gains[0] + ')', 더큰것: atk[gains.indexOf(maxGain)].part + ' (+' + maxGain + ')' });
    /* 「기동 파츠가 공격 파츠보다 위에 오면 안 된다」고도 걸어 봤는데 **그 단정이 틀렸다.**
       역할 태그는 그 파츠에서 가장 큰 스탯을 가리킬 뿐이라, 오버튠[기동](고속이동 +10 ·
       사격 +4)은 '기동'으로 찍히면서도 사격을 준다 — 사격 +2 짜리 '공격' 파츠보다 위에
       오는 게 맞다. 태그를 순위의 자로 읽지 않는다. */
    // 막대는 1위가 100%여야 한다 (share 는 최댓값 기준)
    ok('기여도 막대가 1위 기준으로 정규화된다', atk[0].width === '100%', atk[0].width);
  }

  // ② 내구 가중치만 — 1위는 내구 역할이어야 한다
  const wd = await setWeights({ 'HP': 5, '내실탄 보정': 5, '내빔 보정': 5, '내격투 보정': 5 });
  const def = await readWhy();
  ok('내구 가중치 칸을 찾았다', wd.touched >= 1, wd);
  if (def && def.length) {
    def.slice(0, 4).forEach(r => console.log('    [내구] ' + r.part + ' · ' + r.role + ' · ' + r.stats.slice(0, 44)));
    ok('내구 가중치만 줬을 때 기여도 1위가 내구 역할이다', def[0].role === '내구',
      { 일위: def[0].part, 역할: def[0].role, 상승: def[0].stats.slice(0, 60) });
    // 두 설정이 **다른 답**을 내야 검사가 뜻을 갖는다 (같으면 가중치가 안 먹은 것)
    ok('가중치를 바꾸면 기여도 1위가 달라진다', !atk || atk[0].part !== def[0].part,
      { 공격일위: atk && atk[0].part, 내구일위: def[0].part });
  }

  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

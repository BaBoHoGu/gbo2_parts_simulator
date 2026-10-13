// 무장 피해를 계산하는 **두 경로**가 같은 답을 내는지 실측한다.
//
//   node tools/damage_path_check.js
//
// 왜 필요한가 — 피해 계산이 한 곳이 아니다.
//   ① 무장표·PNG 카드·저장구성 → weaponHitDamage() (공용)
//   ② 대결 「내 무장 → 상대」    → D.shootingDamage / D.meleeDamage 직접 호출
// ②가 따로인 이유는 공용 함수가 상성(attr)·방향 배율(ccd)을 안 받기 때문이다.
// 그래서 새 보정을 넣을 때 두 곳을 다 고쳐야 하는데, 이 저장소는 이미 두 번 물렸다
// (「고정 피해가 한쪽만」·「1히트 vs 전탄」). 그 재발을 여기서 막는다.
//
// 두 값은 **같아야 하는 게 아니라, 설명되는 만큼만 달라야** 한다:
//   대결 = floor(무장표 1히트 × 상성배율) × 전탄배수  (+ 고정 피해)
// 상성 배율은 기체마다 하나뿐이므로, 한 기체 안에서 무장마다 배율이 달라지면 그것이 버그다.
const GBO2Browser = require('./lib/browser.js');   // 크롬 임시 프로필 정리가 프로세스를 죽이지 않게
const DG = require('./lib/duelgate.js');           // 대결 시뮬을 몰아 재는 공용 손잡이
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MECHS = ['건담 Ez8', '자쿠Ⅱ', '짐 커맨드'];
const ATTR_MULT = [['동일', 1], ['우위', 1.3], ['열세', 0.8]];
const FIRE = [1, 2, 3, 4, 5, 6, 8];       // 동시발사 배수로 있을 수 있는 값

let pass = 0, fail = 0;
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n      ' + extra : '')); }
};

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1600, height: 1200 });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 80)));
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  for (const name of MECHS) {
    await pg.evaluate(() => { const x = document.querySelector('#duelClose'); if (x) x.click(); });
    await sleep(350);
    await pg.evaluate(() => { const b = document.querySelector('#backToSelect'); if (b) b.click(); });
    await sleep(700);
    await pg.evaluate(n => {
      const i = document.querySelector('#msQuery'); i.value = n;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }, name);
    await sleep(900);
    const got = await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (!c) return false; c.click(); return true; });
    if (!got) { check(name + ' — 기체를 찾음', false); continue; }
    await sleep(1000);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1400);
    // 보정이 실제로 걸리도록 공격 파츠를 끼운다 — 맨몸이면 두 경로가 우연히 같을 수 있다
    for (const kw of ['사격 강화', '격투 강화']) {
      await pg.evaluate(k => {
        const i = document.querySelector('#partQuery'); i.value = k;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }, kw);
      await sleep(420);
      await pg.evaluate(() => { const c = document.querySelector('#partList > *'); if (c) c.click(); });
      await sleep(420);
    }
    // ① 무장표: 「기본 (+보정)」 의 합 = 1히트 최종 피해
    const screen = await pg.evaluate(() => {
      const out = {};
      for (const r of document.querySelectorAll('#weaponList > *')) {
        const t = r.innerText;
        const nm = (t.split('\n').map(x => x.trim()).filter(Boolean)[1] || '');
        const m = t.match(/([\d,]+)\s*\(\+([\d,]+)\)/);
        if (nm && m) out[nm] = Number(m[1].replace(/,/g, '')) + Number(m[2].replace(/,/g, ''));
      }
      return out;
    });
    // ② 대결 「내 무장 → 상대」 — 무장마다 attack() 으로 잰다(피탄 표가 있던 자리).
    //    화면 글자를 긁지 않는다. 표가 사라져도 뜻은 그대로다.
    const pie = {}, fixedOf = {};
    for (const jp of await DG.weaponsOf(pg, { me: null, foe: 'ザクⅡ' })) {
      const r = await DG.measure(pg, { me: null, foe: 'ザクⅡ', weaponExact: jp });
      if (r.오류) continue;
      pie[r.무장ko] = r.한발;
      fixedOf[r.무장ko] = r.고정;
    }
    await DG.close(pg);

    const keys = Object.keys(screen).filter(k => pie[k] != null);
    if (!keys.length) { check(name + ' — 대조할 무장이 있음', false, '무장표 ' + Object.keys(screen).length + ' · 대결 ' + Object.keys(pie).length); continue; }

    // 무장마다 「어떤 상성×전탄 조합으로 설명되는가」를 찾는다
    const explained = [], odd = [];
    for (const k of keys) {
      let hit = null;
      for (const [lbl, m] of ATTR_MULT)
        for (const f of FIRE)
          if (Math.floor(screen[k] * m) * f + (fixedOf[k] || 0) === pie[k]) { hit = { lbl, m, f }; break; }
      if (hit) explained.push({ k, ...hit });
      else odd.push(k + ': 무장표 ' + screen[k] + ' vs 대결 ' + pie[k]
        + ' (비 ' + (pie[k] / screen[k]).toFixed(3) + ')');
    }
    check(name + ' — 모든 무장이 상성×전탄으로 설명된다 (' + keys.length + '종)',
      odd.length === 0, odd.slice(0, 4).join('\n      '));
    // 상성 배율은 기체 하나에 하나뿐이다 — 무장마다 다르면 그것이 어긋남이다
    const mults = [...new Set(explained.map(x => x.m))];
    check(name + ' — 상성 배율이 무장마다 같다',
      mults.length <= 1, '나온 배율: ' + mults.join(', '));
  }
  /* ── 무장이 적 내성을 깎는다 ──
     「対象の耐ビーム補正を30%減でダメージ計算」이 계산 어디에도 안 들어가고 있었다.
     뜻은 위키 해설이 못 박아 둔다 — 「30%減算した状態(対象耐ビーム補正70%の状態)」.
     **보정값의 70%** 이지 −30 이 아니다. 그래서 빼는 것이 아니라 곱하는지를 잰다. */
  const foe = await pg.evaluate(() => {
    const T = window.GBO2UiTest;
    const w = t => ({ info: { '備考': t } });
    const tot = { hp: 20000, armorRange: 50, armorBeam: 50, armorMelee: 50 };
    return {
      읽기: [
        T.weaponFoeArmorCut(w('対象の耐ビーム補正を40%減でダメージ計算')),
        T.weaponFoeArmorCut(w('攻撃対象の耐格闘補正を30%減でダメージ計算')),
        T.weaponFoeArmorCut(w('移動射撃可 / よろけ有')),          // 없는 것은 0
        T.weaponFoeArmorCut(w('対象のシールドHPを無視'))            // 실드 무시는 내성이 아니다
      ],
      // 보정 50 을 40% 깎으면 30 이다(−40 이 되어 10 이 아니다). 내구는 HP/(1−보정/100).
      깎기전: T.durabilityOf(tot, 'armorBeam'),
      깎은뒤: T.durabilityOf({ ...tot, armorBeam: 50 * (1 - 40 / 100) }, 'armorBeam'),
      뺄경우: T.durabilityOf({ ...tot, armorBeam: 50 - 40 }, 'armorBeam')
    };
  });

  /* ── 화면 끝까지 ── 건담 DX 로 자쿠Ⅰ 을 때린다.
     트윈 새틀라이트 캐논은 **집속 필수라 비집속 위력이 없어**(power = null) 여태 이 목록에서
     통째로 빠져 있었다 — 103 종이 그랬다. 그 줄이 뜨는 것과, 두 꼬리표가 **잘리지 않고**
     다 보이는 것을 함께 본다(한 칸에 몰아넣었더니 「집속…」으로 잘렸다). */
  /* 대결 시뮬에서 **무장마다** 잰다(피탄 표가 있던 자리).
     상대는 **내성이 높은** 기체라야 한다 — 자쿠Ⅰ 로는 20% 를 깎아도 발수가 그대로여서
     (ceil 이 삼킨다) 되돌려도 자가 안 물렸다. 실측으로 확인하고 바꾼 자리다. */
  const DXFOE = 'プロトタイプ・サイコ・ガンダム';
  const ui = await (async () => {
    const rows = [];
    for (const jp of await DG.weaponsOf(pg, { me: 'ガンダムDX', foe: DXFOE })) {
      const r = await DG.measure(pg, { me: 'ガンダムDX', foe: DXFOE, weaponExact: jp });
      if (r.오류) continue;
      rows.push({
        nm: r.무장ko,
        pierce: r.적내성깎기 ? '내' + ({ solid: '실탄', beam: '빔', melee: '격투' }[r.속성] || r.속성)
          + ' −' + r.적내성깎기 + '%' : null,
        charge: r.집속 ? '집속' : null,
        hits: r.발수, per: r.한발
      });
    }
    /* 꼬리표가 칸 밖으로 잘려 나가지 않았는가 — 대결에서는 중앙 카드의 칩이다.
       표가 없어졌으니 「표 칸에서 잘림」이 아니라 **칩 글자가 잘렸는가**를 본다. */
    const fits = await pg.evaluate(() => [...document.querySelectorAll('#duelModal .dc-chips > *')]
      .every(e => e.scrollWidth <= e.clientWidth + 1));
    await DG.close(pg);
    return { foe: DXFOE, rows: rows.map(r => ({ ...r, fits })) };
  })();

  /* ── 스킬의 적 내성 감소 ①: **어느 무장에 걸리는가** ──
     여기가 위험한 자리다. 「対象の耐格闘補正を N%減」이 같은 말로 적혀 있어도
     블레이드 태클은 **태클**, 고성능 카운터는 **카운터**, 바이오센서(PΖΖ)는 **헤비어택**
     전용이다. 「格闘」이 들어갔다고 격투 무장 전부에 걸면 70% 가 사벨에 붙어
     피해가 통째로 거짓이 된다(실제로 처음에 그렇게 잡혔다).
     그래서 원문이 범위를 **적었을 때만** 인정한다 — 이 표가 그 판정을 못 박는다. */
  const scope = await pg.evaluate(() => {
    const T = window.GBO2UiTest;
    const CASES = [
      ['ラムズゴック', 'ブレードタックル', null],
      ['リバウ', '追撃格闘補助プログラム', null],
      ['ゴッドガンダム', '明鏡止水', 'melee'],
      ['クシャトリヤ・リペアード', '高性能カウンタープログラム', null],
      ['プロトタイプΖΖガンダム', '能力UP「バイオセンサー（PΖΖ）」', null],
      ['F90［MZ仕様］', 'OS「TYPE C.A-Ⅲ」', 'melee'],
      ['V2ガンダム', 'ロングレンジ・アダプター', 'solid,beam'],
      ['V2アサルトバスターガンダム', 'ロングレンジ・アダプター', 'solid,beam']
    ];
    const out = [];
    for (const [msName, skName, want] of CASES) {
      const ms = T.msData().filter(m => m.MS名.replace(/_LV\d+$/, '') === msName).pop();
      if (!ms) { out.push({ msName, skName, got: '(기체 없음)', want }); continue; }
      T.setMs(ms);
      const f = T.foeArmorOf(skName);
      out.push({ msName, skName, want,
        got: f ? (f.scope ? f.scope.join(',') : null) : '(못 읽음)',
        val: f ? f.list.map(x => x.ax + ':' + x.pct).join(' ') : null });
    }
    return out;
  });

  /* ── 스킬의 적 내성 감소 ②: **정말 반영되는가** ──
     V2AB 의 롱 레인지 어댑터는 내실탄·내빔을 40% 깎는다. 스킬을 켜면 사격 무장은
     발수가 줄고 **격투 무장은 그대로**여야 한다 — 범위를 지키는지까지 한 번에 잰다.
     실측: 스프레이 빔 포드 7→6 · M·B 라이플 10→8 · B 사벨 12→12. */
  /* V2AB 의 롱 레인지 어댑터는 내실탄·내빔을 40% 깎는다. 스킬을 켜면 사격 무장은
     발수가 줄고 **격투 무장은 그대로**여야 한다 — 범위를 지키는지까지 한 번에 잰다.
     (피탄 시뮬이 있던 자리. 대결은 쪽마다 버프 스킬을 켜므로 buffs 로 넘긴다.) */
  const skillOn = await (async () => {
    const ME = 'V2アサルトバスターガンダム', FOE = 'プロトタイプ・サイコ・ガンダム';
    const SK = 'ロングレンジ・アダプター';
    const read = async buffs => {
      const out = {};
      for (const jp of await DG.weaponsOf(pg, { me: ME, foe: FOE })) {
        const r = await DG.measure(pg, { me: ME, foe: FOE, weaponExact: jp, buffs });
        if (!r.오류) out[r.무장ko] = r.발수;
      }
      return out;
    };
    const off = await read([]);
    const on = await read([SK]);
    await DG.close(pg);
    return { off, on };
  })();

  /* ── 적 실드를 무시하는 무장 ──
     「攻撃対象のシールドHP無視」「…シールド無視」「…シールド貫通効果有」 세 가지로 적히고
     전수로 24종인데 반영되지 않았다. 실드로 막는 상대라도 이 무장은 실드를 안 깨고
     기체를 바로 때린다. 조건이 붙는 것(F91 「集束時、…シールド無視」)은 그 모드일 때만이다. */
  const shieldRead = await pg.evaluate(() => {
    const T = window.GBO2UiTest;
    const w = t => ({ info: { '備考': t } });
    return [
      T.weaponIgnoresShield(w('移動射撃可 / 攻撃対象のシールドHP無視'), false),
      T.weaponIgnoresShield(w('攻撃対象のシールド無視'), false),
      T.weaponIgnoresShield(w('攻撃対象のシールド貫通効果有'), false),
      T.weaponIgnoresShield(w('集束可 / 集束時、攻撃対象のシールド無視'), false),  // 비집속이면 아니다
      T.weaponIgnoresShield(w('集束可 / 集束時、攻撃対象のシールド無視'), true),
      T.weaponIgnoresShield(w('展開部に当たったシールドHP無視を無効化'), false),   // 막는다는 말이다
      T.weaponIgnoresShield(w('移動射撃可 / よろけ有'), false)
    ].join(',');
  });

  /* 실드로 막는 상대에게 「실드 무시」 무장이 그렇게 적히는가.
     (피탄 시뮬이 있던 자리. 대결은 맞는 쪽의 「🛡 실드로 막음」을 켠다.) */
  const shieldUi = await (async () => {
    const ME = 'ガンダムDX', FOE = 'ジム';
    const out = [];
    for (const jp of await DG.weaponsOf(pg, { me: ME, foe: FOE })) {
      const r = await DG.measure(pg, { me: ME, foe: FOE, weaponExact: jp, shield: true });
      if (r.오류) continue;
      out.push({ w: r.무장ko,
        sh: r.실드 ? (r.실드.발수 != null ? '실드 ' + r.실드.발수 + '발' : r.실드.메모) : null,
        ign: !!(r.실드 && r.실드.메모 === '실드 무시') });
    }
    await DG.close(pg);
    return out;
  })();

  /* ── 누적치의 배수 ──
     「20% x2発 x3射」처럼 배수가 **둘** 붙는 표기가 있다(153 무장). 첫 것만 읽고 있어서
     실제보다 낮게 나왔고, 더 나쁜 것은 **같은 무장을 피해 쪽과 다르게 셌다**는 점이다 —
     같은 備考의 「二発同時発射 x3回攻撃」을 피해는 2×3 = 6 으로 세는데 누적치는 2 로 셌다.
     괄호는 집속값이라 세면 안 된다: 「5% x10（7% x10）」의 뒤쪽 x10 은 집속 때의 배수다. */
  const stagRead = await pg.evaluate(() => {
    const T = window.GBO2UiTest;
    const p = t => { const r = T.parseStagger({ mods: { stagger: t } }); return r.pct + ':' + r.pellets; };
    return [
      p('20% x2発 x3射'),     // 2×3 = 6
      p('6% x6発 x3射'),      // 6×3 = 18
      p('12% x 3発 x2腕'),    // 3×2 = 6  (사이 공백)
      p('20% x6'),            // 하나면 그대로
      p('5% x10（7% x10）'),  // 괄호는 집속값 — 세지 않는다
      p('7%（15HIT）'),       // 괄호는 경직까지 필요한 히트 수 — 배수가 아니다
      p('80%')                // 배수 없음
    ].join(' / ');
  });

  /* 그리고 **두 방향이 같은 수를 쓰는지**를 화면에서 본다. 파라스 아테네의 견부 빔포는
     「よろけ値：50% x2発 x5射」이고 발사는 「二発同時発射 … 最大5ヒット」다 —
     격파 줄의 「× N발 × M히트」와 경직 줄의 「1발=K히트」에서 N×M === K 여야 한다. */
  /* 무장 이름은 **사전에서 읽어 온다.** 예전엔 「견부 빔포」라고 박아 두었는데,
     사전을 공식 표기(肩部 = 어깨)로 고치자 자가 무장을 못 찾아 울었다 — 앱은 멀쩡했다.
     일본어 이름은 위키가 쓰는 고정값이라 안 썩는다. 한국어는 사전이 정한다. */
  const KO = (() => {
    const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'weapons.json'), 'utf8'));
    return ja => w[ja] || ja;
  })();
  const WEAP_STAG = KO('肩部ビーム砲');
  const WEAP_SOLID = [KO('マシンキャノンx2'), KO('頭部バルカン砲x4')];

  /* 두 방향이 **같은 배수**를 쓰는지. 파라스 아테네의 어깨 빔포는
     「よろけ値：50% x2発 x5射」이고 발사는 「二発同時発射 … 最大5ヒット」다 —
     피해 쪽 히트 수(fireMult)와 경직 쪽 「1발=K히트」가 같아야 한다.
     (피탄 시뮬이 있던 자리. 글자 두 줄을 맞추던 것을 **값**으로 바꿨다.) */
  const stagUi = await (async () => {
    const r = await DG.measure(pg, { me: 'パラス・アテネ', foe: 'ザクⅡ',
      weaponExact: '肩部ビーム砲' });
    await DG.close(pg);
    if (r.오류) return { 오류: r.오류 };
    return { 무장: r.무장ko, 피해히트: r.히트, 경직설명: r.경직 && r.경직.설명 };
  })();

  /* ── 값이 있어도 **고를 수 없으면** 없는 것과 같다 ──
     갓 건담의 명경지수는 적 내격투를 10% 깎는데, 다른 수치가 하나도 없어 스킬 표에
     아예 안 올랐다 — 스킬 칸에 뜨지 않으니 발동시킬 방법이 없었다(사용자 지적).
     표에 올랐는지(드롭다운에 뜨는지)와, 켰을 때 **격투만** 주는지를 함께 본다. */
  /* 「명경지수가 스킬 칸에 뜨는가」는 **앱 화면**의 문제라 그대로 앱에서 본다.
     「켜면 격투만 주는가」는 대결에서 쪽마다 켜고 잰다 — 범위를 지키는지가 요점이다. */
  const god = await (async () => {
    const ME = 'ゴッドガンダム', FOE = 'プロトタイプ・サイコ・ガンダム', SK = '明鏡止水';
    // ① 스킬 칸(드롭다운)에 올랐는가 — 못 고르면 값이 있어도 없는 것과 같다
    const listed = await pg.evaluate(async nm => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('#infoClose');
      if (c && document.body.classList.contains('info-open')) c.click();
      const q = document.querySelector('#msQuery');
      q.value = '갓 건담'; q.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(900);
      const card = document.querySelector('#msList .ms-card');
      if (!card) return { err: '기체 없음' };
      card.click(); await wait(1500);
      const b2 = document.querySelector('#skillBtn');
      if (!b2) return { err: '스킬 단추 없음' };
      b2.click(); await wait(400);
      const item = [...document.querySelectorAll('#skillMenu .skill-item')]
        .find(x => /명경/.test(x.textContent));
      const out = item ? { nm: ((item.querySelector('.k') || {}).textContent || '').trim() }
        : { err: '드롭다운에 없음' };
      const m = document.querySelector('#skillMenu');
      /* **지우지 않는다.** 앱은 전역 클릭마다 이 메뉴를 닫으므로, 지우면 그 뒤 모든
         클릭이 터진다(그래서 「스크립트 오류 없음」이 울었다). 앱과 같이 닫기만 한다. */
      if (m) m.hidden = true;
      return out;
    }, SK);
    // ② 켜면 격투만 주는가
    const read = async buffs => {
      const o = {};
      for (const jp of await DG.weaponsOf(pg, { me: ME, foe: FOE })) {
        const r = await DG.measure(pg, { me: ME, foe: FOE, weaponExact: jp, buffs });
        if (!r.오류) o[r.무장ko] = r.발수;
      }
      return o;
    };
    const off = await read([]);
    const on = await read([SK]);
    await DG.close(pg);
    return { ...listed, off, on };
  })();

  await br.close();

  {
    check('명경지수가 스킬 칸에 뜬다 (고를 수 있다)',
      god && !god.err && god.nm === '명경지수', JSON.stringify(god && (god.err || god.nm)));
    const melee = ['석파천경권', '갓 슬래시', '갓 건담용 타격'];
    check('켜면 격투 무장의 격파 발수가 준다',
      god && god.on && melee.every(k => god.on[k] < god.off[k]), JSON.stringify(god));
    // 범위를 안 지키면 실탄 무장도 같이 준다 — 여기가 진짜 검사다
    /* 이 줄도 이름을 박아 두었다가 **없는 이름으로 undefined === undefined** 가 되어
       헛되이 통과하고 있었다. 사전에서 읽고, 읽힌 무장이 있는지도 함께 본다. */
    const solid = WEAP_SOLID.filter(k => god && god.off && god.off[k] != null);
    check('실탄 무장을 실제로 읽었다', solid.length > 0, JSON.stringify({ 찾는이름: WEAP_SOLID, 읽은것: god && Object.keys(god.off || {}) }));
    check('실탄 무장은 그대로다 (범위를 지킨다)',
      solid.length > 0 && solid.every(k => god.on[k] === god.off[k]),
      JSON.stringify(god));
  }


  {
    check('누적치 배수를 다 곱한다 (괄호는 집속값이라 뺀다)',
      stagRead === '20:6 / 6:18 / 12:6 / 20:6 / 5:10 / 7:1 / 80:1', String(stagRead));
    /* 여기가 진짜다 — 단위 판정은 「쓰이는지」를 안 본다.
       화면의 두 줄에서 배수를 꺼내 맞춰 본다(공식을 베끼지 않는다). */
    /* 피해 쪽 히트 수(fireMult)와 경직 쪽 「1발=K히트」가 **같은 수**여야 한다.
       예전에는 화면 두 줄의 글자를 맞췄는데, 이제 피해 쪽은 값으로 받고
       경직 쪽은 그 문구에서 K 를 꺼내 맞춘다(공식을 베끼지 않는다). */
    const sm2 = String((stagUi && stagUi.경직설명) || '').match(/1발\s*=\s*(\d+)\s*히트/);
    const same = !!(stagUi && !stagUi.오류 && sm2 && Number(sm2[1]) === stagUi.피해히트);
    check('피해와 누적치가 같은 배수를 쓴다', !!same, JSON.stringify(stagUi));
  }

  {
    // 마지막 둘은 **아니어야** 한다 — 막는 문구와 아무 표기 없는 것
    check('실드 무시 표기 세 가지를 읽고, 조건·무효화를 가린다',
      shieldRead === 'true,true,true,false,true,false,false', String(shieldRead));
    const rows = Array.isArray(shieldUi) ? shieldUi : [];
    const ign = rows.filter(r => r.ign);
    check('실드로 막는 상대에게 「실드 무시」가 뜬다', ign.length >= 1,
      JSON.stringify(rows));
    // 전부 무시로 칠해 버리면 뜻이 없다 — 안 뜨는 무장도 있어야 한다
    check('무시하지 않는 무장은 그대로 발수·표기가 나온다',
      rows.some(r => !r.ign && r.sh), JSON.stringify(rows.map(r => r.sh)));
  }

  {
    const bad = (scope || []).filter(x => x.got !== x.want);
    check('스킬의 내성 감소가 어느 무장에 걸리는지 원문대로 가린다 (8건)',
      bad.length === 0, JSON.stringify(bad, null, 1));
    // 전부 null 이면 「아무것도 안 넣는다」로도 통과해 버린다 — 넣는 쪽이 있는지 함께 본다
    check('그중 반영하는 것이 실제로 있다',
      (scope || []).filter(x => x.got).length === 4, JSON.stringify((scope || []).map(x => x.got)));
  }
  {
    const r = skillOn;
    const ok2 = r && r.off && r.on;
    const shoot = ok2 && Object.keys(r.off).filter(k => /라이플|포드/.test(k));
    check('스킬을 켜면 사격 무장의 격파 발수가 준다',
      ok2 && shoot.length >= 2 && shoot.every(k => r.on[k] < r.off[k]),
      JSON.stringify(r));
    // 범위를 안 지키면 격투 무장도 같이 줄어든다 — 여기가 진짜 검사다
    check('격투 무장은 그대로다 (범위를 지킨다)',
      ok2 && Object.keys(r.off).filter(k => /사벨/.test(k)).every(k => r.on[k] === r.off[k]),
      JSON.stringify(r));
  }
  {
    const f = foe;
    check('무장 備考에서 내성 감소를 읽는다 (없으면 0)',
      f && f.읽기.join() === '40,30,0,0', JSON.stringify(f && f.읽기));
    // 여기가 상대값과 절대값이 갈리는 자리다 — 빼면 10 이 되어 내구가 22222 가 된다
    check('「N%減」을 보정값에 곱한다 (빼지 않는다)',
      f && f.깎은뒤 === 28571 && f.깎기전 === 40000 && f.뺄경우 !== f.깎은뒤,
      JSON.stringify(f));
  }
  {
    const rows = (ui && Array.isArray(ui.rows)) ? ui.rows : [];
    console.log('  (상대: ' + (ui && ui.foe) + ')');
    const sat = rows.find(r => /새틀라이트 캐논$/.test(r.nm.trim()));
    check('집속 필수 무장이 격파 목록에 든다 (트윈 새틀라이트 캐논)', !!sat,
      JSON.stringify(rows.map(r => r.nm)));
    check('그 줄에 집속·내성 감소가 둘 다 붙는다',
      !!sat && sat.charge === '집속' && sat.pierce === '내빔 −40%', JSON.stringify(sat));
    check('꼬리표가 이름 칸에서 잘리지 않는다',
      rows.every(r => r.fits), JSON.stringify(rows.filter(r => !r.fits)));
    check('내성을 깎는 다른 무장도 표시된다 (빔 재블린)',
      rows.some(r => r.pierce === '내격투 −20%'), JSON.stringify(rows.map(r => r.pierce)));

    /* ── 깎은 값이 **실제로 쓰이는가** ──
       위 단위 검사(durabilityOf)는 적용 자리를 안 본다 — 계산에서 빼 버려도 통과했다.
       공식을 베끼지 않고 재는 법: **같은 속성**의 두 무장을 견준다.
       발수 × 1발 ≒ 적 내구다. 내성 감소가 없으면 두 무장이 같은 내구를 가리켜야 하고,
       감소가 걸리면 깎인 쪽만 작아진다. 실측(프로토타입 사이코 건담):
         하이퍼 빔 소드(감소 없음) 5,051 × 10발 = 50,510
         빔 재블린(내격투 −20%)   4,529 ×  9발 = 40,761   → 비 0.807
         빔 재블린을 되돌리면      4,529 × 11발 = 49,819   → 비 0.986
       0.90 을 경계로 두면 둘이 깨끗이 갈린다. */
    const jav = rows.find(r => r.pierce === '내격투 −20%');
    const swd = rows.find(r => !r.pierce && /빔 소드/.test(r.nm));
    const ratio = jav && swd && swd.hits * swd.per
      ? (jav.hits * jav.per) / (swd.hits * swd.per) : null;
    check('깎은 내성이 격파 발수에 실제로 반영된다',
      ratio != null && ratio < 0.90,
      JSON.stringify({ jav, swd, ratio: ratio && +ratio.toFixed(3) }));
  }

  check('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();

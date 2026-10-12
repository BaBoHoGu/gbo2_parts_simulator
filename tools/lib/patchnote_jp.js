// 공식 **일본어** 공지를 거쳐 위키 수치를 공식 한국어 줄에 단다.
//
// ■ 왜 일본어를 거치는가
//   위키 이력은 일본어다. 한국어 공지와 맞대려면 무장 이름을 사전으로 옮겨야 하는데,
//   그 사전에 없는 이름이 많다 — 실측: 같은 166개 무장 행에서
//       한국어 경로  112/166 (67.5%)
//       일본어 경로  159/166 (95.8%)
//   일본어끼리는 **번역이 아니라 표기 통일**만 필요하다(전각→반각, ［］→[], ×２→x2).
//   공식 「ＦＡオーヴェロン用Ｌ・Ｍ・Ｂ」 ↔ 위키 「FAオーヴェロン用L・M・B」 가 그 전부였다.
//
// ■ 자리로 옮긴다 — 왜 되는가
//   공식은 KR/JP 를 같은 틀로 찍어 낸다. `▼N機目▼` 순번으로 맞댄 결과(실측 3개 날짜):
//       기체 수 12/12·10/10·12/12 · 섹션 수 전부 같음
//       무장 행 207개 **전부** 줄 수가 같고, 모드 머리【…】 57개가 양쪽 같은 자리
//   그래서 JP 쪽에서 찾은 값을 **같은 순번의 KR 줄**에 붙인다.
//   어긋나면 옆 무장 수치가 조용히 붙으므로, 어긋난 기체는 아예 건너뛴다(`skipped`).
//
// ■ 손으로 적은 표가 줄었다
//   한국어 경로의 `ATWIKI_KEY` 는 「비틀거림 축적치 → よろけ値」 같은 KR→JP 대응 60여 줄이다.
//   새 용어가 나오면 조용히 썩는다. 여기서는 공식도 위키도 일본어라 **12줄**로 끝난다.
'use strict';
const FILL = require('./patchnote_fill.js');

/* ── 표기 통일 ──────────────────────────────────────────────────── */
/** 전각→반각(NFKC) · 괄호꼴 통일 · 중점/공백 제거 · 「×２」→「x2」 */
const nz = s => String(s).normalize('NFKC')
  .replace(/[［【]/g, '[').replace(/[］】]/g, ']')
  .replace(/[×xX]\s*(\d+)/g, 'x$1')
  .replace(/[\s・･,]/g, '');

/** 개수 표기를 뺀 꼴 — 위키는 「シールド・ファンネル［感知］」, 공식은 「×２[感知]」 */
const noCnt = s => nz(s).replace(/x\d+/g, '');
/** 「[…]」 꼬리 */
const tagOf = s => (nz(s).match(/\[([^\]]*)\]$/) || [])[1] || '';
/** 꼬리를 뗀 몸통 */
const bodyOf = s => noCnt(s).replace(/\[[^\]]*\]$/, '');

/**
 * 위키 머리줄을 무장 이름으로 — 「機体スキル「最大出力（K）」」 → 「最大出力(K)」.
 * 공식은 그것을 특수 무장 행으로 적는다(F89 「Ａ・Ｒ最適化制御装置」가 그랬다).
 */
function headKey(s) {
  let t = String(s).replace(/^機体スキル/, '').replace(/^スキル/, '');
  const m = t.match(/^[「『]([\s\S]+)[」』]$/);
  if (m) t = m[1];
  return t;
}

/* ── 항목 이름 ──────────────────────────────────────────────────── */
/** 동작어 — 공식 줄 끝에 붙는다(「よろけの蓄積値を上昇」) */
const ACT = /(上昇|短縮|増加|軽減|延長|拡大|減少|低下|改善|変更|緩和|強化|向上|統合|付与|追加|削除)+$/;
/** 공식 줄에서 항목 이름만 — 앞의 「・」, 조사, 끝의 동작어를 뗀다 */
const lineCore = s => nz(String(s).replace(/^[・･]\s*/, ''))
  .replace(/[をにのがはも]/g, '').replace(ACT, '');

/**
 * 공식(JP) 항목 이름 → 위키가 쓰는 이름. **둘 다 일본어**라 이 표가 12줄로 끝난다.
 * 긴 것이 먼저다 — 「兵装切り替え時間」이 「切り替え時間」보다 앞이어야 한다.
 *
 * 여기 **없는** 항목은 시도조차 하지 않는다. 弾速·ASL範囲·着弾時爆発範囲·射撃時ブレ 는
 * **위키도 수치를 안 적는다**(실측 60줄). 넣어 두면 「짚었는데 못 채움」만 늘어
 * 덮는 비율이 흐려진다 — 지어내지 않으려면 세는 자리도 정직해야 한다.
 */
const JP_KEY = [
  ['よろけ蓄積値', ['よろけ値']],
  /* 위키가 「切り替え短縮」처럼 「時間」을 빼고 적는 자리가 있다(겔구그 캐논(JN) 실측) */
  ['兵装切り替え時間', ['切り替え時間', '切り替え']],
  ['切り替え時間', ['切り替え時間', '切り替え']],
  ['オーバーヒート時間', ['オーバーヒート復帰時間', 'オーバーヒート時間']],
  ['オーバーヒート', ['オーバーヒート復帰時間', 'オーバーヒート時間']],
  ['下格闘補正', ['下格闘補正', '下格補正']],
  ['爆発ヒット回数', ['爆発のヒット回数', 'ヒット回数']],
  ['連射速度', ['連射速度', '連射性能']],
  ['リロード', ['リロード時間', 'リロード']],
  ['クールタイム', ['クールタイム']],
  ['連撃補正', ['連撃補正']],
  ['効果時間', ['効果時間']],
  ['ヒート率', ['ヒート率']],
  ['射程距離', ['射程距離']],
  ['チャージ', ['集束時間', 'チャージ時間']],
  ['集束', ['集束時間']],
  ['弾数', ['弾数']],
  /* ■ 아래는 **표에 없어서 짚지도 않던** 항목들이다(2026-10-12 전수 측정).
     비율(112/115)은 짚은 것만 세니, 표에 없는 항목은 분모에도 안 들어가 영원히 안 보인다.
     사용자가 「실루엣 개량형 / MACSS 오프」로 그 구멍을 짚어 55줄을 다시 훑었다.
     **긴 것부터** 적는다 — 「被ダメージ軽減効果」가 먼저 걸리면 속성별 구분이 사라진다. */
  ['再使用可能', ['再使用可能になるまでの時間', '再使用可能']],
  ['格闘攻撃中受けた、射撃属性被ダメージ軽減効果', ['格闘攻撃中、射撃属性被ダメージ軽減効果']],
  ['ビーム属性射撃攻撃よる被ダメージ軽減効果', ['ビーム属性の射撃攻撃による被ダメージ軽減効果']],
  ['停止射撃中被ダメージ軽減効果', ['停止射撃中、被ダメージ軽減効果', '停止射撃中の被ダメージ軽減効果']],
  ['格闘属性被ダメージ軽減効果', ['格闘属性の被ダメージ軽減効果', '格闘属性被ダメージ軽減効果']],
  ['射撃属性攻撃よる被ダメージ軽減効果', ['射撃属性の被ダメージ軽減効果', '射撃属性被ダメージ軽減効果']],
  /* 위와 다른 말이다 — 저쪽은 「射撃属性の攻撃による」(오베론), 이쪽은 「射撃属性の」(평범한 꼴).
     사이에 「攻撃よる」가 끼어 한 키로는 둘을 못 덮는다. 자가 잡아 줬다. */
  ['射撃属性被ダメージ軽減効果', ['射撃属性の被ダメージ軽減効果', '射撃属性被ダメージ軽減効果']],
  /* 공식 「攻撃のヒット回数を増加」 ↔ 위키 「ヒット数増加」 (2026-08-27 X2 개량형 실측) */
  ['攻撃ヒット回数', ['ヒット数', 'ヒット回数']],
  ['シールドHP', ['シールドHP']],
  ['焼夷効果よるダメージ', ['焼夷効果によるダメージ', '焼夷効果']],
  ['発射間隔', ['発射間隔']],
  ['威力', ['威力']],
  /* 「(併せて上位LVも上昇)」 줄의 LV 별 수치를 찾으려면 기체 성능도 있어야 한다 */
  ['機体HP', ['機体HP']],
  ['近距離パーツスロット', ['近距離パーツスロット']],
  ['中距離パーツスロット', ['中距離パーツスロット']],
  ['遠距離パーツスロット', ['遠距離パーツスロット']],
  ['射撃補正', ['射撃補正']],
  ['格闘補正', ['格闘補正']],
  ['スラスター', ['スラスター']],
  ['スピード', ['スピード']],
  ['高速移動', ['高速移動']],
  ['旋回', ['旋回']]
];

/** **짚지 않는** 줄 — 위키가 값을 안 적거나, 애초에 수치로 적지 않는 항목.
 *  「兵装使用後の切り替え時間」은 원래 표기하지 않는다(사용자 확인 2026-10-12).
 *  그냥 두면 「切り替え時間」에 걸려 짚히기만 하고 못 채워, 덮는 비율만 흐려진다. */
const NO_KEY = /使用後.*切り替え/;

/** 공식 줄 → 위키 항목 이름 후보. 못 찾으면 null(시도로 세지 않는다). */
function keyOfJa(line) {
  const c = lineCore(line);
  if (!c) return null;
  if (NO_KEY.test(c)) return null;
  for (const [k, cands] of JP_KEY) if (c.includes(nz(k))) return cands;
  return null;
}

/** 값이 오르내린 줄이 아니다 — 스킬 부여·통합, 「~できるように変更」 따위 */
const NOT_VALUE = /(?:可能に|できるように|しやすく)\s*(?:変更|改善|改良)$|(?:付与|統合|変更|追加|削除|可能)$/;

/** 공식 JP 줄에 이미 수치가 있는가 — 「3600」→「4000」 */
const HAS_NUM = /[「“][^」”]*\d[^」”]*[」”]\s*→\s*[「“][^」”]*\d[^」”]*[」”]/;

/** 줄에 적힌 숫자 나열 — 전각을 반각으로 맞춘 뒤 뽑는다. 자리 검사에 쓴다. */
const digits = s => (String(s).normalize('NFKC').match(/\d+(?:\.\d+)?/g) || []).join(',');

/** 모드 머리【…】인가 */
const isMode = s => /^[【[]/.test(String(s).trim());
const modeText = s => String(s).trim().replace(/^[【[]/, '').replace(/[】\]]$/, '');

/* ── 위키 머리줄 짝짓기 ─────────────────────────────────────────── */
/**
 * 공식 무장 이름 → 위키 머리줄 후보들.
 *  · 몸통(개수·꼬리 뗀 것)이 같은 것을 모은다.
 *  · 공식이 **한 행에 묶은** 경우 위키는 꼬리로 쪼갠다:
 *      공식 「ビーム・ガトリングガン×２」 한 행
 *      위키 「ビーム・ガトリングx2」 + 「ビーム・ガトリングx2［リミッター解除］」
 *    그래서 꼬리별로 갈라 담는다 — 모드 머리【リミッター解除】가 그 꼬리를 가리킨다.
 */
function headsFor(name, weapons) {
  const b = bodyOf(name), myTag = tagOf(name);
  let hit = weapons.filter(w => bodyOf(w.key) === b);
  /* 몸통이 글자로 안 맞으면 한쪽이 줄여 적은 것이다 —
     「ビーム・ガトリングガン」(공식) ↔ 「ビーム・ガトリング」(위키). 포함으로 본다.
     4글자 밑으로는 보지 않는다(「S・L」 같은 짧은 약칭이 엉뚱한 데 붙는다). */
  if (!hit.length && b.length >= 4)
    hit = weapons.filter(w => bodyOf(w.key).length >= 4
      && (bodyOf(w.key).includes(b) || b.includes(bodyOf(w.key))));
  if (!hit.length) return null;
  /* ■ 공식 이름에 꼬리가 있으면 **그 꼬리가 먼저다.**
     꼬리 없는 것을 먼저 찾았더니 헤이즐 아우슬라[GAU]에서 틀렸다 —
     공식에 「５連装ビーム砲」와 「５連装ビーム砲[斉射]」 두 행이 있고 위키도 둘로 나뉘는데,
     [斉射] 행에 통상 값(10% x5 → 15% x5)이 붙었다. 제 값은 4% x10 → 10% x10 이다. */
  const base = (myTag && hit.find(w => tagOf(w.key) === myTag))
    || hit.find(w => !tagOf(w.key))
    || (myTag ? null : hit[0]);
  /* ■ 꼬리가 있는데 맞는 꼬리도, 꼬리 없는 것도 없으면 **거절한다.**
     예전엔 남은 첫 번째를 집었다 — 자가 잡았다: 공식 [射撃]·[感知] 둘, 위키 ［射出］·［探知］ 둘일 때
     **둘 다 ［射出］ 값을 받았다.** 꼬리가 하나씩만 남는 경우는 위에서 소거법이 잇는다.
     여기까지 왔다는 것은 어느 쪽인지 알 수 없다는 뜻이다. */
  if (!base) return null;
  const byTag = new Map();
  for (const w of hit) { const t = tagOf(w.key); if (t) byTag.set(t, w); }
  return { base, byTag, all: hit };
}

/**
 * 한 기체: 공식 JP 섹션에서 값을 찾아 **같은 자리의 KR 줄**에 단다.
 * @param krSections 공식 한국어 파싱 결과(이것을 돌려준다 — 문구는 손대지 않는다)
 * @param jpSections 공식 일본어 파싱 결과(같은 순번)
 * @param wikiLines  위키 이력 줄 목록 [{depth,text}]
 * @returns { sections, filled, tried, skipped }  skipped=true 면 자리가 어긋나 아무것도 안 했다
 */
function fillByJp(krSections, jpSections, wikiLines) {
  const ks = krSections || [], js = jpSections || [];
  const no = { sections: ks, filled: 0, tried: 0, skipped: true };
  /* ■ 자리가 어긋나면 손대지 않는다. 틀린 수치는 없는 것만 못하다. */
  if (ks.length !== js.length) return no;
  for (let s = 0; s < ks.length; s++) {
    const kr = ks[s].rows || [], jp = js[s].rows || [];
    if (kr.length !== jp.length) return no;
    for (let r = 0; r < kr.length; r++) {
      const kc = kr[r].changes || [], jc = jp[r].changes || [];
      if (kc.length !== jc.length) return no;
      /* ■ 수를 세는 것만으로는 **밀림을 못 잡는다** — 밀린 자리의 구조가 우연히 같으면
         통과한다. 공식은 KR/JP 를 같은 틀로 찍으니 **같은 자리 줄의 숫자가 같아야 한다.**
         실측(2026-10-12, 3개 날짜): 숫자가 든 줄 491개가 **491개 모두** 일치했다.
         수가 맞아도 숫자까지 맞을 일은 없으니, 이쪽이 훨씬 날카로운 자다. */
      for (let l = 0; l < kc.length; l++) if (digits(kc[l]) !== digits(jc[l])) return no;
    }
  }

  const index = FILL.buildIndex(wikiLines);
  /* 색인을 무장별로 묶는다. 이름은 「機体スキル「…」」를 벗긴 꼴로 쓴다. */
  const byWeapon = new Map();
  for (const e of index) {
    const key = headKey(e.weaponRaw || '');
    if (!byWeapon.has(key)) byWeapon.set(key, { key, items: [] });
    byWeapon.get(key).items.push(e);
  }
  const weapons = [...byWeapon.values()];
  /* ■ 꼬리가 서로 다른 이름을 **소거법**으로 잇는다.
     공식 「シールド・ファンネル[射撃]」 ↔ 위키 「シールド・ファンネル［射出］」 — 射撃/射出 로
     글자가 다르다. 그런데 같은 몸통의 나머지 꼬리([防御]·[感知])는 양쪽이 맞는다.
     양쪽에 **하나씩만** 남으면 그 둘이 짝이다. 비슷해 보인다고 잇는 것이 아니라,
     남은 것이 하나뿐이어서 정해지는 것이다 — 이 쪽은 틀려도 설명이 된다. */
  const tagFix = new Map();
  {
    const offByBody = new Map();
    for (const sec of js) for (const r of sec.rows || []) {
      if (!r.weapon) continue;
      const b = bodyOf(r.weapon);
      if (!offByBody.has(b)) offByBody.set(b, []);
      offByBody.get(b).push(r.weapon);
    }
    for (const [b, names] of offByBody) {
      const wk = weapons.filter(w => bodyOf(w.key) === b);
      if (names.length < 2 || wk.length < 2) continue;
      const taken = new Set();
      const left = [];
      for (const n of names) {
        const t = tagOf(n);
        const hit = t ? wk.find(w => tagOf(w.key) === t && !taken.has(w.key)) : null;
        if (hit) taken.add(hit.key); else left.push(n);
      }
      const spare = wk.filter(w => !taken.has(w.key));
      if (left.length === 1 && spare.length === 1) tagFix.set(nz(left[0]), spare[0]);
    }
  }
  /* 무장 밑이 아닌 **맨 위층** 항목 — 기체 HP·파츠 슬롯·스피드·기체 스킬.
     공식에서 무장 이름이 없는 행(기체 행)이 가리키는 곳이다. */
  const mechHead = { base: { key: '', items: index.filter(e => !e.weapon) }, byTag: new Map(), all: [] };

  let filled = 0, tried = 0;
  const sections = ks.map((sec, si) => ({
    ...sec,
    rows: (sec.rows || []).map((row, ri) => {
      const jrow = (js[si].rows || [])[ri] || {};
      const jname = jrow.weapon || '';
      /* 무장 이름이 없는 행은 **기체 자체**다(기체 HP·파츠 슬롯·스피드…).
         이것을 빼놓았더니 73줄 — 거의 다 「(더불어 상위 LV도 상승)」 — 이 비었다. */
      const fixed = jname ? tagFix.get(nz(jname)) : null;
      const heads = fixed ? { base: fixed, byTag: new Map(), all: [fixed] }
        : jname ? headsFor(jname, weapons) : mechHead;
      let focus = null;     // 集束 / 非集束
      let sub = null;       // 【リミッター解除】처럼 위키가 따로 적은 무장
      let modeLabel = null; // 【ヘビーアタック】처럼 항목 이름에 붙는 머리
      let modeState = false; // 【…発動中】처럼 **같은 무장의 상태**인가

      const fill = (row.changes || []).map((krLine, li) => {
        const jaLine = (jrow.changes || [])[li] || '';
        if (isMode(jaLine)) {
          const t = nz(modeText(jaLine));
          focus = /^集束|集束$/.test(t) ? '集束' : /通常/.test(t) ? '非集束' : null;
          /* 그 모드가 **위키에서는 따로 적힌 무장**인가.
             공식은 「発動中」을 붙이고 위키는 꼬리에만 적는다 — 실측 2026-08-27 X2 개량형:
                 공식  「バスターランチャー[最大出力]」 안에 【最大出力（Ｚ）発動中】
                 위키  「バスターランチャー［最大出力（Z）］」 라는 **별도 머리줄**
             꼬리를 떼고 봐야 이 넷(위력·히트 수·비틀거림·오버 히트)이 제 자리를 찾는다. */
          const tKey = t.replace(/発動中$|中$/, '');
          sub = heads && (heads.byTag.get(t) || heads.byTag.get(tKey)) || null;
          modeLabel = sub || focus ? null : t;
          /* ■ 「…発動中」은 **같은 무장의 상태**다 — 통상 값이 그대로 그 상태에도 적용된다.
             위키가 모드별로 안 나눠 적었으면 그 하나뿐인 값을 쓴다(사용자 확인 2026-10-12:
             X3 무라마사[건 모드]【최대 출력(T) 발동 중】 히트율은 통상과 같은 85%→80%).
             【ヘビーアタック】는 다르다 — 제 배율을 따로 가진 **다른 공격**이라,
             위키가 안 적었으면 비워야 한다(기간틱 암 유닛·키하르Ⅱ). 그 둘을 여기서 가른다. */
          modeState = !sub && !focus && /発動中$|中$/.test(t);
          return null;
        }
        if (!heads) return null;
        const cands = keyOfJa(jaLine);
        if (!cands) return null;
        if (NOT_VALUE.test(lineCore(jaLine) ? String(jaLine).trim() : '')) return null;
        const hasNum = HAS_NUM.test(jaLine);
        /* 「(併せて上位LVも上昇)」 — 공식은 대표 LV 하나만 적는다. 위키는 다 적는다. */
        const wantsLv = /上位\s*LV/.test(nz(jaLine));
        if (hasNum && !wantsLv) return null;
        if (!hasNum) tried++;

        const w = sub || heads.base;
        const val = pickValue(w.items, cands, modeLabel, modeState);
        if (!val) return null;
        const lv = wantsLv ? FILL.lvBreakdown(val) : null;
        if (hasNum) return lv ? { lv } : null;
        const pair = FILL.pickPair(val, focus);
        if (!pair) return lv ? { lv } : null;
        filled++;
        const out = { from: FILL.koValue(pair[0]), to: FILL.koValue(pair[1]) };
        if (lv) out.lv = lv;
        return out;
      });
      return fill.some(Boolean) ? { ...row, fill } : row;
    })
  }));
  return { sections, filled, tried, skipped: false };
}

/**
 * 한 무장의 항목들에서 값을 고른다.
 * `modeLabel` 이 있으면 **그것이 붙은 항목을 먼저** 본다 —
 * 공식은 【ヘビーアタック】아래 「威力を上昇」이라 적고 위키는 「ヘビーアタック補正上昇」이라 적는다.
 * 모드 안에서 못 찾으면 모드 없는 항목으로 내려간다(공식이 모드 머리만 달고 공통 항목을 적는 일이 있다).
 */
function pickValue(items, cands, modeLabel, modeState) {
  const want = cands.map(nz);
  const hit = lab => want.some(w => nz(lab).includes(w));
  if (modeLabel) {
    /* 공식이 「発動中」, 위키가 「中の」로 적는다 — 꼬리를 떼고 본다.
       실측: 공식【最大出力（Ｋ）発動中】 ↔ 위키「機体スキル「最大出力（K）」中のクールタイム短縮」 */
    const key = nz(modeLabel).replace(/発動中$|中$/, '');
    const m = items.find(e => nz(e.label).includes(key) && hit(e.label) && e.value);
    if (m) return m.value;
    /* ■ 공식이 모드 아래 「威力を上昇」이라 적고 위키는 「<모드>補正上昇」이라 적는 경우.
       실측(2026-08-27 F89, 2026-07-23 기라 줄루): 공식 행이
           【通常格闘】・威力「3000」→「3200」に上昇
           【ヘビーアタック】・威力を上昇
       이고 위키에 헤비 어택 수치는 「ヘビーアタック補正上昇 400%(200%x2) → 460%(230%x2)」뿐이다.
       한국어 경로는 여기서 **통상 격투의 3000→3200 을 다시 붙였다**(거짓).
       머리글자만 맞으면 받던 것을 **「<모드>補正」으로 좁혔다** — 항목을 통째로 무시하면
       그 모드의 아무 수치나 붙는다. */
    const m2 = items.find(e => nz(e.label).startsWith(key + '補正') && e.value);
    if (m2) return m2.value;
    /* ■ 모드 안에서 못 찾으면 **거기서 끝낸다.** 모드 밖의 같은 항목으로 물러서면
       안 된다 — 그것이 바로 F89 거짓의 뿌리였다: 【ヘビーアタック】「威力を上昇」이
       바로 위 【通常格闘】의 「威力 3000→3200」을 받아 갔다.
       공식이 모드 머리를 달았다는 것은 **그 모드의 수치**라는 뜻이다.
       **예외는 「…発動中」** — 다른 공격이 아니라 같은 무장의 상태라서 통상 값이
       그대로 적용된다(위 `modeState` 주석). 그때만 아래 평범한 항목으로 내려간다. */
    if (!modeState) return null;
  }
  /* 모드가 아닌 평범한 항목. 모드 머리가 붙은 항목은 **피한다** —
     「ヘビーアタック補正」이 「補正」 찾기에 걸려 통상 격투 줄에 붙으면 거짓이 된다. */
  const plain = items.filter(e => hit(e.label) && e.value);
  if (!plain.length) return null;
  if (plain.length === 1) return plain[0].value;
  /* 여럿이면 가장 짧은 것 — 「オーバーヒート復帰時間」보다 「オーバーヒート時間」처럼
     군더더기 없는 쪽이 공식 줄이 가리키는 것이다. 후보 표의 순서를 따른다. */
  for (const w of want) {
    const e = plain.find(x => nz(x.label).includes(w));
    if (e) return e.value;
  }
  return plain[0].value;
}

module.exports = { nz, noCnt, tagOf, bodyOf, headKey, lineCore, keyOfJa, headsFor, fillByJp, pickValue, JP_KEY, HAS_NUM, NOT_VALUE, NO_KEY, digits };

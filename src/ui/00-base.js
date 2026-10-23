/* 오프라인 UI — 데이터(GBO2_DATA)와 사전(GBO2_I18N)은 빌드 시 이 파일 앞에 인라인된다. 이미지는 HTML 옆의 images/ 폴더를 상대 경로로 참조한다. */
  /* ui/00-base.js — 공용 바탕 — 데이터 · 그림 주소 · 상태 · 누적치 스킬 · 검색 색인 · 계산 안 함 · 기체 스킬.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */

  const C = window.GBO2Core;
  const O = window.GBO2Optimizer;
  const T = window.GBO2i18n;
  /** 일본어 모드(?lang=ja · ⋯ → 언어). 원문을 한국어로 바꿔 보이던 칸(무장 단위 · 備考)은 원문을 그대로 보인다 —
   *  한국어로 바꾼 것을 다시 일본어로 옮기면 원문과 다른 말이 된다(よろけ有 → 비틀 있음 → ?). 판정은 한국어 그대로. */
  const JA = !!(T && T.lang === 'ja');
  const D = window.GBO2Damage;
  const weaponData = window.GBO2_WEAPONS || {};
  const skillData = window.GBO2_SKILLS || {};
  const { msData, parts: partsByCat, fullst, msSkills: msSkillsData = {} } = window.GBO2_DATA;
  const skillText = (window.GBO2_I18N && window.GBO2_I18N.skillText) || {};

  const allParts = [].concat(...C.CATEGORIES.map(c => partsByCat[c]));
  const partByName = new Map(allParts.map(p => [p.name, p]));

  /* ---------- 이미지 ---------- */

  const baseName = C.partBase;
  // 이미지는 빌드 때 data URI 로 HTML 에 인라인된다(window.GBO2_IMAGES). 키는 '<dir>/<NFC이름>.webp'.
  // data URI 라 file:// 에서도 캔버스 오염 없이 PNG 카드에 그릴 수 있다. 없으면 _default 로 폴백.
  // 파일명은 NFC로 통일돼 있다(원본에 결합문자 NFD 이름이 섞여 있어 정규화 필요).
  const IMG_MAP = window.GBO2_IMAGES || {};
  // 사이트판(build.js --web)은 이미지를 인라인하지 않고 images/ 폴더로 따로 낸다.
  // 그러면 img 의 loading="lazy" 가 살아나 첫 화면에 보이는 것만 받고(6.00MB → 0.7MB),
  // 재배포해도 이미지는 브라우저 캐시에 남아 본체(0.58MB)만 다시 받는다.
  // file:// 에서는 외부 이미지가 캔버스를 오염시켜 PNG 카드가 깨지므로, 오프라인용
  // 단일 파일은 지금처럼 인라인을 유지한다 — 아래 분기가 그 둘을 가른다.
  const IMG_BASE = Object.keys(IMG_MAP).length ? null : 'images/';
  const imgUrl = key => IMG_BASE
    ? IMG_BASE + key
    : (IMG_MAP[key] || IMG_MAP[key.replace(/\/[^/]+$/, '/_default.webp')] || '');
  const msImg = name => imgUrl(`ms/${baseName(name).normalize('NFC')}.webp`);
  /* 대결(duel.js)도 이 함수를 쓴다 — 거기 따로 두었더니 인라인 그림만 찾아 **사이트판(images/)에서
     그림이 통째로 비었다**(2026-10-15 사용자 제보). 그림 주소를 정하는 자는 여기 하나다. */
  window.GBO2ImgUrl = imgUrl;

  /* 사이트 오프라인 — 서비스 워커(src/sw.js · 2026-10-16). **사이트(https)에서만** 등록한다.
     파일로 여는 판(오프라인판 · APK)에는 sw.js 가 없고, 로컬 검사 서버에서 켜면 검사 결과가 보관본에
     흔들린다. 시험할 때만 주소에 ?sw=1 을 붙여 켠다. 실패해도 앱은 평소대로 돈다. */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /[?&]sw=1(?:&|$)/.test(location.search))) {
    // 첫 화면을 다 그린 뒤에 등록한다(워커가 9MB 페이지를 받아 두는 일이 첫 로딩과 겹치지 않게).
    const regSw = () => { navigator.serviceWorker.register('sw.js').catch(() => {}); };
    if (document.readyState === 'complete') setTimeout(regSw, 0);
    else window.addEventListener('load', regSw, { once: true });
  }

  /* 공식 일러스트 — 사이트에 따로 올려 두고 **URL 로** 부른다.
     원본이 750x800 PNG 라 508장이면 61MB, 360px WebP 로 줄여도 10MB 다.
     단일 HTML 에 넣으면 OTA 다운로드가 매 갱신 그만큼 커진다.
     <img> 는 CORS 를 타지 않아 APK·PC(file://)에서도 인터넷만 되면 뜨고,
     안 되면 onerror 로 기존 썸네일로 떨어진다. */
  const ILLUST_BASE = 'https://gbo2-parts.pages.dev/illust/';
  const illustSet = window.GBO2_ILLUST || null;     // 빌드가 넣어 주는 '있는 기체' 목록
  const illustUrl = name => {
    const b = baseName(name).normalize('NFC');
    if (illustSet && !illustSet[b]) return null;    // 공식에 없는 기체는 아예 안 부른다
    return ILLUST_BASE + encodeURIComponent(b) + '.webp';
  };
  const partImg = name => imgUrl(`parts/${name.normalize('NFC')}.webp`);
  const defaultImg = dir => imgUrl(`${dir}/_default.webp`);

  /** 이미지가 없으면 기본 이미지로 한 번만 대체한다. */
  function img(src, fallbackDir, alt) {
    const node = document.createElement('img');
    node.loading = 'lazy';
    node.alt = alt || '';
    node.src = src;
    node.onerror = () => {
      node.onerror = null;
      node.src = defaultImg(fallbackDir);
    };
    return node;
  }

  /* ---------- 상태 ---------- */

  // 코스트 필터: 전체 · 750~300(정확히 일치) · ~250(이하) — 높은 코스트부터
  const COST_CHIPS = [
    { label: '전체', v: 'all' },
    ...[750, 700, 650, 600, 550, 500, 450, 400, 350, 300].map(c => ({ label: String(c), v: c })),
    { label: '~250', v: 'low' }
  ];
  // 레벨 필터
  const LEVEL_CHIPS = [
    { label: '전체', v: 'all' },
    { label: 'LV1', v: 1 }, { label: 'LV2', v: 2 }, { label: 'LV3', v: 3 }, { label: 'LV4+', v: '4+' }
  ];
  // 등급 필터(레어리티 = 별 개수, 표시는 'N성') — 높은 등급부터
  const RARITY_CHIPS = [
    { label: '전체', v: 'all' },
    ...[5, 4, 3, 2, 1].map(n => ({ label: n + '성', v: n }))
  ];
  // 속성 정렬 우선순위 — 강습 → 범용 → 지원
  const ATTR_ORDER = { '強襲': 0, '汎用': 1, '支援': 2 };

  /* 기체 객체를 받는다. **이름을 넘겨도 받는다** — core 의 msLevel 은 이름을 받아서
     두 꼴이 섞이는데, 이름을 넘기면 m.MS名 이 undefined 가 되어 조용히 1 을 돌려줬다.
     그 바람에 대결의 방어 스킬·공중 격투 판정이 전 기체 LV1 로 계산됐다(게이트가 잡았다). */
  const msLevel = m => C.msLevel(m && typeof m === 'object' ? m.MS名 : m);
  const msRarity = m => (m.レアリティ || '').length;   // ☆ 개수
  /** 표시용 LV 추출 — 접미사가 없는 파츠(이레귤러DBL 등)는 undefined. */
  const lvOf = name => (name.match(/_LV(\d+)/) || [])[1];

  // 무장 유형(속성) 표시 — 위키 무장표 컨테이너에서 뽑은 attr(solid/beam/melee/shield/other).
  // attr 이 없으면(옛 데이터·실드 등) 종류·빔 판정으로 보완한다.
  const ATTR_LABEL = { solid: '실탄', beam: '빔', melee: '격투', shield: '실드', other: '기타' };
  // 아이콘 한 벌(src/icons.js) — 모든 화면이 이것 하나만 쓴다.
  const ICON = window.GBO2Icons;
  /* 기체 속성 표시 — 예전의 색 점(.dot) 대신 속성 아이콘. 색은 속성색 그대로라
     색을 못 가리는 사람도 모양으로 가린다. 속성이 없는 기체는 예전처럼 빈 점. */
  const attrMark = a => ICON.el(ICON.MS_ATTR[a], 'attr-ic a-' + a) || el('span', 'dot ' + (a || ''));
  /* 등급 — 별 다섯 개 대신 별 하나 + 숫자 칩, 색으로 등급(5 백금 · 4 파랑 · 3 금 · 2 은 · 1 동).
     별 다섯 개는 기체 카드에서 ⓘ 단추와 자리를 다퉜다(사용자 지적). 클래스 stars 는 그대로 —
     카드 배치 검사(msdrawer_check)가 이 자리를 본다. */
  /* 정적 HTML 에 적어 둔 아이콘(data-ic="이름") — 처음 한 번 채운다(표 머리 · 상단바). */
  for (const e of document.querySelectorAll('[data-ic]:not(svg)')) ICON.prepend(e, e.dataset.ic);
  /* 무장 상세의 항목 이름 — 표 머리와 같은 아이콘이라 표와 상세가 이어져 읽힌다. 숫자·소제목은 글자 그대로. */
  const WD_KEY_IC = [
    [/^(쿨타임|발사 간격|무장 전환|전환 시간)/, 'cooldown'], [/^사거리/, 'range'],
    [/^(히트율|OH까지)/, 'heat'], [/^(OH 복귀|리로드)/, 'reload'], [/^누적치/, 'stagger'],
  ];
  const wdKey = k => {
    const s = el('span', 'wd-k', k);
    const hit = WD_KEY_IC.find(([re]) => re.test(k));
    if (hit) ICON.prepend(s, hit[1]);
    return s;
  };
  /* 위키 설명 칩 — **정해 둔 목록에만** 붙인다(외울 것을 늘리지 않는다). 글자는 그대로라
     「집속 시」 같은 조건은 글자로 읽힌다. 무시 계열은 「무시」 를 먼저 확인한다 —
     「실드」 글자만 보고 방패를 붙이면 「실드 무시」 가 거꾸로 읽혔다(시안에서 잡음). */
  const CHIP_IC = [
    [/이동 사격/, 'moveShot'],
    [/실드[^/]*무시/, 'shieldX', true], [/완충재[^/]*무시/, 'bufferX', true], [/유닛 관통/, 'pierce', true],
    [/강경직/, 'stagger2'], [/경직/, 'stagger'], [/발 동시|동시 발사/, 'dual'],
  ];
  const chipIcon = t => {
    const hit = CHIP_IC.find(([re, , neg]) => re.test(t) && !(neg && CHIP_NEGATE.test(t)));
    return hit ? hit[1] : null;
  };
  /* 성능 항목 → 아이콘. 내성 셋은 무장 속성과 같은 아이콘 · 사격 보정 = 빔 라이플 · 격투 보정 = 주먹.
     파츠 화면 성능 표(core 키)와 기체 정보 성능(한글 이름)이 같은 아이콘을 쓴다. */
  const STAT_IC = { hp: 'hp', armorRange: 'solid', armorBeam: 'beam', armorMelee: 'melee', shoot: 'shootC',
    meleeCorrection: 'meleeC', speed: 'speed', highSpeedMovement: 'dash', thruster: 'thrust',
    turnPerformanceGround: 'turn', turnPerformanceSpace: 'turn' };
  const MI_STAT_IC = { 'HP': 'hp', '내실탄 보정': 'solid', '내빔 보정': 'beam', '내격투 보정': 'melee', '사격 보정': 'shootC',
    '격투 보정': 'meleeC', '스피드': 'speed', '고속이동': 'dash', '슬러스터': 'thrust', '선회(지상)': 'turn', '선회(우주)': 'turn',
    '재출격': 'cooldown' };
  /* 파츠 칸 거리(퍼지는 호 1·2·3겹) · 출격 환경(지상 = 산 · 우주 = 고리 행성, 수중은 글자만) */
  const SLOT_IC = { '근접': 'near', '중거리': 'mid', '원거리': 'far' };
  const ENV_IC = { 'env-g': 'ground', 'env-s': 'space' };
  /* 파츠 분류 · 스킬 분류 — 같은 뜻은 같은 아이콘(방어 = 방패 · 공격 = 위 화살 · 이동/기동 = 사방 화살) */
  const PART_CAT_IC = { 防御: 'def', 攻撃: 'atk', 移動: 'mob', 補助: 'sup', 特殊: 'spc' };
  const SKILL_CAT_IC = { '足回り': 'mob', '移動': 'mob', '攻撃': 'atk', '防御': 'def' };
  const rarityChip = r => {
    const c = el('span', 'stars rar r' + r);
    const nm = (ICON.RARITY[r] || [])[0];
    c.title = r + '성' + (nm ? ' (' + nm + ')' : '');
    c.setAttribute('aria-label', c.title);
    const i = ICON.el('rarity');
    if (i) c.append(i);
    c.append(String(r));
    return c;
  };
  const weaponAttr = w => w.attr
    || (w.type === 'shield' ? 'shield' : w.type === 'melee' ? 'melee' : D.isBeamWeapon(w) ? 'beam' : 'solid');

  // 내구 지표 = HP / (1 - 내성/100) — 피해 종류별 실효 HP. 원본 번들(of 함수)과 동일 공식.
  // HP·내성은 상한 반영된 total 값을 넣는다.
  // 공식은 core 에 있다 — 화면과 자동 구성이 **같은 자**를 쓴다(두 벌을 두면 갈린다).
  const durabilityOf = C.durabilityOf;

  /* ---------- 누적치(스태거) 스킬 ---------- */
  // 방어측 스킬의 누적치 영향을 파싱한다. 두 패턴이 핵심:
  //   「よろけ値を N%かつ小数点以下切り捨て で計算」 → 받는 누적치 ×(N/100) (감소)
  //   「蓄積よろけまでの値が N% になる」           → 다운 임계 100→N% (상승)
  // 더불어 피해 경감(被ダメージ －N%)도 속성별로 읽어 격파 계산에 쓴다.
  // 발동 조건을 짧은 라벨로 — 동시 발동 가능 여부는 기체마다 복잡(정지+활공 가능, 이동+정지 불가 등)해
  // 자동 배타 대신 라벨만 보여 주고 사용자가 양립 가능한 것만 고르게 한다.
  function staggerCond(blob) {
    /* 「自軍の支援砲撃を受けた際」(マーカー) — 아군 지원 포격에만 걸린다. 대결·내구 계산과 무관하다.
       조건 낱말이 없어 '상시' 로 떨어져, 피해 −45% 가 늘 걸린 것으로 잡혔다(12기). */
    if (/支援砲撃を受けた/.test(blob)) return '지원포격';
    if (/機体HPへのダメージと[^。]*への負荷/.test(blob)) return '부위피격';   // 脚部/頭部… 특수완충재(그 부위 피격 시)
    // 「対象部位にビーム属性の射撃攻撃を受けた際」 — 아래 일반 규칙은 へ/に 바로 뒤에
    // 攻撃 가 와야 잡는데 여기는 「に + ビーム属性の射撃 + 攻撃」 이라 새어 나가 '상시' 가 됐다.
    // 그 바람에 I필드의 피해 −70% 가 기체 전체에 늘 걸리는 것으로 잡혔다(하이젠슬레이Ⅱ 라 등).
    if (/対象部位[にへ]/.test(blob)) return '부위피격';
    // 「〜へ攻撃を受けた際」 와 「〜に攻撃を受けた際」 — 조사만 다르고 뜻은 같다.
    // へ 만 보다가 に 를 쓰는 3건(바이아란 커스텀 2호기 양팔부 장갑 등)이 '상시' 로 새어,
    // 부위에 맞았을 때만 걸리는 경감이 기체 전체 내구 지표를 30% 올려 버렸다.
    // 단 「停止射撃中に攻撃を受けた際」 처럼 바로 앞이 「中」 이면 부위가 아니라 '상태' 다 —
    // 그건 아래 정지중·이동중 규칙이 잡아야 한다(크로스본 X2 개량형 最大出力(Z) 가 그 자리).
    if (/[^、。/]{1,11}[^、。/中][へに]攻撃を受けた際/.test(blob)) return '부위피격';   // 「A・アーマーDEへ攻撃を受けた際」 등 부위 피격형
    /* 위 규칙은 へ/に **바로 뒤**에 攻撃 가 와야 잡는다. 「胸部にビーム属性の射撃攻撃を受けた際」
       「シールド部へ攻撃を受けた**場合**」 처럼 사이에 낱말이 끼거나 際 대신 場合 를 쓰면 '상시' 로 새었다
       (胸部Iフィールド · 多目的大型バインダー · シールドガトリング/シールド・ファンネル 特殊防御機構 ·
       シールド内Iフィールド — 2026-10-15 전수). 앞에 **부위 이름**이 있을 때만 잡는다 —
       「ビーム属性の射撃攻撃を機体に受けると」(몸 전체) 를 부위로 오판하지 않게. */
    if (/(部|シールド|バインダー|ファンネル)(?:の[^、。/]{0,8})?[へに][^、。/]{0,14}攻撃を受け(?:た際|た場合)/.test(blob)) return '부위피격';
    if (/動作開始|判定発生|格闘攻撃中/.test(blob)) return '격투중';   // 헤비어택 등 — 「空中で使用可」 언급보다 우선
    if (/静止|停止/.test(blob)) return '정지중';
    if (/空中|落下|滑空|ジャンプ/.test(blob)) return '공중';
    if (/高速移動中|ブースト移動中/.test(blob)) return '이동중';
    if (/変形|フライトモード/.test(blob)) return '변형중';
    /* 실제 HP 조건은 「HP…以下」(예: 機体HPが 50%以下). 「機体HPへのダメージ」「HP回復」 같은
       단순 HP 언급을 HP조건으로 오판하지 않도록 **방향 어느 쪽이든 하나는** 요구한다
       (다목적 대형 바인더 등).
       以下 만 보다가 「HP…以上」을 쓰는 것들이 '상시' 로 새어 나갔다 — 사용자가 짚은
       「보조 동력」이 그 자리다(「機体HPが 1000 以上の時に撃破されるダメージを受けると」).
       조건부인데 상시로 잡히면 **늘 걸리는 값**이 되어, 나노라미네이트 아머의 피해 −30%
       (HP 50% 以上 + 피격 2000 이하)가 내구 지표에 항상 들어가 있었다. 전수 10종. */
    // 未満(미만)도 문턱이다 — 耐ビーム・コーティング 「機体HPが50%未満になると…無効」 이 '상시' 로 샜다
    if (/HP[^。]{0,12}(以下|以上|未満|を下回|を超え)/.test(blob)) return 'HP조건';
    /* 「レジストムーブ動作中は…被ダメージを 50% 軽減」 — 「高速移動」 을 두 번 눌러 **직접 발동**한다.
       動作中 을 몰라 '상시' 로 떨어졌다(사용자가 짚음, 2026-10-15 · 20기). 「集束中」 도 같다
       (ビーム撹乱シールド · 胸部ビーム撹乱フィールド — 메가 입자포를 모으는 동안만). */
    if (/発動中|使用中|モード中|効果中|動作中|集束中|ハイパーモード/.test(blob)) return '발동중';
    if (/能力UP|NT-D|覚醒/.test(blob)) return '발동중';   // 「NT-D」·「覚醒」 상태 한정 효과
    /* 「무엇이 끝난/생긴 **뒤** 일정 시간」 — 그 일이 있어야 걸린다. 몰라서 '상시' 로 떨어져
       カウンターブースト(카운터 공격 종료 후 30초 · 15기)의 사격 −20% · 격투 −15% 가 늘 걸린 것으로,
       MFEガンディウムFGI複合材(경직 이상 리액션 발생 후 5초)의 −25% 도 상시로 잡혔다(2026-10-20 사용자 지적 · 전수 검수). */
    if (/終了後|後の一定時間|リアクション(?:が)?発生(?:する|時)|のいずれかが発生すると/.test(blob)) return '발동후';
    /* 「格闘兵装を装備している場合」 — 격투 무장을 **들고 있는 동안**. 시뮬레이터는 무엇을 들었는지 모르므로
       조건부로 둔다(모르면 조건 있음). 白兵戦プログラム(ガンダム・端白星) 사격 −20% 가 상시로 샜다. */
    if (/兵装を装備している場合|兵装装備中/.test(blob)) return '장비중';
    return '상시';
  }

  function parseStaggerSkill(sk) {
    const blob = (sk.eff || '') + ' / ' + (sk.desc || '');
    // 한 스킬에 단계별로 여러 값이 있을 수 있다(예: 헤비어택改 動作開始 35% / 判定発生 70%).
    // 상시 가정하는 값이 아니므로, 감소가 가장 약한(값이 큰) 쪽을 보수적으로 쓴다.
    // 「%?かつ」 처럼 % 뒤 물음표(원본 OCR 잡음)도 허용해 누적치 배수를 놓치지 않는다.
    const mults = [...blob.matchAll(/よろけ値を\s*(\d+)\s*[%％]?[?？\s]*かつ小数点以下切り捨て/g)].map(m => Number(m[1]));
    const tm = blob.match(/蓄積よろけまでの値が\s*(\d+)\s*%/);
    // 피해 경감(被ダメージ －N%) — 속성별. 내구 지표 상승·격파 계산에 쓴다.
    // 표기 변형 허용: 実弾属性/実弾射撃/実弾攻撃 등. 「射撃」은 실탄+빔 공통(shoot).
    const cuts = [];
    const cut = (re, scope) => { const m = blob.match(re); if (m) cuts.push({ scope, pct: Number(m[1]) }); };
    cut(/実弾(?:属性|射撃|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'solid');
    cut(/ビーム(?:属性|射撃|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'beam');
    cut(/格闘(?:属性|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'melee');
    /* 앞 글자 하나만 보면 「実弾属性射撃被ダメージ」 를 못 거른다(射撃 바로 앞이 「性」) — 실탄 한정 −50% 가
       사격 전체 −50% 로도 잡혀 빔에도 걸렸다(밴디트 우지 아머, 사용자 지적 2026-10-16). 「実弾/ビーム(属性)」 를 통째로 본다. */
    cut(/(?<!(?:実弾|ビーム)(?:属性)?)射撃(?:属性|攻撃)*被ダメージ\s*[－-]\s*(\d+)\s*[%％]/, 'shoot');
    // 받는 공격의 속성·종류로 일반 경감의 범위를 좁힌다.
    // (예: 다목적 대형 바인더 '射撃攻撃を受けた際' → 사격 한정 / 빔 교란 실드 'ビーム属性' → 빔 한정)
    const scopeOf = txt => {
      const beam = /ビーム属性/.test(txt), solid = /実弾属性/.test(txt);
      if (beam && !solid) return 'beam';
      if (solid && !beam) return 'solid';
      const rs = /(?:射撃|実弾|ビーム)[^。]{0,4}攻撃を受け|射撃属性/.test(txt), rm = /格闘[^。]{0,4}攻撃を受け/.test(txt);
      if (rs && !rm) return 'shoot';
      if (rm && !rs) return 'melee';
      return 'all';
    };
    // 「기본 경감 + 조건부 속성 경감」을 함께 가진 스킬(밴시 노른 A·아머 DE: 부위 피격 50%,
    // NT-D/각성 중 빔 30% 추가)은 조건이 서로 달라 한 항목으로 합칠 수 없다 → extra 로 분리한다.
    // 기본값의 범위는 그 문장만 보고 판정한다(조건부 쪽의 「ビーム属性」에 끌려가지 않게).
    // 「追加で」 를 요구하는 게 핵심 — 초밤 아머·사이코 필드처럼 EFF 산문과 DESC 항목이
    // '같은 경감'을 두 번 적은 스킬을 둘로 쪼개 이중 계산하는 것을 막는다.
    let extra = null;
    const GEN_BASE = /(?:機体HPへのダメージ|ダメージ)[がを]\s*(\d+)\s*[%％]\s*軽減/;
    if (cuts.length && /追加で/.test(blob)) {
      const seg = blob.split(/ \/ |。/).find(t => GEN_BASE.test(t));
      const gm = seg && seg.match(GEN_BASE);
      if (gm) {
        const attrTxt = /(?:実弾|ビーム|格闘|射撃)(?:属性|射撃|攻撃)*被ダメージ/.test(sk.desc || '') ? (sk.desc || '') : (sk.eff || '');
        // 추가분의 조건은 속성 문장만 보면 안 된다 — 「양팔 장갑에 맞았을 때…, 게다가 빔이면 더」 처럼
        // 발동 조건은 앞 문장에 있고 뒤 문장엔 속성만 적힌 경우가 있어, 거기서 조건을 못 찾으면
        // 스킬 전체(blob)의 조건을 물려받는다. (안 그러면 부위 한정인데 '상시' 로 나온다)
        const xCond = staggerCond(attrTxt);
        extra = { cuts: cuts.slice(), cond: xCond === '상시' ? staggerCond(blob) : xCond };   // 조건부(속성) 몫
        cuts.length = 0;
        cuts.push({ scope: scopeOf(seg), pct: Number(gm[1]) });       // 기본 몫
      }
    }
    // 속성 표기 없는 일반 被ダメージ / ダメージが N%軽減
    if (!cuts.length) {
      const gm = blob.match(/被ダメージ\s*[－-]\s*(\d+)\s*[%％]/) || blob.match(/ダメージ[がを]\s*(\d+)\s*[%％]\s*軽減/)
        || blob.match(/機体HPへのダメージと[^。]{0,24}?(\d+)\s*[%％]\s*軽減/);   // 부위 특수완충재(機体HPへのダメージと〇〇HPへの負荷を N%軽減)
      if (gm) cuts.push({ scope: scopeOf(blob), pct: Number(gm[1]) });
    }
    // 누적치 감소·임계 또는 피해 경감 중 하나라도 있으면 방어 스킬로 본다.
    // (「リアクションを軽減」만 있는 기본 마뉴버아머처럼 수치 없는 것은 제외.)
    if (!mults.length && !tm && !cuts.length) return null;
    const mult = mults.length ? Math.max(...mults) / 100 : 1;
    return { mult, threshold: tm ? Number(tm[1]) : null, cuts, cond: staggerCond(blob), extra };
  }

  const isAltSkillMode = mo => !!(mo && mo.mode && mo.mode !== '通常時');

  /** 현재 모드(통상/변형·변신)에 해당하는 스킬 모드만 고른다.
   *  각 모드는 그 상태의 '완결된' 스킬 목록이라, 섞지 않고 한쪽만 쓰는 게 맞다.
   *  (NT-D 계열은 같은 스킬의 수치가 모드마다 다르다 — 밴시 노른 A·아머 DE 40%↔50%) */
  function skillModesFor(modes, form) {
    if (modes.length < 2) return modes;
    const alt = modes.filter(isAltSkillMode), norm = modes.filter(mo => !isAltSkillMode(mo));
    if ((form || state.form) === 'transform' && alt.length) return alt;
    return norm.length ? norm : modes;
  }

  /**
   * 「켜는 방어 무장」 — I필드 발생기·리플렉터 패널처럼, 골라 쓰는 동안 받는 피해를 깎는 부무장.
   * 스킬이 아니라 무장이라 스킬 목록에 안 잡혔는데, 실제로는 방어 스킬과 똑같이
   * 내구 지표·누적치에 영향을 준다(X3 빔 −50%, 풀아머 오베론 빔 −70% 따위).
   *
   * 備考 표기가 스킬과 달라 그대로는 안 읽힌다 — 스킬은 「被ダメージ －50%」,
   * 무장은 「ビーム属性射撃被ダメージ50%軽減」 처럼 마이너스 없이 적힌다.
   *
   * 「装備中シールドへの被ダメージ」 는 실드 HP 라 뺀다 — 기체 HP 와 다른 값이고,
   * 여기에 섞으면 실효 HP 가 부풀어 오른다.
   */
  const DEF_WEAPON_PREFIX = '무장:';
  function defenseWeaponsOf(ms, lv) {
    if (!ms) return [];
    const out = [];
    for (const w of weaponsOfMs(ms)) {
      const note = (w.info && w.info['備考']) || '';
      if (!note) continue;
      const segs = note.split(' / ');
      const cuts = [];
      for (const seg of segs) {
        if (/装備中シールドへの/.test(seg)) continue;           // 실드 HP — 기체 HP 가 아니다
        const m = seg.match(/被ダメージ\s*(\d+)\s*[%％]\s*軽減/);
        if (!m) continue;
        const scope = /ビーム/.test(seg) ? 'beam' : /実弾/.test(seg) ? 'solid'
          : /格闘/.test(seg) ? 'melee' : /射撃/.test(seg) ? 'shoot' : 'all';
        cuts.push({ scope, pct: Number(m[1]) });
      }
      if (!cuts.length) continue;
      // 누적치 배수도 같은 자리에 적힌다 — 스킬과 같은 문구라 같은 규칙으로 읽는다
      const mm = note.match(/よろけ値を\s*(\d+)\s*[%％]?[?？\s]*かつ小数点以下切り捨て/);
      const secs = note.match(/効果時間[：:]\s*([\d.]+)\s*秒/) || note.match(/([\d.]+)\s*秒間持続/);
      // 조건은 문장에서 읽는다 — 그냥 고르면 되는 것과 자세를 잡아야 하는 것은 다르다
      const base = /ガード体勢/.test(note) ? '가드 중' : '선택 중';
      out.push({
        name: DEF_WEAPON_PREFIX + w.name,
        ko: T.weaponName ? T.weaponName(w.name) : w.name,
        mult: mm ? Number(mm[1]) / 100 : 1,
        threshold: null,
        cuts,
        cond: secs ? `${base} (${secs[1]}초)` : base,
        from: 1,
        isWeapon: true
      });
    }
    return out;
  }

  /** 이 기체가 그 LV 에서 가진, 누적치에 영향 주는 스킬 목록.
   *  같은 이름이 LV 구간별로 여러 개면(예: 데미지컨트롤 LV1=130·LV2~=160) 현재 LV 에 맞는 최상위를 쓴다. */
  function staggerSkillsOf(ms, lv, form) {
    if (!ms) return [];
    const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || [], form);
    const byName = new Map();
    // 스킬명별로 구간을 모아 현재 LV 에 맞는 것 하나만 고른다(폴백 규칙은 스킬 패널과 동일).
    const groups = new Map();
    for (const mode of modes) for (const sk of (mode.skills || [])) {
      if (!groups.has(sk.name)) groups.set(sk.name, []);
      groups.get(sk.name).push(sk);
    }
    for (const cands of groups.values()) {
      const sk = pickByMsLv(cands, lv);
      if (!sk) continue;
      const p = parseStaggerSkill(sk);
      if (!p) continue;
      // 아군 지원 포격에만 걸리는 경감(マーカー) — 적에게 맞는 셈에는 끼지 않는다. 켤 칩으로도 내지 않는다
      if (p.cond === '지원포격') continue;
      const from = msLvFrom(sk.msLv);
      const prev = byName.get(sk.name);
      if (!prev || from > prev.from) byName.set(sk.name, { name: sk.name, ko: skTr(sk.name), mult: p.mult, threshold: p.threshold, cuts: p.cuts, cond: p.cond, from });
      // 조건부 추가 경감(예: A·아머 DE — NT-D/각성 중 빔 −30%)은 기본 경감과 발동 조건이 달라
      // 별도 항목으로 넣는다. 사용자가 상황에 맞는 것만 체크한다.
      if (p.extra) {
        const xn = sk.name + '(추가)';
        const xp = byName.get(xn);
        if (!xp || from > xp.from) byName.set(xn, { name: xn, ko: skTr(sk.name) + ' (추가)', mult: 1, threshold: null, cuts: p.extra.cuts, cond: p.extra.cond, from });
      }
    }
    // 부여 스킬 — 하이퍼모드 등이 「ハイ・マニューバーアーマー LVn」을 付与하는데 직접 항목이 없어 놓친다.
    // 하이마뉴버는 값이 일정(×0.5·피해−40%)하므로 부여를 감지해 별도 항목으로 넣는다.
    if (!byName.has('ハイ・マニューバーアーマー')) {
      let granted = false;
      for (const mode of modes) for (const sk of (mode.skills || [])) {
        if (!msLvHit(sk.msLv, lv) || sk.name === 'ハイ・マニューバーアーマー') continue;
        if (/ハイ[・･]?マニューバーアーマー\s*LV\d/.test((sk.eff || '') + ' ' + (sk.desc || ''))) { granted = true; break; }
      }
      if (granted) byName.set('ハイ・マニューバーアーマー(부여)',
        { name: 'ハイ・マニューバーアーマー(부여)', ko: '하이 마뉴버아머(부여)', mult: 0.5, threshold: null, cuts: [{ scope: 'all', pct: 40 }], cond: '이동중', from: 1 });
    }
    // 켜는 방어 무장(I필드 발생기 등)을 같은 목록에 얹는다 — 체크·집계·피탄이 한 벌로 돈다.
    // 다만 스킬이 '그 무장이 하는 일'을 설명만 하는 경우가 있다
    // (시스쿠드: 스킬 「Iフィールド制御装置」 빔 −80% = 무장 「Iフィールド・ランチャー」 빔 −80%).
    // 둘 다 체크하면 같은 경감을 두 번 세므로, 경감 내역이 똑같으면 무장 쪽을 뺀다.
    const sig = c => c.map(x => x.scope + ':' + x.pct).sort().join(',');
    const skillSigs = new Set([...byName.values()].map(v => sig(v.cuts)));
    const weapons = defenseWeaponsOf(ms, lv).filter(w => !skillSigs.has(sig(w.cuts)));
    return [...byName.values(), ...weapons];
  }

  /** 상대 무장의 성질에 따라서만 걸리는 파츠 경감 — 내구 지표(무장을 특정하지 않음)에는
   *  넣을 수 없고, 무장을 하나 고르는 피탄 시뮬에서만 조건을 확인해 적용한다.
   *    관통 경감 장갑 — 「사이코뮤 제외 + 관통 성능을 가진 사격 무장」에서 받는 피해
   *    폭풍 경감 장갑 — 「兵装による爆風ダメージ」 (「爆風なし」 명시 무장은 제외)
   *  @param {{note:string, psycommu:boolean, attr:string}} w 고른 상대 무장 */
  function conditionalPartCuts(equipped, w) {
    const out = [];
    if (!w) return out;
    const note = String(w.note || '');
    const isShoot = w.attr === 'solid' || w.attr === 'beam' || w.attr === 'shoot';
    const pierces = /ユニット貫通/.test(note) && !w.psycommu && isShoot;
    const blasts = /爆風/.test(note) && !/爆風なし/.test(note);
    for (const p of equipped || []) {
      const d = String(p.description || '');
      if (pierces) {
        const m = d.match(/貫通性能を備えた射撃兵装からの被ダメージを\s*(\d+)\s*[%％]\s*軽減/);
        if (m) out.push({ scope: 'all', pct: Number(m[1]), label: '관통 경감' });
      }
      if (blasts) {
        const m = d.match(/爆風ダメージを\s*(\d+)\s*[%％]\s*軽減/);
        if (m) out.push({ scope: 'all', pct: Number(m[1]), label: '폭풍 경감' });
      }
    }
    return out;
  }

  /** 완충재계 스킬의 '기체HP 피해 경감량'을 올려 주는 파츠(신형 완충재)의 강화 %.
   *  「緩衝材系スキルの効果である機体HPへのダメージ軽減効果をさらに N%強化」 */
  function bufferBoostOf(equipped) {
    let n = 0;
    for (const p of equipped || []) {
      const m = String(p.description || '').match(/緩衝材系スキル[^。]*?(\d+)\s*[%％]\s*強化/);
      if (m) n += Number(m[1]);
    }
    return n;
  }

  /** 완충재계 스킬 몫의 경감량에 강화분을 더한다(퍼센트포인트 가산).
   *  대상은 「◯◯特殊緩衝材」 뿐 — 「特殊防御機構」·「特殊装甲材」 등에는 효과가 없다.
   *  국부(부위) HP 경감은 원래 지표에 안 넣으므로 자연히 제외된다. */
  function boostBufferCuts(cuts, equipped) {
    const boost = bufferBoostOf(equipped);
    if (!boost) return cuts;
    return cuts.map(c => (c.from && /緩衝材/.test(c.from) && !/防御機構/.test(c.from))
      ? { ...c, pct: Math.min(99, c.pct + boost) } : c);
  }

  /** 켜 둔 스킬만 적용한 누적치 상태 — mult(받는 누적 배수) · threshold(임계) · cuts(피해 경감).
   *  누적치 감소(마뉴버·정지사격·헤비어택·활공 등)는 발동 상황이 배타적이라 동시에 못 쓴다
   *  → 하나만 적용(여럿 켜졌으면 감소가 가장 약한=값이 큰 쪽 보수적). 임계형(데미지컨트롤)은 상시. */
  // 체크한 스킬만 적용. 동시 발동 가능 여부는 사용자가 조건 라벨을 보고 판단(양립 불가한 건 안 켬).
  function activeStaggerMods(ms, lv, sel, form) {
    const on = sel || state.staggerOn;
    const skills = staggerSkillsOf(ms, lv, form);
    let mult = 1, threshold = 100; const cuts = [], mults = [];
    for (const s of skills) {
      // 상시 발동(데미지 컨트롤 등)은 체크와 무관하게 늘 걸린다 —
      // 끌 수 있게 두면 안 켠 채로 낮은 수치를 읽고 그것이 맞는 줄 안다.
      if (s.cond !== '상시' && !on.has(s.name)) continue;
      if (s.mult < 1) { mult *= s.mult; mults.push(s.mult); }   // 감소 배수
      if (s.threshold != null) threshold = Math.max(threshold, s.threshold);
      cuts.push(...s.cuts.map(c => ({ ...c, from: s.name })));   // 어느 스킬 몫인지 남긴다(완충재 강화 판정용)
    }
    mults.sort((a, b) => a - b);   // 감소가 큰(배수가 작은) 스킬부터 순서대로 적용
    return { skills, mult, mults, threshold, cuts };
  }

  /* 누적치를 읽는 다섯 가지 상황.
     조건을 아무렇게나 곱하면 정지하면서 격투하는 있을 수 없는 수가 나오고,
     하나만 고르면 공중에서 고속이동하는 기체를 적게 잡는다.
     그래서 **실제로 겪는 상황**을 다섯으로 끊고, 상황마다 성립하는 조건만 센다.

       통상 — 아무것도 안 할 때. 조건 없는 것(상시)만.
       지상 — 지상에서 고속이동하거나 정지사격할 때.
       공중 — 공중에서 고속이동할 때. 활공기구(공중)와 매뉴버(이동중)가 같이 걸린다.
       근접 — 격투 중.
       최대 — 축 규칙대로 전부. 부위 피격·발동 중처럼 좁은 조건이 여기에만 들어간다.

     I필드는 따로 다룬다 — 빔이 그 부위에 맞았을 때만 걸리는 좁은 조건이라 늘 켜 두면
     거짓이 되고, 최대에만 묻어 두면 안 보인다. **버튼으로 켜고 끄고**, 켜면 다섯 칸
     모두에 반영한다(「I필드가 걸린 상태로 본다」는 뜻이다).

     같은 축 안에서는 하나만 성립하고(정지·이동·격투 중 하나, 피격 부위 하나),
     축이 다르면 함께 성립한다. */
  const STG_AXIS = {
    '정지중': 'act', '이동중': 'act', '격투중': 'act',
    '부위피격': 'part', '공중': 'air', '변형중': 'form',
    'HP조건': 'hp', '발동중': 'buff',
    // 2026-10-20 — 「끝난 뒤 일정 시간」 은 버프와 같은 축(효과가 걸려 있는 동안), 「무장을 든 동안」 은 따로
    '발동후': 'buff', '장비중': 'equip'
  };
  const STG_CATS = [
    { key: '통상', conds: [] },
    { key: '지상', conds: ['이동중', '정지중'] },
    { key: '공중', conds: ['공중', '이동중'] },
    { key: '근접', conds: ['격투중'] },
    { key: '최대', all: true }
  ];

  /**
   * 다섯 상황의 누적치 내성. 각 항목은 {key, value, picks}.
   *
   * 값은 임계 ÷ (받는 누적 배수) — 파츠 화면의 성능표와 **같은 식**이다.
   * (고트라탄으로 대조함: 130% → 260% → 520%)
   * 어느 스킬이 그 값을 만들었는지 picks 에 담아 화면에 같이 적는다.
   * 수만 적으면 언제 그 값인지 알 수 없어 거짓이 된다.
   */
  /** 누적치를 줄이는 I필드 스킬. 없으면 null. */
  const iFieldOf = skills => skills.find(sk => sk.mult < 1 && /I *フィールド|Ｉ *フィールド/.test(sk.name)) || null;

  function staggerByCategory(ms, lv, useIField) {
    const all = staggerSkillsOf(ms, lv);
    const ifld = iFieldOf(all);
    // I필드는 버튼이 정한다 — 후보에서 빼 두고, 켜져 있으면 모든 칸에 곱한다.
    const skills = ifld ? all.filter(sk => sk !== ifld) : all;
    // 임계형은 조건이 없다(늘 걸린다). 여럿이면 가장 높은 것.
    let threshold = 100;
    for (const sk of all) if (sk.threshold != null) threshold = Math.max(threshold, sk.threshold);
    // 조건 없는 감소는 어느 상황에서나 곱한다.
    let baseMult = 1;
    for (const sk of skills) if (sk.mult < 1 && sk.cond === '상시') baseMult *= sk.mult;
    if (ifld && useIField) baseMult *= ifld.mult;
    // 조건 없이 늘 값을 만드는 것들 — 임계를 정한 스킬과 상시 감소 스킬.
    const always = skills.filter(sk =>
      (sk.cond === '상시' && sk.mult < 1) || (sk.threshold != null && sk.threshold === threshold && threshold > 100));

    const axisOf = sk => STG_AXIS[sk.cond] || sk.cond;
    const pickBest = allow => {
      const best = new Map();
      for (const sk of skills) {
        if (!(sk.mult < 1) || sk.cond === '상시') continue;
        if (allow && !allow.includes(sk.cond)) continue;
        const ax = axisOf(sk);            // 모르는 조건은 제 이름을 축으로 — 상시로 넘기면 없는 값이 된다
        const prev = best.get(ax);
        if (!prev || sk.mult < prev.mult) best.set(ax, sk);
      }
      return [...best.values()];
    };

    const cats = STG_CATS.map(c => {
      const picks = c.all ? pickBest(null) : pickBest(c.conds);
      let mult = baseMult;
      for (const sk of picks) mult *= sk.mult;
      // 통상 칸이 비면 「아무것도 안 걸린 값」으로 읽힌다 — 실제로는 데미지 컨트롤
      // 같은 상시 스킬이 이미 들어간 값이다. 늘 걸리는 것도 같이 적는다.
      const named = [...(ifld && useIField ? [ifld] : []), ...always, ...picks];
      return { key: c.key, value: Math.round(threshold / mult), picks: named };
    });
    cats.iField = ifld;
    return cats;
  }

  /** 받는 누적치(よろけ値) — 스킬 배수를 감소 큰 순으로 하나씩 곱하고 매번 소수점 이하 내림. */
  function staggerPerHit(base, mults) {
    let v = base;
    for (const m of mults) v = Math.floor(v * m);
    return v;
  }

  // 파츠 피해경감 파싱도 core 에 있다 (위와 같은 이유).
  const partDamageCuts = C.partDamageCuts;

  // 공격 지표용 '대표 무장' — 실탄·빔·격투 각각에 어떤 % 가 걸리는지 재 보는 데만 쓴다.
  // damage.js 의 빔 판정은 attr 이 아니라 '무장 이름'을 보므로, 빔 쪽 대표는 이름을 빔으로 준다.
  const PROBE_SOLID = { name: 'マシンガン', type: 'shooting', attr: 'solid', info: {}, levels: {} };
  const PROBE_BEAM = { name: 'ビーム・ライフル', type: 'shooting', attr: 'beam', info: {}, levels: {} };
  const PROBE_MELEE = { name: 'ヒート・サーベル', type: 'melee', attr: 'melee', info: {}, levels: {} };

  /** 장착 파츠의 '전 사격/격투' 与ダメージ% (오버튠·특화 프로그램·교육형 컴퓨터 등).
   *  무장 피해와 같은 규칙을 쓰려고 damage.js 의 파싱을 그대로 재사용한다 — 따로 정규식을
   *  두었더니 「敵に与えるダメージを3%増加」처럼 속성 접두가 없는 표기를 놓쳐, 무장 피해는
   *  오르는데 공격 지표만 그대로인 불일치가 났다(교육형 컴퓨터·화기관제·CP내장 등 5종).
   *  속성 한정(빔 전용 코넥팅 등)은 실탄·빔 중 한쪽만 오르므로 min 으로 자연히 빠진다. */
  function partAttackBonus(equipped, msLv) {
    // 「4분 경과」 시점을 따른다(교육형 컴퓨터의 4분 뒤 값 — C.partsAt). 두 번 거쳐도 같다.
    const mods = D.weaponModsOf(C.partsAt(equipped, state.lateMode), msLv, state.ms && state.ms.属性, state.expansion);
    return {
      shoot: Math.min(D.damagePctFor(mods, PROBE_SOLID, 'shoot'), D.damagePctFor(mods, PROBE_BEAM, 'shoot')),
      melee: D.damagePctFor(mods, PROBE_MELEE, 'melee')
    };
  }

  /* 파츠별 피해 % — 자동 구성이 「피해 %를 올려 주는 파츠」를 볼 수 있게 미리 나눠 둔다.
     partAttackBonus 는 장착 집합 전체를 받는데, 기여가 파츠별로 독립이라
     (weaponModsOf 가 파츠를 훑어 더한다) 하나씩 재서 더해도 같은 값이 나온다.
     평가마다 파츠 설명을 훑으면 자동 구성이 느려진다 — 방어 축에서 그렇게 했다가
     6.9초가 12.5초가 됐다. 그래서 **한 번만** 만들어 넘긴다.
     사격은 실탄·빔을 따로 두고 쓰는 쪽에서 min 을 잡는다(화면과 같은 기준). */
  function partDmgPctMap() {
    const lv = msLevel(state.ms);
    const attr = state.ms && state.ms.属性;
    const out = {};
    for (const p of allParts) {
      const mods = D.weaponModsOf([C.applyPartMode(p, state.lateMode)], lv, attr, state.expansion);
      const s = D.damagePctFor(mods, PROBE_SOLID, 'shoot');
      const b = D.damagePctFor(mods, PROBE_BEAM, 'shoot');
      const m = D.damagePctFor(mods, PROBE_MELEE, 'melee');
      if (s || b || m) out[p.name] = { s, b, m };
    }
    return out;
  }

  /* 파츠별 슬러스터 소비경감 표 — partDmgPctMap 과 같은 꼴. 경감은 파츠별로 더해지므로
     미리 나눠 둘 수 있다. 경감이 0 인 파츠는 표에 넣지 않는다(지금 164개 중 2개뿐). */
  function partThrFxMap() {
    const out = {};
    for (const p of allParts) {
      const f = C.thrusterPartFx([p]);
      if (f.cutInit || f.cutRate) out[p.name] = { cutInit: f.cutInit, cutRate: f.cutRate };
    }
    return out;
  }

  // 피해경감 계산은 core 에 있다 — 자동 구성과 같은 자를 써야 해서 옮겼다.
  const staggerDmgFactor = C.staggerDmgFactor;

  const ARMOR_KEY = { solid: 'armorRange', beam: 'armorBeam', melee: 'armorMelee', shield: 'armorMelee' };

  /**
   * 이 구성에 걸리는 피해경감 목록. 화면마다 무엇까지 세는지가 달라 인자로 받는다.
   *   lv       기체 LV (오버튠처럼 LV 로 커지는 파츠에 쓴다). 없으면 지금 기체.
   *   skillMs  방어 스킬을 셀 기체 — 체크 UI 가 있는 화면만 넘긴다(저장 구성·비교엔 없다).
   *   skills   체크 Set (기본 state.staggerOn)
   *   weapon   상대 무장 — 관통·폭풍처럼 **그 무장에만** 걸리는 경감까지 셀 때
   */
  function damageCutsOf(equipped, opt = {}) {
    const lv = opt.lv != null ? opt.lv : (state.ms ? msLevel(state.ms) : 1);
    const cuts = partDamageCuts(C.partsAt(equipped, state.lateMode), lv);   // 「4분 경과」 시점(교육형)
    /* opt.form — 대결은 쪽마다 모드가 다르다. 안 넘기면 앱 화면의 state.form 을 따라가 버렸다(2026-10-15) */
    if (opt.skillMs) cuts.push(...boostBufferCuts(activeStaggerMods(opt.skillMs, lv, opt.skills, opt.form).cuts, equipped));
    if (opt.weapon) cuts.push(...conditionalPartCuts(equipped, opt.weapon));
    return cuts;
  }

  /**
   * 내구 지표 — 「이 구성이 이 속성 공격에 실제로 얼마나 버티나」.
   *   HP ÷ (1 − 내성) 에 피해경감을 접은 값.
   * 이 계산이 성능표·카드·비교·피탄·저장 목록에 각각 흩어져 있었고, 그중 둘은 경감을
   * 아예 빼먹어 같은 이름의 지표가 24,572 와 22,115 로 갈렸다. 화면을 더 붙여도
   * 어긋나지 않도록 여기 하나만 쓴다 — 무엇까지 셀지는 damageCutsOf 로 정한다.
   */
  const enduranceOf = (total, attr, cuts) =>
    Math.round(durabilityOf(total, ARMOR_KEY[attr] || 'armorRange') / staggerDmgFactor(cuts, attr));

  /** 화면에 함께 적는 「피해 -N%」 — 경감이 없으면 0. */
  const cutPctOf = (cuts, attr) => {
    const f = staggerDmgFactor(cuts, attr);
    return f < 1 ? Math.round((1 - f) * 100) : 0;
  };

  // 세 속성을 한 번에 도는 자리가 많아 목록으로 둔다 (라벨은 화면마다 조금씩 다르다)
  const DURA_ATTRS = [['solid', '내실탄', '실탄'], ['beam', '내빔', '빔'], ['melee', '내격투', '격투']];

  /* 방어 스킬 목록 펼침 상태 — 기본은 접힘(자리를 아끼는 것이 이 기능의 목적).
     renderAll 이 성능 패널을 통째로 다시 그리므로 모듈 스코프에 둔다. */
  const DEF_SKILL_KEY = 'gbo2.defSkillOpen';
  let defSkillOpen = false;
  try { defSkillOpen = localStorage.getItem(DEF_SKILL_KEY) === '1'; } catch (e) {}
  function setDefSkillOpen(v) {
    defSkillOpen = !!v;
    try { localStorage.setItem(DEF_SKILL_KEY, defSkillOpen ? '1' : '0'); } catch (e) {}
  }

  /* 스러스터 스킬 목록 펼침 — 방어 스킬과 같은 방식. */
  const THR_SKILL_KEY = 'gbo2.thrSkillOpen';
  let thrSkillOpen = false;
  try { thrSkillOpen = localStorage.getItem(THR_SKILL_KEY) === '1'; } catch (e) {}
  function setThrSkillOpen(v) {
    thrSkillOpen = !!v;
    try { localStorage.setItem(THR_SKILL_KEY, thrSkillOpen ? '1' : '0'); } catch (e) {}
  }
  /** 스러스터 효과 축 → 화면에 적을 말. */
  const THR_KEY_KO = { cutInit: '초기소비', cutRate: '소비속도', recover: '회복속도', oh: 'OH복귀' };

  /** 경감 축의 한 칸을 적는다. 이 축은 **줄어드는 쪽이 양수**라, 늘어나는 값을 그대로
   *  적으면 「소비속도 -100%」가 되어 줄어드는 것처럼 읽힌다. 말을 바꿔 적는다. */
  const thrFxLabel = f => (f.v < 0
    ? THR_KEY_KO[f.key] + ' +' + (-f.v) + '% 증가'
    : THR_KEY_KO[f.key] + ' ' + f.v + '%');

  /* 누적치 내성 펼침 — 접으면 「통상」 한 줄, 펴면 다섯 상황을 모두 보여 준다.
     기체 정보 화면과 같은 값이라 같은 계산(staggerByCategory)을 쓴다.
     방어 스킬 체크와는 무관하다 — 저 체크는 「지금 이 구성」의 실효값이고,
     이쪽은 「이 기체가 그 상황에서 갖는 내성」이라 섞으면 둘 다 못 읽는다. */
  const BLD_STG_KEY = 'gbo2.bldStgOpen';
  const BLD_IFLD_KEY = 'gbo2.bldIField';
  let bldStgOpen = false, bldIField = false;
  try {
    bldStgOpen = localStorage.getItem(BLD_STG_KEY) === '1';
    bldIField = localStorage.getItem(BLD_IFLD_KEY) === '1';
  } catch (e) {}
  function setBldStgOpen(v) {
    bldStgOpen = !!v;
    try { localStorage.setItem(BLD_STG_KEY, bldStgOpen ? '1' : '0'); } catch (e) {}
  }
  function setBldIField(v) {
    bldIField = !!v;
    try { localStorage.setItem(BLD_IFLD_KEY, bldIField ? '1' : '0'); } catch (e) {}
  }

  /* 무장 칸 접힘 — 파츠를 고를 때는 무장 표가 자리만 차지한다.
     방어 스킬 목록과 같은 방식으로 localStorage 에 기억한다. */
  const WEAPON_FOLD_KEY = 'gbo2.weaponFold';
  let weaponFolded = false;
  try { weaponFolded = localStorage.getItem(WEAPON_FOLD_KEY) === '1'; } catch (e) {}
  function applyWeaponFold() {
    const sec = document.querySelector('.build-weapons .panel');
    const b = $('#weaponFold');
    if (sec) sec.classList.toggle('folded', weaponFolded);
    if (b) {
      b.classList.toggle('on', weaponFolded);
      b.title = weaponFolded ? '무장 칸을 폅니다' : '무장 칸을 접습니다';
    }
  }
  function toggleWeaponFold() {
    weaponFolded = !weaponFolded;
    try { localStorage.setItem(WEAPON_FOLD_KEY, weaponFolded ? '1' : '0'); } catch (e) {}
    applyWeaponFold();
  }

  /** 누적치 스킬 체크박스 묶음 (내구 지표·피탄 시뮬 공통). onChange 는 상태 반영 후 콜백.
   *  각 스킬의 발동 조건을 라벨로 보여 주고, 동시 발동 가능한 것만 사용자가 자유롭게 체크한다. */
  function staggerCheckList(ms, lv, onChange, sel, form) {
    const on = sel || state.staggerOn;            // 적 방어 스킬은 별도 Set 을 넘겨 같은 UI 를 쓴다
    const wrap = el('div', 'stagger-skills');
    const skills = staggerSkillsOf(ms, lv, form);
    if (skills.length > 1) wrap.append(el('span', 'stg-hint', '※ 동시에 발동 가능한 조건만 체크하세요'));
    for (const s of skills) {
      const always = s.cond === '상시';       // 늘 걸리는 것은 선택지가 아니다
      const lab = el('label', 'stg-chk' + (always || on.has(s.name) ? ' on' : '') + (always ? ' locked' : ''));
      lab.title = always ? '상시 발동 — 늘 반영됩니다' : s.cond + ' 발동';
      const box = el('input'); box.type = 'checkbox'; box.checked = always || on.has(s.name);
      box.disabled = always;
      box.onchange = () => { box.checked ? on.add(s.name) : on.delete(s.name); onChange(); };
      const tags = [];
      if (s.threshold != null) tags.push(`임계 ${s.threshold}%`);
      if (s.mult < 1) tags.push(`누적 ×${+s.mult.toFixed(3)}`);
      if (s.cuts.length) tags.push(`피해 -${Math.max(...s.cuts.map(c => c.pct))}%`);
      lab.append(box, el('span', 'stg-nm', s.ko),
        el('span', 'stg-tag', tags.join(' · ')),
        el('span', 'stg-cond', s.cond));
      wrap.append(lab);
    }
    return { wrap, count: skills.length };
  }

  // 요약 카드(자동 구성 결과·저장 목록)에 공통으로 보여 주는 핵심 스탯 — 선회는 지상만
  const SUMMARY_STAT_KEYS = ['hp', 'armorRange', 'armorBeam', 'armorMelee', 'shoot',
    'meleeCorrection', 'speed', 'highSpeedMovement', 'thruster', 'turnPerformanceGround'];

  // 같은 기체의 레벨 변형 묶음 (base 이름 → 레벨 오름차순 목록)
  const msByBase = new Map();
  for (const m of msData) {
    const b = baseName(m.MS名);
    if (!msByBase.has(b)) msByBase.set(b, []);
    msByBase.get(b).push(m);
  }
  for (const arr of msByBase.values()) arr.sort((a, b) => msLevel(a) - msLevel(b));

  const state = {
    view: 'select',        // 'select'(기체 선택) | 'build'(파츠 적용)
    ms: null,
    equipped: [],
    locked: new Set(),
    banned: new Set(),      // 기본 제외한 파츠 — 영구 저장, 우클릭·모달로 토글, 모든 기체 공통
    staggerOn: new Set(),   // 켜 둔 누적치(스태거) 스킬 이름 — 내구 지표·피탄 시뮬 공통
    /* 「작전 개시 4분 경과」 — 그때 효과가 **바뀌는** 파츠를 어느 쪽으로 볼지.
       거짓이면 초반(이동), 참이면 4분 뒤(보정). 기본은 거짓이다 — 경기는 거기서 시작한다. */
    lateMode: false,
    // 켜 둔 스러스터 스킬 이름 — 상황 한정인 것만 여기 들어간다(상시는 늘 걸린다).
    thrusterOn: new Set(),
    // 무장 LV. null 이면 기체 LV 를 따라간다(게임의 기본이자 여태의 동작).
    // 숫자면 그 LV 로 무장을 본다 — 기체 LV 보다 높게는 못 간다(그런 무장은 없다).
    weaponLv: null,
    stage: 6,
    expansion: C.EXPANSION_NONE,
    expLevel: C.MAX_EXPANSION_LEVEL,   // 확장 스킬 레벨 (LV1~LV5)
    msQuery: '',
    msAttr: '',
    msCost: 'all',
    msLv: 'all',
    msRarity: 'all',
    msView: 'all',          // 'all' | 'fav'(즐겨찾기) | 'recent'(최근 사용)
    favorites: new Set(),   // 즐겨찾기한 기체 MS名 — 영구 저장
    recent: [],             // 최근 고른 기체 MS名 (최신 우선, 최대 12) — 영구 저장
    msLimit: 80,
    form: 'normal',        // 'normal' | 'transform' — 성능표를 어느 형태로 볼지
    detailPart: null,      // 상세 미리보기에 고정된 파츠
    openWeapons: [],       // 펼쳐 둔 무장 이름들 — 파츠를 갈아 끼워도 닫히지 않게 유지한다
    skillPicks: new Set(), // 발동시킨 기체 스킬의 인덱스 (여러 개를 겹칠 수 있다)
    posture: 'stand',      // 사격 자세 'stand'|'crouch'|'prone' — 무장 피해에 자세 보정을 얹는다
    scope: false,          // 스코프 조준 (자세와 별개로 얹힌다)
    weaponSort: 'default', // 무장 정렬 'default'|'power'|'dps'|'stagger'
    partTab: C.CATEGORY_ALL,
    partQuery: '',
    weights: { ...O.PRESETS['밸런스'] },
    minimums: {},
    maximums: {},           // 상한 목표 (초과 시 페널티)
    weightsTouched: false,  // 사용자가 가중치·하한·상한·프리셋을 직접 만졌는가
    running: false,
    autoCandidates: null,  // 자동 구성 후보 (최대 10개, 사용자가 고른다)
    autoExpansion: false,  // 자동 구성이 확장 스킬까지 골랐는가
    autoShown: 3,          // 결과 모달에서 지금 보여 주는 후보 수 (더보기로 늘린다)
    autoApplied: 0         // 지금 적용해 강조 중인 후보 인덱스
  };

  /**
   * 하한·상한 목표를 비운다.
   * 목표는 「HP 12000 이상」처럼 **그 기체에서만 뜻이 있는 절댓값**이라, 다른 기체로 옮기면
   * 남아 있어도 도움이 안 되고 어떤 구성으로도 못 맞춰 계속 「하한 미달」만 나온다.
   * (특히 피탄 시뮬의 「N발 버티기」는 실효 HP 를 큰 절댓값으로 박아 넣는다)
   * @returns {number} 지운 목표 수 — 알려 줄지 판단하는 데 쓴다
   */
  /** 무장 표에 실드 보정 칩을 붙일지 — 대결 시뮬의 「🛡 실드로 막음」이 켜진 동안만. */
  let showShieldMult = false;

  function clearTargets() {
    const n = Object.keys(state.minimums).length + Object.keys(state.maximums).length;
    state.minimums = {};
    state.maximums = {};
    goalHits = 0;
    goalWeapon = null;
    if (document.getElementById('autoGrid')) renderAutoGrid();
    return n;
  }

  /** 기체가 바뀌면 이전 자동 구성 후보는 무효라 지운다. */
  function clearAutoResults() {
    state.autoCandidates = null;
    state.autoExpansion = false;
    state.autoShown = 3;
    const box = document.getElementById('autoResults');
    if (box) box.innerHTML = '';
    const diag = document.getElementById('autoDiag');
    if (diag) { diag.hidden = true; diag.innerHTML = ''; }
    const note = document.getElementById('autoNote');
    if (note) note.textContent = '';
    openResultModal(false);
  }

  // 「N발 버티기」 목표를 건 적 무장. 실효 HP(ehp*) 축을 이 무장 기준으로 재려고 들고 있는다 —
  // 관통·폭풍 경감처럼 **상대 무장의 성질에 따라서만** 걸리는 파츠 경감이 있기 때문이다.
  // 목표를 지우면 같이 비운다(clearTargets).
  let goalWeapon = null;

  /**
   * 자동 구성 결과를 '커스텀 파츠와 무장 사이' 전체폭 밴드로 토글한다 (모달 오버레이가 아니라
   * 다른 패널을 가리지 않는다). 후보는 초기화(clearAutoResults) 전까지 유지되고, '닫기'는 지우지
   * 않고 밴드만 접을 뿐 — 파츠 상세 헤더의 '⚡ 자동 결과'로 다시 편다.
   */
  function openResultModal(open) {
    const panel = document.getElementById('autoResultPanel');
    const reopen = document.getElementById('autoResultShow');
    const has = !!(state.autoCandidates && state.autoCandidates.length);
    const showResult = open && has;
    if (panel) panel.hidden = !showResult;
    if (reopen) reopen.hidden = !(has && !showResult);   // 결과가 남아 있고 밴드가 접혀 있으면 재열기 버튼
  }

  const SAVE_KEY = 'gbo2-offline-build';
  const AUTHOR_KEY = 'gbo2-offline-author';   // 갤러리에 적을 이름 (이 기기에만 남는다)
  const OWNED_KEY = 'gbo2-offline-unowned';    // 기본 제외한 파츠 목록 (영구 저장)
  const FAV_KEY = 'gbo2-offline-fav';          // 즐겨찾기 기체
  const RECENT_KEY = 'gbo2-offline-recent';    // 최근 고른 기체
  const RECENT_MAX = 12;

  /** 즐겨찾기·최근 목록을 불러온다 — 사전에 없는(구버전) 기체명은 조용히 버린다. */
  function loadFavRecent() {
    const known = n => msData.some(m => m.MS名 === n);
    try { state.favorites = new Set((JSON.parse(localStorage.getItem(FAV_KEY)) || []).filter(known)); } catch { state.favorites = new Set(); }
    try { state.recent = (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).filter(known).slice(0, RECENT_MAX); } catch { state.recent = []; }
  }
  function saveFav() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites])); } catch { /* 무시 */ } }
  function saveRecent() { try { localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent)); } catch { /* 무시 */ } }
  /** 기체를 최근 목록 맨 앞으로 올린다(중복 제거·상한 유지). */
  function pushRecent(name) {
    if (!name) return;
    state.recent = [name, ...state.recent.filter(n => n !== name)].slice(0, RECENT_MAX);
    saveRecent();
  }
  function toggleFavorite(name) {
    if (state.favorites.has(name)) state.favorites.delete(name); else state.favorites.add(name);
    saveFav();
  }

  /** 기본 제외 목록을 불러온다 — 사전에 없는(구버전) 이름은 조용히 버린다. */
  function loadBanned() {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(OWNED_KEY)) || []; } catch { arr = []; }
    state.banned = new Set(arr.filter(n => partByName.has(n)));
  }
  function saveBanned() {
    try { localStorage.setItem(OWNED_KEY, JSON.stringify([...state.banned])); } catch { /* 저장 실패는 무시 */ }
  }

  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /**
   * 글 안의 숫자만 조금 키워 눈에 띄게 한다. 파츠 특성은 「사격 보정 +5」처럼
   * 설명과 수치가 한 줄에 섞여 있어, 수치를 찾으려면 문장을 읽어야 했다.
   * innerHTML 을 쓰지 않는다 — 설명문은 원본에서 온 값이라 태그가 섞여도 그대로 글자로 남아야 한다.
   * 부호·소수점·자릿점·%·배까지 한 덩어리로 잡는다 (+1.5%, 1,000, 2배).
   */
  // 단위(%·배)는 붙어 있을 때만 함께 잡는다. \s* 를 밖에 두면 단위가 없어도 뒤 공백까지
  // 삼켜서, 강조된 덩어리에 빈칸이 끼어 글자 사이가 벌어진다.
  const NUM_RE = /[+\-]?\d+(?:[.,]\d+)*(?:\s*(?:%|배))?/g;
  function withNumbers(text) {
    const frag = document.createDocumentFragment();
    const str = String(text == null ? '' : text);
    let last = 0;
    for (const m of str.matchAll(NUM_RE)) {
      if (m.index > last) frag.append(str.slice(last, m.index));
      frag.append(el('b', 'num', m[0]));
      last = m.index + m[0].length;
    }
    if (last < str.length) frag.append(str.slice(last));
    return frag;
  }

  let toastTimer = null;
  /* 토스트를 **하단 안내문 위로** 띄운다(CSS 7단계, #8).
     CSS 의 bottom:26px 은 안내문(73~96px) 한가운데라, 모든 크기에서 고지를 40px 가렸다.
     안내문 높이는 화면마다 다르고(폰은 한 줄이 더 붙는다) 폰 빌드 화면엔 아래 행동 바도 있다 —
     수를 적지 않고 **띄울 때 재서** 그 위에 둔다. CSS 값보다 낮게 내리지는 않는다. */
  function placeToast(t) {
    t.style.bottom = '';
    const base = parseFloat(getComputedStyle(t).bottom) || 0;
    let top = innerHeight;
    for (const sel of ['.app-foot', '.m-actionbar']) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const r = e.getBoundingClientRect();
      if (r.height > 0 && r.top < innerHeight && r.bottom > 0) top = Math.min(top, r.top);
    }
    const need = innerHeight - top + 10;
    if (need > base) t.style.bottom = need + 'px';
  }

  function toast(msg, action) {
    const t = $('#toast');
    t.replaceChildren(el('span', 'toast-msg', msg));
    if (action) {                       // 되돌리기처럼 토스트에서 바로 누르는 동작
      const b = el('button', 'toast-act', action.label);
      b.onclick = () => { t.classList.remove('show'); action.run(); };
      t.append(b);
    }
    raiseToTop(t);
    placeToast(t);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2200);
  }

  /** 파츠 구성 되돌리기 — 장착/해제/전체 해제 직전 상태로 한 번 되돌린다. */
  function snapshotEquip() {
    return { equipped: state.equipped.slice(), locked: new Set(state.locked) };
  }
  function restoreEquip(snap) {
    state.equipped = snap.equipped.slice();
    state.locked = new Set(snap.locked);
    renderAll();
    toast('되돌렸습니다');
  }
  const undoToast = (msg, snap) => toast(msg, { label: '되돌리기', run: () => restoreEquip(snap) });

  /* ---------- 검색 색인 ---------- */

  /**
   * 검색 색인용 글자 접기 — 키보드로 못 치는 글자를 라틴·숫자로 바꿔 함께 담는다.
   * **표시 이름은 그대로 둔다.** 「ν 건담」 을 「v 건담」 으로 쓰지는 않는다.
   *
   * 전각 그리스 ν·β·Ξ 와 로마숫자 Ⅱ·Ⅲ 은 자판에 없어서, 그대로 두면 찾을 방법이 없다.
   * 실제로 「zz」 로는 ZZ 건담이 안 나왔고 「v건담」 은 0건이었다.
   * 로마숫자는 숫자꼴과 알파벳꼴을 둘 다 만든다 — 「스나이퍼2」 와 「스나이퍼ii」 가 모두 걸리게.
   */
  const FOLD_NUM = { 'ν': 'v', 'Ζ': 'z', 'β': 'b', 'α': 'a', 'Ξ': 'xi', 'Δ': 'd',
    'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5', 'ー': '' };
  const FOLD_ROM = { ...FOLD_NUM, 'Ⅰ': 'i', 'Ⅱ': 'ii', 'Ⅲ': 'iii', 'Ⅳ': 'iv', 'Ⅴ': 'v' };
  const FOLD_RE = /[νΖβαΞΔーⅠⅡⅢⅣⅤ]/g;
  const fold = (s, tbl) => s.replace(FOLD_RE, c => tbl[c] != null ? tbl[c] : c);
  /**
   * 원문 + 접은 꼴 + 공백 뺀 꼴을 한 줄에 담아 색인으로 쓴다.
   * 공백 뺀 꼴이 없으면 「v건담」·「스나이퍼2」·「제크아인」 처럼 붙여 친 검색이 안 걸린다
   * (표시 이름이 「ν 건담」·「제크 아인」 이라 공백이 남기 때문).
   */
  const searchIndex = s => {
    const t = T.norm(s);
    const out = new Set();
    for (const v of [t, fold(t, FOLD_NUM), fold(t, FOLD_ROM)]) {
      out.add(v);
      out.add(v.replace(/\s+/g, ''));
    }
    return [...out].join(' ').toLowerCase();
  };

  /**
   * 검색어도 공백을 무시하고 맞춘다 — 색인에 공백 뺀 꼴이 들어 있으므로,
   * 「자쿠 Ⅱ」 처럼 띄어 쳐도 「자쿠Ⅱ」 를 찾게 된다(표기를 붙여 쓰기로 바꾼 뒤 필요해졌다).
   */
  const matches = (idx, q) => idx.includes(q) || (/\s/.test(q) && idx.includes(q.replace(/\s+/g, '')));

  const msSearchText = new Map(msData.map(m =>
    [m, searchIndex(T.msName(m.MS名) + ' ' + m.MS名)]));
  const partSearchText = new Map(allParts.map(p => [p,
    searchIndex(T.partName(p.name) + ' ' + p.name + ' ' + T.partDesc(p.name, p.description))]));

  const EQUIP_REASON = {
    equipped: () => '이미 장착됨',
    full: () => '슬롯 8개 가득 참',
    category: attr => `${T.attrName(attr)} 전용`,
    kind: kind => `${T.kindName(kind)} 계열 중복`,
    banned: () => '기본 제외',
    effect: name => `${T.partName(name)} 효과 중복`,
    movement: () => '스피드/선회 중복',
    slotClose: () => '근접 슬롯 부족',
    slotMid: () => '중거리 슬롯 부족',
    slotLong: () => '원거리 슬롯 부족'
  };
  const reasonText = chk => (chk.code ? EQUIP_REASON[chk.code](chk.param) : '');

  /** 파츠 표시용 파생값 — 상세 패널과 목록 타일이 같은 규칙을 쓰도록 한곳에 둔다. */
  /* ---------- 계산에 안 들어가는 효과 ----------
   * 파츠 설명은 위키 원문 그대로 보여 주는데, 그중에는 **앱이 아예 모델링하지 않는 축**이
   * 섞여 있다. 그대로 두면 사용자는 효과가 있는 줄 알고 슬롯을 쓴다 —
   * 「다리 특수 장갑 LV4」는 근5 중2 를 먹고 「피해 7% 경감」이라 적혀 있는데
   * 실제로는 어떤 수치도 움직이지 않는다.
   *
   * 미구현이라 나쁜 것이 아니다. 전부 **일부러 안 다루기로 한 축**이다:
   *   · 부위(국부) — 부위 파괴를 모델링하지 않는다. 08-31 사용자 결정(재론 금지).
   *   · 상태이상 시간 — 지속·회복 시간을 다루지 않는다.
   * 잘못은 그 사실을 **말하지 않는 것**이다. 강화 단계 화면은 이미 밝히고 있는데
   * (「이 효과는 계산에 반영되지 않습니다」) 커스텀 파츠에만 없었다.
   *
   * 새 축을 구현하면 여기서 그 줄을 지운다 — 남겨 두면 거짓말이 된다.
   * tools/part_effect_check.js 가 이 표와 실제 동작을 대조한다. */
  const UNMODELLED_FX = [
    { re: /に充てられるHP/, ko: '부위 HP 비율',
      why: '다리·머리·등이 따로 가진 HP 는 다루지 않습니다(부위 파괴 미모델링).' },
    { re: /被弾時[、,]?\s*機体HPへのダメージを/, ko: '부위 피격 경감',
      why: '그 부위에 맞았을 때만 걸리는 값이라, 어디에 맞는지 알 수 없는 시뮬레이터에서는 반영하지 않습니다.' },
    { re: /部位ダメージ量/, ko: '부위 피해량',
      why: '부위 파괴 쪽 값이라 기체 HP 피해에는 영향이 없습니다.' },
    { re: /状態異常の回復時間/, ko: '상태이상 회복 시간',
      why: '상태이상의 시간 축은 다루지 않습니다.' },
    /* 교육형 컴퓨터[特防] — 4분 뒤 「자기가 경직 중일 때만」 받는 피해 −10% 추가(2026-10-20 판단).
       상시 수치가 아니고, 대결에도 「경직 중인가」 상태가 없어 넣으면 늘 걸리거나 늘 안 걸리는 거짓이 된다. */
    { re: /4分経過すると[、,]?\s*自機がよろけている場合/, ko: '4분 뒤 경직 중 피해 경감', partial: true,
      why: '자기가 경직 중일 때만 걸리는 값이라 반영하지 않습니다. 「4분 경과」 를 켜도 기본 −10% 만 계산합니다.' }
  ];

  /** 이 파츠 설명에서 계산에 안 들어가는 효과들. 없으면 빈 배열. */
  function unmodelledOf(part) {
    const d = String((part && part.description) || '');
    return UNMODELLED_FX.filter(x => x.re.test(d));
  }

  function partView(p) {
    const lv = lvOf(p.name);
    const fullNm = T.partName(p.name);
    return {
      lv,
      fullNm,
      shortNm: lv ? fullNm.replace(/\s*LV\d+\s*$/i, '') : fullNm,
      desc: T.partDesc(p.name, p.description),
      cat: C.CATEGORY_LABEL[p.category] || '',
      slotTxt: [['근', p.close], ['중', p.mid], ['원', p.long]]
        .filter(([, v]) => v).map(([l, v]) => l + v).join(' ') || '슬롯 0'
    };
  }

  /* ---------- 파생값 ---------- */

  const slots = () => C.calcSlots(state.ms, state.equipped, state.stage, fullst);

  /* ---------- 기체 스킬 ---------- */

  /** 현재 기체가 가진 버프 스킬 목록. */
  const msBuffSkills = () => (state.ms && skillData[baseName(state.ms.MS名)]) || [];

  /** 지금 발동시킨 스킬들. */
  function activeSkills() {
    const list = msBuffSkills();
    return [...state.skillPicks].sort((a, b) => a - b).map(i => list[i]).filter(Boolean);
  }

  /**
   * 스킬 수치는 기체 LV 구간마다 다르다 (「LV1～」「LV4～」).
   * 지금 기체 LV 이 들어가는 구간 중 가장 높은 것을 쓴다.
   */
  function skillLevel(sk) {
    if (!sk || !sk.levels.length) return null;
    const lv = state.ms ? msLevel(state.ms) : 1;
    const fit = sk.levels.filter(l => lv >= l.from && (l.to == null || lv <= l.to));
    // 기체 LV 이 스킬 요구 LV 에 못 미치면 그 스킬은 아직 못 쓴다 (예: 백식 LV1 의 LV4 스킬)
    return fit.length ? fit[fit.length - 1] : null;
  }

  /** 지금 기체 LV 에서 실제로 쓸 수 있는 스킬만 (인덱스와 함께). */
  const availableSkills = () =>
    msBuffSkills().map((sk, i) => ({ sk, i })).filter(x => skillLevel(x.sk) != null);

  /**
   * 발동시킨 스킬들의 효과 합계. 아무것도 안 골랐으면 null.
   * 피해 % 는 걸리는 대상이 갈린다 — `any` 는 사격·격투 모두에 얹는다.
   */
  function skillEffect() {
    const list = activeSkills();
    if (!list.length) return null;
    const sum = { shoot: 0, melee: 0, shootPct: 0, meleePct: 0, crouchPct: 0, limitUp: 0,
      dmgAny: 0, dmgShoot: 0, dmgMelee: 0,
      armorRange: 0, armorBeam: 0, armorMelee: 0, speed: 0, hispeed: 0, thruster: 0, turn: 0, hpUp: 0,
      count: list.length };
    for (const sk of list) {
      const e = skillLevel(sk);
      if (!e) continue;
      sum.shoot += e.shoot;
      sum.melee += e.melee;
      sum.shootPct += e.shootPct;
      sum.meleePct += e.meleePct;
      sum.crouchPct += e.crouchPct || 0;
      sum.limitUp += e.limitUp || 0;
      sum.dmgAny += e.dmgAny;
      sum.dmgShoot += e.dmgShoot;
      sum.dmgMelee += e.dmgMelee;
      sum.armorRange += e.armorRange || 0;
      sum.armorBeam += e.armorBeam || 0;
      sum.armorMelee += e.armorMelee || 0;
      sum.speed += e.speed || 0;
      sum.hispeed += e.hispeed || 0;
      sum.thruster += e.thruster || 0;
      sum.turn += e.turn || 0;
      sum.hpUp += e.hpUp || 0;
    }
    return sum;
  }

  /**
   * 발동한 스킬들의 피해 % 를 "스킬별로" 돌려준다 (곱연산용).
   * 최대출력·레이즈 카운터 등 여러 스킬의 피해 증가는 서로 합산이 아니라 각각 곱해진다.
   */
  function skillDmgPctList(kind) {
    return activeSkills().map(sk => {
      const e = skillLevel(sk) || {};
      return (e.dmgAny || 0) + (kind === 'melee' ? (e.dmgMelee || 0) : (e.dmgShoot || 0));
    }).filter(p => p);
  }

  /**
   * calcStats 에 넘길 스탯 가산분. 피해 % 는 스탯이 아니라 무장 쪽에서 쓴다.
   * 사격/격투 보정 % (ZERO 시스템)는 스킬을 뺀 총보정에 곱해 정수로 더한다.
   * (ZERO 는 상한도 올리지만 그 폭이 위키에 없어, 여기서는 통상 상한을 그대로 둔다)
   */
  function skillStatBonus() {
    const e = skillEffect();
    if (!e) return null;
    let shoot = e.shoot, melee = e.melee;
    if (e.shootPct || e.meleePct) {
      const bare = stats(null).total;
      shoot += Math.round(bare.shoot * e.shootPct / 100);
      melee += Math.round(bare.meleeCorrection * e.meleePct / 100);
    }
    // 방어·기동·HP 발동 버프 (바이오센서 등) — 해당 스탯에 그대로 더한다(상한은 calcStats 가 적용).
    const out = {};
    if (shoot) out.shoot = shoot;
    if (melee) out.meleeCorrection = melee;
    if (e.armorRange) out.armorRange = e.armorRange;
    if (e.armorBeam) out.armorBeam = e.armorBeam;
    if (e.armorMelee) out.armorMelee = e.armorMelee;
    if (e.speed) out.speed = e.speed;
    if (e.hispeed) out.highSpeedMovement = e.hispeed;
    if (e.thruster) out.thruster = e.thruster;
    if (e.turn) { out.turnPerformanceGround = e.turn; out.turnPerformanceSpace = e.turn; }
    if (e.hpUp) out.hp = e.hpUp;
    if (!Object.keys(out).length) return null;
    // ZERO 시스템은 발동 중 사격·격투 상한도 올린다 (파츠로 상한 근처까지 올린 구성에서 차이가 난다)
    if (e.limitUp) out.limit = { shoot: e.limitUp, meleeCorrection: e.limitUp };
    return out;
  }

  /** 스킬 몫을 칠할 클래스 — 하나면 보라, 겹쳐 발동하면 청록. */
  const skillCls = () => (state.skillPicks.size > 1 ? ' multi' : '');

  const stats = (skill = skillStatBonus()) =>
    C.calcStats(state.ms, state.equipped, state.stage, state.expansion, partsByCat, fullst,
      state.expLevel, state.form, skill, wantWeaponLv(), state.lateMode);


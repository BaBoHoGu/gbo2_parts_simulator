  /* ui/15-render.js — 렌더(한꺼번에 다시 그리기).
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 렌더 ---------- */

  function renderHero() {
    const m = state.ms;
    const hero = $('#heroImg');
    if (m) {
      hero.onerror = () => { hero.onerror = null; hero.src = defaultImg('ms'); };
      hero.src = msImg(m.MS名);
      hero.style.visibility = '';
    } else {
      hero.style.visibility = 'hidden';
    }

    // 기체 이름은 위키 페이지로 이어 준다. 주소는 데이터에 기체마다 들어 있다(wiki_url).
    // 없는 기체가 나올 수 있으니(추가분 등) 그때는 그냥 글자로 둔다 — 죽은 링크보다 낫다.
    const nameBox = $('#heroName');
    nameBox.innerHTML = '';
    if (!m) { nameBox.textContent = '기체를 선택하세요'; }
    else if (m.wiki_url) {
      const a = el('a', 'hero-wiki', T.msName(m.MS名));
      a.href = m.wiki_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = '위키에서 이 기체 보기 (새 창)';
      nameBox.append(a);
    } else {
      nameBox.textContent = T.msName(m.MS名);
    }

    const sub = $('#heroSub');
    sub.innerHTML = '';
    if (!m) return;
    sub.append(attrMark(m.属性));
    sub.append(el('span', '', T.attrName(m.属性)));
    sub.append(el('span', '', '·'));
    sub.append(el('span', 'cost-badge', '코스트 ' + m.コスト));
    const r = msRarity(m);
    if (r) {
      sub.append(el('span', '', '·'));
      sub.append(rarityChip(r));   // 기체 카드와 같은 표기
    }

    // 출격 가능 · 환경 적성 · 격투 판정력 — 기체 정보 화면과 같은 줄을 쓴다.
    factsInto(m, $('#heroFacts'), $('#heroFacts2'));
  }

  /**
   * 출격 가능 · 환경 적성 · 격투 판정력을 두 줄에 그린다.
   * 성능 머리(heroFacts)와 기체 정보 화면(infoFacts)이 **같은 렌더러**를 쓴다 —
   * 따로 그리면 한쪽만 표기가 어긋난다(그런 버그를 여러 번 고쳤다).
   * @param {object} m   기체
   * @param {Element} line   첫 줄 (출격·적성)
   * @param {Element} line2  둘째 줄 (격투 판정력). 없으면 첫 줄에 이어 붙인다.
   */
  function factsInto(m, line, line2) {
    if (!line) return;
    line.innerHTML = '';
    if (line2) line2.innerHTML = '';
    if (!m) return;
    let target = line;
    // 값 안의 낱말마다 색을 줄 수 있게, 문자열이 아니라 조각 배열을 받는다.
    const add = (lb, parts, cls) => {
      const b = el('span', 'hf' + (cls ? ' ' + cls : ''));
      b.append(el('i', '', lb));
      const v = el('b');
      parts.forEach((x, i) => {
        // 가운뎃점은 값이 나란히 놓일 때만 (지상 · 우주).
        // 「페이즈1 시:」 뒤에 끼면 「페이즈1 시: · 중」이 된다.
        if (i) {
          const both = typeof x !== 'string' && typeof parts[i - 1] !== 'string';
          v.append(document.createTextNode(both ? ' · ' : ' '));
        }
        if (typeof x === 'string') v.append(document.createTextNode(x));
        else {
          const c = el('span', x.cls, x.t);
          ICON.prepend(c, ENV_IC[x.cls]);
          v.append(c);
        }
      });
      b.append(v);
      target.append(b);
    };
    // 지상·우주·수중은 화면 곳곳에서 같은 색을 쓴다 — 여기서도 맞춘다.
    const envChip = t => ({ t, cls: 'env-' + (t === '지상' ? 'g' : t === '우주' ? 's' : 'w') });

    const sortie = [m['出撃_地上可'] !== false && '지상', m['出撃_宇宙可'] !== false && '우주'].filter(Boolean);
    // sortie — 접힌 기체 칸(낮은 데스크톱)에서는 이 칩만 뺀다(style.css 「낮은 데스크톱」 절)
    add('출격', sortie.length ? sortie.map(envChip) : ['—'], 'sortie');
    const adapt = [m['環境適正_地上'] && '지상', m['環境適正_宇宙'] && '우주', m['環境適正_水中'] && '수중'].filter(Boolean);
    add('적성', adapt.length ? adapt.map(envChip) : ['없음'], adapt.length ? 'on' : '');

    // 판정력은 「通常：中 スキル発動時： 強」처럼 조건이 붙은 기체가 18기 있다.
    // 조건까지 그대로 적으면 길어서, 기본값만 색으로 보이고 조건은 「… 시 상승」으로 줄인다.
    // 다만 조건 쪽이 더 낮거나 같으면 줄이지 않고 값을 적는다 — 줄이면 거짓이 된다.
    const JD_WORDS = [
      ['スキル発動時', '스킬 발동 시'], ['システム発動中', '시스템 발동 중'],
      ['共振発動時', '공진 발동 시'], ['変身時', '변신 시'],
      ['発動中', '발동 중'], ['使用後', '사용 후'], ['射出', '사출'],
      ['フェイズ', '페이즈'], ['通常時', '통상'], ['通常', '통상'],
      ['かつ', ' '], ['以下', ' 이하'], ['HP', 'HP '],
      ['強', '강'], ['中', '중'], ['弱', '약'],
    ];
    // 「強＋」는 강과 별개 단계가 아니라 강보다 한 칸 위다 — 강(3.5) 로 적는다.
    const jdText = v => (v === '강+' ? '강(3.5)' : v);
    const jdClass = v => 'jd-' + ({ '약': 'w', '중': 'm', '강': 's', '강+': 'x' }[v] || 'm');
    target = line2 || line;            // 판정력은 둘째 줄로 — 출격·적성과 성격이 다르다
    const jdRaw = String(m['格闘判定力'] || '').trim();
    if (jdRaw) {
      // 「S・ノズル制御機構（G）」 같은 스킬 이름이 문장 안에 박혀 있다.
      // 통째로 조회하면 안 걸리므로, 긴 이름부터 문장 안에서 갈아 끼운다.
      let t = jdRaw;
      for (const nm of skillNamesByLen()) if (t.includes(nm)) t = t.split(nm).join(skTr(nm));
      for (const [ja, ko] of JD_WORDS) t = t.split(ja).join(ko);
      t = t.replace(/[：:]/g, ':').replace(/［/g, '[').replace(/］/g, ']')
        .replace(/（/g, '(').replace(/）/g, ')').replace(/＋/g, '+').replace(/\s+/g, ' ').trim();

      const segs = [...t.matchAll(/([^:]+):\s*(강\+|강|중|약)/g)].map(x => [x[1].trim(), x[2]]);
      if (!segs.length) {
        // 조건 없는 단일 값
        const v = /강\+|강|중|약/.exec(t);
        add('격투 판정력', [v ? { t: jdText(v[0]), cls: jdClass(v[0]) } : t]);
      } else {
        const base = segs[0][1];
        const parts = [{ t: jdText(base), cls: jdClass(base) }];
        // 원문에 적힌 값을 그대로 적는다 — 「상승」처럼 없는 말을 지어내지 않는다.
        // 조건 문구가 이미 「… 시」·「… 중」으로 끝나면 「시」를 또 붙이지 않는다.
        const when = c => (/(시|중|후|이하)$/.test(c) ? c : c + ' 시');
        for (const [cond, val] of segs.slice(1)) {
          parts.push('/ ' + when(cond) + ':');
          parts.push({ t: jdText(val), cls: jdClass(val) });
        }
        add('격투 판정력', parts);
      }
    }
  }


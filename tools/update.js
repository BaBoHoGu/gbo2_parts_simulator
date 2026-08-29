// 신규/변경 기체를 감지해 데이터를 받고 추출·재빌드까지 자동으로 한다.
//   node tools/update.js            감지 → 변경 있으면 받기·추출·재빌드
//   node tools/update.js --check    감지만 하고 리포트 (반영 안 함)
//
// 출처
//   기체 스탯·wiki_url : https://gbo2.jp/data/msData.json  (공식 데이터 미러)
//   커스텀 파츠·강화   : gbo2.jp 앱 번들 (/assets/index-*.js)
//   무장·스킬·격투방향 : 일본 위키 (raw/wiki, msData 의 wiki_url 로 받음)
//   이미지             : gbo2.jp/images
const fs = require('fs');
const path = require('path');
const https = require('https');
const { resolvePageIds, nameKey, fetchWikiUrl } = require('./lib/wiki_fetch.js');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REMOTE = path.join(ROOT, 'raw', 'remote');
const CHECK_ONLY = process.argv.includes('--check');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const rdJson = (...p) => JSON.parse(rd(...p));

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const run = (script, args = []) => {
  console.log(`\n▶ ${script} ${args.join(' ')}`.trimEnd());
  execFileSync(process.execPath, [path.join('tools', script), ...args], { cwd: ROOT, stdio: 'inherit' });
};

// 실패해도 예외를 던지지 않고 종료 코드만 돌려준다 (검증처럼 "실패=경고"인 단계용).
const runSoft = (script, args = []) => {
  console.log(`\n▶ ${script} ${args.join(' ')}`.trimEnd());
  try { execFileSync(process.execPath, [path.join('tools', script), ...args], { cwd: ROOT, stdio: 'inherit' }); return 0; }
  catch (e) { return e.status ?? 1; }
};

const pageId = url => (String(url || '').match(/pages\/(\d+)\.html/) || [])[1];
// 변경 감지에 쓰는 계산 관련 필드 (표기·설명 등 잡음은 뺀다)
const STAT_KEYS = ['属性', 'コスト', 'HP', '耐実弾補正', '耐ビーム補正', '耐格闘補正',
  '射撃補正', '格闘補正', 'スピード', '高速移動', 'スラスター',
  '旋回_地上_通常時', '旋回_宇宙_通常時', '近スロット', '中スロット', '遠スロット'];

// 적용한 밸런스 패치 날짜 기록 (새 패치가 있을 때만 해당 기체 페이지를 다시 받는다)
const PATCH_FILE = path.join(ROOT, 'data', 'patch.json');
const readPatchApplied = () => { try { return rdJson('data', 'patch.json').applied || ''; } catch { return ''; } };

/**
 * 위키 첫 페이지의 「パラメータ調整」(밸런스 패치) 목록을 읽어,
 * 최근 패치들의 날짜와 조정된 "기체 페이지" ID(현재 msData 에 있는 것만)를 돌려준다.
 * 무장 밸런스 변경은 기체 스탯이 안 바뀌어 다른 방법으론 못 잡는다 — 이 목록이 유일한 신호.
 */
async function detectPatch(msList) {
  try {
    // 평문 https 는 Cloudflare 가 403 을 준다(실측). try/catch 가 이를 삼켜
    // '패치 없음'으로 조용히 넘어가는 바람에, 위키에 올라온 밸런스 조정이
    // 하나도 반영되지 않고 있었다. 헤드리스 경로로 받는다.
    const html = await fetchWikiUrl('https://w.atwiki.jp/battle-operation2/');
    if (!html) { console.log('  ⚠ 위키 첫 페이지를 받지 못해 밸런스 패치 감지를 건너뜁니다.'); return { date: '', ids: [] }; }
    const start = html.search(/パラメータ調整/);
    if (start < 0) { console.log('  ⚠ 위키에서 「パラメータ調整」 목록을 찾지 못했습니다.'); return { date: '', ids: [] }; }
    const rest = html.slice(start + 10);
    const endRel = rest.search(/<h3[ >]/);            // 다음 대분류 전까지
    const seg = endRel < 0 ? rest : rest.slice(0, endRel);
    const date = [...seg.matchAll(/(\d{8})アプデ分/g)].map(m => m[1]).sort().pop() || '';
    const msIds = new Set();
    for (const m of msList) { const id = (String(m.wiki_url || '').match(/pages\/(\d+)/) || [])[1]; if (id) msIds.add(id); }
    const ids = [...new Set([...seg.matchAll(/pages\/(\d+)\.html/g)].map(m => m[1]))].filter(id => msIds.has(id));
    return { date, ids };
  } catch (e) { return { date: '', ids: [], error: e.message }; }
}

(async () => {
  fs.mkdirSync(REMOTE, { recursive: true });
  console.log('■ gbo2.jp 최신 데이터를 확인합니다…');

  // 1) 원격 msData 내려받아 비교
  const remoteBuf = await get('https://gbo2.jp/data/msData.json');
  fs.writeFileSync(path.join(REMOTE, 'msData.json'), remoteBuf);
  const remote = JSON.parse(remoteBuf.toString('utf8'));
  const local = rdJson('data', 'msData.json');

  const localByName = new Map(local.map(m => [m.MS名, m]));
  const remoteNames = new Set(remote.map(m => m.MS名));

  const added = remote.filter(m => !localByName.has(m.MS名));
  const removed = local.filter(m => !remoteNames.has(m.MS名));
  const changed = [];
  for (const m of remote) {
    const o = localByName.get(m.MS名);
    if (!o) continue;
    const diff = STAT_KEYS.filter(k => m[k] !== o[k]);
    // 강화리스트(fullst)만 리밸런싱돼도 감지되도록 함께 비교한다.
    if (JSON.stringify(m.fullst) !== JSON.stringify(o.fullst)) diff.push('fullst');
    if (diff.length) changed.push({ ms: m, diff });
  }

  // 2) 앱 번들(파츠·강화) 변경 확인 — 번들을 받아 임시 폴더에 추출하고 내용을 실제 대조한다
  let partsChanged = false, remoteAppOk = false;
  try {
    const home = (await get('https://gbo2.jp/')).toString('utf8');
    const asset = (home.match(/\/assets\/index-[\w-]+\.js/) || [])[0];
    if (asset) {
      const bundle = await get('https://gbo2.jp' + asset);
      fs.writeFileSync(path.join(REMOTE, 'app.js'), bundle);
      remoteAppOk = true;
      const tmp = path.join(REMOTE, 'extract');
      fs.mkdirSync(tmp, { recursive: true });
      execFileSync(process.execPath,
        [path.join('tools', 'extract_data.js'), path.join(REMOTE, 'app.js'), tmp],
        { cwd: ROOT, stdio: 'ignore' });
      const same = f => fs.existsSync(path.join(tmp, f)) &&
        fs.readFileSync(path.join(tmp, f), 'utf8') === fs.readFileSync(path.join(ROOT, 'data', f), 'utf8');
      partsChanged = !(same('parts.json') && same('fullst.json'));
      const cnt = j => Object.values(JSON.parse(fs.readFileSync(path.join(tmp, j), 'utf8'))).reduce((a, b) => a + b.length, 0);
      const localCnt = Object.values(rdJson('data', 'parts.json')).reduce((a, b) => a + b.length, 0);
      console.log(`  파츠: 현재 ${localCnt}개 / 원격 ${cnt('parts.json')}개` + (partsChanged ? '  ← 변경' : ''));
    }
  } catch (e) {
    console.log('  (앱 번들 확인 건너뜀: ' + e.message + ')');
  }

  // 2.5) 위키 밸런스 패치 감지 — 무장 누적치·위력 등은 기체 스탯이 안 바뀌어 msData 로는
  //      못 잡는다. 위키 첫 페이지의 「パラメータ調整」 목록(조정 기체)만 보고, 새 패치면
  //      해당 기체 페이지만 다시 받아 무장을 갱신한다. (전체 재수신 불필요)
  const patch = await detectPatch(remote);
  const patchApplied = readPatchApplied();
  const patchNew = !!(patch.date && patch.date !== patchApplied);

  // 3) 리포트
  console.log('\n■ 변경 요약');
  console.log(`  기체  현재 ${local.length} / 원격 ${remote.length}`);
  console.log(`  신규  ${added.length}`);
  added.forEach(m => console.log(`     + ${m.MS名}  (${m.属性} 코스트${m.コスト})  ${m.wiki_url}`));

  // wiki_url 이 빈 기체는 무장·스킬을 못 받아온다(gbo2.jp 가 링크 없이 넣는 신기체 — 예: ゴトラタン).
  // override 에 wiki_url 을 넣으면 extract 가 매핑하므로, 안 넣은 것만 경고한다.
  {
    let ov = {}; try { ov = rdJson('data', 'msData.override.json'); } catch { /* 없어도 됨 */ }
    const noUrl = remote.filter(m => !String(m.wiki_url || '').trim() && !(ov[m.MS名] && ov[m.MS名].wiki_url));
    if (noUrl.length) {
      console.log(`  ⚠ wiki_url 없음 ${noUrl.length}기 — 이대로면 무장·스킬이 누락됩니다.`);
      console.log(`     위키에서 페이지 ID 를 찾아 data/msData.override.json 에 "wiki_url" 을 넣으세요:`);
      noUrl.slice(0, 10).forEach(m => console.log(`     ! ${m.MS名}  (${m.属性} 코스트${m.コスト})`));
    }
  }
  console.log(`  스탯 변경  ${changed.length}`);
  changed.slice(0, 20).forEach(c => {
    const o = localByName.get(c.ms.MS名);
    // fullst 는 객체 배열이라 값 대신 라벨만 보여 준다
    const parts = c.diff.map(k => k === 'fullst' ? '강화리스트' : `${k} ${o[k]}→${c.ms[k]}`);
    console.log(`     ~ ${c.ms.MS名}: ${parts.join(', ')}`);
  });
  if (changed.length > 20) console.log(`     … 외 ${changed.length - 20}건`);
  console.log(`  삭제  ${removed.length}` + (removed.length ? '  ' + removed.slice(0, 5).map(m => m.MS名).join(', ') : ''));
  console.log(`  파츠 변경  ${partsChanged ? '있음' : '없음'}`);
  console.log(`  밸런스 패치  ${patch.date || '(확인 실패)'}`
    + (patchNew ? `  ← 새 패치 (조정 기체 ${patch.ids.length}개 무장 갱신)` : ' (이미 반영)'));

  // 무장·스킬이 비어 있거나 wiki_url 이 없는 기체를 매 실행 재점검한다(A·진단).
  // → gbo2.jp 가 먼저 패치되고 위키가 늦어도, 위키가 채워지는 다음 실행에서 자동 완성된다.
  const baseName = n => String(n).replace(/_LV\d+$/, '');
  let ovNow = {}; try { ovNow = rdJson('data', 'msData.override.json'); } catch { /* 없어도 됨 */ }
  const weapNow = (() => { try { return rdJson('data', 'weapons.json'); } catch { return {}; } })();
  const sklNow = (() => { try { return rdJson('data', 'ms_skills.json'); } catch { return {}; } })();
  const urlOf = m => (ovNow[m.MS名] && ovNow[m.MS名].wiki_url) || m.wiki_url || '';
  // M1: 받아봤지만 위키가 여전히 빈 페이지는 24시간 재시도 안 함 → 미완성 기체가 있어도
  //     매 실행 전체 재빌드로 폭주하지 않게 한다(run.ps1 을 실제로 "가볍게" 유지).
  const RETRY_MS = 24 * 3600 * 1000;
  let attempts = {}; try { attempts = rdJson('data', 'wiki_attempts.json'); } catch { /* 없어도 됨 */ }
  const triedRecently = key => attempts[key] && (Date.now() - attempts[key] < RETRY_MS);

  const emptyUrlAll = remote.filter(m => !String(urlOf(m)).trim());
  const emptyUrlMechs = emptyUrlAll.filter(m => !triedRecently('n:' + m.MS名));   // 이번에 조회할 것
  const seenBase = new Set();
  const staleAll = remote.filter(m => {
    const b = baseName(m.MS名); if (seenBase.has(b)) return false; seenBase.add(b);
    const id = pageId(urlOf(m)); if (!id) return false;      // 빈 url 은 emptyUrl 이 담당
    return !weapNow[id] || !(weapNow[id].weapons || []).length || !sklNow[b];
  });
  const staleMechs = staleAll.filter(m => !triedRecently('p:' + pageId(urlOf(m))));
  const skipped = (emptyUrlAll.length - emptyUrlMechs.length) + (staleAll.length - staleMechs.length);

  if (emptyUrlAll.length) {
    console.log(`  ⚠ wiki_url 없음  ${emptyUrlAll.length}기 (무장·스킬 누락)`
      + (emptyUrlMechs.length ? ' — 위키에서 페이지 자동 조회 시도' : ''));
    emptyUrlAll.slice(0, 8).forEach(m => console.log(`     ! ${m.MS名}  (${m.属性} 코스트${m.コスト})`));
  }
  if (staleAll.length) console.log(`  ⚠ 무장/스킬 누락  ${staleAll.length}기`
    + (staleMechs.length ? ` — ${staleMechs.length}기 재수신` : ''));
  if (skipped) console.log(`  (최근 24h 시도했으나 위키가 여전히 빈 ${skipped}건은 건너뜀 — data/wiki_attempts.json)`);

  const nothing = !added.length && !changed.length && !removed.length && !partsChanged && !patchNew
    && !emptyUrlMechs.length && !staleMechs.length;
  if (nothing) { console.log('\n✔ 이미 최신 상태입니다.'); return; }
  if (CHECK_ONLY) { console.log('\n(--check: 감지만 하고 반영하지 않았습니다. 반영하려면 --check 없이 실행하세요.)'); return; }

  // 4) 반영 — 변경 종류에 따라 필요한 단계만 실행한다.
  console.log('\n■ 변경을 반영합니다…');
  const msChanged = added.length || changed.length || removed.length;

  // (a) 파츠·강화 (앱 번들이 바뀐 경우)
  if (partsChanged && fs.existsSync(path.join(REMOTE, 'app.js'))) {
    fs.copyFileSync(path.join(REMOTE, 'app.js'), path.join(ROOT, 'raw', 'app.js'));
    run('extract_data.js');
    // 번들이 바뀌면 계산 로직도 바뀔 수 있다 — 대조 기준을 새 번들에서 다시 뽑아 둔다.
    run('extract_original_calc.js');
  }

  // (b0) 미러가 내린 기체 보험 — 위키에 아직 있으면 지우지 않고 보관한다.
  //
  // gbo2.jp 는 갓 나온 기체를 잠깐 실었다가 내리는 일이 있다(2026-08-28 ガンダムDX).
  // msData.json 을 원격으로 통째로 덮어쓰기 때문에, 그대로 두면 앱에서도 사라진다.
  // 위키에 남아 있으면 additions 로 옮겨 살려 두고, 미러가 다시 실으면 build 가
  // 같은 이름을 보고 추가분을 자동으로 무시한다.
  //
  // 위키 조회 자체가 실패하면(Cloudflare·Chrome 없음) '모르는 상태'이므로 전부 보관한다.
  // 잘못 지우는 쪽이 잘못 남기는 쪽보다 나쁘다.
  if (removed.length) {
    let map = null, lookupFailed = false;
    try { map = await resolvePageIds(); } catch { lookupFailed = true; }
    if (!map || !map.size) lookupFailed = true;

    const keep = [], gone = [];
    for (const m of removed) {
      const base = String(m.MS名).replace(/_LV\d+$/, '');
      const onWiki = !lookupFailed && (map.has(base) || map.has(nameKey(base)));
      (lookupFailed || onWiki ? keep : gone).push(m);
    }

    if (keep.length) {
      const ADD = path.join(ROOT, 'data', 'msData.additions.json');
      let adds = []; try { adds = JSON.parse(fs.readFileSync(ADD, 'utf8')); } catch { adds = []; }
      const have = new Set(adds.map(x => x.MS名));
      let n = 0;
      for (const m of keep) {
        if (have.has(m.MS名)) continue;
        adds.push({ ...m, _keptFromMirror: true,
          _source: `gbo2.jp 미러에서 사라져 보관 (${new Date().toISOString().slice(0, 10)}).`
            + (lookupFailed ? ' 위키 조회 실패로 보수적으로 남김.' : ' 위키에는 아직 있음.') });
        n++;
      }
      if (n) {
        fs.writeFileSync(ADD, JSON.stringify(adds, null, 1) + '\n');
        console.log(`  · 미러에서 사라진 ${n}기를 msData.additions 에 보관했습니다`
          + (lookupFailed ? ' (위키 조회 실패 — 보수적으로 전부 보관)' : ' (위키에 아직 있음)')
          + `: ${keep.slice(0, 5).map(m => m.MS名).join(', ')}`);
      }
    }
    if (gone.length) {
      console.log(`  · 위키에도 없어 그대로 삭제: ${gone.map(m => m.MS名).join(', ')}`);
    }
  }

  // (b) 기체 스탯이 바뀐 경우에만 msData 교체
  if (msChanged) fs.copyFileSync(path.join(REMOTE, 'msData.json'), path.join(ROOT, 'data', 'msData.json'));

  // (b2) 빈 wiki_url 자동 해소 (B) — 위키 機体一覧 에서 기체명 → 페이지ID 를 찾아 override 에 기록.
  //      gbo2.jp 가 링크 없이 넣은 기체(ゴトラタン 등)를 사람 손 없이 연결한다.
  if (emptyUrlMechs.length) {
    try {
      const map = await resolvePageIds();
      let n = 0;
      for (const m of emptyUrlMechs) {
        // 정확 일치 → 전각/반각 정규화 순으로 찾는다(gbo2 ゲルググＲ ↔ 위키 ゲルググR).
        const id = map.get(baseName(m.MS名)) || map.get(m.MS名)
          || map.get(nameKey(baseName(m.MS名))) || map.get(nameKey(m.MS名));
        if (!id) continue;
        ovNow[m.MS名] = { ...(ovNow[m.MS名] || {}), wiki_url: `https://w.atwiki.jp/battle-operation2/pages/${id}.html` };
        console.log(`     ↳ wiki_url 자동 연결: ${m.MS名} → pages/${id}`);
        n++;
      }
      if (n) fs.writeFileSync(path.join(ROOT, 'data', 'msData.override.json'), JSON.stringify(ovNow, null, 1) + '\n');
      const still = emptyUrlMechs.filter(m => !(ovNow[m.MS名] && ovNow[m.MS名].wiki_url));
      if (still.length) console.log(`     (위키에서 못 찾음 ${still.length}기 — 수동 override 필요: ${still.slice(0, 5).map(m => m.MS名).join(', ')})`);
    } catch (e) {
      console.log('  wiki_url 자동 조회 실패:', e.message, '— 수동으로 data/msData.override.json 에 wiki_url 을 넣으세요.');
    }
  }

  // (c) 위키·무장·스킬 — 신규/변경 기체 + 새 패치로 조정된 기체 + 무장/스킬 누락 기체(A) 를 받아 병합
  if (msChanged || patchNew || staleMechs.length || emptyUrlMechs.length) {
    const ids = new Set();
    for (const m of added) { const id = pageId(urlOf(m)); if (id) ids.add(id); }
    for (const c of changed) { const id = pageId(urlOf(c.ms)); if (id) ids.add(id); }
    // 밸런스 패치로 무장이 바뀐 기체.
    // patchNew 만 보면, 감지가 실패한 채 patch.json 만 새 날짜로 적힌 적이 있을 때
    // 그 패치는 영영 안 받아진다(실제로 위키가 403 을 주던 동안 그렇게 됐다).
    // 그래서 '캐시가 패치 날짜보다 오래된' 페이지는 언제나 다시 받는다 — 스스로 복구된다.
    if (patch.date) {
      const stamp = Date.parse(patch.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3T00:00:00+09:00'));
      let stale = 0;
      for (const id of patch.ids) {
        if (patchNew) { ids.add(id); continue; }
        const f = path.join(ROOT, 'raw', 'wiki', id + '.html');
        let mt = 0;
        try { mt = fs.statSync(f).mtimeMs; } catch { mt = 0; }
        if (!mt || (stamp && mt < stamp)) { ids.add(id); stale++; }
      }
      if (!patchNew && stale) console.log(`  · 조정 기체 캐시가 패치(${patch.date})보다 오래돼 ${stale}개를 다시 받습니다.`);
    }
    for (const m of staleMechs) { const id = pageId(urlOf(m)); if (id) ids.add(id); }   // A: 누락 기체
    for (const m of emptyUrlMechs) { const id = pageId(urlOf(m)); if (id) ids.add(id); } // B: 방금 연결된 기체
    const targetIds = [...ids];
    console.log(`  갱신 대상 위키 페이지 ${targetIds.length}개`);

    // --pages 로 한정하고 --force 로 강제 재수신한다(캐시를 미리 지우지 않아, 받기 실패해도
    // 기존 캐시가 남는다). 배포본 캐시가 비어도 전체 584개를 받지 않는다.
    if (targetIds.length) run('fetch_wiki.js', ['--pages=' + targetIds.join(','), '--force']);
    run('extract_weapons.js', ['--merge']);
    run('extract_ms_skills.js', ['--merge']);   // 기체 스킬 목록·설명 (무장 헤더 '스킬' 버튼)
    run('find_buff_skills.js', ['--ui', '--merge']);
    run('build_weapon_i18n.js');
    // 위키 스탯·슬롯이 gbo2.jp 와 다르면(gbo2 가 아직 패치 미반영) 위키 값으로 교정한다.
    if (targetIds.length) run('extract_ms_wiki.js', ['--pages=' + targetIds.join(',')]);

    // M1: 받아봤는데도 무장/스킬이 여전히 빈 페이지는 시도 시각을 남겨 24h 재시도 방지.
    //     채워진 것은 기록을 지운다(다음에 또 바뀌면 즉시 재시도되도록).
    const weapAfter = (() => { try { return rdJson('data', 'weapons.json'); } catch { return {}; } })();
    const sklAfter = (() => { try { return rdJson('data', 'ms_skills.json'); } catch { return {}; } })();
    const now = Date.now();
    for (const m of [...staleMechs, ...emptyUrlMechs]) {
      const id = pageId(urlOf(m)), b = baseName(m.MS名);
      const empty = !id || !weapAfter[id] || !(weapAfter[id].weapons || []).length || !sklAfter[b];
      if (empty) attempts[id ? 'p:' + id : 'n:' + m.MS名] = now;
      else { if (id) delete attempts['p:' + id]; delete attempts['n:' + m.MS名]; }
    }
    fs.writeFileSync(path.join(ROOT, 'data', 'wiki_attempts.json'), JSON.stringify(attempts) + '\n');
  }

  // (d) 이미지 — 새 기체뿐 아니라 새 파츠도 받아야 하므로 둘 중 하나만 바뀌어도 실행한다.
  //     (이미 받은 것은 건너뛰므로 새 항목만 내려받는다)
  if (partsChanged || msChanged) run('fetch_images.js');

  // (e) 신규 기체·파츠를 온라인 번역으로 자동 한글화(실패 시 음차 폴백) 후 재빌드
  run('auto_translate.js');
  run('translate_skills.js');   // 신규 스킬 효과·설명 온라인 번역(캐시 증분)
  run('translate_notes.js');    // 신규 무장 備考 온라인 번역(캐시 증분)
  run('build.js');

  // (f) 번들(계산 로직)이 바뀌었으면 원본 계산과 대조해, 아직 이식 안 된 새 규칙이 있는지 본다.
  //     (이번 ハロ（V） 처럼 gbo2.jp 가 파츠 특수 계산을 추가하면 여기서 불일치로 드러난다)
  if (partsChanged) {
    const code = runSoft('verify_against_original.js', ['5000']);
    if (code !== 0) {
      console.log('\n⚠ 원본 계산과 불일치가 있습니다 — gbo2.jp 가 계산 로직을 바꿨을 수 있습니다.');
      console.log('  위 "불일치 사례"를 보고 src/core.js 에 새 규칙을 반영해야 할 수 있습니다.');
    }
  }

  // 반영한 밸런스 패치 날짜를 기록해, 다음 실행 때 같은 패치를 다시 받지 않게 한다.
  if (patchNew && patch.date) fs.writeFileSync(PATCH_FILE, JSON.stringify({ applied: patch.date }, null, 1) + '\n');

  // 5) 마무리 리포트 — 새 기체 한글명은 사람이 확인해야 한다
  const msDict = rdJson('data', 'i18n', 'ms.json');
  let msAuto = {}; try { msAuto = rdJson('data', 'i18n', 'ms.auto.json'); } catch { /* 없을 수 있음 */ }
  const base = n => n.replace(/_LV\d+$/, '');
  const newMs = [...new Set(added.map(m => base(m.MS名)))].filter(n => !msDict[n]);
  // 자동 음차로 한자 등이 남은 것만 사람이 다듬으면 된다 (나머지는 자동 한글화됨).
  const needKo = newMs.filter(n => !msAuto[n] || /[぀-ヿ一-鿿]/.test(msAuto[n]));
  console.log('\n✔ 반영 완료.');
  if (newMs.length) console.log(`\n새 기체 ${newMs.length}종은 한글명이 자동 음차되었습니다(data/i18n/ms.auto.json).`);
  if (needKo.length) {
    console.log(`\n※ 그중 ${needKo.length}종은 한자 등이 남아 음차만으론 부족합니다 — ms.json 에 넣어 다듬어 주세요:`);
    needKo.forEach(n => console.log(`     "${n}": "",   // 자동: ${msAuto[n] || '(음차 실패)'}`));
  }
  // 새 파츠도 한글 사전에 없으면 알려준다 (파츠명은 자동 번역이 없다).
  const partDict = rdJson('data', 'i18n', 'parts.json');
  const partNeed = Object.values(rdJson('data', 'parts.json')).flat()
    .map(p => p.name).filter(n => !partDict[n]);
  if (partNeed.length) {
    console.log(`\n※ 새 파츠 ${partNeed.length}종은 한글 사전(data/i18n/parts.json)에 없어 일본어로 표시됩니다:`);
    partNeed.forEach(n => console.log(`     "${n}": { "n": "", "d": "" },`));
  }
})().catch(e => { console.error('\n✗ 업데이트 실패:', e.message); process.exit(1); });

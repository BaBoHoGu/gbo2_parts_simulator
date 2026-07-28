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
    const html = (await get('https://w.atwiki.jp/battle-operation2/')).toString('utf8');
    const start = html.search(/パラメータ調整/);
    if (start < 0) return { date: '', ids: [] };
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

  const nothing = !added.length && !changed.length && !removed.length && !partsChanged && !patchNew;
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

  // (b) 기체 스탯이 바뀐 경우에만 msData 교체
  if (msChanged) fs.copyFileSync(path.join(REMOTE, 'msData.json'), path.join(ROOT, 'data', 'msData.json'));

  // (c) 위키·무장·스킬 — 신규/변경 기체 + 새 패치로 조정된 기체 페이지를 다시 받아 병합
  if (msChanged || patchNew) {
    const wikiDir = path.join(ROOT, 'raw', 'wiki');
    const ids = new Set();
    for (const m of added) { const id = pageId(m.wiki_url); if (id) ids.add(id); }
    for (const c of changed) { const id = pageId(c.ms.wiki_url); if (id) ids.add(id); }
    if (patchNew) for (const id of patch.ids) ids.add(id);   // 밸런스 패치로 무장이 바뀐 기체

    // 대상 페이지의 캐시는 지워 강제로 다시 받는다 (신규는 캐시에 없어 그냥 받힌다)
    let refetch = 0;
    for (const id of ids) { const f = path.join(wikiDir, id + '.html'); if (fs.existsSync(f)) { fs.rmSync(f); refetch++; } }
    console.log(`  갱신 대상 위키 페이지 ${ids.size}개 (캐시 삭제 ${refetch})`);

    // --pages 로 한정해 그 페이지만 받는다(배포본 캐시가 비어도 전체 584개를 받지 않도록).
    const targetIds = [...ids];
    if (targetIds.length) run('fetch_wiki.js', ['--pages=' + targetIds.join(',')]);
    run('extract_weapons.js', ['--merge']);
    run('find_buff_skills.js', ['--ui', '--merge']);
    run('build_weapon_i18n.js');
  }

  // (c) 이미지 — 새 기체뿐 아니라 새 파츠도 받아야 하므로 둘 중 하나만 바뀌어도 실행한다.
  //     (이미 받은 것은 건너뛰므로 새 항목만 내려받는다)
  if (partsChanged || msChanged) run('fetch_images.js');

  // (d) 언제나 재빌드
  run('build.js');

  // (e) 번들(계산 로직)이 바뀌었으면 원본 계산과 대조해, 아직 이식 안 된 새 규칙이 있는지 본다.
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
  const base = n => n.replace(/_LV\d+$/, '');
  const needKo = [...new Set(added.map(m => base(m.MS名)))].filter(n => !msDict[n]);
  console.log('\n✔ 반영 완료.');
  if (needKo.length) {
    console.log(`\n※ 새 기체 ${needKo.length}종은 한글명 사전(data/i18n/ms.json)에 없어 일본어로 표시됩니다.`);
    console.log('  다음을 ms.json 에 추가하면 한글로 나옵니다:');
    needKo.forEach(n => console.log(`     "${n}": "",`));
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

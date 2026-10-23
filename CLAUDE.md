# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GBO2(기동전사 건담 배틀 오퍼레이션 2) 커스텀 파츠 시뮬레이터. 순수 브라우저 JS(프레임워크·번들러 없음)를
`tools/build.js` 가 **HTML 한 장**으로 묶는다. 화면은 전부 한국어, 계산은 원본 일본어 키로 한다.
사용자용 설명은 `README.md`, 배포·계정·PC 이전은 `docs/운영.md`, 사용자용 변경 기록은 `패치노트.md`.
(README 의 「검사 동시 4개」 · 「피탄 시뮬」 · `src/ui.js` 는 낡았다 — 지금은 동시 6개, 피탄 시뮬은 대결에 합쳐짐, 화면 코드는 `src/ui/`.)

## 명령

```powershell
node tools/build.js               # 오프라인판 dist/gbo2-simulator.html (그림까지 인라인, ~16MB)
node tools/build.js --web         # 사이트판 dist/web/ (그림 분리 + sw.js + _headers)
node tools/build.js --no-shrink   # 주석·공백을 안 뺀 빌드(줄 번호로 따라갈 때)

node tools/gates.js               # 검사 전부(동시 6개, 약 10분). 실패한 검사는 혼자 한 번 더 돌린다
node tools/gates.js --fast        # Chrome·서버 없이 도는 것만
node tools/gates.js --jobs=1      # 하나씩
node tools/<이름>_check.js        # 검사 하나 — 먼저 빌드해야 한다(대부분 dist/gbo2-simulator.html 을 연다)

.\update.ps1 -Site                # 평소 배포: 수집→번역→빌드→전체 검사→사이트 게시→폰 OTA→데이터 커밋·푸시
.\update.ps1 -Check               # 원본 변경 감지만
.\update.ps1 -Release -Publish    # PC ZIP·APK 까지 — 사용자가 「PC 판·APK 도」 라고 말할 때만
```

- 검사는 `tools/` 의 **파일 이름**으로 주워 담는다: `*_check.js` · `check_*.js` · `smoke.js`. 다른 이름이면 전체 검사에서 안 돈다.
- 갤러리 검사(`gallery_pw_check` 등, `localhost:8788` 을 부르는 것)는 `gates.js` 가 `wrangler pages dev` 를 띄워 줄 때만 돈다(`.dev.vars` 는 없으면 더미로 만든다).
- `offline_check` 는 `dist/web` 을, `webimg_check` 는 사이트판 빌드를 쓴다.
- 브라우저 검사 공용 손잡이: `tools/lib/browser.js` · `wiki_fetch.findChrome()` · 대결은 `tools/lib/duelgate.js` 의 `measure()`(값은 DOM 이 아니라 `GBO2Duel.attack()` 결과로 잰다). 앱은 점검용 함수를 `window.GBO2UiTest` 로 내놓는다.
- 원본 엔진 대조: `node tools/extract_original_calc.js` → `node tools/verify_against_original.js 30000`.

## 구조 (여러 파일을 읽어야 보이는 것)

**빌드 = 표지 치환.** `src/index.html` 의 `/*__CORE__*/` · `/*__UI__*/` · `/*__DATA__*/` 같은 표지를 `build.js` 가
소스·데이터로 바꾼다. 실리는 순서: 데이터(`window.GBO2_DATA` · `GBO2_WEAPONS` · `GBO2_I18N` · `GBO2_PATCHNOTES` …, 큰 것은
`JSON.parse('…')` 꼴) → `icons.js` → `core.js` → `i18n.js` → `optimizer.js` → `damage.js` → `share.js` → **한 `<script>` 안에
ui · token.js · duel.js**. 빌드는 JS·CSS 의 주석·공백을 esbuild 로 빼고(이름은 유지), CSS 의 `@custom-media` 이름을 원래 조건으로 풀어 넣는다
(정의는 `src/style.css` 머리, 정의 안 된 이름이면 빌드가 멈춘다). 새 표지를 만들면 `build.js` 끝의 「unreplaced marker」 목록에도 넣는다.

**화면 코드 `src/ui/00-base.js … 18-init.js`** 는 모듈이 아니라 **한 IIFE 의 토막**이다 — `tools/lib/uisrc.js` 의 `readUi()` 가
번호 순으로 이어 붙여 `(function(){'use strict'; … })();` 로 감싼다. 파일끼리 `const` 를 그대로 나눠 쓰므로 **번호 순서가 정의 순서**다.
검사 도구가 화면 코드를 읽을 때는 `src/ui.js`(없음)가 아니라 `readUi()` 를 쓴다.

**계산은 한 곳.** `core.js`(스탯·슬롯·상한·장착 제한·내구 지표, Node 에서도 `require` 된다) · `damage.js`(피해식·파츠 효과 파싱) ·
`optimizer.js`(자동 구성). 화면과 자동 구성과 대결이 **같은 함수**를 부른다 — 식을 화면 쪽에 따로 두면 값이 갈린다(실제로 갈렸다).

**대결 `src/duel.js`** 는 자기 IIFE 다. 판정은 앱 쪽에만 있고 `GBO2Duel.use({ … })` 로 훅을 받는다(`ui/03-weapons.js` 근처
`window.GBO2Duel.use`). duel.js 의 `HOOK` 기본값은 「모른다 / 없다」 로만 답한다 — 거기에 판정을 새로 지어 넣지 않는다.
토큰 계산기 `token.js` 도 따로 도는 IIFE 다(본문은 `src/token.body.html`, 그 안에 `<script>` 를 두면 빌드가 막는다).

**스킬·무장 설명은 원문 일본어를 런타임에 정규식으로 읽는다** — `data/ms_skills.json` 의 desc/eff, `weapons.json` 의 `備考`.
방어 스킬 경감 · 상대 내성 감소(`foeArmorOf`) · 공중 격투 제어(`airMeleeOf` · `airDirOf` · `AIR_TAG_EXTRA`) · 「スキル発動中」 판정(`weaponSkillOn`) ·
조건부 강경직(`stag2Of`)은 각각 **한 함수**다. 문구 꼴이 새로 나오면 그 함수를 고치고, 고친 정규식을 **전체 데이터에 전후로 대 보아**
바뀐 것이 의도한 것뿐인지 확인한다(예: 「実弾属性射撃」 이 사격 전체로도 잡히던 버그).

**데이터.** `data/msData.json`·`parts.json`·`fullst.json` 은 gbo2.jp(비공식 팬 사이트), `weapons.json`·`ms_skills.json` 은 위키 표에서
뽑는다(`weapons.json` 은 **위키 페이지 ID** 가 키, 기체는 `wiki_url` 로 찾아간다). 수치가 어긋나면 **위키를 따른다.**
`*.additions.json` 은 원본에 없는 것을 보태고 `*.override.json` 은 틀린 것을 고친다 — 둘 다 원본이 제대로 생기면 저절로 무시되게 짜여 있고
병합 규칙은 `tools/lib/dataset.js` 한 곳이다. 손으로 박는 값은 `was`(박을 당시 원본값)를 같이 적는다(`manualpin_check`).
위키(atwiki)는 Cloudflare 가 막아 `tools/lib/wiki_fetch.js`(헤드리스 Chrome)로만 받는다. `raw/wiki/` 캐시는 커밋하지 않는다.

**이름 정규화.** 원본에 NFD 결합 문자가 섞여 온다 — 사전 조회·그림 경로는 `normalize('NFC')`, 이름 비교 키는 NFKC+공백 제거(전각 `Ｒ`).

**번역 사전 `data/i18n/*.json` 은 생성물이다.** 손으로 고치지 말고 규칙을 고친다: 무장명은 `weapon_terms.json` + `node tools/build_weapon_i18n.js`,
MT 앞단 용어 보호는 `tools/lib/glossary.js`. 수동 사전(`ms.json`·`parts.json`)이 자동(`*.auto.json`)을 이긴다. 공식 한국어 표기가 기준이다.

**일본어 모드(`?lang=ja` · ⋯ → 🌐).** 데이터는 원문(일본어)이라 `i18n.js` 가 JA 일 때 한국어 사전을 비운다(weaponNote 는 판정용이라 남김).
화면 문구는 그려진 글자를 `data/i18n/ui_ja.json` 표로 바꾼다(`jaText` + MutationObserver). 표는 **사람이 번역한 것** — 기계번역 금지,
빠진 문구는 `node tools/build_ui_ja.js --todo=<f>` → 번역 → `--merge=<f>`. 원문을 한국어로 바꿔 보이던 칸(`jaUnits` 등)은 ui 의 `JA` 로 원문을 그대로 보인다.
패치노트 본문은 공식 일본어 공지(`adjusted[].ja`, `extract_patchnotes` 의 `mirrorJa`). 검사 `ja_mode_check`. 새 화면 문구를 쓰면 표도 채운다.

**사이트(Cloudflare Pages).** `wrangler.toml` 의 출력은 `dist/web`, 서버는 `functions/api/*`(공유 갤러리 `builds` · 추천 `votes` · 추천 영상 `videos`, D1 바인딩 `DB`).
추천 영상의 고르기 값은 `functions/lib/videos.js` 의 `RULES` 한 곳, 진단은 `/api/videos?why=1&ms=…`(할당량 안 씀).
`functions/lib/dict.js` 는 `tools/build_worker_dict.js` 의 생성물. 공유 구성은 `.github/workflows/backup-shared-builds.yml` 이 6시간마다 `share-backup/` 으로 뜬다.
서비스 워커 `src/sw.js` 는 https(또는 `?sw=1`)에서만 등록된다 — 파일로 여는 판·로컬 검사 서버에선 켜지지 않는다.

**CSS.** `style.css`·`duel.css`·`token.css` 를 `index.html` 이 `@layer app { … }` 로 감싸고 토큰은 `tokens` 층(`:root` 의 `--fs-*` · 색 · `--z-bar/sheet/modal/pop/drag`).
모달은 `<dialog>` + `setModal`(ui 쪽) 하나로 연다. 새 색이 두 번째로 쓰이면 토큰으로 올린다. **정의되지 않은 토큰을 `var(--x, 대체값)` 으로 부르지 않는다**
(나중에 정의하는 순간 자리마다 다른 대체값이 한 색이 된다). 강조(노랑) 위 글자색은 `var(--on-accent)`. 아이콘은 `src/icons.js`(`GBO2Icons`) 한 벌만.
겉모습이 같아야 하는 CSS 정리는 `node tools/cstyle_diff.js <전.html> <후.html>`(모든 요소의 계산 스타일 대조, 0 이어야 한다).

**폰 앱 `android/`** 는 `dist/gbo2-simulator.html` 을 싸는 WebView. 데이터·JS 변경은 OTA(GitHub Release `data`)로 가고, `android/` 를 고쳤을 때만 재설치가 필요하다.
한글 경로 때문에 `android.overridePathCheck=true` 가 필요하다.

## 실사용에서 정해진 것 (버그처럼 보여도 고치지 말 것 · 아직 안 고친 것)

- 같은 이름 다른 레벨 파츠(강화 프레임 LV1~5)는 **같이 달 수 있다** — 파츠 식별은 이름 단위. 버그 아님.
- 공격 보정 상한 100 은 확장·파츠·스킬로 **넘을 수 있다** — `damage.js` 에 하드 상한을 다시 넣지 않는다.
- 히트율이 없는 빔은 OH 가 아니라 **E팩 탄창(리로드)** 이다(`isEpackMag`). GN 발칸도 리로드.
- 공중 격투는 입력 방향과 무관하게 **하격**(예외는 무장 단위, 스크류 웹 = N격). 공중 격투 제어 LV2 +30% 는 설명에 「対応」 이 적힌 무장만(델타 플러스 사벨은 표기 없어도 대응 — 사용자 확인).
- 「緩衝材系スキル無視」 무장은 상대 완충재 스킬 경감을 안 받는다. 완충재 8% 강화는 %p 가산이고 특수 방어 기구에는 안 붙는다.
- 「〜付与」 로 주어지는 스킬은 자동 추출이 안 된다 → 피해에 닿는 것만 `data/skills.override.json` 에.
- 파츠 효과(피해%·리로드)는 일본어 설명을 정규식으로 읽는다 — 새 문구나 전각 `％` 는 **조용히** 빠진다.
- `patch.json` 의 mechs 는 한 패치가 아니라 네 패치의 합집합이다(49 = 12+10+12+15) — **미수정**, 알려진 문제.
- 미뤄 둔 작업과 우선순위는 메모리의 「추후 목록」(backlog). 새 작업을 정할 때 거기부터 본다.
- 공통 교훈(측정·검사·데이터·Windows 함정)은 `..\CLAUDE_BASE(G).md` — 여기엔 이 저장소 고유의 것만 둔다.

## 이 저장소에서 지킬 것

- **배포는 사용자가 말할 때만.** 기본은 `.\update.ps1 -Site`. 돌렸으면 끝까지 기다려 결과(검사 수 · OTA 스탬프 · 푸시)를 한 번에 보고한다.
  배포 스크립트는 `data/` 만 커밋한다 — 코드 커밋은 따로 한다.
- 배포가 `패치노트.md` 에 붙인 자동 초안(「무장이 바뀐 기체 N기」)은 데이터 전후를 비교해 **사람이 읽을 문구**로 풀어 쓴다. `patchnote_check` 가 형식을 본다.
- 화면 문구는 **원문 값을 그대로** — 요약해 원문에 없는 말(「상승」 등)을 만들지 않는다. 모르는 글자는 지어내지 않는다.
- 새 검사는 `*_check.js` 로 이름 짓고, **고치기 전 코드로 돌려 실패하는지** 확인한다. 개수·목록을 `===` 로 박지 않는다(바닥만 막는다).
  누르기 검사는 `el.click()` 이 아니라 `elementFromPoint` + `page.mouse` 로.
- 저장소는 **공개**다. 비밀값은 `%LOCALAPPDATA%\gbo2-sim\*.cred`(DPAPI, `update.ps1 -SetSiteKey` / `-SetSecret`) 또는 `wrangler pages secret put` 에만 둔다.
  관리자 비밀번호는 앱·저장소·대화 어디에도 두지 않는다. 유료 요금제로 올리지 않는다.
- 옆 프로젝트 `..\BP` 는 **읽기만** 한다(파일을 바꾸지 않는다).
- 진행 설명은 한국어로.
- 환경 함정(Windows · Git Bash): `node -e`·heredoc 안의 백슬래시가 사라지거나 `\b` 가 **보이지 않는 0x08** 이 된다 — 정규식이 든 수정은 편집 도구나 파일로 만든 스크립트로.
  소스는 대부분 **CRLF** 라 `\n` 으로 찾는 치환이 조용히 안 걸린다(치환 개수를 센다). Python 출력은 `sys.stdout.reconfigure(encoding='utf-8')`.

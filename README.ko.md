# Junis kit

[![CI](https://github.com/TOOEASY-crew/junis-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/TOOEASY-crew/junis-kit/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Latest tag](https://img.shields.io/github/v/tag/TOOEASY-crew/junis-kit?sort=semver)](https://github.com/TOOEASY-crew/junis-kit/tags)

[English](README.md)

코딩 에이전트가 [주니스(Junis)](https://junis.ai)의 AI 에이전트 스쿼드를 만들고 실행하고 고치게 하는
스킬 및 로컬 MCP 브리지.

Claude Code, Codex, Cursor, Gemini CLI, OpenCode 또는 GitHub Copilot에서 원하는 스쿼드를 설명하면 됨.
에이전트는 먼저 조직 상태를 읽고 모델 및 도구 이름을 플랫폼의 실시간 목록에서 가져옴. 인스트럭션은
저장 전에 하나씩 검사함. 스쿼드를 한 번 실행한 뒤 바꾼 것, 가정한 것 및 사용자에게 남은 일을 보고함.
코딩 세션이 끝난 뒤에도 스쿼드는 주니스에서 스케줄에 따라 계속 동작함. 자체 모델, 지식 그래프, 기억,
위키 및 도구 호출 기록도 그대로 씀.

## 설치

필요 조건은 Node.js 18 이상, git 및 Basic 또는 Pro 요금제의 junis.ai 계정.

Claude Code는 플러그인으로 설치.

```bash
claude plugin marketplace add TOOEASY-crew/junis-kit
claude plugin install junis@junis-kit --scope user
```

이 컴퓨터의 다른 지원 에이전트는 아래 명령으로 설치. 릴리스 태그에 고정한 설치임.

```bash
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/v0.1.0/install.sh | JUNIS_KIT_REF=v0.1.0 sh
```

최신 커밋으로 설치하려면 아래 명령.

```bash
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/main/install.sh | sh
```

`install.sh`는 찾은 에이전트를 등록함. `--agents`에는 id 목록 또는 `all`을 지정: Codex(`codex`),
Cursor(`cursor`), Gemini CLI(`gemini-cli`), Copilot을 쓰는 VS Code(`vscode`), GitHub Copilot
CLI(`copilot-cli`), OpenCode(`opencode`), Devin Desktop 또는 Windsurf(`devin-desktop`), Claude
Desktop(`claude-desktop`, 설치기가 만든 `~/.junis-kit/dist/junis-skill.zip`을 Customize > Skills에 한 번
올려야 함) 및 Claude Code(`claude-code`).

```bash
# 계획만 보여 주고 에이전트 설정은 바꾸지 않음
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/v0.1.0/install.sh | JUNIS_KIT_REF=v0.1.0 sh -s -- --dry-run
# 일부 에이전트만
curl -fsSL https://raw.githubusercontent.com/TOOEASY-crew/junis-kit/v0.1.0/install.sh | JUNIS_KIT_REF=v0.1.0 sh -s -- --agents codex,cursor
# 스킬만 설치(Agent Skills를 읽는 모든 에이전트)
npx skills add TOOEASY-crew/junis-kit -g
```

파이프로 실행하면 키트를 `~/.junis-kit/src`에 내려받거나 갱신한 뒤 설치기를 실행함. 체크아웃 안에서
`sh install.sh`를 실행하면 그 체크아웃을 설치. 스킬만 설치하면 브리지 및 플러그인 훅이 없음. 이때
스킬은 자체 명령줄을 쓰고 확인 절차는 스킬 규칙 및 에이전트의 셸 명령 승인에 맡겨짐.

플러그인은 `main`을 따라감. 업데이트는 `claude plugin marketplace update junis-kit` 다음
`claude plugin update junis@junis-kit`. `install.sh`로 설치했으면 같은 명령을 다시 실행. 키트가 주니스
키를 다루므로 새 태그로 옮기기 전에 `CHANGELOG.md` 확인.

제거는 `claude plugin uninstall junis@junis-kit` 또는
`node ~/.junis-kit/skills/junis/scripts/junis.mjs uninstall`(`--purge`는 저장한 키도 삭제,
`--dry-run`은 계획만 표시). 이어서 `~/.junis-kit`을 지워 키트 파일을 없애고
https://junis.ai/settings/api-keys 에서 키를 폐기. 로컬 파일을 지워도 키는 폐기되지 않음.

## 연결

API 키는 첫 대화에서 만듦. 새 세션을 열고 어떤 언어로든 요청.

```
나:       주니스 연결 상태 확인해 줘
에이전트: 아직 연결 전이에요. https://junis.ai/auth/api-key?code=… 에서 로그인하고
          키트가 요청하는 권한을 확인한 뒤 승인을 눌러 주세요.
나:       승인했어
에이전트: 연결됐어요. 이 키로 Globex(OWNER), GlobexSales(ADMIN) 두 조직에 접근할 수 있어요.
          어느 조직에서 작업할까요?
```

복사하거나 붙여 넣을 것이 없어서 SSH 접속 환경이나 컨테이너 안에서도 그대로 동작.

다른 방법은 https://junis.ai/settings/api-keys 에서 "Coding agents (recommended)" 프리셋으로 키를
만들고 복사 버튼을 누른 뒤 에이전트에게 복사했다고 알리는 것. 키트가 키를 읽어 검증 및 저장하고
클립보드를 비움. 키를 채팅에 붙여 넣지 말 것. 터미널에서는 `junis.mjs login --browser`, CI에서는
`JUNIS_API_KEY` 설정.

## 사용

```
https://example.com/blog 를 매주 월요일 요약하는 스쿼드 만들고 지금 한 번 돌려 줘
```

에이전트는 이 문서 첫머리에 적은 순서대로 작업하고 마지막에 보고함.

## 예시

지금 플랫폼이 지원하는 요청을 직접 입력하는 말투로 적은 예시. 고객 사례 아님.

- "공급사 계약서랑 부품 목록을 올려 둘게. Northwind Metals에 걸린 제품이 무엇이고, 공급 중단에 대해
  계약서에 뭐라고 쓰여 있는지 알려 줘." Knowledge가 계약서를 공급사, 부품, 제품 및 조항의 그래프로
  바꿈. 오케스트레이터가 그래프에서 영향받는 제품을 찾고 조항마다 문서 및 쪽을 붙여 인용함. 수량
  질문은 팀이 승인한 쿼리 템플릿으로 부품 데이터베이스에서 답함.
- "결제 서비스의 새 Sentry 이슈를 한 시간마다 확인하고, 샌드박스에서 수정안을 시험한 뒤 풀 리퀘스트를
  열어 줘. 병합은 내가 할게." Sentry 서버를 쓰는 분류 에이전트, GitHub 서버 및 코드 샌드박스를 쓰는
  수정 에이전트 및 다른 모델 계열의 검토 에이전트가 검토 루프를 돎. 병합 도구는 에이전트의 확인 목록에
  넣음. 확인 목록은 직접 설정하기 전까지 꺼져 있고 스케줄 실행은 그 목록의 도구를 부르지 않음.
- "매주 월요일 EU 배터리 규제에서 바뀐 것을 조사해서 위키 페이지를 고치고, 지난주와 달라진 점을 보여
  줘." 병렬 리서처 3~5개가 정한 깊이로 웹을 조사하고 종합 에이전트가 결과를 출처와 함께 합침. 검토
  에이전트는 초안이 통과하거나 루프 한도에 이를 때까지 루프를 돎. 페이지에 버전 이력이 남아서 지난주 본문 및 차이는 호출
  한 번으로 확인 가능.
- "평일 아침마다 Gmail이랑 Linear를 보고 브리핑해 주고, 내가 내린 결정은 기억해 줘." Gmail 및
  Linear는 웹앱에서 OAuth로 연결. 기억에는 프로필, 기억해 달라고 한 사실, 일일 기록 및 기간별(월간, 분기,
  연간) 요약이 쌓임. 지난 대화는 날짜로 검색 가능.
- "매일 밤 내 노트북의 ~/work/shop 테스트를 돌리고 실패한 것만 보내 줘." `npx junis`로 컴퓨터를
  연결하면 하위 에이전트가 사용자 권한으로 그 컴퓨터에서 명령 실행, 파일 읽기 및 브라우저 조작을 맡음.
  기기 도구를 필수로 지정해 두면 노트북이 꺼져 있을 때 빈 성공 대신 도구 누락으로 표시됨.
- "help.example.com에서 이 도움말 40개를 근거로 고객 질문에 답하게 해 줘." 도움말을 Knowledge에 넣고
  공개 공유로 표시. 웹앱에서 공개 임베드를 켜면 채팅 위젯의 지식 검색은 그 소스만 봄. 위젯은 허용한
  도메인에서만 동작하고 방문자별 메시지 한도가 적용되며 막아 둔 도구는 쓰지 않음.

## 기능

수치는 2026년 11월 기준. 키트는 모든 목록을 실시간으로 읽으므로 새 모델 및 도구는 키트 갱신 없이
동작.

| 분야 | 플랫폼이 하는 일 |
| --- | --- |
| Knowledge | 문서, 스프레드시트, 이미지, 오디오, 영상, CAD 도면, BIM 도면 및 웹 페이지를 설정 없이 읽어 지식 그래프를 만듦. 답변은 문서, 쪽 및 구절을 인용 |
| 그래프 질문 | 주변 노드, 경로, 부분 그래프 및 스냅숏을 모델 호출 없이 조회. `as_of` 날짜를 주면 그 시점의 사실을 씀. 배관 및 계장 도면용 what-if 도구가 밸브를 닫았을 때 끊기는 곳을 알려 줌 |
| 데이터베이스 | PostgreSQL, Oracle, MySQL 또는 MariaDB 및 SQL Server를 읽기 전용 권한만 준 계정으로 Knowledge 소스에 연결. 쿼리는 실행 전에 가드가 검사하고 값 없이 기록이 남음 |
| 의미 계층(PostgreSQL 전용) | 사람이 쿼리 템플릿, 용어집 및 지표를 승인하면 에이전트가 그것으로 답함. 데이터베이스 역할로 사람마다 조회할 수 있는 행 및 열을 정함 |
| 스쿼드 | 오케스트레이터가 요청을 하위 에이전트로 보내고 하위 에이전트는 순차, 병렬 또는 루프로 실행. 스쿼드끼리 호출하고 웹 채팅에서 사용자에게 질문 가능 |
| 스쿼드 코드 관리 및 버전 | 스쿼드를 JSON 파일 하나로 내보내 실제 조직과 비교한 계획을 본 뒤 적용. 에이전트 변경마다 버전이 남고 되돌리기 가능 |
| 실행 및 감사 | 스케줄, Slack, CI 또는 External API로 실행. 모든 도구 호출이 상태와 함께 기록됨 |
| 공개 | 공개로 표시한 소스만 검색하는 웹사이트 채팅 위젯(위 예시 참고) |
| 위키 | 에이전트가 읽고 쓰는 마크다운 페이지. 버전 이력, 차이 보기 및 복원 지원 |
| 사용자별 기억 | 프로필, 기억한 사실, 일일 기록 및 기간별 요약이 매 턴 오케스트레이터에 전달됨. 에이전트는 지난 대화를 키워드 및 날짜로 검색 |
| 정체성 | 조직의 가치 및 말투(soul)가 오케스트레이터의 모든 답변에 반영됨 |
| MCP 서버 | 모든 조직에 제공되는 14개(GitHub, Notion, Salesforce, Sentry, PostgreSQL 등). 조직이 원격 MCP 서버를 직접 등록하는 것도 가능 |
| 앱 | OAuth 또는 API 키로 연결하는 25개(Gmail, Slack, Google Docs, Drive, Sheets, GitHub, Linear, Shopify 등) |
| 내 컴퓨터 | `npx junis`로 연결해 명령, 파일 및 브라우저를 씀(위 예시 참고). 기기 도구를 필수로 지정하면 꺼진 컴퓨터는 도구 누락으로 표시됨 |

분야별 상세는 [docs/CAPABILITIES.md](docs/CAPABILITIES.md)(영문) 참고.

기본 제공 도구는 86개. 분야별 주요 도구:

| 분야 | 에이전트가 쓰는 것 |
| --- | --- |
| 코드 | 격리된 리눅스 샌드박스(셸, 파일, Jupyter, Chromium 및 ffmpeg) 및 프로그램 방식 도구 호출(에이전트의 다른 도구를 부르는 Python 스크립트를 한 번에 실행) |
| 리서치 | 빠른 조사부터 전수 조사까지 네 단계 깊이의 웹 검색 및 페이지 읽기 |
| 문서 | docx, pdf, pptx 및 xlsx 파일용 문서 스킬 |
| 미디어 | 이미지, 영상, 오디오 및 3D 생성 |
| 판정 | 확률을 함께 주는 예/아니요 판정, 분류, 점수, 재정렬 및 주장 검증. 호출 한 번에 최대 200건 |
| 사람 확인 | 웹 채팅의 질문 카드 및 도구별 승인 목록 |
| 시뮬레이션 | 텍스트 하나에 여러 라운드 반응하고 인터뷰도 가능한 가상 커뮤니티(조직이 등록한 키 필요) |

대화 모델은 55개이며 에이전트마다 지정.

| 계열 | 모델 |
| --- | --- |
| Anthropic | Claude Fable 5 및 5.1, Opus 4.8, 5 및 5.5, Sonnet 4.6, 5 및 5.5 |
| OpenAI | GPT-5.4부터 GPT-6.1까지(sol, terra, luna 및 astra 포함) |
| Google | Gemini 2.5부터 3.8까지, flash 및 pro |
| 오픈 웨이트 및 기타 | DeepSeek V4 및 V4.1, Qwen 3.6, Kimi K2.6 및 K3.1, GLM 5.1 및 5.3, Grok 4.3 및 4.6, MiniMax M2.7 및 M3.1, MiMo V2.5 |

## 동작 방식

호스트 URL만 쓰면 에이전트 설정마다 키가 평문으로 들어감. 이 경우 세션마다 도구 목록 전체가 실리고 긴
실행은 클라이언트 제한 시간을 넘김. 브리지는 키를 파일 한 곳에 두고 에이전트별로 도구 목록을 맞추며
진행 상황을 조회할 세션 id를 돌려줌. 자세한 내용은 `docs/ARCHITECTURE.md`.

| 구성 | 역할 |
| --- | --- |
| 스킬(`skills/junis/`) | 운영 규칙, 알려진 함정 및 작업 종류별 참조 문서 19개 |
| 로컬 MCP 브리지(`junis.mjs mcp`) | 에이전트를 호스팅 주니스 MCP 서버(도구 약 177개) 및 External API에 연결. 키는 `~/.junis-kit/credentials.json`에 두거나 `JUNIS_API_KEY`에서 읽음. 긴 실행의 상태를 계속 조회하고 플랫폼 오류를 다음 할 일로 바꿈 |
| 설치기(`install.sh`, `junis.mjs install`) | 이 컴퓨터의 코딩 에이전트를 찾아 각각에 스킬 및 MCP 서버를 등록 |

`skills/junis/scripts/junis.mjs` 및 `lib/` 모듈이 명령줄 도구, 브리지 및 설치기 역할을 맡음. Node.js
기본 모듈만 씀.

Claude Code는 full 모드를 씀. 주니스 도구 전체가 목록에 오르고 Claude Code는 도구를 쓸 때만 스키마를
불러옴. 나머지 에이전트는 모든 스키마를 처음부터 불러오므로 lazy 모드를 씀. 키트 도구 11개가 플랫폼
도구를 필요할 때 찾아 씀. `--full` 또는 `--lazy`로 바꿀 수 있음.

설치기는 스킬을 `~/.junis-kit/skills/junis`에 복사해 각 에이전트의 스킬 폴더에 연결하고 각 에이전트
설정에 `junis`라는 MCP 서버를 추가함. 파일마다 먼저 백업을 만듦. 읽을 수 없는 파일은 다시 쓰지 않음.
`--force`가 없으면 주석이 있는 파일 및 키트가 쓰지 않은 `junis` 항목도 건드리지 않음. Claude Code
플러그인이 설치돼 있으면 도구가 두 번 보이지 않도록 Claude Code는 건너뜀.

## 보안

- 키는 `~/.junis-kit/credentials.json`(0700 폴더 안의 0600 파일)에 저장하거나 `JUNIS_API_KEY`에서
  읽음. 에이전트 설정에 쓰지 않고 도구가 돌려주지도 않음. 채팅에 키가 들어갔다면 폐기할 것.
- 키를 싣는 요청은 리다이렉트를 따르지 않음. 주소 재정의는 https(이 컴퓨터만 일반 http 허용)이면서
  `junis.ai`, 그 하위 도메인 및 이 컴퓨터 중 하나여야 함. `JUNIS_ALLOW_CUSTOM_HOST=1`을 함께 설정한
  경우만 예외.
- 삭제, 연결 해제, 본문 및 목록 전체 교체, 저장된 비밀 값 표시, 웹앱 조직 전환 및 데이터를 교체하는
  Knowledge 호출은 사용자 답을 기다림. Claude Code에서는 플러그인 훅이 권한 확인 창으로 바꿈. lazy
  모드에서는 에이전트가 `confirmed=true`로 다시 부를 때까지 `needs_confirmation`을 돌려줌. 플러그인 없는
  full 모드(`install.sh`로 등록한 Claude Code, `--full`)에서는 플랫폼 도구가 `destructiveHint` 및 에이전트
  승인 창에 맡겨짐. `junis_api` 및 비밀 값 표시 읽기는 여전히 `needs_confirmation`을 돌려줌. 터미널
  없는 명령줄 실행은 `--yes`로 다시 실행할 때까지 종료 코드 2로 멈춤.

키트가 저장하는 것 전체, 키 폐기 방법 및 취약점 신고 방법은 [SECURITY.md](SECURITY.md) 참고.

## 한계

- `confirmed=true`는 에이전트가 직접 넣으므로 사용자가 실제로 답했는지 키트가 증명하지 못함.
- 훅은 키트 명령을 이름 및 형태로 알아봄. 안에서 키트를 부르는 래퍼 스크립트는 잡지 못함.
- 주니스에서 온 텍스트를 데이터로 다루는 것은 에이전트에게 주는 규칙이고 기술적 차단은 없음.
- 에이전트에게 건넨 서비스 키는 대화 및 모델 제공사를 거침. 서비스 키는 https://junis.ai/team/mcp-skills
  에서 직접 입력 권장.
- claude.ai 웹 및 모바일 커넥터는 OAuth만 받는데 호스팅 서버는 OAuth를 제공하지 않음. 키트는
  데스크톱 및 명령줄 에이전트에서 동작.
- 키트가 시작한 실행은 스트리밍하지 않음. `cancel_run`은 진행 중인 단계가 끝난 뒤 멈춤. 그 단계는
  끝까지 실행되어 과금됨.
- 키트는 가격 및 지출을 보지 못함. 결제 담당자가 https://junis.ai/usage 에서 확인.
- 20분 넘게 걸리는 작업은 스킬이 일회성 스케줄로 돌림.

## 명령줄

같은 기능을 셸에서도 씀. 결과는 표준 출력의 JSON.
`node ~/.junis-kit/skills/junis/scripts/junis.mjs <명령>` 형태로 실행. Claude Code 플러그인으로
설치했으면 이 파일은 `~/.claude/plugins/cache/junis-kit/` 아래에 있음. 스킬만 설치했으면 에이전트의
스킬 폴더에 있음.

```
junis.mjs status | login --browser | login --from-clipboard | logout | org use <name> | doctor
junis.mjs tools <words> | tools describe <tool> | tools call <tool> key=value instruction=@file
junis.mjs api <METHOD> <path> [--json '{...}']
junis.mjs run orchestrator "<message>" | run <agent> "<message>" | session wait <id> | session messages <id>
junis.mjs lint <file> | snapshot [--org id] | snapshot diff <older> <newer>
junis.mjs install | uninstall | mcp [--lazy]
```

`--help`가 모든 옵션을 보여 줌. 기다리는 시간보다 오래 걸리는 실행은 세션 id를 돌려줌. 키트는 같은
실행을 두 번 보내지 않음.

| 변수 | 효과 |
| --- | --- |
| `JUNIS_API_KEY` | 저장한 키 대신 이 키를 사용(CI) |
| `JUNIS_ORG_ID` | 기본 조직 id |
| `JUNIS_PROFILE` | 별도 키를 가진 이름 붙은 프로필 사용 |
| `JUNIS_KIT_HOME` | `~/.junis-kit` 대신 쓸 키트 폴더 |
| `JUNIS_KIT_REF`, `JUNIS_KIT_REPO` | `install.sh`가 설치할 태그 또는 브랜치, 저장소 |
| `JUNIS_API_BASE`, `JUNIS_MCP_URL`, `JUNIS_WEB_URL` | 주소 재정의(보안 절 참고) |
| `JUNIS_ALLOW_CUSTOM_HOST` | `1`이면 `junis.ai` 밖 주소 허용, 이때 `status` 및 `doctor`가 그 호스트를 표시 |

`junis.mjs doctor`를 실행하거나 에이전트에게 주니스 연결 확인을 요청하면 Node, 브리지, 호스팅 MCP
서버, 키, 조직 및 에이전트별 등록 상태를 점검하고 실패마다 고치는 방법을 알려 줌. 오류 메시지별 해결법은
`skills/junis/references/troubleshooting.md`, 웹앱에서 사용자만 할 수 있는 일(요금제, OAuth 앱, 게시
및 팀 역할)은 `skills/junis/references/user-steps.md`.

## 시험 범위

| 에이전트 | 시험 내용 |
| --- | --- |
| Claude Code | 동작 평가: `evals/`의 `claude plugin eval` 사례 20개. 사례마다 실제로 격리된 세션에서 모의 주니스 서버를 상대로 플러그인을 켠 상태 및 끈 상태로 각 3회 실행. 그 밖에 `claude plugin validate .`, 설치 시험 및 MCP 핸드셰이크 시험 |
| Codex, Cursor, Gemini CLI, GitHub Copilot CLI, OpenCode | 설치 시험 및 MCP 핸드셰이크 시험. 동작 평가 없음 |
| VS Code (Copilot) | 설치 계획(dry run) 및 MCP 핸드셰이크 시험 |
| Devin Desktop, Claude Desktop | MCP 핸드셰이크 시험. 설정 파일 위치는 시험하지 않음 |

최근 전체 평가는 2026년 11월 4일, 그날 기준 스킬로 실행. 이후 스킬 변경분은 다시 측정하지 않음.

| 결과 | 사례 |
| --- | --- |
| 3회 모두 통과(점수 1.00) | 16개 |
| `schedules-a-slack-report-safely` | 3회 중 2회 통과(점수 0.89) |
| `tunes-search-and-model` | 3회 중 2회 통과(점수 0.67) |
| `tunes-tone-and-wiki`, `writes-partner-integration-code` | 이번 실행에서 측정하지 못함. 계정 사용 한도에 걸려 실행이 멈춤 |
| 플러그인 없이(주니스 도구 및 스킬 없음) | 측정한 사례 18개 중 통과 0개. 채점 기준이 주니스 도구 호출을 확인함 |

결과 파일은 저장소에 올리지 않음(`evals/results/`는 무시 대상).

핸드셰이크 시험은 두 MCP 프로토콜 세대 모두로 stdio를 통해 브리지를 구동하며 에이전트 자체는 띄우지
않음. Claude Code 밖의 에이전트가 스킬을 따르는지는 측정하지 않음. `npm test`는 프로세스 안의 플랫폼
모의 서버를 상대로 돌고 시험 및 평가는 실제 주니스 조직에 닿지 않음.

## 기여

이슈 및 풀 리퀘스트 환영. 개발 규칙은 `AGENTS.md`, 설계 근거는 `docs/ARCHITECTURE.md`, 조사 요약은
`docs/METHODOLOGY.md`에 있음. 풀 리퀘스트 전에 `npm run check` 실행. 모든 매니페스트가 `kit.json`과
맞는지 확인하고 시험을 돌림. 스킬 동작을 바꾸면 평가 사례도 함께 추가. `README.md` 및
`README.ko.md`는 함께 고침.

`main`의 모든 커밋이 플러그인 사용자에게 감. 고정 버전은 `install.sh` 및 태그(`JUNIS_KIT_REF`)로 설치. 릴리스 절차는
`node scripts/build-manifests.mjs --set-version <x.y.z>` 및 `npm run check` 실행 뒤 그 커밋에 `v<x.y.z>` 태그.

## 라이선스

Apache-2.0. [LICENSE](LICENSE) 및 [NOTICE](NOTICE) 참고. 라이선스 조건에 따라 누구나 키트를 사용,
수정 및 재배포 가능하고 특허 실시 허락도 포함됨. Junis 이름 및 상표 사용권은 키트의 출처를 밝히는
범위를 넘어 부여하지 않음.

## 연락처

- 키트 버그 및 질문: https://github.com/TOOEASY-crew/junis-kit/issues
- 보안 문제: [SECURITY.md](SECURITY.md)를 따를 것. 공개 이슈로 올리지 말 것.
- 계정, 결제 및 플랫폼 문의: contact@junis.ai

주니스는 TOOEASY Inc.가 만듦.

# 저장소 점검과 개선 내역

원본 `shisa-agent`의 `ad3ec5e`에서 확인한 결함을 이 포크에서 수정했다. 보안 차단, AI 입력 전달, 반복 일정, 검증 실행을 우선했으며 기존 캐릭터와 데이터 저장 형식은 유지한다.

| 항목 | 변경 | 회귀 검증 |
|---|---|---|
| 수정 run의 Git 차단 | 셸 토큰화 후 Git·gh 전역 옵션과 하위 명령을 판정한다. 알 수 없는 Git 명령과 alias 설정은 차단한다. | `ship-guard.test.ts`: `-C`, `-c`, `--git-dir`, `gh -R`, 따옴표·셸 감싸기 |
| 비밀 파일 링크 | macOS도 실제 파일·디렉터리 대상 경로로 비밀 파일을 검사한다. | `code-read.test.ts`, `permissions.test.ts`: 가짜 `.env`, 설정 파일 링크 |
| OpenAI strict 출력 | 중첩 속성을 모두 필수로 변환하고 선택 값은 응답에서 원래 형태로 복원한다. 기존 nullable 필드의 생략은 별도 표식으로 표현해 명시적 삭제와 구분한다. | `strict-schema.test.ts`: required 규격, 원본 불변, 링크·메모 유지 및 명시적 삭제 |
| 비 Claude Code 맥락 | 맥락 도구가 없는 연결은 기본 설정에서도 업무 맥락을 인라인으로 받는다. | `provider-input.test.ts`: DB에만 있는 할 일이 세 API 요청에 포함됨 |
| 첨부 입력 | 텍스트·이미지·PDF를 공급자별 입력 형식으로 전달한다. Codex는 텍스트를 stdin에 포함하며 미지원 바이너리는 실행 전에 안내한다. | `provider-input.test.ts`: 실제 요청 생성 경로의 내용과 타입 검사 |
| 반복 일정 | DAILY의 BYDAY와 BYMONTH, 빈도별 BYMONTHDAY 필터를 COUNT 전에 적용한다. 조건에 맞는 날이 없는 기간도 조회 창을 넘으면 종료한다. | `ics.test.ts`: 평일 5회, 월 제한, 월별 복수 조건 |
| 데스크톱 테스트 | 디렉터리 대신 명시적인 파일 glob을 사용한다. | Node 24의 `npm test` |
| 플랫폼별 업데이트 | 이 포크의 릴리스 목록에서 현재 플랫폼용 파일이 있는 가장 높은 정식 버전을 찾는다. `-windows`는 버전 비교에서 플랫폼 표기로 처리한다. | `update-check.test.js`: macOS·Windows 분리 릴리스, 초안·미리보기 제외 |
| 개인정보 안내 | 로컬 저장과 외부 AI 전송을 README·Windows 안내·첫 AI 연결 화면에서 구분한다. | 문서와 요청 생성 코드 대조 |
| 머지 대상 고정 | 승인한 head SHA와 base·head 브랜치를 다시 확인하고 `--match-head-commit`으로 경쟁 상황을 막는다. SHA 없는 옛 승인 기록은 다시 요청해야 한다. | `merge-request.test.ts`: 커밋·브랜치 변경 차단, SHA 전달 |
| 머지 응답성 | 외부 머지 명령을 비동기로 실행하고 120초 제한을 둔다. | `fixer.test.ts`: 실행 인자와 제한 시간 검사 |
| 자동 검증 | macOS·Linux 에이전트 전체 테스트, 세 OS 데스크톱 테스트, Windows 에이전트의 플랫폼·공급자·일정 계약 테스트를 추가한다. | `.github/workflows/checks.yml` |

## 실행

Node.js 24 이상이 필요하다.

```sh
cd agent
npm ci --ignore-scripts --no-audit --no-fund
npm test
cd ../desktop
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

## 기능과 검증의 경계

- AI 공급자 테스트는 HTTP 요청을 가짜 응답으로 대체한다. 실제 계정의 인증·모델별 파일 지원·응답 품질·요금은 별도 확인이 필요하다. API 키 연결에서는 작은 텍스트·이미지·PDF를 지원하며, 로컬 도구가 필요한 형식이나 인라인 한도를 넘는 파일은 안내 후 중단한다.
- 셸 차단은 명령 문자열을 해석하는 정책이며 운영체제 샌드박스가 아니다. 임의 프로그램이 내부에서 수행하는 동작까지 차단한다고 보장하지 않는다.
- Electron 실행 파일 설치를 생략한 검사에서는 패키지 런타임 검사가 생략된다. 실제 패키지 실행과 화면 검증은 별개다.
- Windows 에이전트 전체 테스트에는 기존 POSIX 경로 가정이 있어 CI에서는 타입 검사와 명시한 테스트만 실행한다. Windows에서 전체 앱을 검증했다는 의미는 아니다.
- 업데이트 대상은 `Lee-DoHa/usagi-agent`다. 포크에 릴리스가 없으면 알림도 없다. 원본 릴리스의 설치 파일을 포크 업데이트로 안내하지 않는다.
- 원본 라이선스와 제3자 고지는 유지한다. 새 캐릭터 추가와 앱 전체 리브랜딩은 이 변경의 범위에 포함하지 않는다.

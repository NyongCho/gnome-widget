# 검증 기록

## Task 0 — 2026-11-03

대상: Ubuntu 26.04.1 x86_64, Rust 1.99.1, Node 24.22.2, GJS 1.88.0, libical 3.0.20.

전체 명령: `./scripts/check.sh`

- Rust calendar integration: 27개 통과.
- Rust protocol integration: 6개 통과.
- TypeScript protocol: 19개 통과.
- Cargo fmt, Clippy(`-D warnings`), TypeScript production/test 타입 검사 통과.
- 후보 라이브러리 probe 실행: `ical` 구문 파싱, `rrule` 기본 반복 성공·custom TZID 미지원 확인.
- GJS에서 생성된 ESM 검증기를 실행하고 한글·provider payload·설정·오류 처리를 확인했다.
- GIO D-Bus 파서로 실제 introspection XML을 읽었다.

첫 주간 EXDATE 테스트는 빈 구현에서 assertion 실패를 확인한 뒤 구현했다. 이후 날짜 변경·취소·종일·범위·밀집 반복·공통 계약 테스트를 실패시킨 뒤 구현했다. DST gap/fold와 JSON 정수의 `1.0` 표기는 추가 회귀 테스트에서 실패를 재현하고 수정했다.

## 아직 검증하지 않은 것

- 실제 사용자 세션 장시간 사용과 GPU 성능 예산. 단일 카드 렌더링·분수 배율·DING 입력 공존은 아래 Task 1에서 검증했다.
- 실제 사용자 서비스 설치/제거. 격리된 bus에서의 실제 호출·owner 변경·재연결은 아래 Task 2에서 검증했다.
- Google Calendar 실제 비공개 피드, 키링·네트워크·날씨·시스템 측정.
- native 파서의 하드 CPU/메모리 격리. 지금의 입력·회차·iterator 예산과 별개다.

이 항목들은 각각 Task 1 이후의 인수 조건이며 Task 0 성공으로 대신하지 않는다. 재현 명령과 일정 지원 범위는 [개발 환경](setup.md), [캘린더 적합성 검증](calendar-feasibility.md)에 있다.

## Task 0 코드 리뷰

별도 읽기 전용 리뷰에서 중요한 문제 두 건을 확인하고 수정했다. 자정 gap에서 종일 날짜가 전날로 바뀌는 문제, DST가 아닌 offset 후퇴에서 두 번째 시각을 고르는 문제, 존재하지 않는 DTSTART의 잘못된 시각을 회귀 테스트로 재현했다. 시간대가 선언한 offset 후보를 실제 시간 변환과 대조하고 DATE 필드는 그대로 보존하도록 수정했다. gap 안의 DTSTART를 COUNT에 한 번 포함하도록 하는 별도 테스트도 실패 후 통과했다.

경미한 미해결 항목 한 건: `generatedAt` 등의 날짜와 시각 사이에 공백을 넣은 비표준 입력을 Ajv는 허용하고 Rust는 거부한다. 현재 생산하는 시간은 모두 `T` 구분자를 사용한다. 외부 protocol 입력을 넓히기 전에 공통 fixture에 추가해 두 검증기의 허용 범위를 맞출 필요가 있다.

Task 1+ 기능과 native hard CPU/메모리 격리, sanitizer/fuzz 인증은 이번 리뷰의 완료 범위가 아니다.

## Task 1 — 2026-11-03

`./scripts/check.sh`와 `./scripts/test-gnome.py`를 실행했다. 실제 GPU를 사용하는 GNOME Devkit 창에서 굴절·배경 좌표·글자 보존, 카드 클릭, DING 아이콘 선택/드래그, 일반 창 겹침, 125% 배율, 배경 변경과 캐시 분리, overview/workspace, Blur my Shell 공존을 검증했다. 상세 재현 과정과 범위는 [셰이더 검증 기록](shader-spike.md)에 있다. 사용자 세션의 설치·장시간 동작 검증을 대신하지 않는다.

## Task 2 — 2026-11-04

`./scripts/check.sh`는 Rust 46개, TypeScript 31개 테스트와 fmt/clippy/typecheck/build, GJS validator smoke, 실제 Rust–GJS IPC를 검사한다. IPC 테스트는 별도 bus와 임시 XDG 경로를 사용한다. 구독 2개 중 하나 해제, sender 소실·지연 등록, 재시작, 원래 출처의 늦은 결과·이전 캐시 차단, 원자적 파일 교체·권한, native worker 실행 제한을 검증했다.

실제 GJS에서 Rust 실행 파일을 시작하고 provider 신호, 설정 변경, owner 재시작, 마지막 상태 유지, disable 후 공유 bus 유지가 통과했다. GNOME 시각 회귀 검사에서는 한 차례 DING 활성화 직후 카드 클릭이 누락됐다. 재실행에서 actor pick과 클릭 횟수 진단을 추가한 상태로 통과했으며, 재현 원인은 확정하지 못했다. Task 3의 입력·수명 검증에서 계속 확인할 항목으로 남긴다. 서비스 부재 안내와 실제 Rust 서비스 연결 상태의 GNOME 캡처도 확인했다. 최종 실행에서도 DING 클릭·드래그와 GNOME–Rust 연결이 통과했다.

아직 실제 provider 조회/키링 저장과 systemd 설치를 완료한 것은 아니다. 현재 범위와 한계는 [데이터 서비스](data-service.md)에 기록했다.

Task 2 리뷰에서 같은 owner의 일시적 IPC 실패 뒤 자동 재시도가 없던 문제와 초과 응답이 이전 정상 데이터를 지우던 문제를 재현했다. 취소 가능한 최대 30초 backoff, 개별/전체 payload 초과 시 stale 데이터 보존으로 수정했고 회귀 테스트를 추가했다.

## Task 3 — 2026-11-04

시계·월간 달력·날씨·일정·네트워크 기본 카드, 선택적 시스템·음악, 크기·불투명도·굴절 설정과 고정 설정 버튼을 구현했다. 작은 작업 영역에서는 1열과 내부 스크롤로 바뀐다. 실제 서비스가 없으면 연결 대기를 표시하고 시계는 독립적으로 동작한다.

실제 GNOME 50 / NVIDIA Devkit에서 125% 배율, 300×420 작업 영역 주입, 스크롤 하단, 12/24시간 전환, Rust 서비스 연결/종료, DING·Blur my Shell 공존, 카드 8회 클릭과 일반 창 아래 입력, overview 숨김, enable/disable 20회 후 actor·timer·display signal 정리를 검사했다. 시간대는 고정 시각/시간대를 UI에 주입하고, 절전 복귀는 LoginManager 신호를 발생시켜 처리 경로를 검사했다. 실제 OS 시간대 변경이나 하드웨어 절전/모니터 분리는 하지 않았으며 최종 인수 항목으로 남긴다.

캡처에서 발견한 재활성화 후 카드 내용 축소를 실제 allocation assertion으로 재현해 수정했다. Cogl 50의 snippet pointer 기반 캐시를 확인하고 불변 snippet을 공유해 20회 반복 시 50개 이상 shader/program 생성 경고를 없앴다. [Cogl 50.1 소스](https://github.com/GNOME/mutter/blob/50.1/cogl/cogl/cogl-pipeline-snippet.c)를 기준으로 확인했다. 텍스트 갱신은 굴절 입력 캐시를 다시 그리지 않는다.

입력 테스트의 일반 창 겹침 실패는 unmapped/0×0 perf-helper 창을 검사한 테스트 문제였으며 실제 map과 allocation을 기다린 뒤 통과했다. 이전에 관찰한 간헐적인 가상 포인터 클릭 누락은 진단 실행에서 재현되지 않았다. 물리 포인터와 장시간 실제 세션 입력 확인은 Task 7에 남긴다.

재현: `./scripts/check.sh`, 전체 카드 `./scripts/test-gnome.py`, 단일 굴절 회귀 `./scripts/test-gnome.py --spike`. 개인 캡처는 ignored `.superpowers/sdd/liquid-glass-plan/screenshots/`에 보관한다. 실제 계정 데이터 연동과 최종 UI 세부 표현은 Tasks 4–7의 범위다.

최종 Task 3 검증: Rust 46개 + TypeScript 40개, 타입 검사·빌드·실제 GJS IPC가 통과했다. 전체 카드 GUI와 `--spike` 굴절 회귀 모두 exit 0. 별도 GTK4/Adwaita 설정창이 실제 GNOME에 표시되는 캡처를 확인했다. 테스트용 D-Bus activation 환경을 임시 XDG 경로/개발 디스플레이로 명시해 바깥 세션과 분리했다.

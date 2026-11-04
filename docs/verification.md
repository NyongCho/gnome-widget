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

## Task 0 당시 미검증 항목 (후속 결과는 아래 기록 참고)

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

## Task 4 — 2026-11-04

Rust 55개 + TypeScript 45개와 fmt/clippy/typecheck/build/GJS IPC가 통과했다. 별도의 실제 Google 공개 iCal 피드 조회·파싱 검사도 통과했다. 실제 private D-Bus와 임시 XDG 경로의 GNOME keyring에서 저장·조회·삭제·잠긴 항목 오류를 검증했다. 개인 비공개 주소와 사용자 키링은 사용하지 않았다.

수집기·서비스 연결 검사는 설정 IPC → source UUID/키링 저장 → HTTP 대역 → 실제 libical 확장 → provider snapshot → 원본 캐시 → 오프라인 시간대 재계산 → 연결 해제·캐시 삭제 → 재시작 순서로 수행했다. HTTP 검사에는 실제 localhost 응답의 크기/403/429/리디렉션/timeout이 포함된다. 확장 한도와 미지원 규칙은 기존 27개 엔진 검사를 그대로 유지한다.

GNOME 화면에서는 테스트 일정 세 개와 오늘의 일정 점, 종료 일정 제외, 현재 UI와 다른 시간대 응답 숨김을 확인했다. 별도 GTK 설정창은 비밀 입력을 마스킹하고 요청 시 즉시 지운다. 카드 클릭의 Google Calendar 홈 URI는 격리된 기본 처리기에 전달됨을 검사했다. 개인 브라우저 로그인/비공개 피드 실사용은 사용자 인수로 남긴다.

## Task 5 — 2026-11-04

전체 검사에서 Rust 62개 + TypeScript 47개와 타입 검사·빌드·GJS IPC가 통과했다. 실제 Open-Meteo 검색·현재/6시간 예보 live probe도 별도로 통과했으며 실제 사용자 지역은 저장하지 않았다. D-Bus 검색/선택/해제, 검색 실패 후 기존 선택 유지, stale 원래 성공 시각, 60초 수동 갱신 제한을 검증했다. 도시 A의 지연 응답이 B를 덮지 않고 B가 빈 loading 상태에서 시작하는 테스트는 실패 후 통과했다.

GNOME 캡처에서 정상·오프라인 예보, 누락값과 0 구분, 데이터 설정 화면과 출처 링크를 확인했다. 도시 교체 시 이전 도시 제목이 남는 문제를 실제 GUI assertion으로 재현한 뒤 기본 카드 제목을 복원하도록 수정했다. 최종 GUI 검사와 수정 후 타입 검사·빌드가 통과했다. 개인 지역 입력은 사용자 단계이며, 실제 GTK 검색/선택 키보드 흐름은 Task 7 인수에서 다룬다.

## Task 6 — 2026-11-04

CPU 첫 표본·guest 중복 제외·카운터 초기화, MemAvailable 기반 RAM, 센서 부재/CPU 패키지 선택, 네트워크 실경과 시간·동일 카운터 0·NIC 전환·60초 history, MPRIS 재생 우선/동률/일시정지/종료와 로컬 artwork 검사를 추가했다. 전체 검사는 Rust 74개 + TypeScript 49개 및 GJS IPC가 통과했고, 추가 FIFO artwork 회귀 테스트를 포함한 media 5개와 clippy/build도 통과했다(최종 Rust 총 75개). FIFO를 일반 파일처럼 열어 worker가 멈추는 실패를 재현한 뒤 nonblocking open과 일반 파일 확인으로 고쳤다.

실제 private D-Bus의 MPRIS 플레이어를 생성·재생·일시정지·종료해 각 변경이 3초 제한 안에 전달됨을 검사했다. 구독이 필요 없는 카드는 수집하지 않고, CPU·네트워크·음악은 재시작 뒤 디스크 상태를 복원하지 않는다.

`cargo test --test network live_metrics_with_active_tailscale -- --ignored --nocapture`를 명시적으로 실행했다. Tailscale Running 상태에서 자동 `enp5s0`의 RX 약 42.7 kB/s, TX 약 5.7 kB/s와 CPU 8.4%, RAM 13,530,468,352/32,951,459,840 bytes, CPU 온도 42°C를 읽었다. 표본 시점의 값이며 부하 목표 측정은 아니다. 일반 공개 HTTPS 트래픽을 사용했고 사설 Tailscale peer에 시험 트래픽을 보내지 않았다. 명시적 `tailscale0` 전환에서 속도와 history가 초기화됐다.

실제 GNOME에서 live CPU/RAM/온도·네트워크 그래프, 재생 카드·기본 음악 아이콘과 숨김을 캡처해 확인했다. 아이콘은 비동기 로딩 완료 후 캡처하도록 검사기를 보완했다. 반복 실행 중 기존 가상 마우스 8회 검사에서 7회만 도달한 사례가 다시 있었다. 매 클릭마다 장치를 제거/추가하던 검사기를 하나의 지속 마우스로 바꾼 최종 실행은 8/8과 20회 cleanup까지 exit 0였다. 이것만으로 물리 입력 문제의 근본 원인이 확정되지는 않는다. 별도 실행의 clock cache assertion도 한 차례 실패했으나 진단을 추가한 후 두 번의 후속 실행에서는 재현되지 않았다. Task 7 장시간·성능 검사에서 계속 관찰한다.

## Task 7 — 배포와 최종 인수, 2026-11-04

설치/제거는 실제 서비스 활성화와 분리한 임시 루트에서도 실행하며, 기존 프로그램 백업·교체·시작 실패 복구·다른 확장 보존·명시적 purge를 검사한다. 키링 삭제 실패는 완료로 처리하지 않고 재시도할 프로그램을 남긴다. 설치된 앱 디렉터리에도 제거 도구를 보관한다. 배포 ZIP에는 읽을 수 있는 JS/GLSL/CSS/schema/metadata만 포함하며 Rust 실행 파일은 별도다.

실제 GTK 설정창에서 가상 키보드로 Tab/Shift+Tab, 모니터·위치·여백·NIC 선택, 지역 검색·선택·해제, 캘린더 입력·저장·해제·오류 안내를 검사했다. 입력 주소는 공개 fixture이고 사용자 키링은 사용하지 않았다. Shell/GTK 전용 import가 서로 섞이지 않는 빌드 검사도 수행한다.

실제 GNOME Devkit의 `unlock-dialog` session mode에서 확장 root가 0개가 되고 일반 모드에서 1개로 복구되는 것을 확인했다. 이는 물리 잠금·비밀번호 인증을 거친 검사와 구분한다. FBO 할당 오류를 주입해 예외 반복 없이 반투명 모드로 바뀌는 경로를 검사했고, 안내문이 카드 밖으로 나가는 회귀도 검증한다. 이 fallback이 모든 GPU 드라이버의 비동기 오류를 감지한다고 주장하지 않는다.

밝은 배경의 작은 글자 대비를 위해 전경에 그림자를 넣었고 불투명도 조절을 제공한다. 최종 디자인 선호는 사용자 확인이 필요하다. 개인 일정은 모든 캡처에서 사용하지 않았다.

### 요구사항별 증거

| 요구 | 구현·검사 증거 | 남은 실제 사용 확인 |
|---|---|---|
| F-01 굴절 | 실제 NVIDIA Devkit `--spike`: 배경 굴절, 정렬, 선명한 텍스트, 배경 교체; 밝음/어두움 캡처 | 사용자의 배경에서 디자인 선호 |
| F-02 시계 | pure clock tests, 실제 12/24시간 전환, 시간대 주입, resume 신호 | 물리 절전과 OS 시간대 변경 |
| F-03 달력 | 월 경계/주 시작/오늘·일정 점, 실제 카드 클릭 URI | 개인 일정 표시 |
| F-04 일정 | 27개 엔진 검사, 실제 공개 Google 피드, 격리 키링/HTTP/IPC, 일정 3개 UI | 개인 비공개 피드·브라우저 로그인 |
| F-05 날씨 | 실제 Open-Meteo probe, 누락/0·도시 교체·오프라인 fixture, GTK 검색 | 사용자 지역 선택 |
| F-06 시스템 | `/proc`·센서 fixture와 실제 CPU/RAM/온도 수집 | 지원 외 센서는 unavailable |
| F-07 네트워크 | 실제 Tailscale 활성 환경의 물리 NIC 측정, 수동 NIC·초기화 검사 | 사설 VPN peer 트래픽은 미시험 |
| F-08 음악 | 실제 private-bus MPRIS 재생/일시정지/종료, UI cover/기본 아이콘 | 사용자의 플레이어에서 실사용 |
| F-09 설정 | 키보드 prefs, 작은 화면 스크롤, 125%, 모니터 소실 주입 | 재로그인 유지·물리 모니터 분리 |
| F-10 복구 | 실제 서비스 재시작/owner loss, 취소·출처 교체·오프라인 캐시·오류 검사 | 실제 인터넷 연결 끊기는 미실행 |
| Q-01 데스크톱 공존 | DING 아이콘 선택/드래그, 8회 카드 클릭, 앱 겹침, overview/workspace, BMS/Dock | 실제 세션 장시간 마우스 사용 |
| Q-02 성능 | 실제 GPU OFF/ON 3쌍, Shell/service CPU·RSS/FBO와 device-global GPU 계측 | 전체 환경의 presentation latency는 미계측 |
| Q-03 수명주기 | 30분 soak·20회 enable/disable 결과는 성능 기록 참조; 실제 서비스 재시작 | 물리 절전·모니터 분리·재로그인 |
| Q-04 비밀 보호 | 실제 임시 keyring CRUD/lock, config·snapshot·cache 권한, disconnect purge | 개인 키링 잠금 해제는 사용자 수행 |
| Q-05 잠금 비노출 | 실제 private Shell unlock-dialog 모드에서 위젯 root 제거 | 실제 잠금/인증 화면 육안 확인 |
| Q-06 가독성/접근 | 밝음/어두움/복잡한 배경·125%, 키보드 입력/선택/저장/해제/오류 | 사용자 취향·실제 디스플레이 가독성 |
| Q-07 되돌리기 | 설치 정책 7개 회귀, 실제 staging 설치/업데이트/제거, keyring purge CLI | 사용자 실제 데이터 purge는 실행하지 않음 |

### 남겨 둔 사용자 단계

설치 후 로그아웃·로그인, 비공개 iCal 주소 입력/필요한 키링 해제, 날씨 도시 선택, 브라우저 계정 로그인, 실제 배경에서 외형 확인이 필요하다. 물리 잠금·절전/복귀·모니터 분리는 사용자가 작업을 저장한 뒤 확인한다. 자동화는 실제 사용자 세션을 강제 종료하거나 개인 캘린더 주소를 가져오지 않는다.

최종 `./scripts/check.sh`: Rust 75개, TypeScript 49개, Python 설치 회귀 7개와 fmt/clippy/typecheck/build, GJS smoke/IPC, metadata/schema/import 검사가 통과했다. 실제 staging 배포본을 두 번 설치해 백업을 확인하고 **설치된 경로의 제거 도구**로 제거했다. `--spike`, `--preferences`, `--benchmark`는 최종 코드에서 exit 0였다. [실제 화면](../outputs/verification/README.md)과 [성능 원본·방법](performance.md)을 보존한다.

환경 경고는 결과와 구분했다. 로컬 전용 UUID의 확장 사이트 조회 404, 임시 GIO local backend의 Ubuntu Dock `trash://` 미지원, private bus 종료 시 EDS/portal 경고가 로그에 있다. 사용자 세션을 보존하는 검사 환경에서 나온 경고이며 제품 예외나 완전 무경고 실행으로 주장하지 않는다. 긴 soak의 제품 actor/FBO 추이와 완료 결과는 성능 기록에 있다.

최종 전체 GUI 검사도 exit 0: 카드 배치·오류 fallback 경계·잠금 모드·8/8 클릭·20회 cleanup을 통과했다. 30분 soak와 뒤이은 20회 재활성화도 exit 0이며 메모리/FBO 추이를 [성능 기록](performance.md)에 기록했다.

20회 이후 Shell RSS 증가를 확인해 60회까지 추가 진단했다. 20→40→60 구간의 추이와 한계는 [성능 기록](performance.md#rss-증가-추가-진단)에 있다.

## 최종 전체 변경 리뷰와 수정

Tasks 3–7(`e482e8d..519b4f6`)을 별도 fresh-context 리뷰어가 한 번 읽기 전용 검토했다. Critical은 없었고 Important 7개를 모두 수용해 한 번의 수정 단계에서 처리했다.

| 발견 사항 | 수정과 실패→성공 증거 |
|---|---|
| 재연결이 기존 키링 삭제 대기를 지움 | pending flag를 성공한 전체 연결 해제까지 유지; 잠금→삭제 실패→재연결/재교체→전체 삭제 Rust 회귀 |
| 일정 날짜 누락 | 날짜·요일·시각 또는 종일을 표시; caption 회귀와 실제 GUI 캡처 |
| 30일 밖의 일정 표시 | 월간 grid와 별도로 [오늘, 오늘+30일) 및 진행 중 일정 필터; 12월4일 회귀 |
| 종일/시간 일정 정렬 오류 | 표시 시간대의 날짜·시간으로 혼합 비교; 서울 11월5일 종일 vs UTC11월4일16시 회귀 |
| UI 42칸과 엔진 조회 범위 불일치 | 최소 완전한 주 단위 grid로 일치; 2027년2월28칸 및 일요일 시작35칸 회귀 |
| 반투명 fallback이 stale/오류를 가림 | 렌더링 안내는 제목 옆, 데이터 상태는 footer 유지; 실제 GNOME 상태/시각/경계 assertion |
| 같은 날 절전 복귀 시 원격 데이터 미갱신 | 활성·설정된 calendar/weather Refresh, loading+기존 성공 시각, 실패 시 취소 가능한60초 재시도; client/실제 resume signal 회귀 |

수정 후 전체 검사 **Rust 76개 + TypeScript 55개 + Python 7개**, fmt/clippy/typecheck/build/GJS/IPC/schema 검사가 통과했다. 실제 전체 GUI도 exit 0로 날짜·fallback stale 안내·resume 연결·8/8 클릭·20회 cleanup을 통과했다. 물리 절전 인수는 여전히 사용자 단계다. 새 Minor는 없었으며 이전 Task0의 Ajv 날짜 구분자 허용 차이는 그대로 문서화했다. 결정과 리뷰 범위 판단은 [전체 결정 기록](implementation-decisions.md)에 보존했다.

## 실제 사용자 영역 설치

2026-11-04에 최종 release 배포본을 사용자 영역에 설치했다. systemd 서비스 active/enabled, 실제 세션 D-Bus GetSettings/GetSnapshot, 서비스 재시작, 설치한 JS/CSS/metadata/실행 파일과 배포본 일치, 개인 디렉터리0700을 확인했다. 다른 GNOME 확장의 활성/비활성 목록을 보존했다. 캘린더는 disabled/unconfigured, 날씨 지역은 null/unconfigured다. 제거 도구는 `~/.local/lib/liquid-widgets/uninstall.py`에 있다.

새 확장 활성화 항목은 저장했으며 코드가 바깥 Wayland Shell에 로드되려면 사용자가 **로그아웃·로그인**해야 한다. 현재 세션을 종료하지 않았다. 실제 외형 확인은 로그인 후 진행한다. 최종 리뷰 수정 뒤 OFF/ON 측정도 exit0이며 [성능 기록](performance.md)의 최신 JSON을 갱신했다. [설치 확인 항목](../outputs/verification/installation.json)을 보존한다.

## 개인 iCal 연결 후 동기화 오류 수정 — 2026-11-04

사용자가 재로그인하고 비공개 iCal을 연결한 뒤 서비스는 `unavailable / INVALID_DATA`였지만 설정창은 저장 직후의 대기 안내만 보여 주었다. HTTP 수신은 정상이었으며, libical이 빈 DESCRIPTION·LOCATION을 제거하며 남긴 진단과 가져온 일정에 이미 들어 있던 같은 X-LIC-ERROR 때문에 달력 전체를 거부했다.

DESCRIPTION·LOCATION·SUMMARY의 정확한 ‘No value’ 진단과 콜론 뒤 문맥만 허용해 해당 경고를 제거한다. 날짜·시간대·반복 규칙 등 다른 오류는 계속 거부한다. 빈 필드, 연속 경고, 접힌 제목, 접미사가 있는 기존 경고, 잘못된 날짜에 대한 합성 회귀 3개를 추가했다. 설정창은 실제 calendar provider를 구독해 동기화 성공·오류·마지막 데이터 표시를 반영하며 닫을 때 구독을 해제한다.

전체 `./scripts/check.sh`가 exit 0: Rust 79개(격리 subprocess 재실행 중복 제외), TypeScript 56개, Python 7개와 fmt/clippy/build/typecheck/GJS/IPC 검사를 통과했다. 실제 GTK `--preferences` 검사도 오류→동기화 완료 전환을 통과했다. 회귀에는 공개 fixture/합성 일정만 사용했다.

release 배포본을 기존 설치에 반영하고 서비스 재시작 후 실제 비공개 피드의 `status=ok`, `errorCode=null`과 연결 설정 유지, service active/enabled, extension ACTIVE, 설치 파일 일치를 확인했다. Shell의 `extension.js`는 기존 파일과 같아 재로그인하지 않았다. 새 설정 화면은 창을 닫고 다시 열면 적용된다. 주소·일정 내용은 로그나 저장소 증거에 포함하지 않았고 일회성 진단 코드는 제거했다. [비식별 상태 확인](../outputs/verification/calendar-sync.json)을 보존한다.

## 한국어·영어 선택 — 2026-11-04

앱 GSettings `language`에 `ko`/`en` 선택을 저장하며 기본값은 `ko`다. 공용 메시지 사전과 locale 매핑으로 설정·위젯·오류·동기화·날씨·접근성 이름 및 날짜/요일/종일을 함께 바꾼다. 외부 일정/음악/도시 이름은 원문이다. 설정창의 문구만 바꾸므로 입력값과 비동기 상태가 유지되며 언어 변경으로 데이터 구독을 재시작하지 않는다.

영어 요청에 한국어가 반환되는 실패를 먼저 확인한 뒤 공용 표시 회귀 3개를 추가했다. 최종 `./scripts/check.sh`는 Rust 79개, TypeScript 59개, Python 7개와 fmt/clippy/typecheck/build/GJS/IPC 검사를 통과했다. 실제 GTK 검사에서 언어 선택 컨트롤 부재→한국어/영어 양방향 전환, iCal·도시 초안 유지, 언어 변경 후 늦게 도착하는 검색 결과, 창 재개방과 저장된 언어 복구를 확인했다. 재개방 검사는 닫힌 창이 GC 전까지 캘린더 구독을 남기는 문제도 발견했다. 정리는 `close-request`와 `destroy` 중 먼저 발생한 시점에 한 번 실행하도록 고쳤으며 구독 2개→1개를 검증했다.

실제 Shell 검사는 언어별 날짜·요일·월, 시스템 시계 tick 이후 언어 유지, 연결된 서비스의 구독 token 유지, provider 갱신 후 영어 표시와 원문 일정 유지, 영어 fallback 경계, 재활성화 20회 후 언어 유지를 포함해 exit 0였다. 설정 선택 검사의 초기 가상 키보드 입력은 popover focus와 경합했다. 검사기가 해당 선택지의 실제 focus를 기다리도록 고쳤으며 제품 선택 코드는 변경하지 않았다. 기존 GNOME 테스트 환경 경고는 남지만 제품 예외나 검사 실패는 없었다.

[한국어 설정](../outputs/verification/language/preferences-korean.png), [영어 설정](../outputs/verification/language/preferences-english.png), [영어 데이터 화면](../outputs/verification/language/preferences-english-data.png), [영어 위젯](../outputs/verification/language/widgets-english-data.png), [영어 fallback](../outputs/verification/language/widgets-english-fallback.png)은 격리된 GNOME 세션의 합성 데이터 캡처다.

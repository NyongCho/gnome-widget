# TypeScript 공개용 에디션 설계

2026-11-06 · 상태: 구현 전 제안. 현재 기준 커밋 `87e0104`.

## 목적과 범위

개인용 Rust 서비스는 유지하고, 같은 저장소에서 GNOME Extensions 배포를 목표로 하는 TypeScript/GJS 에디션을 만든다. UI·설정 화면·셰이더를 복제하지 않고 데이터 서비스 구현을 빌드 시 선택한다. 이번 문서는 계획이며 현재 설치된 확장이나 서비스를 바꾸지 않는다.

공개용도 현재 기능 전체를 제공한다. 시계 네 가지, 월간 달력, Google Calendar iCal과 다음 일정, 날씨, CPU·RAM·온도, 네트워크, MPRIS와 앨범 이미지가 모두 포함된다. 한/영, 테마, 독립적인 좌우 열, 카드 순서·배율, 유리 설정과 시간에 따라 바뀌는 배경화면 처리도 공유한다. Google 로그인과 일정 편집은 기존처럼 브라우저에서 한다.

첫 지원 대상은 **GNOME Shell 50**이다. 공개용 실행에 Rust 바이너리, Node.js, npm 설치, libical, 별도 systemd 서비스 설치를 요구하지 않는다. TypeScript와 Node.js는 개발·빌드 도구다. 시스템 GJS·GIO·Soup 3·Secret 1 사용 가능 여부는 초기 검증에서 확인한다.

## 조사 결과와 선택

현재 프런트엔드는 이미 TypeScript/GJS다. `extension/src/shared/dataClient.ts`가 `Transport`를 통해 서비스에 연결하고, `extension/src/dbus.ts`가 세션 D-Bus를 구현한다. 달력·날씨 설정창도 동일한 D-Bus를 사용한다. 따라서 서비스의 언어를 바꾸는 것이 핵심이며 화면 전체를 재작성할 이유가 없다.

| 선택지 | 장점 | 비용 / 판단 |
| --- | --- | --- |
| 모든 데이터 처리를 Shell 안에서 실행 | 별도 프로세스가 없음 | ICS 파싱·반복 계산이 Shell 이벤트 루프를 막을 수 있음 |
| Shell 내 provider + 달력 전용 작업 프로세스 | 무거운 계산만 분리 | 설정창용 서비스와 상태 저장 경계를 새로 설계해야 함 |
| 기존 계약의 GJS 데이터 작업 프로세스 | 화면·설정·IPC 계약 재사용, 계산이 Shell과 분리됨 | GJS 프로세스 메모리 및 종료 관리, 심사상 추가 설명 필요 |

**세 번째 방식을 우선 검증한다.** 상시 자동 시작 서비스가 아니라 확장 또는 설정창이 사용하는 동안만 살아 있는 GJS 프로세스다. `async`만 붙여서는 CPU 계산이 별도 스레드로 이동하지 않는다. [GJS 비동기 실행 문서](https://gjs.guide/guides/gjs/asynchronous-programming.html)

GNOME 심사 규정은 읽을 수 있는 JS와 TS의 변환 결과를 허용하며 바이너리 실행 파일·라이브러리 동봉을 금지한다. 외부 프로세스 사용은 권장되지 않고 필요한 경우 GJS 스크립트와 정상 종료를 요구한다. 따라서 **GJS로 바꿨다는 이유만으로 등록 승인이 보장되지는 않는다.** 달력 계산 분리의 필요성과 실제 종료 증거를 배포 문서에 남긴다. 이 구조가 검증이나 심사에서 부적합하면 별도 설계 변경으로 돌아가며, 달력 기능을 조용히 제거하지 않는다. [공식 심사 규정](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)

## 공통 부분과 에디션 경계

```text
공유: 위젯 / GTK 설정 / i18n / 레이아웃 / GLSL / JSON schema / DataClient
                             │
                    빌드 시 BackendSession 선택
                     ┌───────┴────────┐
개인용               │                │               공개용
기존 세션 D-Bus → Rust 서비스    전용 세션 연결 → GJS 작업 프로세스
기존 systemd / libical                         Gio / Soup / Secret / ical.js
```

`protocol/org.local.LiquidWidgets1.xml`의 메서드·시그널과 JSON schema v1을 양쪽 구현의 공통 계약으로 유지한다. 공개용은 별도 bus 이름을 사용하되 인터페이스와 object path를 유지한다. 프런트엔드가 backend를 자동 탐색하거나 설치된 Rust로 몰래 대체하지 않는다.

| 항목 | 개인용 `rust` | 공개용 `gjs` |
| --- | --- | --- |
| 확장 UUID | `liquid-widgets@local` 유지 | `liquid-widgets@nyongcho.github.io` 제안 |
| 데이터 bus 이름 | `org.local.LiquidWidgets` 유지 | `io.github.NyongCho.LiquidWidgets` |
| GSettings schema | 기존 값 유지 | `org.gnome.shell.extensions.liquid-widgets-public` |
| config/cache 디렉터리 | `liquid-widgets` 유지 | `liquid-widgets-public` |
| 서비스 설정 | 기존 TOML 유지 | 버전이 있는 JSON, 같은 공개 Settings DTO |
| Secret Service 앱 식별자 | 기존 값 유지 | `io.github.NyongCho.LiquidWidgets` |
| 빌드 출력 | `extension/dist` 유지 | `extension/dist-gjs` |

공개용 설정은 별도 namespace에서 시작한다. 기존 비공개 iCal 주소·키링 항목을 자동으로 읽거나 복제하지 않는다. 처음 공개용을 실제로 사용할 때 설정창에서 주소와 지역을 입력한다. 개인용 제거·데이터 이동·자동 전환은 이번 범위 밖이다. 두 에디션을 동시에 켜면 카드가 겹칠 수 있으므로 비교는 번갈아 실행한다.

## 프로세스 수명과 설정창

1. 확장과 설정창은 각각 자신이 소유하는 **전용 세션 D-Bus 연결**을 만든다. GNOME Shell의 공유 `Gio.DBus.session`을 닫지 않는다.
2. 공개용 서비스 owner가 없으면 `Gio.Subprocess`에 인자 배열로 `gjs -m <설치 경로>/service.js`를 전달한다. URL·토큰은 인자, 환경변수, 로그에 넣지 않는다. 동시 시작은 D-Bus 이름의 `DO_NOT_QUEUE` 획득으로 단일 승자를 정하고 나머지는 종료한다.
3. 별도 공개용 `Runtime1` 인터페이스의 `AcquireClient() → token`, `ReleaseClient(token)`으로 수명을 관리한다. 토큰은 sender에 귀속되며 다른 sender가 해제할 수 없다. 데이터 구독과 클라이언트 수명은 구분한다. 설정창은 검색만 해도 서비스가 필요하다.
4. 확장 비활성화·설정창 종료 시 해당 클라이언트의 작업을 취소하고 연결을 닫는다. 서비스는 sender 소멸 시 구독과 수명 토큰을 모두 회수한다. 설정창이 열려 있으면 그 작업만 계속되며, 마지막 클라이언트가 사라지면 수집·HTTP·MPRIS watch·타이머를 정리하고 종료한다.
5. 아무 클라이언트도 얻지 못한 시작 프로세스는 5초 후 종료한다. 이미 사용한 서비스는 마지막 클라이언트 이탈 후 정상 조건에서 2초 이내 종료한다. 반복 enable/disable, 시작 도중 취소, 클라이언트 강제 종료와 달력 최대 입력에서도 이 조건을 검증한다.
6. owner 교체 시 기존 DataClient의 revision 초기화·재구독·last-good 보존 규칙을 유지한다. 재시작은 살아 있는 클라이언트에만 1→30초 backoff로 수행한다. 종료된 UI에 늦은 비동기 결과를 적용하지 않는다.

설정창은 backend 세션 하나를 달력·날씨·네트워크 설정에 공유한다. 확장이 꺼져 있어도 설정창에서 연결·검색·실제 동기화 상태를 사용할 수 있다. 저장 변경은 단일 서비스에서 직렬 처리하여 두 창의 설정 쓰기가 충돌하지 않도록 한다. [Gio.Subprocess 문서](https://gjs.guide/guides/gio/subprocesses.html)

## 제공자와 데이터 보존

다음은 새 동작을 발명할 항목이 아니라 현재 Rust 동작과 비교할 기준이다. 자세한 정의는 [데이터 계약](../../../protocol/README.md), [달력](../../calendar.md), [날씨](../../weather.md), [실시간 데이터](../../live-data.md)를 따른다.

| 영역 | 유지할 동작 |
| --- | --- |
| 공통 | payload 512 KiB, owner별 revision, source UUID·generation으로 이전 응답 폐기, 실패 시 last-good/stale와 원래 성공 시각 유지 |
| 수집 | 구독된 제공자만 동작. 날씨 900초, 달력 300초, CPU·네트워크 2초, 음악은 MPRIS 이벤트 |
| 날씨 | 지역 검색·현재·6시간 예보, null과 0 구분, 도시 시간대, 256 KiB/15초, 429와 backoff, 출처 표시 |
| 시스템 | `/proc/stat` 차이와 MemAvailable, 기존 hwmon 센서 우선순위, 최초 표본 null, 온도 재측정 최소 5초 |
| 네트워크 | IPv4/IPv6 기본 경로·metric, 자동 선택에서 loopback/Tailscale 제외, 수동 Tailscale 허용, 단조 시계·카운터 reset·60초 기록 |
| 미디어 | MPRIS owner·상태·곡 변경, 최대 32개 player, 플레이어별 2초 제한, playing만 표시, HTTPS/로컬 앨범·종횡비 유지 |
| 이미지 | 파일 8 MiB, 전체 64 MiB·64개, 5초 요청·2초 후 한 번 재시도·실패 주소 60초 대기, redirect 금지 |
| 개인 정보 | iCal URL은 Secret Service에만 저장. 새 source UUID로 교체. 해제 즉시 표시·캐시 제거, 키링 삭제 실패 시 비활성+삭제 대기 유지 |

Soup는 `send_async`로 받은 stream을 제한 크기만 읽고, header의 Content-Length만 신뢰하지 않는다. 압축 해제된 본문을 기준으로 제한하며 timeout/cancel/redirect 정책을 적용한다. [Soup API](https://libsoup.gnome.org/libsoup-3.0/method.Session.send_async.html)

설정·캐시 디렉터리 0700, 파일 0600, atomic replace와 오류 처리를 유지한다. 심볼릭 링크·비정상 파일·과대 입력을 거부한다. 캘린더·날씨만 오프라인 복원하며 시스템·네트워크·재생 상태는 재시작 후 재측정한다. 키링의 백그라운드 조회에서는 unlock 요청을 하지 않는다. [Secret 검색 flags](https://gnome.pages.gitlab.gnome.org/libsecret/flags.SearchFlags.html)

## iCal 엔진: 먼저 통과해야 하는 검증

후보는 의존성이 없는 JS 라이브러리 **ical.js**다. 아직 이 프로젝트의 fixture를 실행하지 않았으므로 호환 완료로 간주하지 않는다. 해당 라이브러리는 기본 배포에 IANA 시간대 데이터를 등록하지 않는다. **빌드에 고정된 IANA 데이터와 라이선스·버전을 포함**하고, 피드 내부 VTIMEZONE을 해당 피드에 우선 적용해야 한다. 런타임 CDN 다운로드나 알 수 없는 TZID의 로컬 대체는 하지 않는다. [ical.js README](https://github.com/kewisch/ical.js/blob/main/README.md), [TimezoneService](https://kewisch.github.io/ical.js/api/ICAL.module_TimezoneService.html)

기존 `tests/fixtures/calendar`와 Rust 테스트를 양쪽 엔진에 적용한다. 단순 출력 비교뿐 아니라 명시적인 기대 결과를 둔다. RRULE/RDATE/EXDATE, 옮긴·취소된 회차, occurrenceKey, all-day end-exclusive, floating, IANA·custom VTIMEZONE, DST gap/fold, STANDARD→STANDARD fold, COUNT/UNTIL, DURATION과 DTEND 차이, 조회 경계·진행 중 일정·빈 선택 필드를 모두 검사한다. [기존 엔진의 정확성 범위](../../calendar-feasibility.md)

입력 5 MiB, 후보/결과 10,000건, 반복 iterator 호출 총 100,000회 제한을 유지한다. 최대 128회 또는 4ms마다 GLib 루프로 양보하고 취소/generation을 확인한다. 단일 `parse()`나 `next()` 내부는 이 방법으로 선점할 수 없으므로 최대 입력·고밀도 반복에서 종료 지연과 worker 메모리를 별도로 측정한다. 상한을 만족하지 못하면 구현을 확대하기 전에 파서 분리 또는 분할 방식을 다시 설계한다.

기존 명시적 미지원 범위(RANGE=THISANDFUTURE, EXRULE, PERIOD RDATE, 중복 UID/RECURRENCE-ID의 SEQUENCE 병합)는 동일하게 오류로 표시한다. 새 라이브러리가 우연히 처리한다고 기존 계약을 암묵적으로 확대하지 않는다. 한계 초과도 부분 성공으로 보이지 않는다. 알려진 기존 기능을 빠뜨리는 결과는 공개용 출시 불가다.

## 검증과 성능 판단

모든 자동 검증은 합성 데이터·private D-Bus·임시 XDG·격리된 키링을 사용한다. 실제 개인 일정이나 URL을 fixture·캡처·로그에 남기지 않는다. Node 테스트는 순수 로직에, 실제 GJS 테스트는 GI·D-Bus·파일·HTTP·키링·프로세스 동작에 사용한다.

성능은 아직 측정 전이다. 같은 머신·GNOME·위젯·배경화면·합성 데이터에서 Rust와 GJS를 번갈아 5회 실행한다. 30초 준비 후 유휴 120초, 전체 카드 120초, 1천 건 일정 및 제한에 가까운 일정 갱신을 비교한다. 서비스 시작/달력 갱신 시간, 총 CPU, worker PSS/RSS와 Shell 증가분, 프레임 p95/p99·50ms 이상 stall, 종료 후 프로세스·FD·watch 수를 기록한다.

초기 수용 기준은 기능 fixture 전부 통과, 마지막 클라이언트 종료 후 2초 이내 worker 종료, 20회 수명 반복 후 프로세스/FD/watch 누수 없음이다. 프레임 p95가 Rust 대비 `max(2ms, 10%)` 이상 악화되거나 새 50ms stall이 5회 중 3회 이상 반복되면 조사 후 출시를 보류한다. 유휴 worker CPU는 한 코어 기준 평균 1% 이하를 목표로 한다. 메모리·달력 계산 시간은 실제 수치를 보고 판단하며 Rust보다 빠르다는 사전 가정은 두지 않는다. 이는 제안된 합격 기준이지 측정 결과가 아니다.

## 패키지와 배포

공개 ZIP에는 읽을 수 있는 extension/prefs/service JS, schema, CSS, GLSL, 고정 시간대 데이터와 필요한 라이선스만 포함한다. npm 모듈은 빌드 때 묶으며 설치 시 npm이나 shell 설치 스크립트를 실행하지 않는다. 개인용 패키지는 기존 방식으로 유지한다. 빌드별 metadata·UUID·schema·bus·캐시가 일치하는지 검사한다.

프로젝트 라이선스는 아직 없다. 공개 배포 준비 단계에서 소유자가 GPL 호환 라이선스를 선택하고 의존성의 고지·원문을 포함해야 한다. 이 설계 문서가 라이선스 허가를 대신하지 않는다. 실제 저장소 URL은 원격 저장소가 정해지면 metadata에 사용한다. 공개 UUID도 등록 전 충돌을 확인한다. GNOME Extensions 제출은 기능·성능·라이선스 검증을 마친 다음 별도 사용자 요청으로 수행한다.

구현 순서는 [실행 계획](../plans/2026-11-06-typescript-edition.md)의 12개 task를 따른다. Task 1에서 iCal 및 GJS 의존성·수명 검증이 실패하면 이후 전체 포팅을 진행하지 않고 결과와 수정 설계를 제시한다.

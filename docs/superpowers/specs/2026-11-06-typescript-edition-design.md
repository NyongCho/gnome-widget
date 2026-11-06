# TypeScript 공개용 에디션 — 달력 계산만 분리하는 설계

2026-11-06 · 구현 전 계획. 사용자 선택: 같은 저장소에서 Rust 개인용 유지, 공개용은 Shell 내부 제공자와 일시적인 GJS 달력 작업 프로세스 조합. 기준 커밋 `1b0d2d9`. 이전 전체 GJS 데이터 서비스 제안은 이 설계로 대체한다.

## 목표와 결정 근거

시계 네 가지, 월간 달력·Google iCal·다가오는 일정, 날씨, CPU·RAM·온도, 네트워크, MPRIS·앨범 표지, 한/영, 테마, 좌우 카드 배치와 유리 효과를 모두 유지한다. UI·설정 화면·GLSL·데이터 DTO와 fixture는 두 에디션이 공유한다. 공개용의 첫 지원 대상은 GNOME Shell 50이며 실행에 Rust·libical·Node.js·npm·별도 systemd 서비스 설치를 요구하지 않는다.

[실측](../../typescript-shell-feasibility.md)에서 Shell 내부의 기본 I/O API는 사용 가능했지만, 단일 반복 계산이 약 0.7초 동안 화면을 막았고 후보 adapter는 34개 중 26개만 Rust 의미와 일치했다. 실행 위치와 일정 정확성은 별도로 해결해야 한다.

| 검토한 구조 | 결정 |
| --- | --- |
| 모든 제공자를 별도 GJS 서비스에 구현 | 설정/IPC 재사용은 쉽지만 가벼운 제공자까지 외부 서비스 수명에 묶임. 채택하지 않음 |
| 모든 처리를 Shell 내부에 구현 | 무거운 단일 라이브러리 호출을 선점할 수 없어 현재 후보는 불합격 |
| **가벼운 제공자는 Shell, 달력 계산만 일회성 GJS** | **채택.** Shell을 막는 작업을 좁게 분리하고 상시 데이터 서비스를 제거 |

공식 지침은 외부 실행을 강하게 비권장하면서도 필요한 GJS 스크립트의 사용·종료 조건을 정의한다. 모범 사례는 무거운 작업의 분리를 권한다. 측정 자료와 수명 검사를 제출 근거로 남기되 승인 보장으로 표현하지 않는다. [심사 규정](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#scripts-and-binaries), [무거운 작업](https://gjs.guide/extensions/review-guidelines/best-practices.html#subprocesses-and-d-bus-communication)

## 실행 경계

```text
공유 위젯 / 설정 화면 / GLSL / DTO
       ├─ rust 빌드 → 기존 DataClient + D-Bus → 기존 Rust 서비스
       └─ gjs 빌드
           ├─ Shell: 날씨·시스템·네트워크·MPRIS·앨범 캐시·수집 일정
           ├─ Shell: iCal 다운로드·비밀 조회·원본 캐시·결과 검증
           └─ 필요할 때만 calendar-worker.js
                  ICS 해석 → 반복/시간대 계산 → 결과 전달 → 종료

GTK 설정창: 공유 설정/키링 모듈 + 검색
            Shell 활성 → Shell의 달력 상태 구독
            Shell 비활성 → 설정창 소유의 일시적인 연결 검증
```

worker는 달력 계산만 한다. HTTPS·키링·캐시·UI·자식 프로세스 생성 권한을 기능으로 제공하지 않는다. 입력은 raw ICS와 context/now뿐이며 URL은 전달하지 않는다. JS import 구조로 이 경계를 검사한다. OS sandbox나 같은 사용자 프로세스 사이의 보안 격리를 제공한다고 주장하지 않는다.

public UI는 로컬 `WidgetDataSession`을 사용하고 Rust UI는 기존 DataClient를 감싼 adapter를 사용한다. 공개용에 가짜 D-Bus owner를 만드는 Transport 구현이나 기존 서비스 전체의 복제는 추가하지 않는다. `ProviderStore`와 JSON schema v1은 유지한다. 기존 `protocol/org.local.LiquidWidgets1.xml`은 Rust 경로에 남는다.

## 에디션과 파일 범위

| 항목 | rust | gjs |
| --- | --- | --- |
| UUID | `liquid-widgets@local` 유지 | `liquid-widgets@nyongcho.github.io` (제출 전 충돌 확인) |
| GSettings schema/path | 기존 값 유지 | `org.gnome.shell.extensions.liquid-widgets-public` / `/org/gnome/shell/extensions/liquid-widgets-public/` |
| config/cache 하위 디렉터리 | `liquid-widgets` | `liquid-widgets-public` |
| 비밀 항목 앱 식별자 | 기존 값 유지 | `io.github.NyongCho.LiquidWidgets` |
| backend | 기존 systemd Rust 서비스 | Shell 로컬 제공자 + 일회성 달력 worker |
| 빌드 출력 | `extension/dist` 유지 | `extension/dist-gjs` |

일반 설치 안내는 완성 후 공개용을 기본으로 설명한다. 기존 개인 설정·키링 항목을 자동 복사하거나 Rust 설치를 덮어쓰지 않는다. 공개용 첫 사용 때 iCal 주소와 날씨 지역을 입력한다. 시각 설정도 별도 namespace로 시작한다. 두 에디션은 번갈아 켜서 비교한다.

주요 코드 경계는 `extension/src/backend/`(공통 인터페이스/Rust adapter), `extension/src/data/`(UI 없는 I/O·설정·제공자), `extension/src/calendar/`(부모 worker 관리자), `extension/src/calendar-worker/`(일회성 프로그램), `extension/src/prefs/`(GTK)다. worker/ical 라이브러리는 extension.js와 prefs.js 번들에 들어가지 않도록 빌드 그래프를 검사한다. 기존 `tests/spikes/gjs-in-process`는 실험 기록이며 제품 코드로 직접 import하지 않는다.

## 달력 의미를 먼저 맞춘다

ical.js 2.2.1을 기준으로 adapter와 필요한 작은 고정 패치를 둔다. 현재 Rust 30개 테스트 전체와 선택한 34개 비교 사례, 추가 경계를 명시적 기대값으로 검사한다. 오류는 거부 여부뿐 아니라 errorCode까지 맞춘다.

먼저 취소 예외의 DTSTART 생략, RDATE의 기본 DTSTART 포함, 중복 회차 제거, 잘못된 날짜 거부, 반복 gap의 COUNT, 명시 gap DTSTART, DST fold 첫 발생, custom STANDARD fold의 8개 차이를 수정한다. 반복 날짜 생성과 지역 시각의 실제 시각 변환을 분리하여 기존 Rust 의미를 재현한다. 옮긴/취소된 회차·원래 occurrenceKey·종일 end-exclusive·floating·DURATION/DTEND·진행 중 일정·조회 경계를 유지한다. [기존 정확성 범위](../../calendar-feasibility.md)

IANA 데이터는 전체 지원 지역을 고정된 파일로 동봉한다. 첫 구현 task에서 upstream ical.js의 시간대 생성 경로와 IANA tzdb 입력의 버전·generator commit·SHA-256·라이선스/출처를 manifest로 고정한다. 현재 실험의 세 지역 fixture를 전체 IANA 지원으로 간주하지 않는다. 런타임 다운로드는 없다. 피드 VTIMEZONE은 해당 작업 안에서만 우선 적용하고 unknown TZID는 오류다.

원본 5 MiB, 후보/결과 10,000건, iterator 호출 총 100,000회 제한을 유지한다. RANGE=THISANDFUTURE·EXRULE·PERIOD RDATE·중복 UID/RECURRENCE-ID의 SEQUENCE 병합은 기존대로 명시적 미지원 오류다. 부분 결과를 성공으로 반환하지 않는다.

실행 시간 제한을 위한 `EngineBudget.check()`를 반복 엔진의 내부 검색/초기화 루프에도 넣는다. 단순 외부 호출 횟수 제한으로 끝내지 않는다. worker 내부 deadline은 시작부터 9초이며, 초과 시 `EXPANSION_LIMIT`이다. lease/입력 대기에는 GLib timeout을 쓰고 동기 계산에는 같은 monotonic deadline을 검사한다. 이는 새 실행 예산이므로 문서에 공개하고 정상 fixture가 제한 때문에 탈락하면 성능 문제로 다룬다. 지원 반복 종류를 삭제해서 통과시키지 않는다.

## 일회성 worker 프로토콜과 수명

부모는 `Gio.Subprocess`로 `gjs -m <extensionPath>/calendar-worker.js`를 직접 실행한다. shell 문자열, URL/ICS를 넣은 argv·환경변수·임시 파일은 사용하지 않는다. [Gio subprocess](https://gjs.guide/guides/gio/subprocesses.html)

- worker 시작 시 전용 세션 D-Bus 연결로 `io.github.NyongCho.LiquidWidgets.CalendarJob` 이름을 `DO_NOT_QUEUE`로 획득한다. 이 이름은 **계산의 상호 배제용**이며 상시 서비스나 RPC endpoint가 아니다. 승자는 `ready`, 경쟁 패자는 `busy` 한 프레임을 보내고 종료한다. 따라서 동시에 계산하는 worker는 세션 전체에서 하나다. 짧은 시작 경쟁 프로세스는 있을 수 있다.
- stdout 제어 프레임은 길이 4-byte big-endian + UTF-8 JSON, 최대 16 KiB. 부모는 `ready`를 받은 뒤 입력을 보낸다. `busy`면 자식 종료 확인 후 이름 소멸을 기다리고 최신 요청 하나만 재시도한다. 슬롯 대기는 최대 30초, 실패 시 `SERVICE_UNAVAILABLE`; 해당 wait/watch도 취소한다.
- stdin은 `header 길이 u32 + header JSON(≤16 KiB) + ICS 길이 u32 + raw UTF-8 bytes(≤5 MiB) + EOF`. header는 version 1, jobId, sourceId, generation, context, now를 가진다. URL·키링 정보는 없다. raw bytes의 decode/ICS parse는 worker에서 한다.
- stdout 최종 프레임은 같은 길이 framing, **전체 JSON ≤512 KiB**. `{version,jobId,sourceId,generation,ok,data}` 또는 `{...,ok:false,errorCode}` 중 하나이며 성공 data는 기존 CalendarData다. 부모는 크기·schema·출처·context·generation을 검사하고 EOF 및 exit 0까지 확인한 뒤 반영한다. 추가 프레임·잘린 입력·비정상 exit는 실패다. stderr는 버리고 사용자 로그에 원문/stack을 재출력하지 않는다.
- 부모별 활성 요청 하나와 최신 대기 요청 하나만 유지한다. 주소·월·시간대 변경은 이전 HTTP/작업을 취소한다. 이전 프로세스 종료를 확인하기 전 다음 작업을 시작하지 않는다. 중복 요청을 합치고 매 프레임/설정 전체 변경마다 worker를 생성하지 않는다.
- 부모 watchdog은 spawn부터 **10초**다. 시간 초과, disable, 설정창 종료, 출처 변경 시 작업을 무효화하고 `force_exit()` 후 **취소하지 않은 `wait_async()`**로 실제 종료를 확인한다. 일반 취소 시 1초 이내 종료를 검사한다. `Gio.Cancellable.cancel()`만으로 자식이 종료된다고 가정하지 않는다. [force_exit](https://docs.gtk.org/gio/method.Subprocess.force_exit.html)
- 부모가 비정상 종료하면 watchdog도 사라진다. worker 내부 budget과 제한된 입력으로 영구 잔류를 막고, 부모 SIGKILL 시험에서 11초 이내 자식 종료를 출시 gate로 둔다. 이는 OS의 parent-death 강제 종료 보장이 아니다. 단일 parser/라이브러리 경로가 내부 deadline을 우회해 이 gate를 실패하면 배포하지 않고 해당 경로의 예산 검사를 보완한다.
- timeout/계산 예산 초과는 `EXPANSION_LIMIT`, 출력 초과는 `PAYLOAD_TOO_LARGE`, malformed response는 `INVALID_DATA`, 실행 불가/충돌 대기 실패/예기치 않은 crash는 `SERVICE_UNAVAILABLE`로 기존 DTO에 대응한다. 취소된 오래된 작업은 오류로 새 화면을 덮지 않는다.

정상 완료 뒤 worker는 종료한다. 한 번 실패했다고 즉시 무한 재실행하지 않는다. 기존 달력 수집 300초 및 수동 Refresh 최소 5초 정책 안에서 재시도하며 마지막 정상 데이터를 stale로 유지한다. 설정이 없거나 수요가 없으면 worker가 없다. 휴면 복귀는 현재 context/day로 한 번 새로고침한다.

## 설정·키링·캐시의 소유권

시각 설정은 기존 GSettings를 재사용한다. 공개용 데이터 설정은 별도 `settings.json`의 schemaVersion 1, revision UUID, calendar source/활성/삭제대기, weather source/location, network interface로 저장한다. URL은 키링에만 있다. 데이터 디렉터리 0700, 파일 0600, 크기 상한·일반 파일 확인·atomic replace와 오류 처리를 유지한다.

두 설정창 및 Shell의 calendar cache 쓰기가 충돌하지 않도록 `io.github.NyongCho.LiquidWidgets.ConfigLock` 세션 bus 이름을 전용 연결에서 소유하는 동안만 변경한다. 대기는 비동기·취소 가능·최대 30초이며 다른 이름의 CalendarJob과 섞지 않는다. 락은 설정·키링 변경과 해당 calendar cache의 최종 교체/삭제에만 사용한다. HTTP·달력 계산·사용자 입력 대기 동안 보유하지 않는다. 키링 잠금은 오류로 알리고 락 안에서 해제 프롬프트를 기다리지 않는다. 프로세스 종료 시 bus 소유권이 자동 해제되며 stale lock 파일은 만들지 않는다.

새 URL 연결은 락 안에서 새 source UUID의 비밀 저장 → 설정 atomic commit → 직전 source 비밀 제거 순서다. commit 전 실패 시 기존 설정을 유지하고, commit 후 옛 비밀 제거 실패는 새 연결을 유지하며 삭제 대기를 표시한다. 삭제는 설정 비활성화와 source 변경을 먼저 확정하고 calendar 캐시를 제거한다. 이 앱 namespace의 키링 정리가 실패하면 삭제 대기를 남긴다. 다른 창의 새 연결과 앱 전체 삭제를 같은 락으로 직렬화한다. 삭제 대기는 새 연결 성공만으로 사라지지 않으며 namespace 전체 정리는 명시적 연결 해제에서만 수행한다. 자동 재시도로 현재 연결의 비밀을 제거하지 않는다.

Shell은 source별 비밀을 무프롬프트 조회한다. Secret.Service.search에서 UNLOCK을 제외하고 LOAD_SECRETS를 사용한다. Secret GI/provider 부재는 달력의 오류로 표시하고 다른 카드를 막지 않는다. [Secret 검색 flags](https://gnome.pages.gitlab.gnome.org/libsecret/flags.SearchFlags.html)

원본 calendar cache의 정기 writer는 Shell 하나다. commit 직전 락을 얻어 설정 source/revision을 다시 확인한다. 삭제가 먼저 끝났다면 이전 작업은 파일을 복구하지 않는다. weather cache는 source ID로 분리하며 변경 시 동일한 재확인 원칙을 적용한다. 시스템·네트워크·미디어 상태는 디스크에서 복원하지 않는다. 앨범 이미지만 제한된 캐시로 보관한다.

## 설정창의 실제 동기화 상태

Shell이 활성 상태이면 그 프로세스가 `io.github.NyongCho.LiquidWidgets.Status` 이름, `/io/github/NyongCho/LiquidWidgets/Status` 경로에 `io.github.NyongCho.LiquidWidgets.Status1`을 export한다. 별도 프로세스를 띄우지 않는다. 메서드는 `WatchCalendar() → (token,summaryJson)`, `UnwatchCalendar(token)`, `RefreshCalendar()`와 `CalendarStatusChanged(summaryJson)` 시그널이다. 토큰은 sender 귀속, sender 소멸/disable 시 회수하며 sender당 8개·전체 128개 제한이다.

summary는 version 1, sourceId, generation, context, status, updatedAt, errorCode, hasData, eventCount를 포함하고 최대 16 KiB다. URL이나 일정 제목/본문은 없다. 설정창의 이벤트 개수·loading/ok/stale/오류 표시를 유지한다. 달력 카드가 숨겨져 있어도 설정창 구독이 있으면 calendar 수집 수요로 계산한다.

Shell 비활성 시 prefs가 자신의 프로세스에서 설정 조회·도시 검색·키링 변경을 수행한다. 열린 달력 페이지는 같은 fetch/worker 모듈로 연결을 검증하고, 300초 주기로 상태를 갱신한다. preview는 현재 현지 월·GLib 현지 시간대·weekStart=0으로 계산하며 Shell 전용 ClockController를 import하지 않는다. Shell에 연결되면 그 summary의 실제 context를 사용하므로 연결 확인과 실제 동기화의 일정 개수는 다를 수 있다. 캐시는 읽되 정기 캐시 writer 역할은 맡지 않는다. prefs 결과는 창 메모리에만 있다. 여러 창의 계산은 CalendarJob 이름으로 직렬화한다.

Shell owner가 나타나면 prefs의 로컬 preview HTTP/worker를 취소하고 실제 Shell 상태로 전환한다. Shell owner가 사라지면 source를 다시 확인한 뒤 로컬 검증으로 전환한다. source/generation이 맞지 않는 늦은 결과는 폐기한다. 화면 문구는 '위젯 동기화'와 '설정창 연결 확인'을 구분하여 preview 성공을 Shell의 성공처럼 표시하지 않는다. 현재 GTK 화면에 필요한 데이터 API는 typed PreferencesDataSession으로 통일하고 Rust adapter는 기존 D-Bus 경로를 유지한다.

## 제공자 동작과 Shell CPU 예산

기존 [날씨](../../weather.md), [달력](../../calendar.md), [실시간 데이터](../../live-data.md), [계약](../../../protocol/README.md)을 유지한다. 날씨 900초/256 KiB/15초, calendar 300초/5 MiB/15초 HTTP, system/network 2초, 온도 최소 5초, MPRIS 이벤트 기반·player 최대 32개·2초 timeout, 표지 8 MiB·전체 64 MiB/64개·5초 요청·기존 재시도 정책이다. null과 0, source 교체의 last-good 차단, monotonic counter 차이와 suspend reset을 지킨다.

Soup streaming으로 압축 해제 후 byte 수를 제한한다. /proc/sysfs와 이미지 읽기·축소는 비동기, timer/source마다 취소와 generation을 소유한다. calendar raw bytes를 Shell에서 JSON 문자열로 확대하거나 ICS parser로 처리하지 않는다. 작은 JSON/결과 검증도 공짜가 아니므로 최대 payload에서 실제 프레임 지연을 측정한다.

## 검증·배포와 남은 소유자 결정

선행 gate는 일정 의미 전체 일치와 worker 종료/프로토콜 검증이다. 이후 전체 provider, prefs handoff/동시 변경/삭제, 시각 회귀, 성능, 패키지 순으로 진행한다. 모든 자동 검사는 합성 데이터·private D-Bus·임시 XDG·격리 키링을 사용한다. `docs/hyprland-research.md`와 현재 개인용 설치는 변경하지 않는다.

성능은 같은 GNOME/해상도/위젯/배경에서 Rust와 공개용을 번갈아 5회 측정한다. 30초 준비 후 유휴·전체 카드 각 120초, 1천/1만 일정·5 MiB·긴 next()를 비교한다. frame interval p95/p99, 50ms 초과 stall, 총 CPU, Shell 증가분+worker peak PSS/RSS, 시작/갱신 시간, 20회 lifecycle 뒤 process/FD/watch를 기록한다. 5회 중 3회 이상 새 50ms stall 또는 p95가 Rust 대비 max(2ms,10%) 이상 악화되면 조사 후 출시를 보류한다. idle worker 0, 취소 1초/부모 사망 11초, 누수 0을 요구한다. 이는 목표이며 아직 통과한 결과가 아니다.

공개 ZIP에는 읽기 가능한 JS, calendar-worker.js와 고정 시간대 데이터, schema/CSS/GLSL, 라이선스/고지만 담는다. Rust 바이너리·libical·Node runtime·systemd unit·실험 fixtures·개인 설정은 제외한다. Node는 빌드 도구이며 공개용 빌드에서 cargo를 호출하지 않는다. 홈페이지는 `https://github.com/NyongCho/gnome-widget`다. 제출 시 worker의 필요성·수명·실측 근거를 설명한다.

프로젝트 라이선스는 아직 선택되지 않았다. 구현·검증을 막지 않지만 최종 공개 배포 준비 시 소유자가 GPL 호환 라이선스를 선택하고 MPL-2.0 ical.js 수정본 및 시간대 데이터의 고지를 확인해야 한다. GNOME Extensions 제출과 기존 설치 교체는 이번 계획 작성에 포함되지 않는다.

[구현 계획](../plans/2026-11-06-typescript-edition.md)은 이 설계를 기준으로 작성했다. 전체 13개 task이며 첫 구현은 일정 정확성부터 시작한다.

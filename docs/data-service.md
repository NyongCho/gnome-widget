# 에디션별 데이터 구조

UI·설정 화면·GLSL·provider DTO v1은 공유한다. `extension/editions.json`이 빌드할 backend와 UUID/schema/저장 이름을 결정한다. 공개용은 TypeScript에서 읽기 좋은 GJS로 빌드하며, 개인용 Rust 서비스와 IPC는 그대로 유지한다.

## 공개용 수집과 수명

시계·날씨·시스템·네트워크·MPRIS는 Shell 프로세스 안의 세션이 관리한다. HTTP와 파일·D-Bus I/O는 비동기다. 달력 원문은 `Uint8Array`로 보관하고, Shell/설정창이 ICS 파서나 전체 시간대 라이브러리를 import하지 않는다.

각 활성 세션이 설정 watch, provider scheduler, 취소 토큰과 타이머를 소유한다. 카드가 숨겨지면 해당 수집을 멈추고, 마지막 달력 카드와 설정창 수요가 모두 사라지면 달력도 멈춘다. 시스템·네트워크는 2초, 달력은 5분, 날씨는 15분 주기이고 음악은 MPRIS 이벤트로 갱신한다. 정기 시스템·네트워크 수집 중에는 이전 표본을 유지해 loading footer가 깜박이지 않는다.

`stop()`은 카드 수요를 끄고 `destroy()`는 세션 전체를 종료한다. 확장의 `disable()`은 `destroy()`를 호출해 수집·watch·status bridge·child·timer를 정리한다. 늦게 끝난 이전 출처/컨텍스트의 응답은 generation과 source UUID로 버린다.

## 일회성 달력 계산

작업마다 `gjs -m calendar-worker.js`를 실행한다. URL이나 원본 ICS를 argv/환경/일반 로그에 넣지 않는다. 파이프로 versioned header와 원문 bytes를 보내며, worker는 HTTP·키링·설정 저장을 하지 않는다. 정상 응답과 EOF, 성공 exit를 모두 확인한 뒤 결과를 반영한다.

| 제한 | 값 |
| --- | --- |
| Header/control | 16 KiB |
| Raw ICS | 5 MiB |
| Result | 512 KiB |
| Candidate/result events | 10,000 |
| Iterator calls | 100,000 |
| Internal deadline / parent watchdog | 9초 / 10초 |
| 취소 후 종료 / 부모 사망 후 종료 | 1초 이내 / 11초 이내 |
| 계산 슬롯·설정 lock 대기 | 각각 30초 이내 |

child가 `io.github.NyongCho.LiquidWidgets.CalendarJob` bus name을 소유해 세션 전체 동시 계산을 하나로 제한한다. 다른 child는 원문을 받기 전에 busy로 종료한다. 부모별 활성 작업 하나와 최신 대기 작업 하나만 유지한다. 취소 시 force-exit 뒤 취소되지 않는 wait로 reap하며, 상시 worker나 사용자 서비스는 없다.

## 설정창과 공개용 상태 bridge

설정창은 자신의 `PreferencesDataSession`을 소유한다. 설정/키링 변경을 직접 수행하고, 위젯이 켜져 있으면 `io.github.NyongCho.LiquidWidgets.Status`의 `Status1`을 통해 실제 달력 상태만 구독한다. UUID token은 sender별로 관리되며 다른 sender가 해제할 수 없다. 오래된 Watch 응답도 원래 owner에 Unwatch해 회수한다.

요약에는 instance/revision/source/context/status/성공 시각/오류 코드/이벤트 수만 담는다. URL·일정 제목·전체 event payload는 보내지 않는다. 먼저 도착한 높은 revision을 늦은 snapshot으로 되돌리지 않는다.

위젯이 꺼져 있으면 설정창이 같은 달력 모듈로 연결을 검증하고 ‘설정창 연결 확인’으로 표시한다. 이 preview는 공유 캐시를 쓰지 않는다. 위젯이 나타나면 preview를 취소하고 bridge에 붙으며, 사라지면 preview로 돌아간다. 창이 닫히면 timer·subscription·worker를 정리한다. 두 창의 계산도 동일한 단일 슬롯을 사용한다.

## 공개용 저장·비밀

설정은 `$XDG_CONFIG_HOME/liquid-widgets-public/settings.json`, 캐시는 `$XDG_CACHE_HOME/liquid-widgets-public/`다. XDG가 없으면 `~/.config`와 `~/.cache`를 사용한다. 디렉터리 0700·파일 0600, 크기·파일 종류·경로 동일성을 검사하며 임시 파일을 원자적으로 교체한다. private cache는 같은 사용자 프로세스를 격리하는 경계는 아니다.

설정 변경과 캐시 commit은 세션 bus의 `ConfigLock`으로 직렬화한다. HTTP/달력 계산 동안 lock을 붙잡지 않는다. 저장 직전 source/revision을 다시 읽고 현재 출처만 commit한다. raw ICS와 metadata의 SHA-256을 대조해 중간에 끊긴 저장을 현재 cache로 오인하지 않는다.

Secret GI는 달력 경로에서 지연 로드하고, 없으면 해당 기능의 `SERVICE_UNAVAILABLE`로 처리한다. 메서드 전체 예산은 8초다. 잠금 해제/Prompt를 실행하지 않으며, 비밀은 키링의 application `io.github.NyongCho.LiquidWidgets`와 source UUID로 구분한다. 연결 해제는 설정을 먼저 비활성화하고 cache와 namespace 내 비밀을 지운다. 실패 시 삭제 대기를 남겨 재시도한다. Rust namespace의 비밀은 건드리지 않는다.

## 개인용 Rust: 실행과 소유권


서비스는 사용자 세션 D-Bus의 `org.local.LiquidWidgets`, object `/org/local/LiquidWidgets`, interface `org.local.LiquidWidgets1`을 제공한다. HTTP 서버나 외부 포트를 열지 않는다. GJS는 기존 공유 session connection을 사용하며 확장 해제 시 그 연결을 닫지 않는다. 서비스 프로세스도 직접 실행하지 않는다.

`packaging/liquid-widgets.service`는 systemd 사용자 서비스 템플릿이다. 시작 소유자는 systemd 하나이며, 개인용 설치기가 이를 설치·활성화한다. 확장은 연결이 없으면 연결 필요 상태와 사용자 서비스 설치·시작 안내를 표시한다.

`GetSnapshot`으로 초기 상태를 읽고 `ProviderChanged`로 provider 하나씩 갱신한다. GJS는 신호를 먼저 연결하고 `Subscribe`가 끝난 뒤 snapshot을 요청한다. 먼저 도착한 높은 revision은 늦은 snapshot에 덮이지 않는다. owner가 바뀌면 revision과 응답 세대를 초기화하되 연결이 끊긴 동안 마지막 값은 유지한다. 새로운 snapshot을 받으면 현재 owner의 상태로 교체한다. 같은 owner가 살아 있어도 일시적인 Subscribe/snapshot 실패 뒤 1초부터 최대 30초까지 간격을 늘려 자동 재연결한다. disable과 owner 변경은 이전 재시도 타이머를 취소한다.

각 Subscribe는 sender와 별도 임의 token으로 기록한다. 동일 sender의 구독 둘 중 하나를 해제해도 다른 구독은 유지된다. 다른 sender는 그 token을 해제할 수 없다. sender 소실 시 모두 제거하며, 이미 소실된 sender의 지연된 요청이 뒤늦게 등록되는 경우도 bus의 현재 owner 상태를 확인해 제거한다. sender당 8개, 전체 128개로 구독 수를 제한한다.

GJS 요청은 비동기이며 snapshot 요청은 disable/owner 변경 때 취소한다. **Subscribe는 예외적으로 응답을 받아 정리한다.** 이미 서버에 생성된 token을 잃지 않도록, disable 뒤 늦게 도착한 token도 원래 unique owner에 Unsubscribe한다. 일반 호출 제한 시간은 10초다. 서버가 구독을 만든 뒤 응답을 보내지 않는 비정상 상황에서는 token을 알 수 없어, 해당 연결이나 서비스가 종료될 때까지 서버 쪽 정리가 지연될 수 있다. 정상 서비스의 Subscribe는 네트워크나 provider 작업을 기다리지 않는다.

## 수집·출처·캐시

구독 수요와 설정 여부가 모두 있는 provider만 worker를 실행한다. 마지막 구독이 없어지면 수집 future를 취소하고 작업 세대를 바꾼다. 재구독하면 즉시 재개한다. 수동 Refresh는 활성 provider만 허용하고 날씨는 60초, 다른 provider는 5초 간격으로 제한한다.

출처 ID는 임의 UUID이며 URL이나 URL 해시가 아니다. 날씨 위치·NIC 변경은 새 ID를 발급하고 이전 데이터를 즉시 비운다. 캘린더 조회 context 변경은 같은 출처의 작업 세대를 바꾸고 이전 범위 데이터를 비운다. 작업 결과는 source ID와 세대가 모두 현재일 때만 반영된다. 캐시는 provider+source ID 파일에 속하고 캘린더 context도 함께 대조한다.

설정은 `$XDG_CONFIG_HOME/liquid-widgets/settings.toml`, 캐시는 `$XDG_CACHE_HOME/liquid-widgets/`에 저장한다. XDG 값이 없으면 각각 `~/.config`, `~/.cache`를 사용한다. 앱 디렉터리는 0700, 파일은 0600이다. 임시 파일을 fsync한 후 rename하고 디렉터리도 fsync한다. 읽기는 symlink·일반 파일이 아닌 대상·과도한 크기·느슨한 파일 권한을 거부한다. 같은 사용자 프로세스에 대한 보안 격리 경계는 아니다.

유효한 마지막 성공 데이터와 오프라인 재계산 결과를 캐시에 저장한다. 재시작 시 일치하는 캐시는 stale 상태와 원래 성공 시각으로 복원한다. 같은 출처의 일시 실패도 마지막 성공 값을 유지한다. provider가 비정상 형식을 반환하거나 개별/전체 JSON이 512KiB 한도를 넘으면 정해진 오류 코드로 처리하며 공급자 오류 원문은 보내지 않는다. 새 응답이 너무 커도 기존 값이 예산 안에 있으면 stale로 유지하며 마지막 성공 시각을 바꾸지 않는다.

ICS 계산에는 공용 bounded blocking worker를 제공한다. 최대 2개의 native 작업만 허용한다. 달력과 표지 저장은 슬롯을 비동기로 기다리며 대기 future를 취소할 수 있다. CPU·네트워크의 즉시 작업 요청은 슬롯이 가득 차면 Busy로 거절한다. Tokio executor에서 ICS를 직접 계산하지 않는다. 기존 5MiB 입력·10000개 결과·100000회 반복 제한도 유지한다. 이미 시작한 native 작업을 강제로 중단하는 하드 시간 제한은 아니다.

## 현재 지원하는 설정 IPC

- GetSettings, SetCalendarContext, SetWeatherLocation, SetNetworkInterface: 검증 및 원자적 저장을 구현했다.
- SetCalendarSecret / ClearCalendarSecret: Secret Service에 source UUID별로 저장하고 교체·연결 해제·캐시 제거를 처리한다. 비밀 URL을 응답·로그에 반사하지 않는다. [캘린더 설정과 검증](calendar.md).
- SearchLocations: Open-Meteo 검색 결과를 검증해 최대 20개 반환한다. 한 번에 한 요청, 최소 1초 간격으로 제한한다. 검색은 선택된 위치를 바꾸지 않는다. [날씨 설정과 검증](weather.md).

## 검증

```bash
./scripts/check.sh
./scripts/dev cargo build --manifest-path daemon/Cargo.toml
./scripts/test-ipc.py
./scripts/test-gnome.py
```

`cargo test`의 IPC 테스트는 각 테스트를 별도 `dbus-run-session`으로 다시 실행한다. `test-ipc.py`는 임시 XDG 경로에서 실제 Rust 실행 파일과 GJS를 연결한다. 테스트가 실제 사용자 bus name을 점유하거나 사용자 설정을 쓰지 않는다.

검증 범위: 공통 schema/크기 제한, 독립 provider 실패, revision 역순·중복, snapshot/신호 경합, 구독 token 소유권, 두 구독 중 하나 해제, caller 소실, 지연된 등록, 구독 0명에서 수집 중단, 재구독·서비스 재시작, 늦은 이전 출처/owner 응답 무시, 이전 캐시 차단, 원자적 교체와 권한, bounded worker, GJS 공유 bus 유지. GNOME 카드에서는 서비스 부재 안내, 임시 Rust 서비스 연결 상태와 기존 굴절·입력 공존을 캡처로 확인했다. `screenshots/service-connected.png`는 git에서 제외한 `.superpowers/sdd/liquid-glass-plan/` 아래에 있다.

Tokio의 blocking 작업은 시작 후 강제 취소되지 않으므로 semaphore로 동시 실행을 제한했다. [Tokio spawn_blocking 문서](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html). D-Bus 인터페이스는 name을 요청하기 전에 등록했다. [zbus Connection Builder](https://docs.rs/zbus/5.19.0/zbus/connection/struct.Builder.html).

Task 6 이후 시스템·네트워크·음악 수집기가 연결되어 있다. 실제 설정한 카드만 구독하며 실시간 값은 디스크에 보관하지 않는다. 측정 정의와 MPRIS 범위는 [실시간 데이터](live-data.md)를 참고한다.

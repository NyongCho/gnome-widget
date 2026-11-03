# Rust 데이터 서비스

2026-11-04. Task 1의 GNOME 렌더링 위에 로컬 데이터 서비스와 GJS 통신 경계를 연결했다. Task 4에서 실제 Google iCal·키링·오프라인 캘린더 provider를 연결했다. Task 5의 Open-Meteo 날씨·지역 검색도 연결했다. 시스템 측정은 후속 task이며, 구현되지 않은 측정값을 예시 수치로 채우지 않는다.

## 실행과 소유권

서비스는 사용자 세션 D-Bus의 `org.local.LiquidWidgets`, object `/org/local/LiquidWidgets`, interface `org.local.LiquidWidgets1`을 제공한다. HTTP 서버나 외부 포트를 열지 않는다. GJS는 기존 공유 session connection을 사용하며 확장 해제 시 그 연결을 닫지 않는다. 서비스 프로세스도 직접 실행하지 않는다.

`packaging/liquid-widgets.service`는 systemd 사용자 서비스 템플릿이다. 시작 소유자는 systemd 하나이며, 설치·활성화는 Task 7에서 다룬다. 이번 단계에서는 사용자 세션에 설치하지 않았다. 확장은 연결이 없으면 연결 필요 상태와 사용자 서비스 설치·시작 안내를 표시한다.

`GetSnapshot`으로 초기 상태를 읽고 `ProviderChanged`로 provider 하나씩 갱신한다. GJS는 신호를 먼저 연결하고 `Subscribe`가 끝난 뒤 snapshot을 요청한다. 먼저 도착한 높은 revision은 늦은 snapshot에 덮이지 않는다. owner가 바뀌면 revision과 응답 세대를 초기화하되 연결이 끊긴 동안 마지막 값은 유지한다. 새로운 snapshot을 받으면 현재 owner의 상태로 교체한다. 같은 owner가 살아 있어도 일시적인 Subscribe/snapshot 실패 뒤 1초부터 최대 30초까지 간격을 늘려 자동 재연결한다. disable과 owner 변경은 이전 재시도 타이머를 취소한다.

각 Subscribe는 sender와 별도 임의 token으로 기록한다. 동일 sender의 구독 둘 중 하나를 해제해도 다른 구독은 유지된다. 다른 sender는 그 token을 해제할 수 없다. sender 소실 시 모두 제거하며, 이미 소실된 sender의 지연된 요청이 뒤늦게 등록되는 경우도 bus의 현재 owner 상태를 확인해 제거한다. sender당 8개, 전체 128개로 구독 수를 제한한다.

GJS 요청은 비동기이며 snapshot 요청은 disable/owner 변경 때 취소한다. **Subscribe는 예외적으로 응답을 받아 정리한다.** 이미 서버에 생성된 token을 잃지 않도록, disable 뒤 늦게 도착한 token도 원래 unique owner에 Unsubscribe한다. 일반 호출 제한 시간은 10초다. 서버가 구독을 만든 뒤 응답을 보내지 않는 비정상 상황에서는 token을 알 수 없어, 해당 연결이나 서비스가 종료될 때까지 서버 쪽 정리가 지연될 수 있다. 정상 서비스의 Subscribe는 네트워크나 provider 작업을 기다리지 않는다.

## 수집·출처·캐시

구독 수요와 설정 여부가 모두 있는 provider만 worker를 실행한다. 마지막 구독이 없어지면 수집 future를 취소하고 작업 세대를 바꾼다. 재구독하면 즉시 재개한다. 수동 Refresh는 활성 provider만 허용하고 날씨는 60초, 다른 provider는 5초 간격으로 제한한다.

출처 ID는 임의 UUID이며 URL이나 URL 해시가 아니다. 날씨 위치·NIC 변경은 새 ID를 발급하고 이전 데이터를 즉시 비운다. 캘린더 조회 context 변경은 같은 출처의 작업 세대를 바꾸고 이전 범위 데이터를 비운다. 작업 결과는 source ID와 세대가 모두 현재일 때만 반영된다. 캐시는 provider+source ID 파일에 속하고 캘린더 context도 함께 대조한다.

설정은 `$XDG_CONFIG_HOME/liquid-widgets/settings.toml`, 캐시는 `$XDG_CACHE_HOME/liquid-widgets/`에 저장한다. XDG 값이 없으면 각각 `~/.config`, `~/.cache`를 사용한다. 앱 디렉터리는 0700, 파일은 0600이다. 임시 파일을 fsync한 후 rename하고 디렉터리도 fsync한다. 읽기는 symlink·일반 파일이 아닌 대상·과도한 크기·느슨한 파일 권한을 거부한다. 같은 사용자 프로세스에 대한 보안 격리 경계는 아니다.

유효한 마지막 성공 데이터와 오프라인 재계산 결과를 캐시에 저장한다. 재시작 시 일치하는 캐시는 stale 상태와 원래 성공 시각으로 복원한다. 같은 출처의 일시 실패도 마지막 성공 값을 유지한다. provider가 비정상 형식을 반환하거나 개별/전체 JSON이 512KiB 한도를 넘으면 정해진 오류 코드로 처리하며 공급자 오류 원문은 보내지 않는다. 새 응답이 너무 커도 기존 값이 예산 안에 있으면 stale로 유지하며 마지막 성공 시각을 바꾸지 않는다.

ICS 계산에는 공용 bounded blocking worker를 제공한다. 최대 2개의 native 작업만 허용하고 대기열이 가득 차면 Busy로 거절한다. Tokio executor에서 ICS를 직접 계산하지 않는다. 기존 5MiB 입력·10000개 결과·100000회 반복 제한도 유지한다. 이미 시작한 native 작업을 강제로 중단하는 하드 시간 제한은 아니다.

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

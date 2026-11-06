# TypeScript Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Rust 개인용을 유지하면서 모든 위젯 기능을 제공하는 GJS 공개용 에디션을 같은 저장소에 추가한다.

**Architecture:** UI·설정·GLSL·데이터 계약은 공유한다. 빌드 시 기존 Rust 서비스 또는 필요할 때 실행되는 GJS 데이터 서비스를 선택한다. GJS 서비스는 기존 D-Bus v1 계약을 구현하고 독립된 설정·캐시·키링 namespace를 사용한다.

**Tech Stack:** TypeScript, GJS/GLib/Gio, Soup 3, Secret 1, ical.js와 고정 IANA 데이터, 기존 esbuild/Ajv/GLSL, Rust 비교 테스트.

**Spec:** [TypeScript 공개용 에디션 설계](../specs/2026-11-06-typescript-edition-design.md). 기준 커밋 `87e0104`. 상태: 미구현, 전체 12개 task.

## Global Constraints

- GNOME Shell 50만 지원. 공개용 실행에는 Node.js·Rust·libical·systemd 서비스 설치가 필요 없어야 한다.
- 기존 모든 카드·언어·설정·시각 효과를 유지한다. Google Calendar와 반복/시간대 지원을 축소하지 않는다.
- `rust`는 기존 UUID·bus·설정·출력 경로를 유지한다. `gjs`의 식별자와 경로는 spec 표를 따른다. 개인 설정/키링을 자동 이전하지 않는다.
- D-Bus v1과 schema v1을 유지한다. payload 512 KiB, ICS 5 MiB, 후보/결과 10,000건, iterator 호출 100,000회.
- GJS worker는 사용자 클라이언트가 있을 때만 동작한다. 마지막 클라이언트가 사라진 뒤 정상 조건에서 2초 이내 종료, 시작 후 미사용 5초 종료.
- 공개 ZIP의 JS는 읽을 수 있어야 한다. 라이브러리·시간대 데이터는 빌드 시 고정하고 고지를 포함한다. 실행 시 코드 다운로드 금지.
- 테스트는 합성 데이터, private D-Bus, 임시 XDG 및 격리 키링을 사용한다. 현재 설치·실제 비공개 주소·`docs/hyprland-research.md`를 건드리지 않는다.
- Task 1의 적합성 검증을 통과하기 전 전체 서비스 포팅을 진행하지 않는다. 아래 새 명령·파일은 해당 task에서 추가할 산출물이며 현재 존재하는 기능이 아니다.

## Review Focus

1. 확장과 설정창의 동시 시작/종료: 단일 worker와 sender별 수명, 마지막 종료 뒤 잔여 프로세스 없음 — Task 3·10.
2. 도시·캘린더 변경 중 늦은 응답 및 owner 교체: 이전 출처가 새 화면을 덮지 않음 — Task 4·6·9.
3. DST gap/fold·custom VTIMEZONE·종일 일정: 라이브러리 차이로 시각이나 COUNT가 바뀌지 않음 — Task 1·8.
4. 잠긴 키링·부분 삭제·쓰기 실패: 설정 성공/해제 성공을 잘못 표시하거나 주소를 노출하지 않음 — Task 5·9.
5. 큰/압축된 입력·64bit 카운터·미디어 교체: 제한 우회, Shell 정지, 잘못된 속도·이전 앨범 이미지 없음 — Task 5·7·8·11.

## 파일과 경계

| 경로 | 역할 |
| --- | --- |
| `extension/editions.json`, `extension/src/edition.ts` | 빌드별 식별자·경로·backend kind |
| `extension/src/backend.ts`, `extension/src/backendRuntime.ts` | 공유 UI가 사용하는 세션 factory, 공개용 worker의 연결·수명 |
| `extension/src/dbus.ts`, `extension/src/extension.ts`, `extension/src/prefs.ts`, `extension/src/prefs/{pages,calendar,weather,placement}.ts` | endpoint 주입과 세션 공유. 화면·셰이더 복제 금지 |
| `extension/src/service/{main,server,lifecycle,state,scheduler}.ts` | worker 진입점, D-Bus, 클라이언트 수명, 상태, 수집 일정 |
| `extension/src/service/{http,storage,secrets,settings,contracts}.ts` | 제한된 I/O, 설정/캐시/키링, 내부 인터페이스 |
| `extension/src/service/providers/{weather,system,network,media,mediaArt,calendar}.ts` | Rust 제공자와 동등한 동작 |
| `extension/src/service/calendar/{engine,timezones,limits}.ts` | ICS와 반복·시간대 의미 처리 |
| `extension/tests/gjs/`, `extension/tests/service*.test.ts` | 실제 GJS 통합 및 순수 상태/계산 테스트 |
| `tests/calendar-gjs/`, `tests/fixtures/calendar/expected/` | 선행 적합성 검증과 양쪽 엔진의 명시적 기대 결과 |
| `scripts/test-gjs-backend.py`, `scripts/test-calendar-parity.py`, `scripts/benchmark-editions.py` | 격리 테스트, 비교, 측정 |
| `protocol/io.github.NyongCho.LiquidWidgets.Runtime1.xml` | 공개용 worker의 client lease 인터페이스 |

모든 TypeScript 내부 API에서 제공자 타입은 기존 `extension/src/types.ts`, 취소 타입은 `shared/dataClient.ts`의 `Cancellation`을 재사용한다. 아래 서명에 등장하는 `Store`, `HttpClient`, `SecretStore`, `ServiceContext`는 Task 4·5에서 정의한다.

## Task 1: iCal·GJS·종료 가능성 검증

**Files:** Create `tests/calendar-gjs/{package.json,package-lock.json,build.mjs,probe.ts,lifecycle.js}`, `tests/fixtures/calendar/expected/*.json`, `scripts/test-calendar-parity.py`, `daemon/examples/calendar-fixture.rs`, `docs/typescript-feasibility.md`. Read `daemon/tests/calendar.rs`, `docs/calendar-feasibility.md`.

**Interfaces:** 두 runner는 `{icsPath, context: CalendarContext, now: string}`을 입력으로 받고 `{data: CalendarData}` 또는 `{errorCode: string}` JSON을 stdout에 쓴다. URL·원문 ICS는 출력하지 않는다. `./scripts/test-calendar-parity.py --engine rust|gjs|both`가 동일 기대 결과를 검사한다.

- [ ] 모든 기존 calendar fixture와 Rust 인라인 회귀 케이스를 기대 JSON으로 옮긴다. `weekly-exdate`는 2회, moved는 원래 occurrenceKey, unknown-zone은 오류, gap/fold와 duration은 기존 테스트의 정확한 시각을 고정한다. 비교 시 배열 순서만 정규화하고 시각·키 차이를 숨기지 않는다.
- [ ] Rust runner가 기대 결과를 통과하고 GJS runner의 미구현 경로가 실패하는지 확인한다. 단순히 현재 Rust 출력으로 기대 파일을 자동 승인하지 않는다.
- [ ] ical.js 안정 버전과 IANA 데이터의 버전/해시를 lockfile·문서에 고정한다. 실제 GJS에서 import·VTIMEZONE·고정 IANA 데이터·Soup 3·Secret 1을 검증한다. JS 파서의 출력 차이와 필요한 보정 계층을 기록한다.
- [ ] GJS probe에서 5 MiB 입력·10,000건·100,000 iterator 호출 경계를 실행한다. 반복 처리는 최대 128회 또는 4ms 단위로 양보한다. 클라이언트 소멸 후 2초 종료와 Shell에서 실행하지 않아도 되는 구조를 검증한다. 단일 parse/next가 이를 막으면 구조를 재검토한다.
- [ ] `./scripts/test-calendar-parity.py --engine both` 및 `dbus-run-session -- gjs -m tests/calendar-gjs/lifecycle.js` PASS를 확인한다. 부족한 GI 패키지·동작 차이·측정 결과·라이선스 원문 경로를 문서에 기록한다. 모든 계약을 충족하지 못하면 여기서 포팅을 멈추고 설계를 수정한다.
- [ ] 이 task의 명시된 파일만 커밋: `test: validate GJS calendar and worker feasibility`.

## Task 2: 빌드별 backend 경계

**Files:** Create `extension/editions.json`, `extension/src/{edition,backend}.ts`, `extension/tests/serviceEdition.test.ts`; modify `extension/src/dbus.ts`, `extension/scripts/build.mjs`, `extension/package.json`, `extension/tsconfig.gnome.json`, `extension/tsconfig.prefs.json`; create `extension/tsconfig.service.json`.

**Interfaces:**
```ts
interface EditionConfig {
  kind: 'rust' | 'gjs'; uuid: string; busName: string;
  schemaId: string; schemaPath: string; dataDirectory: string;
}
interface BackendSession { wire: Transport; target: string; dispose(): void }
function openBackend(extensionPath: string, cancel: Cancellation): Promise<BackendSession>;
```
`SessionTransport`에 선택적인 endpoint를 추가하되 기존 기본값을 유지한다. `edition.ts`는 빌드 주입 상수만 읽고 Node API를 import하지 않는다. `openBackend`의 Rust 경로는 기존 연결을 감싸며 dispose 시 공유 연결을 닫지 않는다.

- [ ] `serviceEdition.test.ts`에서 두 빌드의 UUID/schema/path/bus가 다르고 Rust 값이 그대로임을 검사한다. 미구현 edition 선택 때문에 FAIL인지 확인한다.
- [ ] `build.mjs --edition rust|gjs`를 구현한다. 기본값 rust, 출력은 각각 `dist`/`dist-gjs`. metadata와 schema는 동일 원본에서 생성하되 공개용 schema id와 path를 함께 바꾼다. 생성물을 소스에 덮어쓰지 않는다.
- [ ] `./scripts/dev npm --prefix extension test -- serviceEdition.test.ts` PASS와 두 `build -- --edition …` 및 typecheck를 확인한다. 이 단계의 공개용은 기능 완료 패키지로 배포하지 않는다.
- [ ] 커밋: `refactor: add build-time backend edition boundary`.

## Task 3: 필요할 때 실행되는 GJS worker

**Files:** Create `extension/src/backendRuntime.ts`, `extension/src/service/{main,server,lifecycle}.ts`, Runtime1 XML, `extension/tests/gjs/{runner,lifecycle}.ts`, `scripts/test-gjs-backend.py`; modify `backend.ts`, `build.mjs`, `package.json`.

**Interfaces:** `openBackend()`의 공개용 구현. Runtime1의 `AcquireClient() -> s`와 `ReleaseClient(s)`는 데이터 인터페이스와 같은 object path에서 제공한다. 데이터 v1 XML은 변경하지 않는다. `runService(): Promise<void>`가 worker 진입점이다.

- [ ] private bus 테스트 runner에 `--suite lifecycle`을 추가한다. `simultaneous_clients`는 worker 1개, `close_one_client`는 나머지 연결 유지, `close_last_client`는 2초 이내 종료, `cancel_during_start`는 잔여 worker 0, `foreign_token`은 해제 거부를 검사한다. 초기 FAIL을 확인한다.
- [ ] 전용 D-Bus 연결과 sender별 lease를 구현한다. 공유 Shell bus를 닫지 않는다. `DO_NOT_QUEUE` 경쟁 패자는 종료하고 성공 owner에 연결한다. lease 없이 시작된 worker는 5초 제한, 토큰은 sender당 8개·전체 128개 제한을 적용한다.
- [ ] dispose는 멱등적으로 pending 작업·watch를 정리하고 전용 연결을 닫는다. 이전 owner에 대한 늦은 응답을 새 owner에 적용하지 않는다. 살아 있는 클라이언트만 1→30초 재시작 backoff를 소유한다.
- [ ] `./scripts/test-gjs-backend.py --suite lifecycle` PASS. Shell 대신 독립 GJS 클라이언트로 강제 종료·시작 경쟁·20회 연결 반복도 검사한다.
- [ ] 커밋: `feat: add demand-driven GJS service lifecycle`.

## Task 4: 공통 상태·구독·스케줄러

**Files:** Create `extension/src/service/{contracts,state,scheduler}.ts`, `extension/tests/serviceState.test.ts`, `extension/tests/gjs/protocol.ts`; modify `server.ts`.

**Interfaces:**
```ts
interface ServiceContext {
  settings: Settings; calendarContext: CalendarContext; now: string;
  sourceId: string; generation: number; cancel: Cancellation;
}
interface ProviderDriver<K extends ProviderName> {
  collect(context: ServiceContext): Promise<ProviderMap[K]>;
}
class ServiceState {
  snapshot(): Snapshot;
  begin<K extends ProviderName>(name: K, sourceId: string): number;
  publish<K extends ProviderName>(name: K, generation: number, state: ProviderMap[K]): boolean;
}
```
서비스 host가 subscriptions, source generation, driver, timers를 소유한다. `ProviderMap`·`Settings`·`Snapshot`은 기존 타입이다. GI 의존성이 없는 상태 모델을 먼저 테스트한다.

- [ ] `late_source_reply`, `owner_revision_reset`, `stale_keeps_updatedAt`, `last_unsubscribe_stops_work`, `payload_512k_limit`의 기대 결과를 테스트하고 FAIL 확인한다.
- [ ] v1 GetSnapshot/Subscribe/Unsubscribe/Refresh/ProviderChanged, schema 검증, sender별 구독 제한, cancellation을 구현한다. 일정은 spec 주기를 따르고 수동 Refresh는 weather 60초/나머지 5초로 제한한다. 설정 미완료 제공자는 수집하지 않는다.
- [ ] `./scripts/dev npm --prefix extension test -- serviceState.test.ts`와 `./scripts/test-gjs-backend.py --suite protocol` PASS. 기존 계약 fixtures의 잘못된 payload도 양쪽에서 거부되는지 확인한다.
- [ ] 커밋: `feat: implement GJS provider state and subscriptions`.

## Task 5: 설정·키링·캐시·제한 HTTP

**Files:** Create `extension/src/service/{http,storage,secrets,settings}.ts`, `extension/tests/gjs/io.ts`; modify `contracts.ts`, `server.ts`.

**Interfaces:**
```ts
interface HttpClient {
  get(url: string, options: {maxBytes: number; timeoutMs: number}, cancel: Cancellation): Promise<Uint8Array>;
}
interface Store {
  read(name: string, maxBytes: number, cancel: Cancellation): Promise<Uint8Array | null>;
  replace(name: string, bytes: Uint8Array, cancel: Cancellation): Promise<void>;
  remove(name: string, cancel: Cancellation): Promise<void>;
}
interface SecretStore {
  lookup(sourceId: string, cancel: Cancellation): Promise<string | null>;
  save(sourceId: string, url: string, cancel: Cancellation): Promise<void>;
  clearAll(cancel: Cancellation): Promise<void>;
}
```
`Store`는 생성 시 고정 base directory를 받고 basename만 허용한다. 설정 내부 문서는 schemaVersion 1, 기존 Settings 필드, calendarSourceId/weatherSourceId 및 calendarContext를 가지며 URL은 없다. `HttpClient`는 redirect를 금지하고 provider가 URL 허용 범위를 검사한다. HTTP status는 원문 없는 typed error로 전달한다.

- [ ] `locked_keyring_no_prompt`, `write_failure_keeps_old_settings`, `delete_pending`, `reject_symlink_fifo`, `compressed_body_limit`, `cancel_http` 테스트를 추가하고 FAIL 확인한다. 파일 권한과 민감값의 로그/응답 부재를 검사한다.
- [ ] Soup streaming body 제한, 0700/0600·atomic replace, 설정 쓰기 직렬화, Secret 비동기 접근을 구현한다. background lookup은 unlock하지 않는다. `clearAll`은 공개용 앱 식별자에 해당하는 항목만 삭제한다.
- [ ] `./scripts/test-gjs-backend.py --suite io` PASS. 실제 사용자 키링에 접근하지 않는 harness guard도 검사한다. fsync 등 사용 API가 제공하지 않는 보장은 구현·검증 없이 문서에 쓰지 않는다.
- [ ] 커밋: `feat: add bounded GJS IO and private settings`.

## Task 6: 날씨 전체 이식

**Files:** Create `extension/src/service/providers/weather.ts`, `extension/tests/serviceWeather.test.ts`, `extension/tests/gjs/weather.ts`; modify `server.ts`, `main.ts`.

**Interfaces:** `WeatherProvider implements ProviderDriver<'weather'>`; `searchLocations(query: string, cancel: Cancellation): Promise<WeatherLocation[]>`. `SetWeatherLocation`과 `SearchLocations`는 기존 v1 메서드를 구현한다. Task 5의 HttpClient/Store를 주입한다.

- [ ] 기존 `daemon/tests/{weather,weather_service}.rs`와 weather fixtures를 재사용해 도시 시간대·현재/6시간·null/0·429·오프라인·도시 A의 늦은 응답 폐기를 검사한다. 초기 FAIL 확인한다.
- [ ] 900초 정상 주기, 30→900초 backoff, 256 KiB/15초, 검색 최소 간격 1초·결과 20개·동시 1회, 새 source UUID와 캐시를 구현한다. 기존 attribution을 유지한다.
- [ ] `./scripts/dev npm --prefix extension test -- serviceWeather.test.ts`와 `./scripts/test-gjs-backend.py --suite weather` PASS. 테스트는 HTTP fixture 서버를 사용한다.
- [ ] 커밋: `feat: port weather provider to GJS`.

## Task 7: 시스템·네트워크·MPRIS와 표지

**Files:** Create `extension/src/service/providers/{system,network,media,mediaArt}.ts`, `extension/tests/serviceLive.test.ts`, `extension/tests/gjs/live.ts`; modify `main.ts`.

**Interfaces:** `SystemProvider implements ProviderDriver<'system'>`, `NetworkProvider implements ProviderDriver<'network'>`; `MediaProvider.start(publish: (state: ProviderMap['media']) => void, cancel: Cancellation): void`. `loadArtwork(uri: string, cancel: Cancellation): Promise<string | null>`는 검증된 로컬 file URI만 반환한다. 서비스 host가 미디어 구독의 시작/종료와 generation 검사를 소유한다.

- [ ] 기존 system/network/media/media_art Rust 테스트를 기준으로 최초 null, counter reset, IPv4→IPv6 fallback, 수동 tailscale0, 센서 없음, player 교체, 느린 A 표지가 B에 적용되지 않음을 고정한다. 2^53 초과 counter fixture를 추가하고 FAIL 확인한다.
- [ ] /proc·sysfs 비동기 읽기, BigInt로 원본 64bit 카운터 차이 계산, 안전 범위의 DTO 변환, 단조 시계·60초 기록을 구현한다. `server.ts`의 SetNetworkInterface와 설정 저장을 완성한다. 온도와 네트워크 정책은 `docs/live-data.md` 그대로 적용한다.
- [ ] MPRIS signal/owner watch와 기존 선택 규칙, 이미지 크기·개수·재시도 제한을 구현한다. 세션 종료/트랙 교체 시 요청을 취소한다. 공통 artwork 렌더러의 비율 유지 동작을 재사용한다.
- [ ] `./scripts/dev npm --prefix extension test -- serviceLive.test.ts`와 `./scripts/test-gjs-backend.py --suite live` PASS. CPU/네트워크/미디어 상태는 디스크에 복원되지 않음을 검사한다.
- [ ] 커밋: `feat: port system network and media providers to GJS`.

## Task 8: 검증된 일정 엔진을 제품 코드로 이동

**Files:** Create `extension/src/service/calendar/{engine,timezones,limits}.ts`, `extension/tests/gjs/calendar-engine.ts`; modify `extension/package.json`, lockfile, `build.mjs`, `scripts/test-calendar-parity.py`; add fixed timezone input/manifest under `extension/vendor/timezones/`.

**Interfaces:** `expandCalendar(ics: string, context: CalendarContext, now: string, cancel: Cancellation): Promise<CalendarData>`. 실패는 기존 errorCode로 대응되는 typed error다. Task 1 probe를 이 API로 옮기고 중복 엔진은 제거한다.

- [ ] production 경로를 호출하도록 parity runner를 바꾸어 FAIL 확인한다. custom timezone A 뒤 동명 TZID의 B 피드를 계산할 때 A의 registry가 남지 않는 회귀를 추가한다.
- [ ] 고정 IANA와 피드 VTIMEZONE 범위 관리, recurrence/override·gap/fold 보정, 5 MiB/10,000/100,000 제한과 128회 또는 4ms yield를 구현한다. 캐시에서 다른 월을 계산할 때도 같은 검증 경로를 쓴다.
- [ ] `./scripts/test-calendar-parity.py --engine both`와 `./scripts/test-gjs-backend.py --suite calendar-engine` PASS. 단일 parse/next의 비선점 구간도 Task 1 종료 기준을 계속 만족하는지 확인한다.
- [ ] 커밋: `feat: add production GJS calendar engine`.

## Task 9: Google iCal 연결·동기화·삭제

**Files:** Create `extension/src/service/providers/calendar.ts`, `extension/tests/gjs/calendar-feed.ts`; modify `server.ts`, `main.ts`, `settings.ts`.

**Interfaces:** `CalendarProvider implements ProviderDriver<'calendar'>`; v1의 `SetCalendarSecret`, `ClearCalendarSecret`, `SetCalendarContext`를 완성한다. Task 5 SecretStore/Store/HttpClient와 Task 8 `expandCalendar`를 조합한다.

- [ ] `new_source_ignores_old_fetch`, `offline_recomputes_new_month`, `clear_drops_all_calendar_cache`, `secret_delete_failure_is_pending`, `context_mismatch_not_published`를 기존 Rust 테스트와 같은 합성 데이터로 작성하고 FAIL 확인한다.
- [ ] Google HTTPS 호스트·경로 검증, redirect 금지, 15초/5 MiB, 300초 수집과 수신 시각 보존을 구현한다. URL 교체는 새 키링 항목 저장→설정 반영 순서이며 실패 시 기존 연결을 보존한다.
- [ ] 해제 시 먼저 비활성화·generation 무효화·캐시 제거, 키링 삭제 실패 시 pending 유지. 새 주소 연결이 이전 pending을 지우지 않도록 한다. secret을 DTO/예외/일반 설정에 넣지 않는다.
- [ ] `./scripts/test-gjs-backend.py --suite calendar-feed` PASS. 새 연결 후 설정창이 실제 loading/ok/stale/error를 구독할 수 있음을 IPC로 검증한다.
- [ ] 커밋: `feat: complete Google Calendar support in GJS`.

## Task 10: 공통 UI·설정 연결과 기능 동등성

**Files:** Modify `extension/src/{extension,prefs}.ts`, `extension/src/prefs/{pages,calendar,weather,placement}.ts`, `extension/src/shared/i18n.ts`, `scripts/test-gnome.py`, `extension/tests/gnome/preferences.js`; create `tests/gnome/editions.js`.

**Interfaces:** `fillSettingsWindow(window, settings, extensionPath: string): void`. 창 하나당 `Promise<BackendSession>`와 Cancellation 하나를 소유하고 달력·날씨·네트워크 페이지에 전달한다. `openBackend(extensionPath, cancel)`은 Task 2·3 계약을 사용한다. 데이터와 무관한 설정은 연결 실패 중에도 동작한다.

- [ ] GNOME harness에 `--edition rust|gjs`와 `--editions`를 추가한다. 확장 off 상태 설정창, 두 창 동시 변경, 시작 중 닫기, worker 재시작, 언어 전환 후 상태 표시를 검사하고 FAIL 확인한다.
- [ ] Shell은 backend 연결을 비동기로 시작하고 enable 세대로 늦은 완료를 폐기한다. 시계·레이아웃은 기다리지 않는다. 직접 생성하던 SessionTransport/BUS_NAME을 세션 주입으로 바꾸며 `placement.ts`의 네트워크 설정도 포함한다.
- [ ] 두 에디션에서 전체 카드, 4개 시계, 한/영, 라이트/다크, 좌우 재배치, 유리 설정·시간별 배경화면을 동일 fixture로 확인한다. Google Calendar 클릭은 격리 URI handler로 검사한다.
- [ ] `./scripts/test-gnome.py --edition gjs --editions`, 기존 clock-styles/visual/dynamic-wallpaper 검증, Rust 기준 검증 PASS. 개인 설치로 테스트하지 않는다.
- [ ] 커밋: `feat: share widget and preference UI across editions`.

## Task 11: 두 에디션 성능·수명 비교

**Files:** Create `scripts/benchmark-editions.py`, `docs/typescript-performance.md`; modify `tests/gnome/benchmark.js`, `scripts/test-gjs-backend.py`.

**Interfaces:** `./scripts/benchmark-editions.py --runs 5 --output outputs/verification/edition-performance`는 두 에디션을 번갈아 실행하고 raw JSON과 요약 표를 기록한다. 30초 준비 후 유휴/전체 카드 각 120초, 1천 건 및 한계 부근 일정 입력을 사용한다.

- [ ] 측정 결과가 가짜 값이나 process 하나의 RSS로 대체되지 않도록 fixture 검증을 추가한다. worker PSS/RSS, Shell 증가분, CPU, 시작/갱신 latency, 프레임 p95/p99와 50ms stall, 종료 후 프로세스/FD/watch를 수집한다.
- [ ] 같은 GNOME/해상도/배율/배경/전원 상태에서 비교한다. 갱신 중 달력 취소와 20회 lifecycle 반복도 검사한다. 측정 방법·환경·분산·실패를 문서에 기록한다.
- [ ] 기능 전체 통과, 2초 종료, 누수 0을 확인한다. spec의 프레임 회귀 기준과 유휴 CPU 목표를 평가한다. 실패 시 원인을 해결하고 관련 측정만 반복하며 개선 없는 숫자를 합격으로 표시하지 않는다.
- [ ] 커밋: `test: benchmark Rust and GJS editions`.

## Task 12: 배포 패키지와 사용 문서

**Files:** Modify `scripts/{package.py,check-build.py,check.sh}`, `tests/test_install.py`, `README.md`, `docs/{setup,data-service,calendar,weather,live-data}.md`; create `tests/test_public_package.py`, `docs/gnome-extensions-release.md`, `THIRD_PARTY_NOTICES.md`. 프로젝트 `LICENSE`는 소유자의 라이선스 선택 후 추가한다.

**Interfaces:** `python3 scripts/package.py --edition rust|gjs` (기본 rust). 공개 출력은 `dist/liquid-widgets-public/liquid-widgets.shell-extension.zip`. `./scripts/check.sh --edition rust|gjs|all` (기본 all)는 해당 타입 검사·테스트·실제 GJS·패키지 검사까지 실행한다. 공개 경로는 cargo/libical 없이도 완료되어야 한다.

- [ ] 공개 ZIP에서 Rust ELF/.so, systemd unit, installer, Node 런타임 import, private 설정·fixture가 제외되는 테스트를 먼저 작성해 FAIL 확인한다. 읽기 가능한 service JS와 고정 시간대 데이터·고지·schema·metadata 일치도 검사한다.
- [ ] edition별 패키징과 깨끗한 출력 디렉터리를 구현한다. 실제 원격 저장소 URL을 metadata에 넣고 UUID 충돌을 확인한다. 공개 artifact는 프로젝트 라이선스·의존성 고지가 준비되기 전 출시 준비 완료로 표시하지 않는다.
- [ ] 공개용 설치/제거/연결 설정, Rust로 복귀, 지원 GNOME, 데이터 전송·저장·삭제, worker 필요성과 종료 증거, 알려진 calendar 제한을 문서화한다. GI 누락 안내는 해당 기능에 표시하며 셸 명령 자동 설치를 하지 않는다.
- [ ] `./scripts/check.sh --edition all`, `python3 -m unittest discover -s tests -p 'test_*package.py'`, GNOME 50 깨끗한 사용자 환경의 설치/활성화/해제 검증을 수행한다. GUI 결과와 artifact manifest를 남긴다.
- [ ] 커밋: `build: package the GJS edition for GNOME review`. 최종 변경을 검토하고 결과를 사용자에게 보고한다. GNOME Extensions 업로드·기존 개인용 교체는 별도 요청 시 수행한다.

## 의존 순서와 완료 기준

`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12` 순으로 진행한다. task마다 명시한 파일만 커밋하고 무관한 작업물을 포함하지 않는다. 새 구현 작업은 실행 시 별도 worktree/브랜치에서 시작한다.

완료는 **모든 기존 기능을 GJS에서 확인하고, Rust 회귀가 없으며, 깨끗한 환경에서 공개 ZIP이 동작하는 상태**다. 실제 EGO 승인과 사용자 계정의 비공개 피드 재입력은 자동 검증 결과로 주장하지 않는다. Task 1의 검증, 라이선스 선택, 최종 제출은 서로 다른 판단 단계다.

계획 자체의 점검: 7개 카드·4개 시계·언어/테마/레이아웃/유리 효과는 Task 10, 5개 provider는 Task 6–9, 수명/동시 설정창은 Task 3·10, 개인정보와 I/O는 Task 5·9, 성능은 Task 11, 배포는 Task 12에 대응한다. Review Focus 5개는 각 소유 task에 회귀 검사가 있다. 이번 계획 작성에서 이 테스트들이 이미 실행됐다는 의미는 아니다.

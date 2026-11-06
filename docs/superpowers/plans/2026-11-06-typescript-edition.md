# TypeScript Edition — Calendar Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rust 개인용을 보존하면서, 기존 모든 기능을 제공하고 달력 계산만 일회성 GJS로 분리하는 공개용 에디션을 만든다.

**Architecture:** 위젯·설정 UI·GLSL·DTO를 공유하고 빌드 시 backend를 선택한다. 공개용 제공자는 Shell 안에서 비동기 I/O를 수행하며 raw ICS 계산만 child에 맡긴다. 설정창은 직접 설정/키링을 관리하고 Shell의 달력 상태를 구독하며, Shell이 꺼져 있으면 같은 모듈로 자신의 연결 검증을 수행한다.

**Tech Stack:** TypeScript/GJS, Gio/GLib, Soup 3, Secret 1, ical.js 2.2.1와 고정 패치/시간대 데이터, esbuild/Ajv/GLSL, Rust oracle.

**Spec:** [달력 계산만 분리하는 설계](../specs/2026-11-06-typescript-edition-design.md). 기준 `1b0d2d9`. **전체 13개 task, 모두 미구현.** 기존 전체 GJS 서비스 기반 12-task 계획을 대체한다. [실측 결과](../../typescript-shell-feasibility.md)는 선행 근거이며 제품 검증 완료가 아니다.

## Global Constraints

- 공개용 지원 GNOME Shell 50. 실행에 Rust/libical/Node.js/npm/systemd 서비스 설치를 요구하지 않는다. 공개용 빌드는 cargo를 호출하지 않는다.
- 기존 7개 카드·4개 시계·Google iCal·한/영·테마·좌우 배치·유리 효과를 유지한다. 반복 규칙·시간대·입력 상한을 조용히 축소하지 않는다.
- rust의 UUID·bus·설정·설치 경로를 보존한다. gjs의 namespace/출력은 spec 표를 따른다. 개인 설정과 키링을 자동 이전하지 않는다.
- 기존 Rust D-Bus v1과 provider schema v1 유지. 새 worker 및 Status1 프로토콜은 별도 version 1이다.
- ICS 5 MiB, worker header/control 16 KiB, 최종 reply 512 KiB, 후보/결과 10,000건, iterator 호출 100,000회.
- worker 내부 deadline 9초, 부모 watchdog 10초, 취소 후 1초 이내 종료, 부모 비정상 종료 후 11초 이내 종료. 계산 슬롯/설정 lock 대기는 각각 최대 30초.
- SecretStore 메서드별 전체 예산 8초. 선택적인 Secret GI는 지연 import하며 부재가 전체 확장/설정창 로드를 막지 않는다.
- 세션 전체 계산 worker 1개. busy 경쟁자는 입력 수신 전에 종료하며 상시 서비스가 없다. 부모별 활성 1개+최신 대기 1개.
- URL/ICS를 argv·환경변수·일반 로그에 넣지 않는다. worker에는 URL을 보내지 않는다. calendar raw bytes를 Shell에서 거대한 JSON 문자열로 변환하지 않는다.
- 테스트는 합성 데이터/private bus/임시 XDG/격리 키링. 현재 개인용 설치와 `docs/hyprland-research.md`를 변경하지 않는다.
- 아래 새 API·파일·명령은 해당 task에서 추가할 산출물이다. 현재 존재하거나 통과한 것으로 취급하지 않는다.

## Review Focus

1. worker가 `next()` 내부에서 멈추거나 부모가 죽음: 실제 자식 종료·reap와 deadline 보장 — Task 1·2·12.
2. 이전 출처/월의 결과가 늦게 도착함: 새 상태/캐시를 덮지 않고 clear 이후 파일을 복구하지 않음 — Task 4·5·9.
3. 두 설정창의 연결/삭제 경쟁과 Shell on/off 전환: 늦은 구독 토큰을 회수하고 snapshot/신호 역순으로 상태가 돌아가지 않음 — Task 4·10·11.
4. DST gap/fold·취소·중복/잘못된 날짜: 현재 발견한 8개 차이와 전체 기존 의미를 보정 — Task 1·9.
5. 큰/잘린/압축된 입력·counter reset·늦은 표지: 제한 우회·Shell stall·오래된 결과 반영 없음 — Task 2·6·7·8·12.

## 파일 구조와 공통 인터페이스

| 경로 | 책임 |
| --- | --- |
| `extension/editions.json`, `extension/src/edition.ts` | 빌드 식별자/schema/path/backend 선택 |
| `extension/src/backend/{contracts,factory,rust}.ts` | 위젯/설정 UI의 공통 API와 기존 Rust adapter |
| `extension/src/data/{busLease,http,files,config,secrets,settings}.ts` | UI 없는 비동기 I/O, 설정 mutation, private cache |
| `extension/src/data/{localSession,scheduler,state}.ts` | Shell의 수요·타이머·generation·ProviderStore 연결 |
| `extension/src/data/providers/{weather,system,network,media,mediaArt,calendar}.ts` | 제공자별 동작 |
| `extension/src/calendar/{protocol,workerClient,statusBridge}.ts` | 부모 프로세스의 child 관리와 Shell 상태 bridge |
| `extension/src/calendar-worker/{main,engine,normalize,timezones,budget}.ts` | 계산 전용 진입점/의미/시간 제한 |
| `extension/src/prefs/{dataSession,calendarPreview}.ts` | 공개용 GTK API와 Shell off 시 연결 검증 |
| `extension/vendor/{ical,timezones}/` | 고정 패치·버전/해시·upstream/라이선스 고지 |
| `protocol/{calendar-worker,calendar-status}.schema.json`, `protocol/io.github.NyongCho.LiquidWidgets.Status1.xml` | 새 좁은 경계 계약 |
| `extension/tests/gjs/`, `scripts/test-public-backend.py` | private bus/XDG 실제 GJS 검증 |

기존 `types.ts`의 ProviderName/ProviderMap/CalendarContext/CalendarData/Settings/WeatherLocation, `shared/providerStore.ts`의 ProviderStore, `shared/dataClient.ts`의 Cancellation/ConnectionState를 재사용한다. 새 공통 모듈은 St/Clutter/Meta/Shell/Gtk/Gdk/Adw를 import하지 않는다. 인터페이스의 callback과 promise는 종료 후 UI 객체에 접근하지 않는다.

## Task 1: 일정 의미 보정과 계산 예산

**Files:** Create `extension/src/calendar-worker/{engine,normalize,timezones,budget}.ts`, `extension/vendor/{ical,timezones}/manifest.json`, 필요한 고정 패치/데이터/고지, `extension/tests/gjs/calendarEngine.ts`, `extension/scripts/build-calendar-tests.mjs`, `scripts/test-calendar-parity.py`, `tests/fixtures/calendar-parity/{cases,expected}.json`, `daemon/examples/calendar-parity.rs`, `extension/tsconfig.worker.json`; modify extension package/lockfile/typecheck.

**Interfaces:** `EngineBudget { check(): void }`; `expandCalendar(ics: string, context: CalendarContext, now: string, budget: EngineBudget): CalendarData`. `CalendarFailure.code`는 `INVALID_DATA | UNSUPPORTED_CALENDAR | UNKNOWN_TIME_ZONE | PAYLOAD_TOO_LARGE | EXPANSION_LIMIT`. `createBudget(deadlineUs: number): EngineBudget`는 GLib monotonic deadline을 검사한다.

- [ ] 기존 `daemon/tests/calendar.rs` 30개 검사 전체와 spike의 34개 비교 사례를 명시적 기대값으로 이식한다. 겹치는 입력은 합치되 source 테스트 대응표를 남긴다. 오류도 code까지 비교한다. `scripts/test-calendar-parity.py --engine rust|gjs|both`와 실제 GJS test build를 추가한다.
- [ ] Rust oracle가 기대값을 통과하고 현재 GJS adapter가 알려진 8개 범주에서 실패하는 것을 기록한다. UTC 정규화로 instant를 비교하되 all-day 날짜·occurrenceKey·COUNT·종료 차이는 숨기지 않는다.
- [ ] ical.js 2.2.1을 고정한다. upstream timezone 생성 경로의 입력 tzdb 버전·generator commit·SHA-256·고지를 manifest로 고정하고 전체 IANA/alias 데이터를 준비한다. 결과물 없이 세 지역 fixture만으로 완료 처리하지 않는다.
- [ ] `normalize.ts`에서 raw 날짜 검증, 취소 예외 전처리, 기본 DTSTART/RDATE union과 중복 제거, UID/RECURRENCE-ID 관계를 구현한다. `engine.ts`/`timezones.ts`에서 지역 반복 날짜→gap/fold 변환→COUNT/UNTIL 및 DURATION/DTEND 의미를 기존 Rust와 맞춘다. custom VTIMEZONE은 작업 범위 밖으로 남지 않는다.
- [ ] 5 MiB/10,000/100,000 제한을 적용한다. 고정 라이브러리의 초기화/내부 탐색 루프에도 `budget.check()`를 넣고 9초를 넘는 계산은 부분 결과 없이 실패시킨다. sparse leap/불가능한 날짜 규칙·큰 property의 deadline 우회 경로를 검사한다.
- [ ] `./scripts/test-calendar-parity.py --engine both` PASS와 원본 library regression suite의 관련 테스트 PASS. 알려진 8개 차이와 부모 없는 deadline 시험을 통과하기 전 공개용 전체 이식으로 넘어가지 않는다.
- [ ] 명시된 파일만 커밋: `feat: preserve calendar semantics in the GJS engine`.

## Task 2: 일회성 worker 프로토콜과 종료

**Files:** Create `extension/src/calendar/{protocol,workerClient}.ts`, `extension/src/calendar-worker/main.ts`, `extension/src/data/busLease.ts`, worker schema, `extension/tests/gjs/{worker,workerFixtures}.ts`, `extension/tests/workerProtocol.test.ts`, `scripts/test-public-backend.py`; modify worker test build/validator generation.

**Interfaces:**
```ts
interface CalendarJobHeader {
  version: 1; jobId: string; sourceId: string; generation: number;
  context: CalendarContext; now: string;
}
interface CalendarJob { header: CalendarJobHeader; ics: Uint8Array }
class CalendarWorkerClient {
  run(job: CalendarJob, cancel: Cancellation): Promise<CalendarData>;
  dispose(): Promise<void>;
}
interface BusLease { release(): void }
function acquireBusLease(name: string, timeoutMs: number, cancel: Cancellation): Promise<BusLease>;
```
`acquireBusLease`는 전용 session 연결을 소유하고 DO_NOT_QUEUE/owner watch로 대기한다. `timeoutMs=0`은 즉시 시도하고 실패 시 `LeaseBusyError`, 양수는 기한 뒤 `LeaseTimeoutError`로 reject한다. Shell 공유 연결을 닫지 않는다. worker는 CalendarJob 이름을 즉시 시도하고 busy일 때 기다리지 않고 종료한다. ConfigLock은 이후 같은 도구의 대기 기능을 쓴다.

- [ ] `--suite worker`에 ready/busy 경쟁, 16 KiB/5 MiB/512 KiB 경계, invalid UTF-8, extra/truncated frame, exit nonzero, 완료 후 계속 살아 있는 fake child를 추가한다. 미구현 reader/lifecycle에서 FAIL을 확인한다.
- [ ] spec의 u32 framing을 구현한다. child는 계산 lease를 얻기 전에 engine/시간대 데이터를 초기화하지 않는다. 9초 deadline은 시작 시 기록하며 lease/입력 대기에는 GLib timeout, 동기 계산에는 같은 deadline의 budget을 적용한다. ready 후 stdin raw bytes를 읽고, 계산→schema 검증→한 reply→exit 한다. stdout은 protocol 전용, stderr는 부모에서 버린다.
- [ ] 부모는 입력/출력을 비동기 stream으로 제한해 읽는다. 무제한 `communicate_utf8_async()` 수집을 사용하지 않는다. source/context/generation, EOF, exit 0을 모두 확인한다. 취소 시 먼저 무효화하고 force_exit 후 uncancelled wait_async로 reap한다. `dispose()`는 즉시 kill을 요청하고 정리가 끝나면 resolve한다.
- [ ] 부모별 활성 하나+최신 대기 하나, 세션 계산 슬롯 하나, busy wait 30초, spawn watchdog 10초를 구현한다. worker lease는 자기 연결이 소유하므로 부모가 죽어도 기존 계산 중 다른 worker가 슬롯을 얻지 못한다. 부모 없는 worker도 내부 9초 budget으로 종료해야 한다.
- [ ] `./scripts/test-public-backend.py --suite worker` PASS: 일반 취소 ≤1초, parent SIGKILL 후 ≤11초, 입력 전 parent 사망/pipe EOF, 20회 교체 후 child/FD/watch 0. 이 실패를 '취소 요청 성공'으로 대신하지 않는다.
- [ ] 커밋: `feat: isolate calendar jobs in short-lived GJS workers`.

## Task 3: 두 에디션의 빌드와 UI API

**Files:** Create edition files, `extension/src/backend/{contracts,factory,rust}.ts`, `extension/tests/backendEdition.test.ts`; modify `extension/scripts/build.mjs`, `extension/package.json`, `extension/tsconfig.{gnome,prefs,worker}.json`. 기존 `dbus.ts`/DataClient는 Rust adapter 안에서 재사용한다.

**Interfaces:**
```ts
interface WidgetDataSession {
  start(providers: ProviderName[]): void;
  stop(): void;
  setCalendarContext(context: CalendarContext, day: string): void;
  refreshAfterResume(): void;
  destroy(): void;
}
interface WidgetSessionOptions {
  extensionPath: string; store: ProviderStore;
  changed(provider?: ProviderName): void;
  connection(state: ConnectionState): void;
}
function createWidgetDataSession(options: WidgetSessionOptions): WidgetDataSession;
```
`stop()`는 카드 수요만 해제, `destroy()`는 bridge/prefs 수요까지 포함해 세션 전체 종료다. Rust adapter는 기존 DataClient 동작을 유지한다. gjs 구현은 Task 5에서 연결한다.

- [ ] rust/gjs metadata·UUID·GSettings id와 path·cache namespace가 정확히 분리되고 기존 rust 값이 유지되는 테스트를 작성해 FAIL 확인한다.
- [ ] `build.mjs --edition rust|gjs` 구현. 기본 rust, 출력 dist/dist-gjs, public에 calendar-worker.js 별도 entry. engine/ical/timezone 데이터가 extension.js 또는 prefs.js dependency graph에 있으면 build 검사 실패로 만든다.
- [ ] Rust WidgetDataSession wrapper와 typed factory를 구현한다. 현재 설치를 수정하거나 완료 전 gjs artifact를 배포하지 않는다.
- [ ] `./scripts/dev npm --prefix extension test -- backendEdition.test.ts`, typecheck, 두 edition build PASS. Rust의 기존 client tests도 PASS.
- [ ] 커밋: `refactor: share UI contracts between Rust and public editions`.

## Task 4: 공통 I/O·설정·키링과 변경 직렬화

**Files:** Create `extension/src/data/{http,files,config,secrets,settings}.ts`, `extension/tests/gjs/io.ts`, `extension/tests/config.test.ts`; modify protocol validation test/build as needed.

**Interfaces:**
```ts
interface DataConfig {
  schemaVersion: 1; revision: string;
  calendar: {sourceId: string | null; enabled: boolean; deletionPending: boolean};
  weather: {sourceId: string | null; location: WeatherLocation | null};
  networkInterface: string;
}
interface ConfigTransaction {
  readonly current: DataConfig;
  replace(next: DataConfig): Promise<DataConfig>;
}
interface ConfigStore {
  read(cancel: Cancellation): Promise<DataConfig>;
  watch(changed: (config: DataConfig) => void): () => void;
  mutate<T>(fn: (tx: ConfigTransaction) => Promise<T>, cancel: Cancellation): Promise<T>;
}
interface HttpClient {
  get(url: string, limits: {maxBytes: number; timeoutMs: number}, cancel: Cancellation): Promise<Uint8Array>;
}
interface PrivateFiles {
  read(name: string, maxBytes: number, cancel: Cancellation): Promise<Uint8Array|null>;
  replace(name: string, bytes: Uint8Array, cancel: Cancellation): Promise<void>;
  remove(name: string, cancel: Cancellation): Promise<void>;
}
```
PrivateFiles는 고정 baseDir의 basename만 받으며 read의 null은 파일 부재에만 사용한다. `SecretStore.lookup(sourceId: string,cancel: Cancellation): Promise<string|null>`, `save(sourceId: string,url: string,cancel: Cancellation): Promise<void>`, `remove(sourceId: string,cancel: Cancellation): Promise<void>`, `clearAll(cancel: Cancellation): Promise<void>`는 공개용 앱 namespace에 한정한다. DataSettingsService는 Task 10 PreferencesDataSession의 getSettings 및 네 mutation 메서드와 동일한 시그니처를 구현한다.

- [ ] `concurrent_connect_clear`, `write_failure_preserves_old_source`, `delete_pending_survives_reconnect`, `stale_cache_writer_after_clear`, `locked_keyring_no_prompt`, `compressed_body_limit`, `reject_symlink_fifo`를 작성하고 FAIL 확인한다. `missing_secret_gi_only_disables_calendar`는 나머지 카드/설정 로드 성공, `unresponsive_keyring_releases_lock`는 SecretStore 8초 제한 뒤 두 번째 writer 진행을 검사한다.
- [ ] 설정 JSON 최대 64 KiB·schema 검증, 0700/0600·atomic replace, ConfigLock 30초 대기/취소와 종료 후 tx 재사용 거부를 구현한다. revision은 매 commit UUID로 새로 발급한다. 모든 데이터 설정 writer와 calendar/weather cache 최종 commit/삭제가 같은 lock 규칙을 따른다.
- [ ] secret 저장→config commit→직전 source secret 제거, disable/source 무효화→cache 삭제→secret 전체 정리 순서를 구현한다. lock 내부에서 키링 unlock prompt를 기다리지 않는다. background lookup은 search(LOAD_SECRETS), UNLOCK 제외. 이전 삭제 실패는 새 연결 성공으로 해제하지 않으며 clearAll은 명시적 연결 해제에서만 호출한다. 자동 재시도로 새 source의 비밀을 삭제하지 않는다.
- [ ] SecretStore에서 GI를 지연 import하고 메서드 전체에 8초 deadline/cancellable을 연결한다. 취소는 remote mutation의 rollback으로 취급하지 않는다. 늦은 source별 save/remove가 새 source를 바꾸지 않고, 불확실한 삭제는 pending을 유지하며, finally에서 ConfigLock과 timeout을 해제하는 fixture를 검증한다.
- [ ] Soup send_async의 압축 해제 stream을 제한하고 redirect를 금지한다. 공급자 URL allowlist는 각 공급자가 정한다. raw URI·본문·exception 원문을 로그/설정/DTO에 넣지 않는다.
- [ ] `./scripts/dev npm --prefix extension test -- config.test.ts`와 `./scripts/test-public-backend.py --suite io` PASS. private bus에서 lock 보유 프로세스 종료 후 다른 writer가 진행되는 것도 검사한다.
- [ ] 커밋: `feat: share public settings and private IO safely`.

## Task 5: Shell 로컬 제공자 수명과 상태

**Files:** Create `extension/src/data/{localSession,scheduler,state}.ts`, `extension/tests/localSession.test.ts`, `extension/tests/gjs/localSession.ts`; modify backend factory/contracts.

**Interfaces:** `LocalWidgetSession implements WidgetDataSession`; `ProviderContext {config: DataConfig; calendarContext: CalendarContext; now: string; cancel: Cancellation}`; `ProviderDriver<K extends ProviderName>.collect(context: ProviderContext): Promise<ProviderMap[K]>`. 미디어는 Task 8의 signal driver를 사용한다. scheduler가 source/generation/revision과 모든 collection 취소를 소유한다. `setCalendarWatchers(count: number): void`가 Task 10 bridge 수요를 전달한다.

- [ ] `late_reply_ignored`, `source_change_clears_old_data`, `last_good_same_source_only`, `stop_cards_keeps_prefs_calendar`, `destroy_cancels_everything`, `resume_resets_samples`를 fake clock/driver로 작성하고 FAIL 확인한다.
- [ ] 카드와 prefs 수요를 합쳐 필요한 provider만 시작한다. weather 900초, calendar 300초, system/network 2초; 겹치는 수집은 만들지 않는다. manual Refresh는 weather 60초/나머지 5초 제한. clock의 context/day 변경·resume를 수집 조건에 반영한다.
- [ ] 기존 ProviderStore/schema로 결과를 검증한다. source/generation/context가 맞는 결과만 publish하고 last-good/stale/updatedAt 의미를 유지한다. 설정/Secret 부재는 해당 provider만 실패시킨다.
- [ ] `destroy()`는 모든 HTTP/source/watch를 해제하고 child dispose를 요청한다. 비동기 reap callback은 UI나 새 세션에 접근하지 않는다. `./scripts/dev npm --prefix extension test -- localSession.test.ts`와 `./scripts/test-public-backend.py --suite local-session` PASS.
- [ ] 커밋: `feat: manage public providers inside GNOME Shell`.

## Task 6: 날씨와 지역 검색

**Files:** Create `extension/src/data/providers/weather.ts`, `extension/tests/weatherProvider.test.ts`, `extension/tests/gjs/weather.ts`; wire localSession.

**Interfaces:** `WeatherProvider implements ProviderDriver<'weather'>`; `searchLocations(query: string, cancel: Cancellation): Promise<WeatherLocation[]>`. Task 4 HttpClient/PrivateFiles/ConfigStore 주입. Shell과 prefs가 같은 search 함수를 호출한다.

- [ ] 기존 Rust weather/weather_service tests를 이식해 null/0, 도시 시간대, 현재+6시간, 429, backoff, 도시 A의 늦은 응답 폐기, 오프라인 성공 시각 보존, 해제를 고정하고 FAIL 확인한다.
- [ ] 고정 HTTPS endpoint, 256 KiB/15초, 정상 900초/실패 30→900초, 검색 동시 1회·최소 1초·최대 20개를 구현한다. 지역 선택은 DataSettingsService를 사용하고 출처 표시를 유지한다.
- [ ] cache commit은 ConfigStore.mutate에서 source를 재확인한다. 지역 변경 뒤 이전 파일이 다시 현재 cache가 되지 않도록 한다.
- [ ] `./scripts/dev npm --prefix extension test -- weatherProvider.test.ts`와 `./scripts/test-public-backend.py --suite weather` PASS. HTTP fixture만 사용한다.
- [ ] 커밋: `feat: run weather collection inside Shell`.

## Task 7: 시스템·네트워크

**Files:** Create `extension/src/data/providers/{system,network}.ts`, `extension/tests/systemNetwork.test.ts`, `extension/tests/gjs/systemNetwork.ts`; wire localSession.

**Interfaces:** `SystemProvider implements ProviderDriver<'system'>`, `NetworkProvider implements ProviderDriver<'network'>`; `listNetworkInterfaces(cancel: Cancellation): Promise<string[]>`를 prefs와 공유한다.

- [ ] 기존 system/network fixtures에 2^53 초과 counter, 장치 소멸, suspend, counter reset을 추가한다. 최초 표본 null, MemAvailable, 센서 우선순위, IPv4/IPv6 fallback, 자동 Tailscale 제외/수동 허용을 검사하고 FAIL 확인한다.
- [ ] 비동기·크기 제한 proc/sysfs 읽기, 제한된 열거/병렬 수, BigInt 차이→안전한 DTO 변환, monotonic 속도·60초 기록을 구현한다. 온도는 최소 5초 후 재측정한다. 명령행 도구를 spawn하지 않는다.
- [ ] `./scripts/dev npm --prefix extension test -- systemNetwork.test.ts`와 `./scripts/test-public-backend.py --suite system-network` PASS. 구독 0/disable 뒤 센서 읽기·timer 0을 확인한다.
- [ ] 커밋: `feat: collect system and network data with Gio`.

## Task 8: MPRIS·앨범 이미지

**Files:** Create `extension/src/data/providers/{media,mediaArt}.ts`, `extension/tests/mediaProvider.test.ts`, `extension/tests/gjs/media.ts`; wire localSession, reuse `widgets/artwork.ts`.

**Interfaces:** `MediaProvider.start(publish: (state: ProviderMap['media']) => void, cancel: Cancellation): void`; `loadArtwork(uri: string, cancel: Cancellation): Promise<string|null>`는 검증된 로컬 file URI만 반환한다. 트랙/source generation은 media provider가 소유한다.

- [ ] 기존 Rust media/media_art tests에서 player owner 교체, 최대 32개 탐색, 2초 timeout, playing 우선 선택, 느린 곡 A의 표지가 B에 반영되지 않음, 깨진/과대/비정상 파일을 이식하고 FAIL 확인한다.
- [ ] MPRIS signal·owner watch, HTTPS/로컬 8 MiB, 캐시 64 MiB·64개, 5초 요청·2초 후 한 번 재시도·실패 URL 60초 대기를 구현한다. 이미지 decode/축소는 기존 비동기 경로를 사용한다.
- [ ] `./scripts/dev npm --prefix extension test -- mediaProvider.test.ts`와 `./scripts/test-public-backend.py --suite media` PASS. 16:9 및 정사각형의 원래 비율, pause/exit, disable 시 watch/요청 정리를 실제 GJS로 검사한다.
- [ ] 커밋: `feat: preserve media artwork in the public backend`.

## Task 9: iCal 다운로드·원본 캐시·작업 연결

**Files:** Create `extension/src/data/providers/calendar.ts`, `extension/tests/calendarProvider.test.ts`, `extension/tests/gjs/calendarFeed.ts`; wire localSession.

**Interfaces:** `CalendarProvider implements ProviderDriver<'calendar'>`는 HttpClient/SecretStore/PrivateFiles/ConfigStore/CalendarWorkerClient를 사용한다. raw Uint8Array와 현재 context/now를 CalendarJob으로 넘기며 Shell에서 ICS를 decode/parse하지 않는다.

- [ ] `switch_source_during_fetch`, `switch_month_during_worker`, `offline_recompute`, `clear_then_late_cache_write`, `worker_timeout_keeps_stale`, `same_source_same_day_coalesces`를 작성하고 FAIL 확인한다. 복귀/자정/주 시작 요일 변경도 포함한다.
- [ ] 기존 Google HTTPS 호스트·경로 정책, redirect 금지, 15초/5 MiB fetch와 원래 성공 시각 보존을 구현한다. URL 교체는 새 source에서 빈 loading, 같은 source 실패는 last-good을 유지한다. 다른 context 결과는 표시하지 않는다.
- [ ] worker header의 jobId/source/generation/context를 검사하고 기존 provider status/errorCode로 대응한다. raw cache 저장 직전 mutation lock에서 source를 재확인한다. clear 실패를 성공으로 알리지 않는다.
- [ ] `./scripts/dev npm --prefix extension test -- calendarProvider.test.ts`와 `./scripts/test-public-backend.py --suite calendar-feed` PASS. HTTP 중/worker 중 각각 clear·disable, 오프라인 새 월 재계산, 원래 updatedAt 유지까지 확인한다.
- [ ] 커밋: `feat: connect Google iCal to ephemeral calendar jobs`.

## Task 10: 설정 API·Shell 상태 bridge·preview 전환

**Files:** Create `extension/src/calendar/statusBridge.ts`, `extension/src/prefs/{dataSession,calendarPreview}.ts`, Status1 XML/status schema, `extension/tests/gjs/preferencesData.ts`; modify backend contracts/rust/factory, `prefs/{pages,calendar,weather,placement}.ts`, `shared/{calendarStatus,i18n}.ts`, `prefs.ts`.

**Interfaces:**
```ts
interface CalendarSummary {
  version: 1; instanceId: string; revision: number;
  sourceId: string|null; generation: number;
  context: CalendarContext|null; status: ProviderMap['calendar']['status'];
  updatedAt: string|null; errorCode: string|null; hasData: boolean; eventCount: number;
}
interface PreferencesDataSession {
  getSettings(cancel: Cancellation): Promise<Settings>;
  setCalendarSecret(url: string, cancel: Cancellation): Promise<void>;
  clearCalendarSecret(cancel: Cancellation): Promise<void>;
  searchLocations(query: string, cancel: Cancellation): Promise<WeatherLocation[]>;
  setWeatherLocation(location: WeatherLocation|null, cancel: Cancellation): Promise<void>;
  setNetworkInterface(name: string, cancel: Cancellation): Promise<void>;
  watchCalendar(changed: (state: CalendarSummary, origin: 'shell'|'preview'|'rust'|'unavailable') => void): () => void;
  refreshCalendar(cancel: Cancellation): Promise<void>;
  destroy(): void;
}
function createPreferencesDataSession(extensionPath: string): PreferencesDataSession;
```
`fillSettingsWindow(window,settings,extensionPath)`는 창당 세션 하나를 모든 데이터 페이지에 전달한다. Rust는 기존 D-Bus+DataClient를 감싼다. 공개용은 직접 설정/검색과 Status1 또는 local preview를 사용한다. preview의 context는 현재 현지 월·GLib 현지 시간대·weekStart=0으로 고정한다. Shell 전용 ClockController를 GTK에 import하지 않는다. Shell 연결 후에는 summary의 실제 context를 그대로 사용한다.

- [ ] `prefs_while_extension_off`, `hidden_card_with_prefs_demand`, `shell_appears_cancels_preview`, `shell_disappears_starts_preview`, `two_windows_connect_clear`, `close_during_job`, `foreign_watch_token`을 작성하고 FAIL 확인한다. `close_before_watch_reply`와 `owner_change_before_watch_reply`는 shared prefs bus를 살려 둔 채 늦은 token을 원래 unique owner에 해제하고, watch 수/수집 수요가 0이며 새 owner/UI에 반영되지 않음을 검사한다.
- [ ] `newer_signal_beats_watch_snapshot`은 같은 generation에서 revision 2의 ok 신호 뒤 revision 1의 loading 응답이 와도 ok를 유지한다. `completion_during_watch_setup`은 완료를 놓치지 않으며, `reenable_same_owner_new_instance`는 같은 bus unique owner라도 이전 instance 응답/신호가 새 상태를 덮지 않음을 검사한다.
- [ ] spec의 bus/path/interface에 WatchCalendar→token+summary, UnwatchCalendar, RefreshCalendar, CalendarStatusChanged를 구현한다. summary ≤16 KiB, sender별 token 8/전체 128, sender 소멸 정리, source/generation 검사와 UI 밖의 error enum 검증을 적용한다.
- [ ] Shell enable마다 instanceId UUID를 만들고 모든 summary 변화에 uint32 revision을 증가시킨다. prefs는 signal 연결→WatchCalendar 순서를 지킨다. 초기 reply 전 최신 signal 한 건을 보관하고 reply의 instance가 같은 값 중 최고 revision만 적용한다. attachment 세대가 바뀐 이전 callback은 상태를 갱신하지 않는다. Rust/preview adapter도 연결/수명별 instance와 revision을 생성한다.
- [ ] WatchCalendar는 계산을 기다리지 않고 즉시 응답한다. 발견한 unique owner로 호출하며 10초 응답은 창 닫힘/owner 교체에도 받아서 late token을 원래 owner에 해제한다. shared session 연결은 닫지 않는다. 서버의 sender 소멸/지연 등록 경합도 검사한다. 기존 `client.test.ts`의 late Subscribe 동작을 보존 기준으로 삼는다.
- [ ] bridge는 Shell enable에 export, disable에 unexport한다. 구독 수는 localSession.setCalendarWatchers에 반영한다. prefs는 owner가 있으면 실제 Shell 상태, 없으면 300초 local preview를 사용한다. owner 교체 시 이전 작업을 취소하고 새 상태로 전환하며 원문 이벤트 대신 eventCount를 유지한다.
- [ ] 모든 prefs의 직접 SessionTransport/BUS_NAME 호출을 API로 교체한다. 네트워크 목록은 async listNetworkInterfaces를 쓴다. 한/영에 위젯 동기화/설정창 연결 확인을 구분하는 문구를 추가한다. 다른 설정은 데이터 실패 중에도 동작한다.
- [ ] `./scripts/test-public-backend.py --suite preferences-data`와 기존 calendarStatus/i18n tests PASS. 임시 GTK 창에서 실제 표시·닫기·다시 열기를 검사한다.
- [ ] 커밋: `feat: share settings and live calendar status without a data daemon`.

## Task 11: 전체 UI·에디션 회귀

**Files:** Modify `extension/src/extension.ts`, `scripts/test-gnome.py`, `extension/tests/gnome/preferences.js`; create `tests/gnome/editions.js`, `docs/public-edition-verification.md`.

**Interfaces:** `test-gnome.py --edition rust|gjs --editions`; 기존 `--clock-styles`, `--visual`, `--dynamic-wallpaper`, `--media-art`, `--system`, `--preferences`에 edition 선택을 전달한다. 기본은 rust를 유지한다.

- [ ] 실제 extension의 생성 지점을 createWidgetDataSession으로 바꾸기 전 양쪽 factory 경로를 검사하는 harness를 추가해 gjs 경로 FAIL을 확인한다. `disable_with_preferences_open`에서는 Shell session의 child/config watch/bridge name/token/source가 모두 정리되는지 검사한다. prefs가 새 preview를 시작하는 것은 별도 소유 작업으로 구분한다.
- [ ] `extension.ts`의 `syncProviders()`는 카드 수요가 0일 때 `stop()`을 유지하고, `disable()`의 기존 `client.stop()`은 **`client.destroy()`로 교체한 뒤 null**로 만든다. 새 enable은 새 세션을 만들고 이전 비동기 응답은 무시한다. Rust wrapper의 destroy는 기존 stop 동작을 유지한다.
- [ ] 현재 WidgetHost/ClockController·설정 UI·GLSL을 그대로 연결한다. 화면 구성·도넛·시계 날짜 고정·오늘 표시·이미지 비율·좌우 배치·언어·테마·유리 설정·시간별 배경 변경을 기존 fixture로 검증한다.
- [ ] 실제 private GTK에서 Shell off 설정, owner 전환, worker 오류/stale 표시를 확인한다. Google Calendar 클릭은 격리 URI handler를 사용한다. 사용자 개인 브라우저/피드로 자동 검증하지 않는다.
- [ ] 양쪽 edition의 관련 GNOME suites PASS. 결과 캡처와 문서에 검증한 화면·실패/미검증 범위를 남긴다. 개인용 설치로 확인을 대신하지 않는다.
- [ ] 커밋: `test: verify feature parity across both widget editions`.

## Task 12: 성능·오류·수명 gate

**Files:** Create `scripts/benchmark-editions.py`, `tests/gnome/edition-benchmark.js`, `docs/typescript-performance.md`; extend private worker/local-session suites.

**Interfaces:** `./scripts/benchmark-editions.py --runs 5 --output outputs/verification/edition-performance`가 spec의 30초 준비·유휴/전체 카드 각 120초·1천/1만/5 MiB/sparse 규칙을 두 에디션에서 번갈아 실행한다.

- [ ] 동일 애니메이션/배경/해상도/전원 상태를 고정하고 frame interval p95/p99·50ms stall·총 CPU·Shell 증가분+worker peak PSS/RSS·cold start/갱신 시간을 수집한다. paint duration을 frame gap으로 잘못 표기하지 않는다. parser만이 아니라 reply 검증/직렬화/UI 적용까지 포함한다.
- [ ] 20회 enable/disable와 설정창 on/off, 바쁜 child의 취소·parent SIGKILL, 느린/과대 stdout, 두 창 슬롯 경쟁을 실행한다. 유휴 child 0·일반 취소 ≤1초·부모 사망 ≤11초·process/FD/watch 누수 0을 확인한다.
- [ ] 5회 중 3회 이상 새 50ms stall 또는 p95의 Rust 대비 max(2ms,10%) 이상 악화를 조사한다. 성공 fixture가 9/10초 예산에 걸리면 기능 축소로 해결하지 않는다. 전체 semantics/worker gate가 실패하면 배포 task로 넘어가지 않는다.
- [ ] raw 측정·기기·변동·제약과 gate 결과를 기록하고 관련 회귀만 재실행한다. 모두 PASS일 때 커밋: `test: validate public edition responsiveness and lifecycle`.

## Task 13: 패키징·사용 문서·심사 준비

**Files:** Modify `scripts/{package.py,check-build.py,check.sh}`, `tests/test_install.py`, `README.md`, `docs/{setup,data-service,calendar,weather,live-data}.md`; create `tests/test_public_package.py`, `docs/gnome-extensions-release.md`, `THIRD_PARTY_NOTICES.md`. `LICENSE`는 소유자 선택 후 추가한다.

**Interfaces:** `python3 scripts/package.py --edition rust|gjs` (기본 rust); `./scripts/check.sh --edition rust|gjs|all` (기본 all). public ZIP은 `dist/liquid-widgets-public/liquid-widgets.shell-extension.zip`. public build/check 경로는 cargo/libical 없이 완료되어야 한다.

- [ ] artifact allowlist 검사에 metadata.json·extension/prefs/calendar-worker JS·timezone·schema/CSS/GLSL·고지만 허용한다. Rust ELF/.so/systemd/installer/Node import/테스트 fixture/개인 설정과 worker 코드의 Shell 번들 혼입을 거부하는 테스트를 먼저 작성해 FAIL 확인한다. worker 첫 줄 `#!@GJS@ -m`, `<schema-id>.gschema.xml` 동봉, Shell의 Gtk/Gdk/Adw 및 prefs의 St/Clutter/Meta/Shell import 금지를 검사한다.
- [ ] 두 빌드의 metadata·UUID/schema/path·URL(`https://github.com/NyongCho/gnome-widget`)·출력 디렉터리를 일치시킨다. 공개용 README 설치를 기본으로, Rust 개인용 설치·복귀는 별도 안내한다. 다운로드/설치 시 npm이나 shell 설치 스크립트를 실행하지 않는다.
- [ ] 프로젝트 GPL 호환 라이선스 선택, ical.js MPL-2.0 수정 소스/고지와 timezone provenance를 정리한다. 아직 라이선스가 없으면 출시 준비 완료로 표시하지 않는다.
- [ ] 심사 설명에 일회성 worker의 범위·약 0.7초 stall 실측·종료 검증·전송/저장/삭제·지원 범위를 기록한다. 공유 UI의 run_dispose 필요성을 확인하고 필수 호출은 이유를 주석으로 남긴다. 유지보수자의 코드 이해/관리와 읽기 좋은 출력 여부를 확인한다. GI 누락은 해당 기능 안내로 처리하고 자동 설치하지 않는다.
- [ ] `./scripts/check.sh --edition all`, `python3 -m unittest discover -s tests -p 'test_*package.py'`, GNOME 50 깨끗한 사용자 환경의 ZIP 설치/활성화/제거 PASS. 외부 공개 API·실제 계정 확인은 자동 fixture 결과와 구분한다.
- [ ] 커밋: `build: package the public edition with calendar workers`. 최종 변경을 검토하고 결과를 보고한다. EGO 업로드·개인용 설치 교체는 별도 요청 시 수행한다.

## 실행 순서와 계획 점검

기본 순서: `1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13`. 실제 구현 시작 시 별도 작업 브랜치/격리 작업 공간을 사용한다. task마다 해당 파일만 커밋한다. 외부 서비스 전체를 복제하는 이전 계획으로 되돌아가지 않는다.

설계 대응: calendar 의미는 1, 프로세스/프로토콜은 2, 빌드/Rust 보존은 3·13, 비밀/삭제 경쟁은 4·9·10, 가벼운 제공자는 5–8, 실제 동기화 상태와 off 상태 설정창은 10, 모든 시각 기능은 11, 최대 입력/수명/성능은 12다. Review Focus 다섯 항목은 각 소유 task에 테스트가 있다. 독립 설계 검토와 계획 self-review를 마쳤으며, 대기 중 deadline·삭제 재시도·preview context·공유 I/O 시그니처를 명시했다.

2026-11-06 재검토: 기존 계약 기준 검토는 late WatchCalendar token 정리 누락 1건, 요구사항 검토는 같은 항목과 disable→destroy 연결·snapshot/신호 순서 누락까지 3건을 확인했다(중복 제외 3건). Task 10·11과 설계에 반영했다. 현재 `client.test.ts` 11개가 통과해 기존 보존 기준을 확인했으며 새 bridge 검증은 구현 task에서 수행한다. 추가로 Task 4의 키링 8초 제한/선택 GI 지연 로드와 Task 13의 metadata·worker header·schema/import 심사 검사를 명시했다.

완료는 **기존 기능이 양쪽 에디션에서 유지되고, 공개 ZIP이 Rust 없이 동작하며, 정확성·프레임·종료 검증을 통과한 상태**다. 이번 문서 작성은 구현 완료나 GNOME Extensions 승인을 의미하지 않는다.

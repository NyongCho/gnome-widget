# Liquid Glass Desktop Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 이 계획은 현재 세션에서 순차 구현하는 제안이며 자동 실행 지시가 아니다.

**Goal:** GNOME 50 바탕화면에 Liquid Glass 스타일의 개인 위젯을 구현한다.

**Architecture:** Rust 사용자 서비스는 데이터를 수집·정규화하고 세션 D-Bus로 제공한다. TypeScript GNOME 확장은 카드·입력·설정을 관리한다. GLSL은 배경화면의 굴절을 처리하며 텍스트에는 적용하지 않는다.

**Tech Stack:** Rust stable, Tokio, reqwest/rustls, serde, zbus 후보; TypeScript → GJS ES modules, St/Clutter/Cogl; GLSL; systemd user service. ICS·시간대 라이브러리는 Task 0에서 적합성을 검증하고 버전을 잠근다. GI 타입 정의도 로컬 Mutter 18 / GNOME 50 API와 대조한다.

**Spec:** [PRD v1.0](liquid-glass-prd.md), [기술 설계](liquid-glass-design.md)

**Status:** 2026-11-03 PRD 기준 반영. 시계·연결 해제·출처 변경·접근성 요구를 task와 검증에 배정했다. Task 0의 계약·캘린더 엔진을 구현했으며, 완료 표시된 항목은 실행 검증 결과를 반영한다.

**Review:** [2026-11-03 저장소·로컬 API 검토](liquid-glass-repository-review.md)를 반영했다. 구조 검토를 통과했으며 Task 0의 Rust/TypeScript/GJS 실행 검증을 진행했다. GPU 시각·성능 검증은 아직 하지 않았다.

**Execution order:** 의존성에 따라 **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7** 순서로 진행한다. Task 0과 1은 전체 기능 구현 전 관문이다.

## Global Constraints

- 대상: Ubuntu 26.04.1, GNOME Shell 50.1, Wayland. 우선 GNOME 50만 지원한다.
- 사용자는 읽기 전용 Google Calendar와 클릭 시 브라우저 열기를 원한다.
- 데이터 처리 Rust, 확장 TypeScript → JavaScript, 유리 효과 GLSL.
- root 서비스, 외부 수신 포트, Mutter 패치, 전체 화면 캡처는 사용하지 않는다.
- 비공개 URL은 로컬 키링에만 저장하고 로그·snapshot·git에는 넣지 않는다.
- Shell의 St/Clutter 모듈과 prefs의 GTK4/Adwaita 모듈을 분리한다. 공통 타입·검증 모듈에는 UI import를 넣지 않는다. Node.js는 빌드와 순수 로직 테스트에만 사용한다.
- 서비스 기동은 systemd 한 경로로 통일한다. Rust 바이너리는 확장 ZIP에 넣지 않는다.
- 첫 버전은 iCal 1개 읽기 전용, 현재 달, 진행 중·다가오는 일정 최대 3개, 날씨 지역 1곳·향후 6시간, 네트워크 history 60초다.
- 기본 표시 카드는 시계·달력·일정·날씨·네트워크이며 오른쪽 위에 배치한다. 시스템·음악도 구현하되 기본 표시는 끈다.
- 실제 설치와 GNOME 세션 조작은 Task 1 이후에 수행한다. Task 0에는 독립 라이브러리·계약 검증 코드만 있다.

## Review Focus

- 반복 일정 변경·취소·종일·DST 및 조회 범위 이전에 시작한 진행 중 일정이 정확해야 한다 — Task 0, 4.
- DING·작은 화면·분수 배율·모니터 소실에서 카드 입력과 아이콘 조작이 유지되어야 한다 — Task 1, 3, 7.
- URL·날씨 지역·NIC 변경 뒤 늦게 도착한 이전 응답, 해제 뒤 재시작에서 예전 값이 복원되지 않아야 한다 — Task 2, 4, 5, 6.
- 서비스 장애·절전 복귀·자정·시간대 변경에도 시계와 카드 상태가 맞고 중복 timer/actor가 없어야 한다 — Task 2, 3, 7.
- 잠금 화면에 일정이 보이지 않고 키링 실패에도 연결 해제·캐시 삭제 결과를 정직하게 표시해야 한다 — Task 4, 7.

## 파일 구조

프로젝트 루트는 `/home/nyong/projet/gnome-widget/`다. 아래 경로는 이 프로젝트 루트 기준이다. 별도 `work/liquid-glass-widgets/`를 중첩 생성하지 않는다. Task 0의 라이브러리·계약·테스트가 준비되어 있다. 아래 구조의 나머지는 후속 구현 대상이다.

```text
daemon/Cargo.toml
daemon/src/{lib,main,config,ipc,cache,secrets,types}.rs
daemon/src/providers/{calendar,weather,system,network,media}.rs
daemon/tests/{contract,ipc,calendar,weather,system,network,media,cache}.rs
daemon/tests/support/mod.rs
extension/{package.json,tsconfig.json,metadata.json,stylesheet.css}
extension/src/{extension,prefs,dbus,types,layout,clock}.ts
extension/src/platform/{desktopLayer,gnome50}.ts
extension/src/shared/{validation,providerStore,clockValues,calendarFormat,agenda,cardState}.ts
extension/tests/{contract,layout,clockValues,calendarFormat,agenda,cardState}.test.ts
extension/src/widgets/{clock,calendar,agenda,weather,system,network,media}.ts
extension/src/effects/{glass,background}.ts
extension/shaders/glass.glsl
extension/schemas/org.gnome.shell.extensions.liquid-widgets.gschema.xml
protocol/{snapshot.schema.json,settings.schema.json,org.local.LiquidWidgets1.xml}
tests/fixtures/{calendar,weather,system,network}/
scripts/{install-user,uninstall-user,check}.sh
packaging/liquid-widgets.service
docs/{setup,verification,shader-spike,calendar-feasibility,third-party-notices}.md
```

책임: `types`는 공통 DTO, `ipc`는 D-Bus 경계, `config`는 비밀값 없는 설정, `cache`는 sourceId별 저장, `secrets`는 키링, `providers`는 개별 데이터 수집을 담당한다. 상세 책임과 UI/서비스 경계는 기술 설계의 컴포넌트 표를 따른다.

실행 준비: 현재 셸 PATH에서 rustc/cargo/node/npm을 찾지 못했다. 실행 시작 시 사용자 도구 경로를 먼저 확인하고, 없으면 설치 범위와 버전을 정해 개발 환경을 준비한다. 이 점검은 설치 완료를 뜻하지 않는다. 프로젝트가 Git 저장소가 아니면 실행 단계에서 이 폴더를 저장소로 초기화하고 문서 기준점을 기록한다. 이미 저장소라면 기존 변경을 보존한다.

검증 명령은 프로젝트 루트 기준이다. Task 0에서 순수 TS 테스트 러너를 설정해 `npm --prefix extension test -- <test-file>`을 사용할 수 있게 한다. Rust는 lib target을 제공해 integration test가 공개 타입·함수를 가져오게 한다. 실패 검증은 동작 assertion 실패여야 하며 의존성 미설치나 문법 오류를 성공적인 실패 재현으로 세지 않는다. 각 task는 해당 검증을 통과한 뒤 그 task 파일만 커밋한다.

## Task 0: 계약과 캘린더 적합성 검증

**Files:** `protocol/*`, `extension/src/{types,shared/validation}.ts`, 빌드·테스트 설정, `daemon/{Cargo.toml,src/lib.rs,src/types.rs}`, `daemon/src/providers/calendar.rs`, `daemon/tests/{calendar.rs,support/mod.rs}`, `tests/fixtures/calendar/`, `docs/calendar-feasibility.md`.

**Interfaces:** `expand_ics(input: &str, context: &CalendarContext, now: &str) -> Result<Vec<CalendarEvent>, CalendarError>`. `now`는 offset을 포함한 RFC3339이며 테스트가 실제 실행일에 의존하지 않도록 주입한다. `CalendarContext={month:string,timeZone:string,weekStart:number}`(0=일요일, 6=토요일). Event와 provider DTO는 Task 2/4에 명시된 계약을 이 task에서 먼저 선언한다. 테스트 helper `seoul_november()`는 2026-11, Asia/Seoul, 월요일 시작의 고정 컨텍스트다.

- [x] Task 2의 snapshot·provider 변경 계약을 먼저 확정한다. 양쪽에서 사용하는 예시 fixture와 오류 상태를 작성하고 Rust/TypeScript 명명 규칙을 맞춘다.
- [x] RRULE/RDATE, EXDATE, RECURRENCE-ID 변경, 취소된 반복 occurrence, TZID/VTIMEZONE, floating time, DST, 여러 날 종일 일정 fixture를 작성한다. 현재 달력 그리드와 다음 30일이 조회 범위다.
- [x] `weekly-exdate.ics`에 2026-11-02 09:00 Asia/Seoul 시작, 주간 COUNT=3, 11월 9일 제외를 넣고 아래 assertion을 `weekly_exdate_has_two_occurrences`로 작성한다. `expand_ics` 임시 구현은 비어 있는 결과를 반환하게 해 assertion 실패를 확인한다.

```rust
let events = expand_ics(include_str!("../../tests/fixtures/calendar/weekly-exdate.ics"),
    &seoul_november(), "2026-11-03T12:00:00+09:00")?;
assert_eq!(events.iter().map(|e| e.start.as_str()).collect::<Vec<_>>(),
    ["2026-11-02T09:00:00+09:00", "2026-11-16T09:00:00+09:00"]);
```

- [x] Rust ICS 파서·반복 규칙 후보를 작은 실행 검증으로 비교한다. 유한 조회 범위·반복 건수·연산량 제한을 확인한다. 미지원 시간대를 임의로 로컬 시간대로 바꾸거나 예외 일정을 중복 표시하면 실패다.
- [x] `moved_occurrence_replaces_original`, `cancelled_occurrence_is_absent`, `all_day_end_is_exclusive`, `dst_keeps_local_start`, `ongoing_event_overlaps_window`, `custom_vtimezone_is_resolved`, `expansion_limit_returns_error`를 fixture 기대값으로 검증한다. 원본 ICS 최대 5MiB, 반복 확장 최대 10000건을 적용한다.
- [x] 통과한 조합과 지원 범위를 기록한다. 실패하면 libical 계열 또는 GOA/EDS 대안의 비용을 비교하고 iCal 방식에 미치는 영향을 보고한다. 전체 UI 구현 전에 해결 방향을 결정한다.
- [x] `cargo test --manifest-path daemon/Cargo.toml --test calendar`를 실행해 모든 fixture가 PASS인지 확인하고 라이브러리·lockfile·지원 범위를 기록한다. 계정 연결 없이 통과해야 한다.

**완료 기준:** 공통 데이터 계약이 있고, 요구한 캘린더 정확성을 입증하는 fixture가 후보 라이브러리에서 통과한다. 실제 계정 없이 검증 가능해야 한다.

## Task 1: GNOME 배경 굴절 기술 검증

**Files:** `extension/src/extension.ts`, `extension/src/effects/{glass,background}.ts`, `extension/src/platform/{desktopLayer,gnome50}.ts`, `extension/shaders/glass.glsl`, 빌드 설정, `docs/shader-spike.md`.

**Interfaces:** `GlassSurface.setGeometry(rect: Rect, scale: number): void`, `setStrength(value: number): void`, `destroy(): void`. `Rect = {x:number,y:number,width:number,height:number}`. 구현 가능한 API를 검증한 후 클래스 내부 경로를 확정한다.

- [x] 검토 보고서의 로컬 API 결과를 기준으로 타입 정의·실행 버전을 고정한다. 없는 `ShaderEffect.new_with_snippet/set_uniform_float`를 사용하지 않는다. 다른 확장과 충돌하지 않는 GType namespace를 정한다.
- [x] 독립 BackgroundManager 배경 복제, 카드 영역과 blur padding, Cogl.Pipeline/Snippet/Offscreen 및 Clutter paint node 경로를 구현한다. 카드마다 전체 모니터 크기의 FBO를 무제한 유지하지 않는다. private API는 platform adapter에 격리한다.
- [x] `gnome-shell-test-tool --extension`을 이용하는 개발용 세션에서 단일 카드와 글자, 굴절 0/양수 비교 모드를 만든다. 실제 사용자 Wayland 세션을 강제 재시작하지 않는다.
- [x] 대비가 뚜렷한 테스트 배경으로 모서리 UV 왜곡이 보이고 글자는 변형되지 않는지 확인한다. 빈 텍스처·셰이더 오류를 실패로 기록한다.
- [x] DING 유무에 따라 카드가 아이콘 창 위·일반 창 아래에 표시되도록 DesktopLayerAdapter를 검증한다. 카드 클릭, 아이콘 클릭·드래그, 카드 외부 입력 통과를 확인한다.
- [x] 배경 변경, 100%/분수 배율, 일반 창 겹침, overview·workspace 전환, Blur my Shell 활성 상태를 확인한다. 배경·배치 변경만 효과 캐시를 무효화하고 텍스트 갱신은 분리한다. 사용할 API와 한계를 문서화한다.
- [x] 통과 시 `feat: prove wallpaper refraction on GNOME 50`로 커밋한다. 실패 시 실제 원인을 보고하고 후속 전체 구현을 멈춘다.

**완료 기준:** HTML이 아닌 GNOME 50에서 굴절 카드 한 개의 실행 증거, DING과 클릭 공존 결과, 동작 한계가 있다. headless 성공만으로 실제 GPU·바탕화면 동작을 통과 처리하지 않는다.

## Task 2: Rust 서비스와 D-Bus 계약

**Files:** Rust 초기 구조, `protocol/*`, `extension/src/{types,dbus}.ts`, `daemon/tests/{contract,cache}.rs`.

**Interfaces:** 세션 bus `org.local.LiquidWidgets`, object `/org/local/LiquidWidgets`, interface `org.local.LiquidWidgets1`. `GetSnapshot() -> s`는 초기 전체 JSON, `ProviderChanged(s provider, u revision, s payload)`는 provider 상태만 포함하는 변경 신호다. `Subscribe(as providers) -> s token`, `Unsubscribe(s token)`으로 sender+token별 구독을 추적한다. 명시적 해제와 name-owner 소실을 모두 처리한다. `Refresh(s provider)`는 제한된 수동 새로고침이다.

`ProviderName='calendar'|'weather'|'system'|'network'|'media'`. `ProviderMap`은 각 이름과 `ProviderState<해당 Data>`의 매핑이다. `Snapshot={schemaVersion:1,generatedAt:string,revisions:Record<ProviderName,number>,calendar:ProviderState<CalendarData>,weather:ProviderState<WeatherData>,system:ProviderState<SystemData>,network:ProviderState<NetworkData>,media:ProviderState<MediaData>}`. revision은 서비스 인스턴스 안에서 provider별 증가하며 bus owner 변경 시 클라이언트가 기존 revision을 폐기한다.

`ProviderState<T>={status:'loading'|'ok'|'stale'|'unconfigured'|'unavailable',sourceId:string|null,updatedAt:string|null,data:T|null,errorCode:string|null}`. 시간 문자열은 offset을 포함한 RFC3339(종일 이벤트의 날짜 필드는 Task 4 예외). Rust serde 필드는 camelCase. 데이터 세부 타입은 Task 0에서 선언하고 각 provider task에서 변경 시 schema와 양쪽 타입을 함께 갱신한다. 최대 snapshot·신호 payload는 각각 512KiB이며 초과 provider는 명확한 오류 상태로 처리한다. 비밀값이나 공급자 오류 원문을 넣지 않는다.

설정 IPC: `GetSettings()->s`, `SetCalendarContext(s contextJson)`, `SetCalendarSecret(s url)`, `ClearCalendarSecret()`, `SearchLocations(s query)->s`, `SetWeatherLocation(s locationJson)`, `SetNetworkInterface(s name)`. 반환 표기가 없는 메서드는 반환 데이터가 없다. `locationJson`의 JSON null은 지역 해제다. `Settings={calendarEnabled:boolean,calendarSecretDeletionPending:boolean,weatherLocation:WeatherLocation|null,networkInterface:string}`이며 NIC 자동 선택 값은 `auto`다. 입력·출력 JSON은 `settings.schema.json`에 정의한다.

클라이언트 상태 병합 경계: `ProviderStore.acceptSnapshot(snapshot:Snapshot):void`, `applyChange<K extends ProviderName>(name:K,revision:number,state:ProviderMap[K]):boolean`, `resetOwner():void`, `get<K extends ProviderName>(name:K):ProviderMap[K]`. revision이 같거나 더 낮으면 false를 반환하며 데이터를 바꾸지 않는다. 알 수 없는 schema/provider·초과 payload는 검증 단계에서 거부한다.

- [ ] 계약 테스트에 잘못된 schemaVersion, 비밀 URL 누출, provider별 독립 실패, 512KiB 초과 입력 거부, 중복·역순 신호, 서비스 owner 변경을 명시하고 실패를 확인한다. 신호 payload에도 크기·구조 검증을 적용한다.
- [ ] serde 타입·JSON Schema·TypeScript 검증을 구현해 동일 fixture를 양쪽에서 통과시킨다.
- [ ] `provider_revision_is_monotonic` 테스트를 먼저 실패시킨 뒤 구현한다. revision 4를 적용한 후 revision 3과 4를 전달하면 `applyChange`는 false이고 기존 값이 유지되어야 한다. owner 변경 후에는 새 snapshot의 revision 1을 받을 수 있어야 한다.
- [ ] Tokio 비동기 서비스와 zbus를 연결한다. 구독자 0명일 때 수집을 멈추고 재구독 시 재개한다. ICS 계산은 제한된 worker에서 유한 범위·연산량 상한으로 실행하여 async executor를 막지 않는다.
- [ ] GJS 호출은 비동기·취소 가능하게 하고 enable/disable 세대가 다른 응답은 버린다. 신호 연결·구독 후 snapshot을 읽고, 그 사이의 신호를 revision으로 병합한다. 재연결 시 전체 snapshot을 다시 가져온다.
- [ ] 확장 disable 시 해당 token을 해제하며 공유 session bus 연결 자체를 닫지 않는다. systemd가 서비스를 관리하고 확장에서 별도 spawn하지 않는다. 서비스가 없으면 연결 오류와 설치 안내를 표시한다.
- [ ] 원자적 캐시 교체와 0600/0700 권한 테스트를 통과시킨다. 서비스 재시작·연결 끊김에서도 확장이 마지막 값을 유지하게 한다.
- [ ] 출처가 바뀌면 sourceId를 교체하고 provider data를 비운다. 비동기 작업 결과는 시작 당시 sourceId·조회 컨텍스트 세대가 현재와 일치할 때만 publish/cache한다. `old_source_response_is_discarded`, `new_source_never_reads_old_cache`, `late_old_owner_response_is_discarded`를 지연된 가짜 요청으로 검증한다.
- [ ] `dbus-run-session -- cargo test --manifest-path daemon/Cargo.toml --test ipc`에서 구독 두 개 중 하나 해제, caller 소실, 서비스 재연결을 검증한다. 실제 사용자 세션의 bus name을 테스트가 점유하지 않는다.
- [ ] `cargo test --manifest-path daemon/Cargo.toml`와 extension 타입·계약 검사를 통과시키고 `feat: add typed local data service`로 커밋한다.

## Task 3: 카드 배치와 확장 생명주기

**Files:** `extension/src/{extension,layout,clock}.ts`, `extension/src/shared/{clockValues,cardState}.ts`, `extension/src/widgets/*.ts`, `extension/tests/{layout,clockValues,cardState}.test.ts`, `stylesheet.css`, schemas, `docs/verification.md`.

**Interfaces:** `WidgetHost.update(snapshot: Snapshot): void`, `updateProvider<K extends ProviderName>(name: K, state: ProviderMap[K]): void`, `destroy(): void`; `LayoutConfig={monitor:string,anchor:'top-right'|'top-left',offsetX:number,offsetY:number,scale:number,visible:string[]}`. Task 0/2 계약의 예시와 실제 데이터를 같은 경로로 표시한다.

`millisecondsToNextMinute(nowMs:number):number`는 다음 분 경계까지의 지연이며 1..60000 범위다. `ClockController.start(onTick:(nowMs:number)=>void):void`, `destroy():void`는 GI adapter로 시스템 시간·설정 변경과 절전 복귀를 수신한다. `computeLayout(config:LayoutConfig,workarea:Rect,visibleCards:string[]):LayoutResult`는 순수 함수이며 `LayoutResult={cards:{id:string,rect:Rect}[],columns:1|2,overflow:boolean,viewport:Rect}`를 반환한다. cards 좌표는 스크롤 콘텐츠 기준, viewport는 화면 좌표다. `CardStateView.update(state:ProviderState<unknown>,connected:boolean):void`는 데이터·로딩·오류 표시를 갱신한다.

- [ ] `layout` 순수 함수 테스트에 작은 화면, 모니터 소실, 배율 변경을 넣는다. viewport는 항상 작업 영역 안에 있고 콘텐츠가 높이를 넘으면 overflow=true여야 한다. 표시되는 내용은 viewport에서 clip한다.
- [ ] 레이아웃 함수를 구현하고 타입 검사·테스트를 통과시킨다.
- [ ] 시계와 기본 카드(달력·일정·날씨·네트워크), 설정에서 켜는 시스템·음악을 구성한다. 공간 부족 시 1열로 재배치하고 세로 공간도 부족하면 묶음 내부 스크롤을 사용한다. 숨긴 음악 카드의 빈 공간을 제거하고 설정 진입점은 화면 안에 유지한다.
- [ ] `clock_values_follow_minute_boundary`를 아래 assertion으로 먼저 실패시킨 뒤 구현한다. 별도 테스트에서 자정·시간대·12/24시간 변경을 고정 시간으로 검증한다. 서비스 연결이 없어도 시계가 갱신되어야 한다.

```typescript
assert.equal(millisecondsToNextMinute(Date.parse('2026-11-03T09:59:59.250+09:00')), 750);
assert.equal(millisecondsToNextMinute(Date.parse('2026-11-03T10:00:00+09:00')), 60000);
```

- [ ] 연결 전·최초 loading·정상 빈 결과·stale·unavailable·연결 해제를 구분한다. 기존 데이터가 있는 갱신 실패는 마지막 성공 시각을 보존하고, 출처 변경은 기존 데이터를 숨긴다. snapshot fixture로 `card_states_do_not_fabricate_values`를 검증한다.
- [ ] Task 1의 DesktopLayerAdapter를 통해 배치하고 카드 외부 입력은 통과시킨다. 모니터/workarea 변경을 처리하며 잠금 화면에는 표시하지 않는다.
- [ ] provider 변경 시 해당 카드만 갱신한다. 순수 날짜·배치 계산 테스트에는 GJS UI 모듈을 import하지 않는다.
- [ ] enable/disable 20회 후 남은 actor·signal·timer가 없고 원래 데스크톱 동작이 복원되는지 확인한다.
- [ ] `npm --prefix extension test -- clockValues.test.ts layout.test.ts cardState.test.ts`와 타입 검사를 실행해 PASS를 확인한다. 실제 GNOME에서 작은 workarea·스크롤 경계·시간대 변경·서비스 종료·절전 복귀를 확인한다.
- [ ] `feat: add desktop widget layout and lifecycle`로 커밋한다.

## Task 4: Google Calendar와 월간 달력

**Files:** `daemon/src/providers/calendar.rs`, `secrets.rs`, `extension/src/widgets/{calendar,agenda}.ts`, `prefs.ts`, calendar fixtures/tests.

**Interfaces:** `CalendarData={month:string,timeZone:string,weekStart:number,events:CalendarEvent[]}`; `CalendarEvent={uid:string,occurrenceKey:string,title:string,start:string,end:string,allDay:boolean}`. 종일 start/end는 YYYY-MM-DD이며 end는 exclusive다. `selectAgenda(events:CalendarEvent[],nowMs:number,today:string):CalendarEvent[]`는 진행 중 우선·종료 제외·최대 3개를 반환한다. `today`는 CalendarData.timeZone의 YYYY-MM-DD다. 동률은 start, uid, occurrenceKey 순으로 정렬한다. 별도 prefs 창에서 마스킹된 입력을 받고 `SetCalendarSecret` 요청 후 필드를 지운다. 같은 사용자 세션 D-Bus를 비밀 격리 경계로 설명하지 않는다.

- [ ] Task 0에서 통과한 fixture와 라이브러리를 실제 provider에 연결한다. 지원 범위가 달라지면 적합성 검증을 다시 수행한다. shared CalendarServer 조회 범위나 date menu 내부 상태에 의존하지 않는다.
- [ ] 설정된 Google Calendar HTTPS iCal URL만 읽고 응답 크기 5MiB·timeout 15초·반복 확장 건수 10000개 상한을 둔다. 미지원 데이터는 마지막 성공 결과를 보존하며 오류를 표시한다.
- [ ] 키링 잠김·잘못된 URL·HTTP 실패 테스트와 비밀값 비노출 테스트를 통과시킨다.
- [ ] `disconnect_removes_events_and_cache`를 작성한다. 연결 해제 후 snapshot은 unconfigured/data=null, 디스크의 해당 sourceId 캐시는 없음, 재시작 후에도 옛 일정은 없음이어야 한다. 지연된 이전 응답도 폐기되어야 한다. 키링 삭제 실패에는 calendarEnabled=false·캐시 없음은 유지하고 calendarSecretDeletionPending=true로 남긴다.
- [ ] Secret Service 테스트 대역으로 저장·삭제 실패를 먼저 재현한 뒤 실제 adapter를 연결한다. URL 교체 시 옛 캐시를 비우고 새 sourceId 결과만 표시한다.
- [ ] 현재 달력 그리드 및 30일 일정 범위를 계산해 오늘 표시·날짜 점·다음 3개 일정을 구현한다. GNOME의 주 시작 요일·시스템 시간대 변경을 반영한다. 첫 버전에는 다른 달 이동을 넣지 않는다.
- [ ] `extension/src/shared/agenda.ts`와 `calendarFormat.ts`를 구현한다. 분 경계마다 진행 중·종료 여부를 다시 계산한다. `agenda_excludes_ended_and_caps_at_three`, `all_day_is_active_until_exclusive_end`, `month_grid_uses_week_start`를 검증한다. 종료·진행 중·미래 일정 4개 fixture의 반환 uid가 `['ongoing','next-1','next-2']`여야 한다.
- [ ] 월·날짜·시간대·주 시작 요일 변경 시 `SetCalendarContext`로 재계산한다. 응답 컨텍스트가 현재 UI와 다르면 새 컨텍스트 결과로 표시하지 않는다. 원본 일정 캐시가 있으면 오프라인에서도 새 범위를 계산한다.
- [ ] 카드 클릭은 Gio 기본 URI 실행으로 Google Calendar를 연다. 날짜 링크는 실제 브라우저에서 확인하고 불가하면 홈 링크로 폴백한다.
- [ ] `cargo test --manifest-path daemon/Cargo.toml --test calendar` 및 GNOME 수동 클릭 검증 후 `feat: add read-only Google Calendar widgets`로 커밋한다.

## Task 5: 현재 날씨와 시간별 예보

**Files:** `daemon/src/providers/weather.rs`, `extension/src/widgets/weather.ts`, `prefs.ts`, weather fixtures/tests.

**Interfaces:** `WeatherLocation={id:string,label:string,latitude:number,longitude:number,timeZone:string}`; `WeatherData={location:string,timeZone:string,current:{temperatureC:number|null,code:number|null},hourly:{at:string,temperatureC:number|null,precipitationProbability:number|null}[],attributionUrl:string}`. `SearchLocations`는 WeatherLocation 배열을 반환하며 `SetWeatherLocation`으로 선택한다. null 값은 화면에서 사용 불가 표시로 처리한다.

- [ ] 지역 미설정, 자정·시간대 변환, 값 누락, timeout, HTTP 429 fixture를 만든다. 없는 값은 0으로 꾸미지 않는다.
- [ ] Open-Meteo 현재·향후 6시간 예보를 조회한다. 좌표는 사용자가 선택하고 API 키 없는 비상업용 조건과 출처 표시를 확인한다.
- [ ] 지역 검색과 선택 UI를 연결한다. `location_change_rejects_previous_response`를 재현한다: A 요청 대기 중 B 선택 → A 결과는 무시, B loading에는 A 기온 없음, B 성공 값만 표시. 검색 실패만으로 기존 선택 A의 데이터를 지우지는 않는다.
- [ ] 15분 주기·재시도 backoff·수동 갱신 제한·마지막 성공 데이터 보존을 구현한다.
- [ ] `cargo test --manifest-path daemon/Cargo.toml --test weather`와 카드 오프라인 상태를 확인하고 `feat: add weather widget`으로 커밋한다.

## Task 6: 시스템 네트워크 음악

**Files:** `daemon/src/providers/{system,network,media}.rs`, 대응 widgets, `tests/fixtures/{system,network}/`, `daemon/tests/{system,network,media}.rs`.

**Interfaces:** `SystemData={cpuPercent:number|null,memoryUsedBytes:number,memoryTotalBytes:number,temperatureC:number|null}`; `NetworkData={interface:string,rxBytesPerSec:number|null,txBytesPerSec:number|null,history:{at:string,rx:number,tx:number}[]}`; `MediaData={player:string,status:'playing'|'paused'|'stopped',title:string,artist:string,artUri:string|null}`. CPU·속도의 첫 표본은 null/측정 중으로 표시하며 history에 가짜 0을 추가하지 않는다.

- [ ] 시간차 기반 네트워크 속도 계산 테스트: 동일 counter는 0, 재설정·NIC 전환은 첫 표본을 버림, 2초간 2048바이트 증가는 1024 B/s, NIC 합산 없음.
- [ ] CPU 첫 표본 처리, 온도 센서 없음→null, RAM 사용량 정의를 구현·검증한다. root 권한을 요구하지 않는다.
- [ ] `system_first_sample_has_no_cpu_rate`, `missing_sensor_is_null`을 먼저 실패시킨 뒤 구현한다. 메모리 사용량은 MemTotal-MemAvailable을 기준으로 하고 표시·비교 도구의 정의를 문서화한다.
- [ ] 2초 수집·5초 온도·60초 네트워크 history를 구현하고 단위 표시를 자동 변환한다.
- [ ] MPRIS 다중 플레이어 중 재생 중인 앱을 우선하며 이름 순으로 동률 결정한다. 종료·pause·미지원 앱에서 카드가 올바르게 숨겨지는지 검증한다.
- [ ] `mpris_selects_playing_player`, `paused_players_hide_card`, `interface_change_resets_rate_and_history`를 가짜 이벤트·counter fixture로 검증한다. 네트워크의 2초간 2048바이트 증가는 정확히 1024 B/s여야 한다.
- [ ] 앨범 커버는 선택적이다. 초기판은 읽을 수 있는 로컬 artUri만 허용하고 그 외에는 기본 아이콘을 사용한다.
- [ ] Rust 테스트와 실제 Tailscale 사용 중 속도 확인 후 `feat: add system network and media widgets`로 커밋한다.

## Task 7: 설치 설정 성능과 인수 검증

**Files:** `prefs.ts`, schemas, install/uninstall/check scripts, user service, `docs/{setup,verification}.md`.

- [ ] 위치·모니터·크기·카드 표시·굴절 강도·저전력 모드를 설정한다. 굴절 불가 상태에는 명확한 반투명 fallback을 제공한다.
- [ ] 불투명도 설정과 키보드 탐색을 확인한다. Tab/Shift+Tab, 입력·선택·저장, 연결 해제, 오류 안내가 키보드로 접근 가능해야 한다. 상태는 색만으로 구분하지 않는다. 설정 창 공통 모듈에서 Shell UI import가 발생하지 않는지 확인한다.
- [ ] 사용자 영역 설치 스크립트는 기존 설치를 백업하고 systemd 사용자 서비스와 GNOME 확장을 설치한다. 서비스는 graphical session 수명주기에 연결하고 설치 시 시작·활성화한다. 제거는 위젯·서비스만 제거하며 `--purge-data`를 설정·캐시·비밀 삭제의 명시적 옵션으로 제공한다. 키링 삭제 실패를 완료로 표시하지 않는다.
- [ ] 확장 ZIP에는 읽을 수 있는 빌드된 JS·GLSL·schema만 넣고 Rust 바이너리는 별도 배포한다. 참고 코드를 재사용하면 파일별 라이선스와 출처를 기록한다. extensions.gnome.org 제출 여부는 별도 결정한다.
- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`를 daemon manifest 대상으로 실행한다. extension의 `npm ci`, `npm run typecheck`, `npm test`, `npm run build`와 metadata/schema 검증을 실행한다.
- [ ] `gnome-shell-test-tool` 개발 세션에서 Shell 로딩·셰이더·cleanup을 확인하고, 실제 환경에서 재로그인·suspend/resume·화면 잠금·다중 모니터 분리·서비스 재시작·인터넷 끊김을 확인한다. DING·Ubuntu Dock·Blur my Shell 공존과 일정의 잠금 화면 비노출을 확인한다.
- [ ] 동일 배경/해상도/전경 동작으로 OFF/ON 비교를 3회 수행한다. 서비스 CPU 평균 1%/논리 코어, RSS 100MiB, 프레임 시간 p95 증가 2ms 목표를 측정한다. Shell CPU/RSS 변화·offscreen 할당량·가능한 GPU 지표도 측정한다. headless 소프트웨어 렌더링 결과를 실제 GPU 성능으로 제시하지 않는다. 도구·조건·측정 불가 항목·미달 항목을 기록하고 필요하면 효과 해상도·갱신을 줄인다.
- [ ] 30분 사용과 enable/disable 20회 뒤 누수·셸 오류를 확인한다. 캘린더 클릭·날씨·음악과 비밀값 비노출까지 통과하면 `feat: package and verify desktop widgets`로 커밋한다.

**완료 기준:** PRD F-01~F-10, Q-01~Q-07 각각에 자동 테스트 또는 실제 실행 증거를 연결한다. 실제 계정 연결, GPU 성능, 시각 검토를 하지 않았다면 해당 항목을 미검증으로 남긴다. 정상 배경 굴절 없이 반투명 fallback만 동작하는 것은 첫 버전의 완료가 아니다.

## 인수 산출물

설치 가능한 확장 ZIP, Rust 서비스 바이너리, 사용자 설치/제거 스크립트, 설정 가이드, 실제 데스크톱 스크린샷, 기능·성능 검증 결과를 제공한다. 설치 경로와 제거법을 명시하고 실제 계정 연결 없이 검증한 항목은 구분한다.

## 자체 검토

사용자 요청한 모든 카드, 읽기 전용 캘린더, 클릭 동작, 굴절, Rust/TS 분리와 제거 경로를 task에 배정했다. 실제 저장소와 로컬 API를 대조해 Cogl 렌더링 경로, DING adapter, provider별 변경 신호, 서비스 단일 기동 경로와 별도 바이너리 배포를 추가했다. Task 0에서 계약과 ICS, Task 1에서 굴절과 클릭 공존을 먼저 검증한다. 문서 검토는 구현 성공이나 성능 보장이 아니다. 날씨 지역·비밀 iCal 주소는 실제 설정 시 입력하며 지금 계획 작성에는 필요하지 않다.

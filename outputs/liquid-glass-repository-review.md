# GNOME 저장소 기반 계획 검증

검토일: 2026-11-03. 결론: **Rust + TypeScript + GLSL 구조는 실제 사례가 있어 유지할 수 있다. 기존 계획은 셰이더 API, 바탕화면 레이어, 일정 처리, IPC와 배포를 보완한 뒤 구현해야 한다.**

검증 범위는 공개 저장소 소스·메타데이터·라이선스, 공식 문서와 이 PC의 읽기 전용 API 점검이다. 참고 확장을 설치하거나 실행하지 않았고, 자체 위젯도 구현하지 않았다. 저장소가 지원 버전을 선언한다는 사실과 이 PC에서 동작을 확인했다는 사실은 구분한다.

## 확인한 저장소

| 저장소와 고정 revision | 실제 확인한 파일 | 판단 |
|---|---|---|
| [Liquid Glass](https://github.com/ryohsuke1231/liquid-glass/tree/a3fb66f7cfd9eb1a77cb3def03ec0dff0bf193c9) | TypeScript rendering/pipelines.ts, rendering/backdropGlass.ts, desktop/desktopLayer.ts, desktop/widgets.ts, shaders/glass.frag, package.json, tsconfig.json, metadata.json, LICENSE | TS → JS, Cogl 파이프라인, GLSL 굴절, 데스크톱 카드의 실례. 전체 화면 framebuffer 경로까지 그대로 채택하면 범위와 위험이 커진다. |
| [Blur my Shell](https://github.com/aunetx/blur-my-shell/tree/57fb510438d701b369d13a1640eba49c073deea0) | src/render/shader/shader_effect.js, src/pipelines/pipeline.js, src/components/popup/static_actor.js, metadata.json, LICENSE | BackgroundManager로 배경 복제, offscreen texture, Cogl snippet, clipping·resource scale 처리 확인. 현재 PC에도 v77이 설치되어 있다. |
| [Desktop Widgets](https://github.com/r3nhick/desktop-widgets/tree/442f3500843afc2b2ef6e5735052f59eccc086c0) | lib/glass.js, lib/widgetGlass.js, extension.js, widgets/calendar/widget.js, metadata.json, LICENSE | 배경화면만 굴절하는 카드에 가장 가까운 설계. DING 창 위로 레이어를 재배치하며 달력은 GNOME CalendarServer를 사용한다. |
| [Strata](https://github.com/Edu4rdSHL/Strata/tree/1294ba741a7016c3b195b379d10b356349d2e492) | strata-daemon/Cargo.toml, src/dbus_service.rs, 확장의 dbus.js·extension.js·metadata.json, systemd service | GNOME 50을 선언한 GJS 프런트엔드와 Rust/Tokio/zbus 백엔드. 비동기 호출·서비스 소유자 확인·재시작 대응을 참고할 수 있다. |
| [vitals-rs](https://github.com/NicksLameCode/vitals-rs/tree/06d529b1c85ff83dda383eaddd699662462aba20) | crates/vitals-daemon/src/dbus.rs, main.rs | Rust에서 센서 캐시·변경 신호·시계열 조회를 D-Bus로 제공하는 실례. 이 저장소의 성능이나 안정성은 실행 검증하지 않았다. |

## 1. 실제 API 차이 발견

최신 Clutter 온라인 문서는 현재 API 51을 설명한다. 이 PC의 Mutter/Clutter 18 typelib을 GJS에서 읽었을 때 다음 결과가 나왔다. 객체 생성이나 화면 렌더링 없이 메서드 존재만 검사했다.

| API | 이 PC의 결과 |
|---|---|
| Clutter.ShaderEffect.new_with_snippet | 없음 |
| Clutter.ShaderEffect.prototype.set_uniform_float | 없음 |
| Clutter.ShaderEffect.prototype.set_shader_source | 있음 |
| Clutter.ShaderEffect.prototype.set_uniform_value | 있음 |
| Cogl.Snippet.new, Cogl.Pipeline.new | 있음 |
| Cogl.Pipeline.prototype.set_uniform_1f, set_uniform_float | 있음 |
| Cogl.Offscreen.new_with_texture, Clutter.PipelineNode.new, Clutter.LayerNode.new_to_framebuffer | 있음 |

따라서 Desktop Widgets의 API 자동 판별 부분만 따라 하고 이후 `set_uniform_float`까지 그대로 호출하면 실패할 가능성이 있다. 이것은 해당 프로젝트 전체의 실행 실패를 확인했다는 뜻이 아니다. **우리 구현은 현재 로컬 API에서 확인된 Cogl 경로를 우선 검증한다.** 최신 문서나 main 브랜치를 곧바로 GNOME 50 호환 코드로 취급하지 않는다.

근거: [Desktop Widgets 효과 클래스](https://github.com/r3nhick/desktop-widgets/blob/442f3500843afc2b2ef6e5735052f59eccc086c0/lib/glass.js#L249), [Blur my Shell Cogl effect](https://github.com/aunetx/blur-my-shell/blob/57fb510438d701b369d13a1640eba49c073deea0/src/render/shader/shader_effect.js#L56), [현재 온라인 Clutter 문서](https://gnome.pages.gitlab.gnome.org/mutter/clutter/class.ShaderEffect.html).

## 2. 굴절의 첫 구현 경로를 구체화

Desktop Widgets는 별도 BackgroundManager가 만든 배경을 카드 위치에 맞춰 이동시키고, 주변 픽셀 여유분을 포함해 blur 후 굴절·마스크를 적용한다. 효과용 offscreen buffer padding도 보정한다. Blur my Shell은 배경 복제로 부분 repaint 문제를 줄인다.

우리 첫 경로: **BackgroundManager 배경 복제 → 카드 영역과 blur 여유분 확보 → Cogl offscreen/snippet → 굴절·테두리 → 별도 전경 텍스트**. 기존 배경 actor 자체를 변형하거나 stage를 캡처하지 않는다. 카드마다 4K 전체 배경을 무제한 FBO로 유지하지 않도록 입력 범위와 메모리 할당량을 측정한다.

Liquid Glass 저장소의 framebuffer blit 방식은 가능성을 보여주지만, 소스에는 damage 영역 밖의 이전 프레임, 가려진 창, screenshot paint 경로를 따로 다루는 코드가 있다. 정적인 바탕화면 위젯에 이 복잡도를 가져오지 않는다. 셰이더 결과와 GPU 비용은 아직 실측 대상이다.

근거: [배경 카드 구조](https://github.com/r3nhick/desktop-widgets/blob/442f3500843afc2b2ef6e5735052f59eccc086c0/lib/glass.js#L1), [배경 복제](https://github.com/aunetx/blur-my-shell/blob/57fb510438d701b369d13a1640eba49c073deea0/src/pipelines/pipeline.js#L57), [framebuffer 경로](https://github.com/ryohsuke1231/liquid-glass/blob/a3fb66f7cfd9eb1a77cb3def03ec0dff0bf193c9/liquid-glass%40thinkingcoding1231.gmail.com/src/rendering/backdropGlass.ts#L736).

## 3. DING과의 클릭 충돌은 현재 환경의 실제 조건

이 PC에는 `ding@rastersoft.com`이 설치되어 있으며 enabled-extensions 목록에도 있다. Blur my Shell v77과 Ubuntu Dock도 활성 목록에 있다. 이는 렌더링 성공 검증이 아니라 설정과 설치 소스 확인이다.

배경 그룹에 카드를 추가하는 것만으로는 DING의 바탕화면 창에 가려지거나 클릭을 받지 못할 수 있다. 두 위젯 저장소는 DING/desktop window를 찾아 그 위, 일반 창 아래에 컨테이너를 배치한다. 이 내부 API 의존성을 `DesktopLayerAdapter` 한 곳에 제한한다. DING 없음/있음, 창 열기·최소화, overview·workspace 전환, 아이콘 클릭과 드래그, 카드 외부 클릭 통과를 첫 실행 검증에 포함한다.

근거: [Liquid Glass desktopLayer.ts](https://github.com/ryohsuke1231/liquid-glass/blob/a3fb66f7cfd9eb1a77cb3def03ec0dff0bf193c9/liquid-glass%40thinkingcoding1231.gmail.com/src/desktop/desktopLayer.ts#L214), [Desktop Widgets 레이어 배치](https://github.com/r3nhick/desktop-widgets/blob/442f3500843afc2b2ef6e5735052f59eccc086c0/extension.js#L1094).

## 4. Rust 분리는 타당하지만 통신 계획을 줄여야 함

Strata에서 Rust/Tokio/zbus, GJS 비동기 proxy, JSON 응답, 서비스 소유자 변경 대응을 확인했다. vitals-rs에는 센서 조회와 readings-changed 신호가 있다. 이들은 우리 조합의 실현 가능성 근거이며 Rust를 쓰면 자동으로 빠르다는 벤치마크 근거는 아니다.

기존 계획의 전체 SnapshotChanged JSON은 센서가 2초마다 바뀔 때 캘린더·날씨까지 다시 파싱시킬 수 있다. 초기 전체 snapshot 뒤에는 provider별 변경만 전달한다. sender만으로 구독을 구분하지 않고 구독 token을 발급한다. GJS의 공유 session bus 연결을 쓰는 다른 확장과 수명주기가 같다고 가정하지 않는다. 재연결 후 전체 snapshot으로 복구한다.

서비스 시작은 systemd 사용자 서비스 한 경로로 통일하며 확장에서 별도 프로세스를 중복 spawn하지 않는다. Shell의 모든 IPC는 비동기이고 취소 가능해야 한다. Rust의 ICS CPU 작업도 async executor를 막지 않도록 격리·제한한다.

근거: [Strata proxy](https://github.com/Edu4rdSHL/Strata/blob/1294ba741a7016c3b195b379d10b356349d2e492/strata%40edu4rdshl.dev/dbus.js), [중복 프로세스 방지](https://github.com/Edu4rdSHL/Strata/blob/1294ba741a7016c3b195b379d10b356349d2e492/strata%40edu4rdshl.dev/extension.js#L216), [vitals-rs D-Bus](https://github.com/NicksLameCode/vitals-rs/blob/06d529b1c85ff83dda383eaddd699662462aba20/crates/vitals-daemon/src/dbus.rs).

## 5. 달력은 선례를 그대로 가져올 수 없음

Liquid Glass의 일정은 Shell date menu의 내부 event source에서 이미 조회된 일정만 읽으며 기본 GNOME Calendar 앱을 연다. Desktop Widgets는 CalendarServer의 SetTimeRange를 호출한다. 우리 요구는 비공개 iCal과 Google Calendar 브라우저 열기이므로 이 코드가 그대로 요구를 충족하지 않는다. 특히 공유 CalendarServer 범위나 내부 date menu 상태에 의존하지 않는다.

Rust `ical`은 구문 파서이고 `rrule`은 반복 규칙 라이브러리다. 두 개를 넣었다고 취소·변경된 occurrence, 사용자 정의 VTIMEZONE까지 자동 완성되는 것은 아니다. 전체 UI 이전에 parser 적합성을 확인한다. 이를 통과하지 못하면 libical 계열 바인딩 또는 GOA/EDS 연동 대안을 비교하되, 승인된 iCal 연결 방식을 몰래 바꾸지 않는다. 현재 달 월간 그리드와 다음 30일만 1차 범위로 삼고 다른 달 이동은 이후 범위로 분리한다.

근거: [기존 일정 소스의 범위 제약](https://github.com/ryohsuke1231/liquid-glass/blob/a3fb66f7cfd9eb1a77cb3def03ec0dff0bf193c9/liquid-glass%40thinkingcoding1231.gmail.com/src/desktop/widgets.ts#L222), [CalendarServer 호출](https://github.com/r3nhick/desktop-widgets/blob/442f3500843afc2b2ef6e5735052f59eccc086c0/widgets/calendar/widget.js#L148), [ical 문서](https://docs.rs/ical/0.11.0/ical/), [rrule 문서](https://docs.rs/rrule/0.14.0/rrule/).

## 6. 테스트와 배포 보완

`gnome-shell-test-tool --extension`과 `--headless`가 로컬에 존재한다. 순수 로직은 Node/Rust로 테스트하고 실제 Shell·GLSL은 별도 GNOME 테스트 세션에서 검사한다. headless 성공은 사용자 GPU 성능이나 DING 공존 검증을 대신하지 않는다. Wayland 세션을 Alt+F2 r로 재시작하는 절차는 사용하지 않는다.

설정 창은 GTK4/Adwaita 프로세스, 데스크톱은 St/Clutter 프로세스이므로 공통 모듈에 양쪽 UI import를 섞지 않는다. node_modules는 빌드 도구이며 GJS에 Node.js 런타임이 있다고 가정하지 않는다.

Extension ZIP과 Rust 서비스 배포는 분리한다. EGO 배포 시 native binary를 ZIP에 포함할 수 없으며, 개인용 설치와 EGO 심사 통과는 별개다. 전체 fork 대신 작은 독립 adapter와 renderer를 작성한다. 실제 코드 재사용 전 파일별 출처를 기록한다. Liquid Glass 루트는 MIT, Blur my Shell과 Desktop Widgets 루트는 GPLv3로 확인했으며, 루트 라이선스만으로 모든 서브파일의 조건이 동일하다고 단정하지 않는다.

근거: [GNOME 50 테스트 도구](https://gjs.guide/extensions/upgrading/gnome-shell-50.html), [프로세스 구분 및 배포 규칙](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).

## 수정 후 진행 순서

1. 로컬 API·데이터 계약 고정 및 ICS 적합성 검증.
2. 실제 데스크톱에 굴절 카드 한 개, DING과의 클릭 공존 검증.
3. Rust/D-Bus 연결과 변경 데이터 전달.
4. 달력·일정 중심의 전체 카드 UI.
5. 날씨·시스템·음악 확장.
6. 사용자 설치·제거, 잠금·복귀·배율·다중 모니터·메모리·프레임 측정.

구조 검토는 통과하지만, 아직 런타임 인수 검증은 통과한 것이 아니다. 바로 전체 기능을 구현하기보다 첫 두 관문으로 API와 데이터 정확성의 위험을 먼저 줄이는 것이 합리적이다.

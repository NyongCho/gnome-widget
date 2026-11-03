# Liquid Glass Desktop Widgets 설계

작성일·저장소 검토 반영일: 2026-11-03. 상태: 구조 검토 완료, 구현·런타임 검증 전. 대상: 현재 확인된 Ubuntu 26.04.1, GNOME Shell 50.1, Wayland. 근거와 한계는 [저장소 검토 보고서](liquid-glass-repository-review.md)에 기록했다.

제품 범위와 완료 기준은 승인된 [PRD v1.0](liquid-glass-prd.md)을 따른다. 아래의 iCal 방식·현재 달만 표시·기본 배치는 첫 버전 기준으로 채택했으며, 실제 API·렌더링·연동 검증은 구현 관문에서 수행한다.

## 목적과 범위

macOS Liquid Glass에서 영감을 받은 개인용 바탕화면 위젯을 만든다. 둥근 카드, 배경화면 굴절, 은은한 블러와 반사광을 사용하되 텍스트는 별도 전경 레이어에 선명하게 표시한다. Apple 효과의 물리적 복제는 목표로 삼지 않는다.

포함: 날짜·시계, 월간 달력, 다가오는 일정, 현재·시간별 날씨, CPU·RAM·온도, 네트워크 속도·그래프, 음악 정보. 각 카드를 끌 수 있고 음악은 재생 중일 때만 보인다. 모니터·배치·크기·불투명도·굴절 강도를 설정한다.

Google Calendar는 비공개 iCal 구독으로 읽기만 한다. 월간 달력에는 일정 표시점을, 일정 카드에는 다음 3개 일정을 표시한다. 클릭은 기본 브라우저의 Google Calendar를 연다. 안정적인 날짜 링크가 검증되면 날짜별 이동을 지원하고, 아니면 캘린더 홈을 연다. ICS UID를 Google 이벤트 URL의 ID로 간주하지 않는다.

## 접근 방식

- Conky: 기존 설정 재사용에는 유리하지만 현재 GNOME Wayland에서 클릭·배치·굴절 통합을 별도 해결해야 한다.
- Rust 독립 앱: 렌더링을 Rust 중심으로 만들 수 있지만 바탕화면 레이어와 GNOME 배경 접근이 어렵다.
- 선택한 방향: Rust 서비스 + TypeScript GNOME 확장 + GLSL. 사용자는 이 조합으로 계획 수립을 요청했다. 데이터 처리는 별도 프로세스, 셸 통합은 GJS에서 실행한다.

## 구조와 경계

Rust 서비스가 네트워크 요청, ICS 반복 일정 계산, 시스템 수집, MPRIS를 담당한다. TypeScript는 JavaScript ES 모듈로 빌드되어 카드와 설정 화면을 구성한다. 데스크톱은 St/Clutter, 별도 설정 창은 GTK4/Adwaita를 사용하며 공통 모듈에 양쪽 UI import를 섞지 않는다. Node.js는 빌드·순수 로직 테스트용이며 GJS 런타임에 요구하지 않는다.

양쪽은 사용자 세션 D-Bus로 통신한다. 최초 연결에는 전체 snapshot, 이후에는 provider별 변경만 전달해 센서 갱신마다 달력을 다시 파싱하지 않는다. Shell에서 IPC는 비동기로 호출하며 재연결 시 전체 상태를 복원한다. 구독은 sender와 token으로 구분한다. HTTP 서버나 외부 수신 포트는 만들지 않는다.

셰이더는 배경화면 텍스처에만 적용한다. 첫 검증 경로는 독립 BackgroundManager의 배경 복제 → 카드 영역과 blur 여유분 → Cogl offscreen/snippet → 곡률 기반 UV 이동·모서리 반사 → 별도 전경 텍스트다. 창·화면 전체를 실시간 캡처하지 않는다. 배경 맞춤 방식, 모니터 위치, 화면 배율과 blur padding이 텍스처 좌표에 반영되어야 한다. 로컬 GNOME 50.1에 없는 ShaderEffect.new_with_snippet/set_uniform_float를 가정하지 않는다. 실제 렌더링 성공 여부는 단일 카드 검증에서 확정하며 wgpu는 추가하지 않는다.

바탕화면 레이어 처리는 DesktopLayerAdapter로 격리한다. 이 PC에서 활성 목록에 있는 DING의 desktop window 위, 일반 앱 창 아래에 카드가 위치해야 한다. 다른 확장의 private 객체를 직접 호출하지 않고, GNOME 내부 API 의존 지점과 효과 GType을 자체 namespace로 한정한다.

## 기본 동작 제안

- CPU·RAM·네트워크 2초, 온도 5초, 캘린더 5분, 날씨 15분 갱신. 음악은 D-Bus 이벤트로 갱신한다.
- 화면에는 마지막 성공 시각과 오래된 데이터 상태를 전달한다. 오프라인에서도 마지막 성공 데이터를 유지한다.
- 날짜·시간은 시스템 시간대를 기본으로 한다. 날씨 지역은 사용자가 설정하며 서울로 묵시적으로 고정하지 않는다.
- 첫 버전은 현재 달을 표시한다. ICS 조회 범위는 월간 달력 그리드 시작일부터 그리드 끝 또는 현재부터 30일 중 더 늦은 시점까지다. 다른 달 이동은 이후 범위다. 반복 일정 예외, 취소, 종일 일정, 시간대 및 여름시간 처리는 전체 UI 구현 전 fixture로 검증한다. 구문 파서와 RRULE 라이브러리를 조합하는 것만으로 완성된다고 가정하지 않는다.
- 네트워크는 기본 경로 인터페이스 한 개를 기본으로 사용하고 수동 선택을 허용한다. 물리 NIC와 Tailscale을 합산해 이중 집계하지 않는다.
- 음악은 MPRIS 지원 플레이어만 대상이다. 지원되지 않는 앱은 표시하지 않는다.
- 카드 외부는 클릭을 가로채지 않는다. 일반 창 뒤에 표시하며 잠금 화면에서는 일정·위젯을 숨긴다. DING 아이콘 클릭·드래그, overview·workspace 전환, Blur my Shell 공존을 확인한다.
- 확장 비활성화 시 actor, signal, timer, D-Bus 연결을 해제한다. 서비스는 구독이 끊기면 수집을 중단한다.

## 저장 및 설치

서비스 설정은 XDG config 아래 TOML, 캐시는 XDG cache 아래 저장한다. 비공개 ICS URL은 Secret Service에 보관하고 서비스가 조회한다. 키링이 잠겼으면 연결 필요 상태를 표시한다. 로컬 설정 창에서 마스킹된 입력을 한 번 받아 비동기 저장 요청 후 필드를 지우며, 저장된 URL을 다시 표시하거나 로그·D-Bus snapshot·git에 넣지 않는다. 세션 D-Bus는 같은 사용자 프로세스 사이의 통신이며 별도 보안 격리 경계로 간주하지 않는다. 캐시에는 일정 제목이 포함될 수 있으므로 디렉터리 0700, 파일 0600을 사용한다.

확장은 사용자 영역, 서비스는 systemd 사용자 서비스로 설치한다. 서비스 시작·재시작 소유자는 systemd 하나이며 확장에서 별도 spawn하지 않는다. 확장 ZIP과 Rust 바이너리는 분리해 배포한다. root 서비스나 GNOME/Mutter 패치를 요구하지 않는다. 지원 범위는 우선 GNOME 50으로 제한하며, 개인용 설치 성공과 extensions.gnome.org 심사 통과는 구분한다. 참고 코드 재사용 시 파일별 라이선스·출처를 확인한다.

## 컴포넌트 책임과 설정 소유권

| 컴포넌트 | 책임 | 경계 |
|---|---|---|
| Rust 서비스 | 일정·날씨·시스템·네트워크·MPRIS, 공통 상태·캐시·비밀정보, 비시각적 설정 저장 | 서비스만 TOML·provider 캐시를 쓴다. |
| Shell 확장 | 카드, 시계, 월 그리드·일정 선택, 모니터 배치, 클릭, 연결 상태 | 네트워크 조회·ICS 파싱·동기 IPC를 실행하지 않는다. |
| 설정 창 | 카드/효과/배치 편집, 캘린더 연결/해제, 지역 검색·선택, NIC 선택 | 시각적 설정은 GSettings, 서비스 설정은 비동기 D-Bus 메서드로 변경한다. |
| GlassSurface | 배경 복제·클립·padding·굴절·캐시 | 전경 텍스트를 렌더링하거나 데이터 갱신을 소유하지 않는다. |
| DesktopLayerAdapter | DING 위·일반 창 아래 배치, 모니터/workarea·workspace 대응 | GNOME 내부 API 사용을 이 경계와 효과 adapter로 한정한다. |
| 순수 shared 모듈 | schema 검증·상태 병합·시계 값·배치 계산·일정 정렬 | GI/UI import 없이 Node 테스트와 GJS 양쪽에서 사용한다. |

GSettings에는 선택 모니터·앵커·오프셋·전체 크기·카드 표시·불투명도·굴절·저전력만 둔다. TOML에는 날씨 위치, NIC 선택, 캘린더 활성 여부와 비밀값을 포함하지 않는 sourceId를 둔다. URL은 TOML에 넣지 않는다.

## 시계·달력·좁은 화면

ClockController는 Shell 안에서 동작하며 Rust 연결과 무관하다. 시스템 시간의 다음 분 경계에 맞춰 갱신하고 시간대·날짜·12/24시간 형식 변경 및 절전 복귀에는 즉시 새 값을 읽는다. 반복 타이머 누적을 피하고 disable에서 구독과 타이머를 해제한다. 구현 시 설치된 GNOME 시간 알림 API를 대조하고, 시간 변경 후 60초 이상 오래된 시각을 유지하지 않도록 검증한다.

월간 그리드와 일정 목록은 같은 시간대·주 시작 요일을 사용한다. Shell은 서비스에 `{month:'YYYY-MM',timeZone:string,weekStart:0..6}` 컨텍스트를 전달하며, 서비스는 월 그리드와 다음 30일의 합집합을 확장한다. 컨텍스트 변경은 재계산을 유발하며 이전 범위 결과를 새 범위로 간주하지 않는다. 네트워크가 끊겨도 캐시된 ICS가 있으면 재계산한다. 진행 중 일정 우선·종료 일정 제외·다음 3개 선택은 분 갱신마다 cached events에서 재계산한다.

배치 기본값은 오른쪽 위, 시계·달력·일정·날씨·네트워크 표시다. 카드 폭과 간격은 시제품에서 조정하며, 좁은 작업 영역에서는 1열로 전환한다. 1열에서도 높이가 부족하면 위젯 묶음 내부에 세로 스크롤을 허용한다. 글자를 무한 축소하거나 선택된 카드를 임의로 숨기지 않는다. 카드 밖의 빈 영역은 스크롤·클릭을 가로채지 않으며, 화면이 작아도 설정 버튼은 접근 가능한 위치에 둔다. 이는 PRD의 작은 화면 접근성 요구를 충족하기 위한 구현 결정이다.

## 초기 로딩·상태 갱신·설정 변경

공통 상태는 `loading | ok | stale | unconfigured | unavailable`이다. `ok`이면서 빈 배열인 것은 실패가 아니다. 최초 요청은 loading, 갱신 실패는 마지막 데이터가 있으면 stale, 없으면 unavailable로 표시한다. provider 오류와 버스 연결 오류를 구분하며, 연결이 끊기면 수신 시각을 새 성공 시각으로 기록하지 않는다.

전체 snapshot은 최초 연결·재연결에만 사용하고 이후 provider별 revision 신호를 병합한다. 신호를 먼저 구독하고 snapshot 응답 전 도착한 변경을 잠시 보관한 후 revision 순으로 합친다. bus owner가 바뀌면 이전 revision과 대기 응답을 폐기한다.

캘린더 URL·날씨 위치가 바뀔 때마다 임의의 sourceId를 새로 발급한다. URL이나 URL 해시를 외부 상태 식별자로 사용하지 않는다. 캐시는 provider+sourceId에 귀속되며 비동기 작업은 시작 당시 sourceId가 현재와 다르면 캐시·화면 갱신에 사용하지 않는다. 같은 출처의 네트워크 실패에는 마지막 데이터를 유지하지만, 출처가 바뀌면 기존 내용을 즉시 비운다.

캘린더 연결 해제는 활성 상태·진행 중 요청·메모리 데이터·provider 캐시를 무효화하고 비밀 저장소 항목을 삭제한다. 키링 잠김으로 비밀 항목 삭제가 실패해도 연결 비활성 및 일정 캐시 삭제는 유지하며, 설정 창에 비밀정보 삭제 재시도가 필요함을 표시한다. 성공하지 않은 삭제를 완료했다고 표시하지 않는다. 재시작 후 예전 일정이 복원되지 않아야 한다.

## 설정용 IPC

기존 snapshot/구독 메서드에 다음 경계를 추가한다. JSON 인자는 공통 schema로 검증하고, 메서드의 실패 응답에는 비밀 원문을 넣지 않는다. 모든 호출은 비동기다.

| 메서드 | 입력·결과 | 동작 |
|---|---|---|
| GetSettings | 입력 없음 → 비밀값 없는 JSON | 캘린더 활성 여부, 현재 날씨 위치와 NIC 선택을 읽는다. |
| SetCalendarContext | month·timeZone·weekStart JSON → 결과 없음 | 확장의 월·시간대 변경을 일정 범위에 반영한다. |
| SetCalendarSecret / ClearCalendarSecret | URL / 입력 없음 → 결과 없음 | 설정·연결 해제와 출처 무효화를 수행한다. |
| SearchLocations | 검색어 → WeatherLocation 배열 JSON | Rust에서 지역을 조회하며 설정 창은 선택 결과만 저장한다. |
| SetWeatherLocation | WeatherLocation JSON 또는 null → 결과 없음 | 새 지역 선택 또는 해제 시 기존 지역 캐시와 화면을 비운다. |
| SetNetworkInterface | 'auto' 또는 인터페이스 이름 → 결과 없음 | 표본 기준과 history를 초기화한 뒤 다시 측정한다. |

`WeatherLocation={id:string,label:string,latitude:number,longitude:number,timeZone:string}`. 지역 미설정·선택 취소·검색 실패는 구분한다. 지역 검색 실패 때문에 이미 선택된 지역의 정상 데이터를 지우지 않는다.

## 검증 및 결정 시점

먼저 계약과 ICS 라이브러리 적합성을 검증하고, 첫 시각적 산출물로 실제 데스크톱의 굴절 카드 하나를 만든다. 굴절과 DING 클릭 공존을 통과한 뒤 전체 UI로 확장한다. 미리보기 HTML이나 메서드 존재 확인은 런타임 검증으로 간주하지 않는다. GNOME API로 배경 접근·효과 적용이 불가능하거나 불안정하면 문제와 가능한 대안을 제시한다. 블러만 구현하고 굴절이 완성됐다고 보고하지 않는다.

순수 로직은 Rust/Node, 실제 Shell·GLSL은 로컬에 존재하는 gnome-shell-test-tool과 별도 GNOME 테스트 세션으로 검증한다. headless 테스트는 실제 GPU·DING 공존 검증을 대체하지 않는다. 사용자 Wayland 세션을 강제 재시작하지 않는다.

성능은 현재 장치에서 확장 OFF/ON을 비교한다. 첫 목표는 안정 시 서비스 CPU 평균 한 논리 코어의 1% 이하, RSS 100MiB 이하, 전경 창을 움직일 때 프레임 시간 p95 증가 2ms 이하이다. GNOME Shell의 CPU·메모리 증가와 GPU/offscreen 할당량도 함께 기록한다. 이는 검증할 목표이지 보장 수치가 아니다. 지속적인 애니메이션 루프 없이 배경·배치·효과 설정 변경 시 배경 캐시를 갱신한다. 시간·센서 텍스트 갱신은 유리 배경 캐시와 분리한다.

실제 연결 단계에서 필요한 사용자 입력: 날씨 도시, 표시할 캘린더의 비공개 iCal 주소를 로컬 설정 화면에 입력, 선호하는 모니터와 위치. 그 전까지 명확히 표시된 예시 데이터로 개발할 수 있다.

## 참고

- [GNOME 확장 구조](https://gjs.guide/extensions/overview/anatomy.html)
- [TypeScript에서 GJS로 빌드](https://gjs.guide/extensions/development/typescript.html)
- [Google Calendar 읽기 전용 iCal 연결](https://support.google.com/calendar/answer/37648?hl=en)
- [Open-Meteo 이용 조건](https://open-meteo.com/en/pricing): 개인 비상업용 API를 후보로 사용하고 출처를 표시한다. 구현 시 사용 조건을 재확인한다.

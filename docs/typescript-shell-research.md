# GNOME 50 Shell 내부 TypeScript/GJS 가능성 조사

2026-11-06. 공식 문서·고정 버전 소스와 현재 저장소를 읽은 결과다. **확인**은 문서/소스로 확인한 사실, **권고**는 아직 구현·검증하지 않은 설계 판단이다. 실제 개인 일정·키링은 조회하지 않았다. 이 문서는 전체 기능 동등성이나 Shell 프레임 성능의 통과 증거가 아니다.

**판단: 별도 Rust/GJS 데이터 프로세스 없이 구현할 API 경로는 있다. 그러나 기존 `ICAL.parse()`를 Shell에 그대로 옮기는 방식의 안전성은 확인되지 않았다.** I/O보다 달력의 단일 CPU 호출, 설정창과 Shell 사이의 상태 소유권이 남는 핵심 문제다. 공식 GNOME 설정창은 원래 별도 프로세스이므로, 여기서 “외부 프로세스 없음”은 **확장이 추가 데이터 작업 프로세스를 실행하지 않음**을 뜻한다.

## Shell에서 사용할 수 있는 API

| 영역 | 확인된 사실 | 구현 시 남는 조건 |
| --- | --- | --- |
| GI 기반 I/O | GNOME Shell **50.0** 자체가 `Gio` 2.0, `Soup` 3.0을 필수 dependency로 import한다. Shell의 확장 다운로더도 Soup 비동기 HTTP를 사용한다. | `gi://Soup?version=3.0` 사용. 개발용 `@girs` 타입 설치만으로 런타임 검증을 대신하지 않는다. |
| HTTP | `Soup.Session.send_async()`/`send_finish()`는 응답 헤더 뒤에 `Gio.InputStream`을 제공한다. `read_bytes_async()`로 본문을 제한된 크기씩 읽을 수 있다. | 취소·총 요청 deadline·실제 읽은 byte 상한·HTTP 오류 처리를 갖춘 공통 fetch 모듈이 필요하다. |
| proc/sysfs | `Gio.File`의 비동기 읽기와 비동기 디렉터리 열거, `FileEnumerator.next_files_async()`가 제공된다. `/proc`·`/sys`를 읽는 데 shell command 실행은 필요하지 않다. | 장치 제거·권한 오류를 처리하고, 모든 센서/인터페이스를 무제한 병렬 조회하지 않는다. 파일 크기 metadata 대신 읽은 byte 수를 제한한다. |
| 키링 | `Secret.Service.search()`는 비동기이며 `SearchFlags.LOAD_SECRETS`는 잠기지 않은 항목의 secret만 로드한다. `UNLOCK`을 빼면 해당 검색 경로는 unlock을 요청하지 않는다. | `Secret-1.typelib`과 기존 Secret Service provider의 설치 여부는 별도 확인 대상이다. Secret은 Shell 50 필수 GI 목록에 없다. 잠긴 항목·누락·서비스 오류를 구분한다. |

근거: [GNOME Shell 50 dependencies](https://github.com/GNOME/gnome-shell/blob/50.0/js/misc/dependencies.js), [50.0 확장 다운로더](https://github.com/GNOME/gnome-shell/blob/50.0/js/ui/extensionDownloader.js), [Soup send_async](https://libsoup.gnome.org/libsoup-3.0/method.Session.send_async.html), [Gio read_bytes_async](https://docs.gtk.org/gio/method.InputStream.read_bytes_async.html), [load_contents_async](https://docs.gtk.org/gio/method.File.load_contents_async.html), [enumerate_children_async](https://docs.gtk.org/gio/method.File.enumerate_children_async.html), [next_files_async](https://docs.gtk.org/gio/method.FileEnumerator.next_files_async.html), [Secret search](https://gnome.pages.gitlab.gnome.org/libsecret/method.Service.search.html), [SearchFlags](https://gnome.pages.gitlab.gnome.org/libsecret/flags.SearchFlags.html).

**확인:** Soup의 기본 ContentDecoder가 압축을 해제해도 `Content-Length`는 원래 압축 길이를 나타낸다. 본문 제한은 읽은 **압축 해제 후** byte에 적용해야 한다. `MessageFlags.NO_REDIRECT`로 기존 리디렉션 금지 정책을 표현할 수 있다. [ContentDecoder](https://libsoup.gnome.org/libsoup-3.0/class.ContentDecoder.html), [MessageFlags](https://libsoup.gnome.org/libsoup-3.0/flags.MessageFlags.html)

**권고:** 작은 proc 파일도 비동기 스트림으로 제한해서 읽고, 2초 수집 중 이전 수집이 진행 중이면 겹치지 않게 한다. 파일 읽기 다음의 문자열 변환·파싱은 JS CPU 작업이므로 작게 유지한다. 네트워크 rate는 `GLib.get_monotonic_time()`을 사용하되 suspend 뒤 첫 표본을 재설정한다. 단조 시계가 suspend 중 계속 가는지는 플랫폼 의존이다. [GLib 단조 시계](https://docs.gtk.org/glib/func.get_monotonic_time.html)

**확인:** libsecret의 편의 `Service.lookup()` 구현은 잠긴 항목만 발견하면 unlock 경로를 호출한다. “비동기 lookup이므로 무프롬프트”라고 가정하면 안 된다. 백그라운드는 flags를 지정하는 `search()` 경로가 맞다. `OPEN_SESSION`은 secret 전송용 세션 설정이며 collection 잠금 해제와 다르다. [libsecret 0.21.7 검색/lookup 구현](https://github.com/GNOME/libsecret/blob/0.21.7/libsecret/secret-methods.c), [ServiceFlags](https://gnome.pages.gitlab.gnome.org/libsecret/flags.ServiceFlags.html)

## 달력: async와 점진 처리는 다르다

**확인:** GJS JavaScript는 단일 스레드이며 확장은 GNOME Shell의 기존 GLib 이벤트 루프를 사용한다. GI 비동기 함수 일부는 내부 thread에서 I/O를 처리하지만, `async` 함수나 Promise가 JS 파서를 별도 thread로 옮기지는 않는다. 낮은 우선순위 `GLib.idle_add()`는 양보할 기회를 만들 뿐, 실행 중인 함수를 선점하지 않는다. [GJS 비동기 실행 설명](https://gjs.guide/guides/gjs/asynchronous-programming.html)

ical.js **v2.2.1** 소스에서 확인한 구체적인 제약:

- `ICAL.parse(input)`는 `_eachLine()`으로 전체 입력을 동기 처리한다. `ComponentParser.process()`도 문자열이면 먼저 전체 `ICALParse()`를 호출하고, 이벤트 callback들을 동기로 실행한다. callback API라는 이유로 streaming/비동기 파서로 볼 수 없다. [parse.js](https://github.com/kewisch/ical.js/blob/v2.2.1/lib/ical/parse.js), [component_parser.js](https://github.com/kewisch/ical.js/blob/v2.2.1/lib/ical/component_parser.js)
- `RecurIterator.next()` 안에는 조건을 만족할 때까지 반복하는 루프가 있다. **생성/초기화에도** 일치 연도를 찾는 루프가 있으며 UNTIL이 없으면 연도 20000까지 찾을 수 있는 경로가 있다. 외부에서 “128회 또는 4ms마다 yield”해도 한 번의 생성/`next()` 내부 시간은 제한하지 못한다. [recur_iterator.js](https://github.com/kewisch/ical.js/blob/v2.2.1/lib/ical/recur_iterator.js)
- 기본 패키지는 IANA 시간대를 등록하지 않는다. `TimezoneService`는 모듈 singleton registry이며, `Component.getTimeZoneByID()`에는 VCALENDAR 트리별 VTIMEZONE 조회가 있다. [README](https://github.com/kewisch/ical.js/blob/v2.2.1/README.md#timezones), [timezone_service.js](https://github.com/kewisch/ical.js/blob/v2.2.1/lib/ical/timezone_service.js), [component.js](https://github.com/kewisch/ical.js/blob/v2.2.1/lib/ical/component.js)

**권고:** Shell 내부 방식을 검증하려면 전체 파싱뿐 아니라 UTF-8 decode/줄 펼침, 단일 긴 property, component hydration, 반복 iterator 생성·한 번의 `next()`, 시간대 계산, 정렬·JSON 변환 시간을 나누어 측정해야 한다. `await Promise.resolve()`만 반복하지 말고 실제 GLib source로 양보한다. 입력 5 MiB·결과 10,000건·iterator 호출 100,000회라는 기존 총량 상한은 유지하되, 단일 호출 stall 상한은 별도 검증한다.

**권고:** 점진 파서는 줄 펼침과 BEGIN/END 중첩을 보존하고, VTIMEZONE·UID·RECURRENCE-ID 관계를 완성한 뒤 의미 계산을 해야 한다. `BEGIN:VEVENT` 문자열만으로 잘라 파싱하면 충분하다는 근거는 없다. ical.js 내부 private parser를 빌려 분할한다면 고정 버전 fork/adapter 유지 비용과 upstream 변경을 명시한다. 피드별 VTIMEZONE을 전역 registry에 덮어쓰지 않고, IANA 데이터는 고정 배포하며, 기존 [달력 정확성 fixture 범위](calendar-feasibility.md)를 전부 다시 검사한다. 총 입력을 조용히 축소하거나 반복 기능을 빼는 것으로 “동등 구현”을 통과시키지 않는다.

## 설정창과 공유 데이터: 서비스 없이도 경계는 필요하다

**확인:** `prefs.js`는 GNOME Shell 밖의 GTK4/Adwaita 프로세스에서 실행되며 Shell의 JS 객체를 직접 공유할 수 없다. 양쪽은 같은 GSettings schema를 이용하고 변경 신호를 받을 수 있다. 공통 모듈에는 `Gtk`/`Adw` 및 `St`/`Clutter` 같은 프로세스 전용 import를 넣지 않아야 한다. [공식 Preferences 안내](https://gjs.guide/extensions/development/preferences.html), [Gio.Settings](https://docs.gtk.org/gio/class.Settings.html), [공통 모듈 지침](https://gjs.guide/extensions/review-guidelines/best-practices.html)

현재 코드에서 확인한 변경 지점:

| 현재 파일 | 서비스 제거의 영향 |
| --- | --- |
| [extension.ts](../extension/src/extension.ts) | `DataClient(new SessionTransport())` 생성 지점을 로컬 provider session으로 바꿀 수 있다. 위젯/ProviderStore는 재사용 가능하다. |
| [dataClient.ts](../extension/src/shared/dataClient.ts), [dbus.ts](../extension/src/dbus.ts) | Transport seam은 있으나 owner·Subscribe token·재접속은 D-Bus 서비스 수명에 맞춘 계약이다. 로컬 adapter로 호환하거나 공통 provider session 인터페이스로 분리하는 선택이 필요하다. |
| [prefs/calendar.ts](../extension/src/prefs/calendar.ts) | `GetSettings`, secret 저장/삭제, `DataClient`의 실제 달력 동기화 상태에 의존한다. 로컬 설정만 저장하도록 바꾸면 현재 상태 표시 기능이 사라진다. |
| [prefs/weather.ts](../extension/src/prefs/weather.ts), [prefs/placement.ts](../extension/src/prefs/placement.ts) | 검색·지역 저장·네트워크 선택이 bus 이름으로 직접 호출된다. UI가 사용하는 설정/query adapter를 바꿔야 한다. 네트워크 목록은 이미 prefs에서 Gio로 읽지만 현재 열거는 동기다. |

**권고하는 구성:** Shell과 prefs가 UI 없는 동일 데이터 모듈을 import하되 별도 인스턴스를 갖는다. Shell은 카드의 provider 수명과 정기 갱신을 소유한다. prefs는 직접 Soup 지역 검색과 Secret 저장/삭제를 수행하고, 확장이 꺼져 있어도 필요한 연결 검증을 자신의 프로세스에서 수행한다. 설정창에서 보이는 연결 검증 결과와 실행 중 Shell의 동기화 상태를 구별한다. 실행 중 Shell의 상태를 그대로 보존하려면 sourceId·성공 시각·오류를 담은 작은 상태 snapshot을 Shell이 기록하고 prefs가 파일 monitor로 읽는 방식이 가능하다. 이는 **제안**이며 상태 갱신·중복 HTTP·종료 때 동작은 구현 검증 대상이다.

| 데이터 | 서비스 없는 공유 권고 | 반드시 남길 검증 |
| --- | --- | --- |
| 비밀이 아닌 설정 | 기존 GSettings를 확장. 서로 함께 바뀌어야 할 calendar sourceId/활성/삭제대기 상태는 하나의 record로 저장한다. weather location은 하나의 tuple/record로, network interface는 별도 key로 둔다. | JSON 파일 전체를 양쪽에서 read-modify-write하면 변경 유실 가능. 여러 설정창의 충돌 정책을 명시한다. GSettings를 고빈도 telemetry/cache로 쓰지 않는다. |
| 비공개 URL | Secret Service에만 저장. prefs가 새 source UUID의 secret 저장에 성공한 뒤 해당 UUID를 설정에 공개한다. Shell은 정확한 UUID로 무프롬프트 읽기만 한다. | 교체 실패 rollback, 연결 해제의 삭제대기, 두 설정창 동시 작업, 이전 작업의 늦은 응답, 고아 secret 정리. 앱 namespace 전체 삭제는 새 연결과 경쟁할 수 있다. |
| cache/status | 정기 수집 cache의 writer는 Shell 하나로 두고 prefs는 읽기. prefs 단독 연결 검증 결과는 우선 메모리에 둔다. cache에 sourceId·schema/version·성공 시각을 포함한다. | 해제/교체 즉시 이전 source를 읽지 않아야 한다. 삭제와 진행 중 쓰기 경쟁으로 예전 파일이 복구되지 않도록 취소·generation·쓰기 완료 후 재확인/정리를 검증한다. |

**확인:** GSettings는 빠른 설정 읽기/쓰기를 제공하지만 공식 문서는 쓰기를 사용자 동작에 대응해서 수행하도록 권한다. 파일의 비동기 replace, private 생성 flag, ETag 불일치 검출도 제공된다. **추론:** atomic replace는 독자가 반쯤 쓴 파일을 보는 문제를 줄이지만, 두 writer 사이의 비밀 저장→설정 변경→캐시 삭제 전체를 transaction으로 만들지는 않는다. 파일 방식을 유지하면 충돌 감지·재시도와 작업 직렬화를 별도로 설계해야 한다. [Gio.Settings](https://docs.gtk.org/gio/class.Settings.html), [File.replace](https://docs.gtk.org/gio/method.File.replace.html), [replace_contents_async](https://docs.gtk.org/gio/method.File.replace_contents_async.html)

## 심사와 최종 판단

**확인:** 심사 규정은 TypeScript를 읽기 좋은 JavaScript로 변환하도록 하고 minify/obfuscation을 금지한다. 추가 스크립트/바이너리 실행은 강하게 비권장하며, 허용이 필요한 경우에도 binary 동봉 금지·정상 종료 등 조건이 있다. 초기화에서 활동하지 않고 `enable()`에서 시작한 signal/source/object를 `disable()`에서 정리해야 한다. Shell 내부 방식도 이 수명 규칙의 예외가 아니다. [공식 심사 규정](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)

**권고:** 추가 프로세스를 없애는 것은 배포/종료 관리 부담을 줄인다. 다만 공식 best practices는 무거운 작업을 별도 앱으로 옮기라고도 안내한다. 따라서 “전부 Shell 안에 넣으면 심사 통과”도, “GJS 작업 프로세스면 심사 통과”도 결론낼 수 없다. Shell 내부의 달력 단일 호출이 허용 프레임 예산을 넘으면 점진 파서/반복 엔진 수정 또는 다른 경계가 필요하다. 측정 전에는 전체 기능 유지가 **가능성 있는 설계**라는 수준이며, 현재 외부 worker 우선안을 확정할 근거도 API 부족에서는 찾지 못했다. [공식 best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)

후속 판정에 필요한 증거는 합성 fixture 정확성, 최악 입력의 단일 JS 호출과 실제 Shell 프레임 측정, 대상 배포판의 Secret GI/provider, enable/disable 중 요청·source 정리, 설정창 단독 실행 및 동시 변경·삭제 경쟁 검증이다. 이 조사는 설계/계획 파일이나 실행 중 확장을 변경하지 않았다.

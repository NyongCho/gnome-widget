# TS/GJS를 Shell 내부에서 실행할 수 있는가 — 실측 결과

2026-11-06. 기준 소스 `8b3b81f`. **판정: 현재 ical.js와 간단한 분할 처리 조합은 기존 기능·응답성 요구를 충족하지 못한다.** Shell 내부 방식 자체가 불가능하다는 뜻은 아니다. 날짜/반복 의미 보정과 단일 호출 내부까지 중단 가능한 계산 구조가 선행되어야 한다. 공개용 전체 이식을 바로 시작할 근거로 사용하지 않는다.

## 무엇을 실제로 실행했는가

- 현재 Rust 캘린더 회귀 검사 **30/30 통과**를 먼저 확인했다.
- `ical.js@2.2.1`을 GJS 1.88.0에서 실행했다. 기존 ICS fixture와 선택한 Rust 회귀 입력에서 만든 합성 사례 34개를 동일 Rust 엔진 출력과 비교했다.
- 라이브러리의 일괄 파싱/반복 처리와, 파싱을 약 2ms씩 나누고 반복을 최대 128회씩 양보하는 실험 코드를 비교했다. 파서는 public `ICAL.parse.property`를 사용한다.
- **GNOME Shell 50.1의 실제 프로세스 안**에 동일 실험 코드를 import했다. private D-Bus·임시 XDG·중첩 Wayland 세션에 기존 위젯 7개와 합성 상태를 표시하고 사용자 정의 데이터 서비스 없이 실행했다. 실제 사용자 데스크톱 Shell·iCal 주소·키링 항목은 사용하지 않았다.
- GLib 5ms heartbeat 지연과 Clutter 애니메이션의 프레임 콜백 간격을 각 입력/방식별 **5회** 측정했다. 일괄/분할 순서를 번갈아 실행했고 다른 성능 실험과 동시에 돌리지 않았다.

측정 환경: Ubuntu 26.04, Intel Core i7-12700F (20 logical CPUs), GNOME 50.1, GJS 1.88.0, libical 3.0.20, tzdata 2026e. libical은 테스트 참조값과 세 개의 시간대 fixture를 만들 때만 사용한다. 공개용 런타임에서 libical을 쓰는 설계가 아니다.

## 응답성 결과

다음 수치는 중첩 GNOME Shell에서 측정한 **5회 중 가장 긴 프레임 콜백 간격**이다. 계산 전체 소요 시간이나 GPU paint 시간과 구분한다.

| 입력 | 일괄 처리 | 분할 처리 | 판단 |
| --- | ---: | ---: | --- |
| 일정 1,000개 파싱+확장 | 31.98ms | 32.56ms | 이번 검사에서 50ms 초과 없음 |
| 약 4.94MB ICS 파싱만 | 30.26ms | 12.20ms | 점진 파싱의 효과 확인 |
| 과거 반복 100,000회 순회 | 237.35ms | 15.58ms | 반복 호출 사이의 양보가 효과적 |
| 일정 10,000개 파싱+확장 | 152.72ms | 62.89ms | 분할안도 5회 중 4회 50ms 초과 |
| 드문 반복의 `next()` 한 번 | 701.77ms | 695.42ms | 분할안도 5회 모두 50ms 초과 |

유휴 대조군의 최대 프레임 간격은 18.21ms였고 50ms 초과는 없었다. 분할 처리에서 일정 1,000개의 총 계산 시간 중앙값은 19.75ms, 10,000개는 177.21ms였다. 총 시간은 늘어도 이벤트 루프에 제어권을 돌려주면 화면 반응을 개선할 수 있다. 단, 아직 분할하지 않은 component hydration/검증 등의 단계와 GC는 남는다. 10,000건의 지연을 라이브러리 전체의 불가피한 한계로 단정하지 않는다.

반면 단일 `next()`의 지연은 바깥쪽 yield만으로 해결되지 않는다. 사용한 조건은 다음과 같다.

```text
DTSTART:20240229T000000Z
RRULE:FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=0;BYMINUTE=0;BYSECOND=0;UNTIL=20261231T235959Z
```

DTSTART는 반복 조건을 만족하는 윤년 날짜다. 이 경우 next 계산이 다음 윤년 조건을 찾은 뒤 UNTIL을 확인하는 경로를 탄다. 조회 종료 시각을 UNTIL로 넣어도 긴 호출이 남았다. 별도 GJS 프로세스의 진단에서는 UNTIL 없는 같은 반복 조건의 후속 호출들이 약 **675–687ms**였다.

추가로 존재하지 않는 날짜 조건에 대한 견고성 시험에서 `FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30`은 두 번째 호출이 **4초 안에 반환하지 않아 외부 테스트 runner가 종료**했다. 이는 무한 루프를 증명한 것이 아니라 4초 시간 제한을 초과한 관찰이다. 이 입력은 실제/중첩 Shell에서 실행하지 않았다. 연 단위의 비슷한 조건은 2월 30일을 3월 날짜로 반환했다. 이런 입력을 지원 범위 밖으로 판단하더라도 Shell을 오래 막지 않고 거부할 수 있어야 한다.

소스에서도 `RecurIterator.next()` 내부의 검색 루프가 동기이고 UNTIL 판정이 루프 뒤에 있음을 확인할 수 있다. 타이머로 취소를 예약해도 같은 JS 호출이 반환하지 않는 동안 실행할 수 없다. [ical.js 2.2.1 반복 엔진](https://github.com/kewisch/ical.js/blob/v2.2.1/lib/ical/recur_iterator.js), [GJS 이벤트 루프 설명](https://gjs.guide/guides/gjs/asynchronous-programming.html)

## 일정 의미 비교

기본 adapter를 붙인 후보는 **34개 중 26개**가 참조와 일치했다. 이는 전체 캘린더 지원이 76%라는 뜻이 아니다. 선택한 입력 집합의 결과이며, 오류 사례는 정확한 errorCode 대신 거부 여부만 비교했다. 시각은 UTC로 정규화하고 UID·occurrenceKey·제목·종일 날짜·종료를 비교했다.

| 불일치 사례 | 관찰 |
| --- | --- |
| `cancelled` | DTSTART 없는 취소 예외에서 오류. 취소 예외 전처리 필요 |
| `rdate` | 기본 DTSTART 회차가 결과에서 빠짐 |
| `deduplicate` | RRULE/RDATE의 중복 회차가 남음 |
| `invalid-date` | 11월 31일을 12월 1일로 보정. 기존은 오류 |
| `recurring-gap` | DST로 존재하지 않는 반복 시각을 건너뛰고 COUNT를 유지하는 동작과 다름 |
| `gap-start` | 명시적인 gap DTSTART의 전환 이전 offset 해석과 다름 |
| `ambiguous-first` | DST fold에서 첫 시각 대신 뒤의 시각 선택 |
| `custom-fold` | STANDARD→STANDARD offset 변경에서도 첫 발생 선택과 다름 |

일반 주간 반복·옮긴 일정·종일·floating·기본 종료·통상 DST 전환·DURATION 등의 선택 사례는 일치했다. 기본 adapter에는 기존 미지원 항목 거부, floating zone 지정, 시간대 등록만 포함하며 별도의 DST 정확성 보정은 아직 없다. 이 불일치는 프로세스를 분리해도 해결되지 않으므로 TS backend의 실행 위치와 별도로 수정해야 한다.

점진 parser와 원본 parser의 jCal 트리는 파싱 가능한 **33개 입력에서 동일**했다. 나머지 1개는 잘못된 반복 규칙으로 원본 parser가 오류를 반환했다. 이 검사는 점진 parser의 RFC 전체 준수나 악성 입력 안전성을 증명하지 않는다.

## 다른 기능과 설정창

실제 중첩 Shell에서 **Soup 3·Secret 1·Gio import와 `/proc/stat` 비동기 읽기**가 성공했다. 따라서 날씨·시스템·네트워크가 반드시 별도 서비스 프로세스를 요구하는 API 제약은 발견하지 못했다. 시계·레이아웃·GLSL은 현재도 Shell 내부에서 실행된다.

이 검증에서는 실제 날씨 API, HTTPS 이미지, MPRIS 가상 player, 키링 잠금/저장/삭제를 모두 이식해 실행하지 않았다. API 사용 근거와 이전 코드의 변경 지점은 [별도 조사](typescript-shell-research.md)에 기록했다. API 존재와 전체 제공자 기능 검증을 구분한다.

설정창은 GNOME의 정상 구조에서도 별도 GTK 프로세스다. 이번 목표는 **사용자가 추가 설치/실행해야 하는 전용 데이터 프로세스를 없애는 것**이지 GNOME의 설정창 프로세스를 없애는 것이 아니다. 현재 설정창의 D-Bus 서비스 의존을 제거할 경우, 비밀이 아닌 설정·Secret·캐시·실제 동기화 상태를 양쪽에 공유하는 경계가 필요하다. 특히 동시에 열린 설정창, URL 교체와 삭제 경쟁, 비활성 확장에서 연결 확인은 아직 구현 검증 전이다.

## 실측 직후의 권고

1. 공개용 전체 포팅에 앞서, **단일 호출 내부에서도 연산 예산·취소·양보가 가능한 일정 엔진**을 검증한다. ical.js 반복 코드를 유지 가능한 형태로 수정하거나 다른 엔진을 비교할 수 있다. `async` wrapper 또는 호출 사이 timeout 추가만으로 완료 처리하지 않는다.
2. 기존 Rust의 전체 의미 검사를 이전하고 위 8개 차이를 해결한다. 반복 종류·최대 입력 크기·시간대 기능을 조용히 축소해서 합격시키지 않는다.
3. 파싱→hydrate/검증→반복→정렬/직렬화→UI 갱신을 모두 포함해 성능·취소·수명을 다시 측정한다. 현재 시험은 parse+expansion까지이며, 데이터 계약의 512 KiB payload 제한을 포함한 전체 provider는 아니다.
4. 이 선행 검증을 통과하면 Shell 내부 backend와 prefs 공유 설계로 계획을 다시 작성한다. 통과 전에는 내부 실행 가능 또는 외부 프로세스 필수라고 확정하지 않는다.

이 실측 직후에는 기존 전체 GJS 서비스 설계와 12-task 계획을 보류했다. 이후 사용자는 **가벼운 제공자는 Shell 내부, 달력 계산만 일회성 GJS 작업 프로세스** 구조를 선택했다. 현재 [설계](superpowers/specs/2026-11-06-typescript-edition-design.md)와 [13-task 계획](superpowers/plans/2026-11-06-typescript-edition.md)이 이를 반영한다. 단일 호출의 화면 양보 요구는 작업 프로세스 분리로 해결하고, 일정 의미 보정·내부 시간 제한·실제 종료 검증은 선행 조건으로 유지한다. 위 측정값은 그대로 보존하며 개인용 Rust 구현·설치·설정은 변경하지 않았다.

## 재현과 자료

```sh
./scripts/dev cargo test --locked --manifest-path daemon/Cargo.toml --test calendar
python3 tests/spikes/gjs-in-process/run.py --shell
```

- [실험 코드와 실행 설명](../tests/spikes/gjs-in-process/README.md)
- [실제 Shell raw 측정](../outputs/verification/gjs-in-process/shell.json)
- [독립 GJS 비교·parser·성능 결과](../outputs/verification/gjs-in-process/standalone.json)
- [단일 호출·시간 초과 결과](../outputs/verification/gjs-in-process/single-call.json)
- [환경과 증거 설명](../outputs/verification/gjs-in-process/README.md)

이 결과는 전체 TS 구현, 장시간 메모리 안정성, 전체 backend 간 성능 비교 또는 GNOME Extensions 승인 검증을 완료했다는 의미가 아니다. **현재 후보의 불합격 원인 두 가지(정확성·긴 동기 호출)를 재현한 적합성 검증**이다.

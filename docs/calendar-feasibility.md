# 캘린더 엔진 적합성 검증 — Task 0

2026-11-03. 선택: **Rust 처리 계층 + libical 3.0.20**, 작은 C FFI 어댑터. 외부 프로세스나 계정 연결 없이 fixture로 검증했다. 네트워크 조회·키링·D-Bus 서비스는 이후 task다.

## 후보 비교

| 후보 | 실행 결과 | 판단 |
| --- | --- | --- |
| `ical` 0.11.0 | custom VTIMEZONE과 VEVENT 구문 분석 성공 | 구문 파서이며 반복 확장·시간대 평가 엔진은 별도로 필요 |
| `rrule` 0.14.0 | IANA TZID + 주간 COUNT + EXDATE 성공, `Custom/Office` TZID 파싱 실패 | 타입이 chrono-tz/Local 기반이므로 임의 VTIMEZONE까지 단독 처리할 수 없음 |
| `libical` 3.0.20 + 어댑터 | 반복 변경·취소·RDATE/EXDATE·종일·DST·floating·custom VTIMEZONE 검증 통과 | native 의존성을 허용하고 채택 |

비교 실행: `./scripts/dev cargo run --locked --manifest-path tests/calendar-candidates/Cargo.toml`. Rust 서비스는 유지하며 C 코드는 libical의 구조체와 포인터 수명을 감추는 경계로 한정했다. 모든 libical 호출은 프로세스 안의 공통 mutex로 직렬화한다. root가 timezone·event를 소유하며 iterator가 그 수명보다 오래 살 수 없다.

근거: [rrule Tz 공식 타입 문서](https://docs.rs/rrule/0.14.0/rrule/enum.Tz.html), [ical 공식 문서](https://docs.rs/ical/0.11.0/ical/), [libical 3.0.20 반복 엔진 소스](https://github.com/libical/libical/blob/v3.0.20/src/libical/icalrecur.c), 설치된 libical 3.0.20 헤더. GOA/EDS는 시스템 계정 통합에 적합하지만 서비스·계정 의존성을 늘린다. 이번 읽기 전용 private iCal 범위에서는 필요하지 않았다.

## 검증한 동작

- 주간 RRULE COUNT=3에서 가운데 EXDATE 제거 → 정확히 2건.
- RECURRENCE-ID로 옮긴 일정은 원래 회차를 대체한다. occurrenceKey는 원래 회차의 UTC 시각 또는 종일 날짜로 유지한다. 취소된 master·회차는 제거한다.
- RDATE 추가, 중복 제거, 복수 EXDATE. 변경된 회차는 원래 날짜가 조회 범위 밖이어도 별도로 조회한다.
- 종일 start/end는 날짜 문자열, end는 exclusive. 기본 종료는 종일 다음 날·시각 일정 시작 시각이다.
- IANA TZID, 임의 VTIMEZONE, floating time의 사용자 시간대 적용. 미지원 TZID는 오류이며 임의 로컬 시간대로 대체하지 않는다.
- DST 전후 같은 지역 시각 유지. DURATION의 하루는 달력상 하루, 시간 단위는 실제 경과 시간이다. DTEND로 정한 시각 일정은 원본의 실제 지속 시간을 유지한다.
- DST gap의 존재하지 않는 반복 시각은 건너뛰고 COUNT에 포함하지 않는다. 명시적 DTSTART가 gap에 있으면 전환 이전 offset으로 해석하고 첫 회차로 한 번 센다. DST 및 STANDARD→STANDARD fold의 모호한 시각은 첫 발생을 선택한다. 자정 gap에서도 DATE 필드를 보존한다. UTC UNTIL은 포함 경계다.
- 조회 범위는 지정 월의 주 단위 그리드와 주입된 now 이후 30×24시간의 합집합이다. 이전에 시작해 범위와 겹치는 일정도 포함하고, 무관한 과거·미래 일정은 제외한다.

직접 사용한 libical의 zoned recurrence iterator는 2026-03-08 New York 02:30을 03:30으로 보정하고 이후 회차에도 영향을 주었다. 따라서 어댑터는 **지역 시각의 반복 날짜 생성 → 각 회차 시간대 변환 → gap/fold 검증**으로 나누고 COUNT/UNTIL을 보존한다. DST 여부 두 값만으로 offset을 선택하지 않고 timezone의 TZOFFSETFROM/TO 후보를 실제 변환 결과와 대조한다. 이 차이들은 회귀 테스트로 남겼다. 라이브러리 이름만으로 RFC 정확성을 가정하지 않는다.

## 제한과 오류 정책

원본 입력은 최대 5 MiB, 확장 후보/결과는 최대 10,000건, 외부 recurrence iterator 호출은 전체 입력당 최대 100,000회다. native iterator에도 조회 종료 시각을 전달한다. 초과 시 `InputLimit` 또는 `ExpansionLimit`이며, 일부 일정만 성공처럼 반환하지 않는다. 과도하게 오래된 고빈도 반복은 정상 데이터라도 예산 초과 오류가 날 수 있다.

이 제한은 **native 호출 내부의 CPU 시간이나 파서 메모리를 강제 종료하는 장치가 아니다**. Task 2에서는 async executor와 분리된 제한 worker에 연결해야 한다. 하드 실행 시간 제한이 필요하면 종료 가능한 별도 프로세스 경계가 필요하다. 이번 단계에서 timeout·메모리 격리까지 완료했다고 간주하지 않는다.

초기 미지원 항목은 `RANGE=THISANDFUTURE`, EXRULE, PERIOD 형식 RDATE, 중복 UID master 또는 중복 RECURRENCE-ID의 SEQUENCE 병합이다. 이런 입력은 `UnsupportedCalendar` 오류로 처리한다. Task 4의 실제 provider는 마지막 성공 데이터를 유지하고 오류를 표시해야 한다. 서버 쪽 Google 내보내기 형식과 실제 사용자 계정 연결은 아직 확인하지 않았다.

다음 단계 진행 판단: fixture 기준으로 private iCal 방식을 계속 구현할 수 있다. 실제 계정 연결 후에는 동일 검증 경로를 거쳐야 하며, 위 미지원 항목을 만나면 조용히 잘못 표시하지 않고 지원 범위를 확장한다.

# 데이터 계약 v1

`snapshot.schema.json`이 provider 데이터의 원본 계약이다. `settings.schema.json`은 이 정의를 참조한다. Rust는 embedded schema를 검증하고 serde DTO로 변환한다. TypeScript는 Ajv standalone 검증기를 미리 생성해 GJS용 ESM에 포함한다. 두 언어의 테스트는 `tests/fixtures/protocol`의 같은 성공·실패 예시를 읽는다.

- 모든 JSON 키는 camelCase. 알 수 없는 키·schemaVersion·상태·잘못된 날짜·범위를 거부한다.
- snapshot과 provider 변경 payload는 각각 UTF-8 512 KiB 이하. 검증 오류에는 입력 원문을 포함하지 않는다.
- `ProviderChanged(provider, revision, payload)`의 payload는 해당 provider의 상태 객체다. u32 revision은 owner별로 병합하고 owner 변경 시 초기화한다.
- `ok/stale`에는 data와 마지막 성공 updatedAt이 필요하다. `stale/unavailable`에는 정해진 errorCode가 필요하다. `unconfigured/unavailable`의 data/updatedAt은 null이다. null 측정값은 0과 다르다.
- sourceId는 URL이 아닌 opaque 식별자다. 서비스가 무작위로 발급하고 출처 변경 때 작업 세대를 갱신한다.
- 종일 이벤트만 날짜 문자열을 쓰고 종료일을 포함하지 않는다. 나머지 시각에는 offset이 필요하다. 값의 구조 검증과 실제 달력 시간대 해석은 별개이며 후자는 캘린더 엔진이 담당한다.
- 정수 메모리 값은 JavaScript의 안전한 정수 범위 이내다. revision은 u32 범위다.
- 설정 조회에는 비공개 캘린더 URL이 없다. `SetCalendarSecret` 입력만 URL을 전달하며 키링 연동과 연결 해제 처리는 Task 4에서 구현했다. 같은 사용자 D-Bus는 비밀 격리 경계가 아니다.

`org.local.LiquidWidgets1.xml`은 세션 D-Bus 인터페이스다. Rust 서비스가 구현하며, GIO 구문 검사와 실제 격리 bus 호출을 검증했다. 사용자 세션 설치는 아직 수행하지 않았다.

참조: [Ajv standalone 생성](https://ajv.js.org/standalone.html), [Rust jsonschema 형식 검증](https://docs.rs/jsonschema/0.60.2/jsonschema/). 자동 생성 파일을 수정하지 말고 schema·양쪽 DTO·공유 fixture를 함께 변경한다.

## Task 2 런타임

Rust zbus 서비스와 GJS 비동기 클라이언트를 구현했다. GetSnapshot/ProviderChanged는 기존 schema를 그대로 쓰며, 서비스 인스턴스가 바뀌면 provider revision을 초기화한다. 구독은 sender+token에 귀속된다. 설정 메서드의 현재 지원 범위, 캐시·취소와 설치 소유권은 [데이터 서비스](../docs/data-service.md)에 있다.

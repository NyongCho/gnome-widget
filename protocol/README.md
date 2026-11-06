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

## 공개용 calendar worker v1

`calendar-worker.schema.json`은 기존 Rust D-Bus와 별개의 단일 작업 계약이다. 모든 frame은 big-endian u32 UTF-8 byte 길이와 JSON 본문을 사용한다. child는 private session bus 연결에서 `io.github.NyongCho.LiquidWidgets.CalendarJob`을 DO_NOT_QUEUE로 얻고 ready를 보내며, 실패하면 busy만 보내고 종료한다. ready/busy와 입력 header는 각각 16 KiB, 최종 reply는 512 KiB 제한이다.

ready 이후 부모는 header frame, u32 길이+raw ICS bytes(5 MiB 이하), EOF를 순서대로 쓴다. URL·비밀은 프로토콜에 없다. child는 한 reply와 EOF를 남기고 종료한다. 부모는 version, job/source/generation/context, schema, EOF와 exit 0을 모두 확인한 뒤에만 반영한다. 취소된 결과는 반영하지 않는다.

내부 계산·입력 대기 기한은 시작 후 9초, 부모 watchdog은 spawn 후 10초다. 부모는 취소 즉시 kill을 요청하고 취소하지 않은 wait_async로 실제 종료를 확인한다. 세션 slot 대기는 30초 이내이며, 부모는 name 소멸을 관찰할 뿐 계산 lease를 소유하지 않는다. `scripts/test-public-backend.py --suite worker`가 private bus에서 경계·경쟁·강제 종료를 검사한다.

공개용 `data-config.schema.json`은 별도 private `settings.json`의 계약이다. calendar/weather source UUID와 revision UUID를 저장하며 비공개 URL은 포함하지 않는다. 변경은 전용 ConfigLock 연결 아래 직렬화하고, 캐시 최종 쓰기도 같은 락 안에서 현재 source를 확인해야 한다. `extension/src/data/contracts.ts`는 GI 없이 공통 I/O 계약을 정의한다.

Secret.Service는 달력 기능에서만 지연 로드한다. 검색은 LOAD_SECRETS/ALL만 사용하고 UNLOCK을 제외한다. libsecret의 [Item.delete](https://gnome.pages.gitlab.gnome.org/libsecret/method.Item.delete.html)는 프롬프트를 실행할 수 있으므로, 생성/삭제는 암호화된 Secret session을 유지하면서 raw D-Bus CreateItem/Delete 결과의 prompt 경로를 검사하고 실행하지 않는다. 전체 작업 기한은 초기화부터 8초다. 삭제는 조회한 item path 스냅샷에만 적용해 늦은 작업이 미래의 source를 삭제하지 않는다.

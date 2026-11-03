# 검증 기록

## Task 0 — 2026-11-03

대상: Ubuntu 26.04.1 x86_64, Rust 1.99.1, Node 24.22.2, GJS 1.88.0, libical 3.0.20.

전체 명령: `./scripts/check.sh`

- Rust calendar integration: 27개 통과.
- Rust protocol integration: 6개 통과.
- TypeScript protocol: 19개 통과.
- Cargo fmt, Clippy(`-D warnings`), TypeScript production/test 타입 검사 통과.
- 후보 라이브러리 probe 실행: `ical` 구문 파싱, `rrule` 기본 반복 성공·custom TZID 미지원 확인.
- GJS에서 생성된 ESM 검증기를 실행하고 한글·provider payload·설정·오류 처리를 확인했다.
- GIO D-Bus 파서로 실제 introspection XML을 읽었다.

첫 주간 EXDATE 테스트는 빈 구현에서 assertion 실패를 확인한 뒤 구현했다. 이후 날짜 변경·취소·종일·범위·밀집 반복·공통 계약 테스트를 실패시킨 뒤 구현했다. DST gap/fold와 JSON 정수의 `1.0` 표기는 추가 회귀 테스트에서 실패를 재현하고 수정했다.

## 아직 검증하지 않은 것

- 실제 GNOME Shell actor, 배경화면 굴절 셰이더, GPU 성능, 분수 배율, DING 입력 공존.
- 설치/제거, 사용자 systemd 서비스, 살아 있는 D-Bus 호출·owner 변경·재연결.
- Google Calendar 실제 비공개 피드, 키링·네트워크·날씨·시스템 측정.
- native 파서의 하드 CPU/메모리 격리. 지금의 입력·회차·iterator 예산과 별개다.

이 항목들은 각각 Task 1 이후의 인수 조건이며 Task 0 성공으로 대신하지 않는다. 재현 명령과 일정 지원 범위는 [개발 환경](setup.md), [캘린더 적합성 검증](calendar-feasibility.md)에 있다.

## Task 0 코드 리뷰

별도 읽기 전용 리뷰에서 중요한 문제 두 건을 확인하고 수정했다. 자정 gap에서 종일 날짜가 전날로 바뀌는 문제, DST가 아닌 offset 후퇴에서 두 번째 시각을 고르는 문제, 존재하지 않는 DTSTART의 잘못된 시각을 회귀 테스트로 재현했다. 시간대가 선언한 offset 후보를 실제 시간 변환과 대조하고 DATE 필드는 그대로 보존하도록 수정했다. gap 안의 DTSTART를 COUNT에 한 번 포함하도록 하는 별도 테스트도 실패 후 통과했다.

경미한 미해결 항목 한 건: `generatedAt` 등의 날짜와 시각 사이에 공백을 넣은 비표준 입력을 Ajv는 허용하고 Rust는 거부한다. 현재 생산하는 시간은 모두 `T` 구분자를 사용한다. 외부 protocol 입력을 넓히기 전에 공통 fixture에 추가해 두 검증기의 허용 범위를 맞출 필요가 있다.

Task 1+ 기능과 native hard CPU/메모리 격리, sanitizer/fuzz 인증은 이번 리뷰의 완료 범위가 아니다.

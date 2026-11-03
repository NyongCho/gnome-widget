# 실제 GNOME 검증 화면

2026-11-04, GNOME 50.1/NVIDIA RTX 3080의 격리된 가시 Devkit 세션에서 캡처했다. HTML 시안이나 이미지 생성 결과가 아니다. 일정·날씨·음악은 캡처용 fixture를 포함하고, 시스템·네트워크는 실제 로컬 표본이다. 개인 일정/비밀 주소/브라우저 계정은 포함하지 않았다.

- `glass-off/on.png`: 굴절 비교
- `widgets-calendar-fixture.png`: 달력과 일정
- `widgets-live-metrics.png`, `widgets-music.png`: 실제 측정/음악 UI
- `widgets-bright-default.png`, `widgets-bright-more-tint.png`, `widgets-dark-125.png`: 배경·불투명도·분수 배율
- `widgets-fallback.png`: 할당 실패를 주입한 반투명 안내
- `widgets-locked-mode.png`: private Shell의 unlock-dialog 모드, 물리 잠금 인증은 아님

성능 계측 조건과 한계는 [성능 기록](../../docs/performance.md), 나머지 인수는 [검증 기록](../../docs/verification.md)을 참고한다.

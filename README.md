# GNOME Liquid Glass Widgets

Ubuntu GNOME 바탕화면에 macOS Liquid Glass에서 영감을 받은 개인 위젯을 만드는 프로젝트다.

## 현재 상태

GNOME Shell 50용 Rust 서비스·TypeScript 확장·GLSL 굴절을 구현했다. 시계, Google iCal 달력·다음 일정, 날씨, 네트워크, CPU·RAM·온도, MPRIS 음악을 표시한다. 사용자 영역 설치와 서비스 기동까지 완료했다. 로그아웃·로그인 후 개인 캘린더와 날씨 지역을 설정한다.

빌드된 배포본 설치: `./dist/liquid-widgets/install.py`. 새 확장 코드는 로그아웃·로그인 후 적용될 수 있다. [설치·설정·제거 안내](docs/setup.md), [검증 결과와 남은 인수 항목](docs/verification.md)을 참고한다. extensions.gnome.org에는 게시하지 않았다.

개발 검증: `./scripts/check.sh`. 실제 GPU의 격리 GNOME 검사: `./scripts/test-gnome.py`. 아키텍처와 제약은 [데이터 서비스](docs/data-service.md), [캘린더](docs/calendar.md), [날씨](docs/weather.md), [실시간 측정](docs/live-data.md), [굴절 검증](docs/shader-spike.md)에 있다.

## 먼저 읽을 문서

1. [PRD: 제품 요구사항과 완료 기준](outputs/liquid-glass-prd.md) — 승인된 v1.0 기준. 초기 기본값과 후속 시각·연동 확인을 구분한다.
2. [기술 설계](outputs/liquid-glass-design.md)
3. [저장소 조사와 로컬 API 검증 결과](outputs/liquid-glass-repository-review.md)
4. [구현 계획](outputs/liquid-glass-plan.md) — PRD의 기능·품질 요구를 task와 검증에 연결했다.
5. [HTML 디자인 미리보기](outputs/liquid-glass-preview.html) — 배치 참고용이며 GNOME 실행 결과가 아니다.

## 이어받을 핵심 맥락

- Rust 사용자 서비스 + TypeScript로 작성해 GJS에서 실행하는 GNOME 확장 + GLSL 효과를 사용한다.
- 날짜·시계, 월간 달력·다음 일정, 날씨, 네트워크, CPU·RAM·온도, 재생 중 음악을 표시한다.
- Google Calendar는 비공개 iCal 읽기 전용이며, 클릭하면 기본 브라우저에서 Google Calendar를 연다. 비밀 주소와 날씨 지역은 아직 설정하지 않았다.
- 대상 환경은 Ubuntu 26.04.1 / GNOME Shell 50.1 / Wayland다. 새 환경에서 작업하면 버전을 다시 확인한다.
- 단일 굴절 카드와 DING 아이콘의 클릭 공존을 검증했다. 배경화면만 처리하며 글자는 별도 레이어에 표시한다.
- 로컬에 없는 ShaderEffect API를 사용하지 않는다. Cogl API 존재 확인을 실제 렌더링 성공으로 간주하지 않는다.
- ICS 반복 일정·취소·시간대 처리는 libical 기반 엔진과 적합성 테스트를 사용한다.
- 검증은 실제 개인 계정 없이 실행한다. 개인 계정·물리 세션 전환의 최종 확인은 사용자 단계다.

## Codex CLI에서 대화 이어가기

현재 대화 ID: `01a1a040-e613-7390-961e-298fc097bd2e`

터미널에서:

```bash
codex resume 01a1a040-e613-7390-961e-298fc097bd2e -C /home/nyong/projet/gnome-widget
```

2026-11-03에 Codex의 thread/settings/update 기능으로 이 대화의 이후 작업 경로를 `/home/nyong/projet/gnome-widget`으로 변경했고, 저장된 세션 정보에서도 확인했다.

현재 폴더의 resume 목록에서 찾지 못하면 터미널의 `codex resume --all` 또는 위의 정확한 ID를 사용한다. 셸에서 현재 경로를 확인하는 명령은 `pwd`다. `/pwd`나 `/cd`를 셸 명령으로 실행하지 않는다.

대화 기록은 사용자 Codex 저장소에서 관리되고 프로젝트 파일은 이 폴더에 있다. 이전 outputs와 미리보기 원본은 백업으로 남겨 두었다. 이후 문서 수정은 이 프로젝트의 outputs를 기준으로 한다.

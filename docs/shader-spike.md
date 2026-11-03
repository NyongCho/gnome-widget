# GNOME 50 배경 굴절 검증 — Task 1

2026-11-03, Ubuntu 26.04.1 / GNOME Shell 50.1 / GJS 1.88 / Wayland에서 실행했다. 실제 NVIDIA GPU를 쓰는 별도 Mutter Devkit 창 안에 GNOME 세션을 띄워 확인했다. HTML 미리보기나 headless 렌더링 결과가 아니다. 사용자 세션에는 확장을 설치하지 않았다.

## 구현 경로

TypeScript는 `@girs/gnome-shell@50.0.4` 타입으로 검사하고 esbuild로 GJS ESM으로 묶는다. `LiquidWidgetsGlassEffect50` GType을 사용한다. `ShaderEffect.new_with_snippet` 같은 존재하지 않는 API는 사용하지 않는다.

`WallpaperClone`이 독립적인 GNOME BackgroundManager를 만들고, 모니터 좌표에서 카드 좌표를 빼서 배경을 정렬한다. private Background/Main API는 platform adapter에 둔다. 테스트 창의 모니터가 확장보다 늦게 생기는 경우도 `monitors-changed`에서 정렬한다.

`GlassEffect`는 Clutter.Effect의 paint vfunc에서 Cogl.Texture2D → Offscreen → LayerNode/ActorNode로 배경을 저장한다. Pipeline/Snippet이 이 텍스처를 샘플링하고 PipelineNode로 출력한다. GLSL은 둥근 사각형 거리장, 가장자리 UV 이동, 5회 샘플 blur, 얇은 하이라이트를 계산한다. 글자와 버튼은 효과가 붙은 배경 actor의 형제다.

배경 텍스처의 크기는 카드 340×230 + 양쪽 padding 24다. 100%에서 388×278×4 = 431,456 bytes, 125%에서 GNOME resource scale 2에 따라 1,725,824 bytes였다. 이는 **RGBA 색상 버퍼만** 센 값이며 드라이버·깊이 버퍼·배경 텍스처까지 포함한 GPU 사용량은 아니다. 전체 화면 크기의 별도 FBO를 카드마다 만들지 않는다. `setGeometry(rect, scale)`의 scale 인자는 공통 인터페이스용이며 실제 할당은 actor의 resource scale을 따른다.

배경 변경·카드 배치·실제 렌더 해상도 변경 때만 입력 캐시를 다시 그린다. 굴절 강도와 버튼 글자 변경은 캐시를 다시 만들지 않는다. 정적인 배경을 대상으로 한 기술 검증이다.

`DesktopLayerAdapter`는 window_group의 실제 자식 목록에서 DING 창을 찾고, 아이콘 창 위·일반 창 아래에 카드를 둔다. DING이 `global.get_window_actors()`에서 자신을 제외하므로 그 함수만으로는 판별하지 않는다. overview에서는 숨기고 돌아오면 표시한다. 컨테이너는 비반응형이고 버튼만 클릭을 받는다.

## 재현

[개발 환경](setup.md)을 준비한 뒤 그래픽 Wayland 세션에서:

```bash
./scripts/check.sh
./scripts/test-gnome.py
```

Python GI/Pillow, `gnome-shell-test-tool`, GNOME 50에 맞는 `mutter-devkit`, DING 및 Blur my Shell이 필요하다. 테스트는 설치된 `~/.local/share/gnome-shell/extensions/blur-my-shell@aunetx`를 임시 환경으로 복사하며, 없으면 호환성 검증을 실패 처리한다. 이번 대상은 BMS v77, 시스템 제공 DING이다.

이 컴퓨터에는 devkit 실행 파일이 빠져 있어 `mutter-dev-bin 50.1-0ubuntu2.5`를 프로젝트 내부에 추출했다. 시스템 패키지 설치 없이 같은 방법으로 준비할 수 있다:

```bash
mkdir -p .tools/downloads .tools/sysroot
(cd .tools/downloads && apt-get download mutter-dev-bin)
for package in .tools/downloads/mutter-dev-bin_*.deb; do
    dpkg-deb -x "$package" .tools/sysroot
done
```

배포판의 설치된 Mutter와 맞는 패키지를 사용해야 한다. runner는 `/usr/libexec/mutter-devkit`이 있으면 Mutter가 띄운 창을 쓰고, 없으면 위 로컬 실행 파일을 띄운다.

runner는 `dbus-run-session`으로 별도 버스를 만든다. GNOME test tool이 만든 임시 XDG 설정에서만 배경·배율·확장 활성화 상태를 변경한다. DING 드래그에는 `.superpowers/sdd/liquid-glass-plan/screenshots/desktop/`의 일회용 파일을 사용한다. 사용자 바탕화면 파일이나 실제 모니터 배율을 바꾸지 않는다. 테스트 창은 완료 후 닫힌다.

## 실행 결과

- 실제 GNOME 카드에서 굴절 강도 0/16을 캡처했다. 버튼을 제외한 가장자리 픽셀 변화, 배경의 동일 위치 샘플, 제목 글자 마스크 일치를 검사했다. 캡처도 직접 확인했다.
- 효과가 없는 임시 구현에서 픽셀 비교가 실패했다. 배경 좌표 오류도 별도 위치 검사로 재현했다. 모니터 생성 후 위치를 다시 계산해 해결했다.
- 실제 가상 포인터로 카드 버튼 클릭을 검증했다. 일반 창을 카드 위에 올리면 해당 창이 입력을 받고, 닫으면 카드가 다시 받는다.
- DING 활성화 시 쌓임 순서 검사가 먼저 실패했다. 실제 window_group 순서를 사용하도록 수정한 후 통과했다. 아이콘 선택과 드래그는 캡처의 출발·도착 위치로 확인했다. DING이 켜진 상태의 일반 창 겹침도 통과했다.
- 100% → 125% → 100%를 테스트 세션의 DisplayConfig로 실제 적용하고 현재 배율을 다시 조회했다. 캡처에서 크기·굴절·글자를 확인했다.
- GSettings의 실제 배경 URI를 바꾼 뒤 캐시 입력 횟수가 증가하고 카드 픽셀도 새 배경의 색으로 바뀌었다. 강도·글자만 바꾸면 증가하지 않았다.
- overview 진입/복귀와 두 번째 workspace에서 카드 클릭이 통과했다.
- Blur my Shell 활성화 성공, 카드 렌더링과 클릭을 확인했다.
- `./scripts/check.sh`: 기존 52개 Rust/TypeScript 테스트, fmt/clippy, GJS smoke, 추가 GNOME 소스 타입 검사·번들 빌드가 통과했다.

캡처와 실행 로그는 git에서 제외한 `.superpowers/sdd/liquid-glass-plan/` 아래에 있다. `screenshots/glass-on.png`, `fractional-125.png`, `icon-dragged.png`, `ding-window-overlap.png`, `blur-my-shell.png`가 주요 증거다. 별도로 표준 GNOME Screenshot portal을 통해 실제 사용자 듀얼 모니터 화면도 캡처·확인했으며 개인 화면은 커밋하지 않는다.

## 이 단계의 한계

한 개의 고정 위치 카드로 렌더링·입력 경로를 증명했다. 최종 위젯 디자인, 달력·날씨·시스템 데이터 연결은 아직 없다. 광학 물리 시뮬레이션이 아니라 배경 텍스처의 화면 공간 UV 변형이다. 다른 앱 창이나 아이콘을 굴절시키지 않는다.

실제 GPU를 사용하는 중첩 GNOME 세션에서의 성공이다. 주 사용자 세션에 설치한 장시간 사용, 다중 모니터 배치·핫플러그, 잠금/절전, 애니메이션 배경, 다양한 DING/BMS 설정, 프레임 시간·CPU/GPU 성능 예산, 20회 enable/disable 검증은 Task 3/7의 별도 인수 조건이다. GNOME private API에 의존하므로 다른 Shell 버전에 대한 호환성을 주장하지 않는다.

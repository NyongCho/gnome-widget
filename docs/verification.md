# 검증 기록

## 시간에 따른 배경 변경이 일부 카드에 남는 문제 — 2026-11-05

같은 XML 주소 안에서 빨간 장면이 초록 장면으로 바뀌는 실제 GNOME slideshow를 만들었다. `--dynamic-wallpaper`의 첫 실행에서 바탕화면은 초록색이 됐지만 일곱 카드 모두 빨간색을 유지했고 input/blur paint 횟수가 멈췄다. 시계 한 장으로 줄여도 재현됐다. [수정 전 화면](../outputs/verification/dynamic-wallpaper/before.png)과 [측정](../outputs/verification/dynamic-wallpaper/before.json)을 저장했다. 테스트는 개인 데이터 없이 별도 D-Bus/XDG 세션에서 실행하고 픽셀 측정을 위해 글자만 숨긴다.

유리 효과가 자체 dirty 플래그만 확인하면서 Clutter의 `ACTOR_DIRTY`를 무시한 것이 원인이었다. [GNOME Shell의 timed wallpaper](https://github.com/GNOME/gnome-shell/blob/50.1/js/ui/background.js#L363-L379)는 기존 배경의 파일/혼합 비율을 갱신한다. URI·geometry·BackgroundManager 교체 알림에만 의존하면 이런 내용 갱신을 놓친다. [Mutter의 effect 캐시 계약](https://github.com/GNOME/mutter/blob/50.1/clutter/clutter/clutter-effect.c#L326-L364)에 맞춰 `ACTOR_DIRTY` 때도 배경 입력과 두 blur pass를 다시 그리도록 수정했다. 강도·농도의 effect-only repaint는 캐시를 재사용하며 새 타이머나 신호 연결을 추가하지 않았다.

수정 후 일곱 카드가 모든 관측 crossfade 단계와 최종 장면을 따라오고, 숨긴 동안 장면이 바뀌어도 다시 표시하면 현재 배경을 그린다. 색상 비교 외에도 각 표면이 표시 중이고 fallback 없이 GPU texture를 소유하며 실제 input/blur paint 횟수가 증가하는지 검사한다. 정지한 장면에서는 굴절 강도와 시계 foreground 변경이 캐시를 다시 만들지 않는 것도 확인했다. [수정 후 화면](../outputs/verification/dynamic-wallpaper/after.png), [숨김 후 복귀](../outputs/verification/dynamic-wallpaper/remapped.png), [측정](../outputs/verification/dynamic-wallpaper/after.json).

`./scripts/check.sh`(TypeScript 68개 및 Rust/GJS/IPC/설치 검사), `--visual`(밝기·테마·굴절·125% 및 정적 캐시), `--clock-styles`(초침과 배경 캐시 분리·타이머 정리)이 통과했다. 별도 리뷰에서 제품 코드 문제는 없었고 테스트에 표면 표시 여부·실제 GPU 갱신 검사를 보강했다. 캐시 검사 초기의 실패는 테스트가 주 시작 요일을 바꿔 달력 높이를 20px 늘린 데 따른 정당한 재생성이었으며, 처음부터 동일한 날짜/시간대/주 시작일을 쓰도록 검사를 수정했다.

최종 `--dynamic-wallpaper`도 28개 전환 관측과 숨김 후 복귀까지 통과했다. 배포물을 설치하고 확장 8개 파일·daemon 일치, 모든 기존 위젯 설정 보존, 서비스 active/enabled를 [확인했다](../outputs/verification/dynamic-wallpaper/installation.json). 사용자 세션은 재시작하지 않았으며 다음 로그아웃/로그인에 새 코드가 적용된다. 이 검증은 가속한 XML 전환과 실제 GPU 출력에 대한 검사이며 장시간 사용자 세션의 성능 측정은 아니다.

## 설정 변경 시 시계 날짜 위치 흔들림 — 2026-11-04

`./scripts/test-gnome.py --clock-footer`에서 시계 스타일·굴절 강도·유리 농도를 바꾸면 카드 높이는 230px로 고정인데 날짜 y가 194↔184px로 번갈아 이동하는 현상을 재현했다. 날짜 좌표를 갱신하는 시점의 `actor.height`가 배정된 높이 194와 재배치 중 preferred height 184를 번갈아 반환했다. 최종 배정 높이가 그대로이면 height 알림만으로 날짜 위치를 다시 바로잡을 수 없었다.

수동 y 계산을 제거하고 시계판은 위, 날짜는 아래로 native BinLayout이 배정하도록 바꿨다. [Mutter 50.1의 BinLayout 구현](https://github.com/GNOME/mutter/blob/50.1/clutter/clutter/clutter-bin-layout.c#L195-L227)에 따라 각 자식의 expand 플래그도 명시해 START/END 정렬이 적용되게 했다. 회귀 검사는 같은 카드 안에서 날짜 위치가 변하지 않는지와 footer가 실제 배정된 하단에 있는지를 함께 확인한다. [수정 전 측정](../outputs/verification/clock-footer/before.json), [수정 후 측정](../outputs/verification/clock-footer/after.json), [실제 캡처](../outputs/verification/clock-footer/after.png).

수정 후 같은 설정 변경 31개 관측에서 날짜 y=194px, 카드 하단 여백=18px로 유지됐다. `--clock-styles`에도 날짜 하단 정렬 검사를 추가하여 네 스타일 × 한국어/영어 × .75–1.50 전체 .05 간격, 좁은 화면, 125% 배율 및 기존 timer/fallback 검사가 통과했다. 전체 `check.sh`와 별도 읽기 전용 리뷰도 통과했다.

함께 제보된 굴절은 설정값 0/5/10/20이 효과 객체에 도달하고 실제 출력 픽셀이 바뀌는 것을 격리 GNOME에서 확인했다. 사용 중인 Tahoe 배경을 같은 세션에 불러온 진단에서 0 대비 20은 가장자리 4,624픽셀에 2/255 초과의 채널 차이가 있었지만 가장자리 평균 최대 채널 차이는 1.771/255, 중앙 변화는 0이었다. 20px bevel과 이미 블러된 배경에 한정한 효과라 눈에 띄는 변화가 약하다. 실제 사용자 compositor의 픽셀 측정으로 주장하지 않으며 셰이더나 강도 설정은 변경하지 않았다. [수치와 검사 범위](../outputs/verification/clock-footer/refraction-inspection.json).

최종 `--visual`도 통과했다. 수정본을 패키징·설치하고 확장 8개 파일/daemon 일치, 모든 위젯 설정 보존, 서비스 active/enabled를 [확인했다](../outputs/verification/clock-footer/installation.json). 현재 세션은 재시작하지 않았고 새 코드는 다음 로그아웃/로그인에 적용된다.

## 선택 가능한 시계 스타일 — 2026-11-04

사용자가 고른 큰 디지털을 기본으로 적용하고 사각 눈금·클래식 원형·미니멀 아날로그를 설정 옵션으로 추가했다. `clock-style`에 선택을 저장하며 실제 GTK 키보드 조작으로 네 가지 선택, 즉시 Shell 반영, 언어 변경, 외부 설정 변경, 창 재열기를 검증했다. 디지털 숫자는 고정 폭을 유지하고 날짜·오전/오후는 위젯 언어를 따른다. 시간대와 12/24시간은 기존 시스템 설정 경로를 사용한다.

아날로그 초침은 기존 시계 foreground만 갱신한다. 달력 actor와 유리 blur 캐시는 유지되며 숨김·카드 제거·디지털 전환·저전력·확장 해제 때 timer가 정리된다. 리뷰에서 GLib의 소수 밀리초 절삭에 따른 0ms 반복을 발견해 실패하는 회귀 검사를 추가하고 다음 초까지의 지연을 올림 처리했다. 한국어/영어 × 네 스타일 × UI scale .75–1.50 전체 .05 간격, 좁은 화면, 디스플레이 125%를 검사했다. 본문이 배정 높이로 확장되고 날짜가 아래에 붙도록 하여 폰트 반올림에 따른 날씨와의 높이 차이를 없앴다.

`./scripts/check.sh`(TypeScript 68개 포함), 새 `--clock-styles`, 기존 `--card-order`, `--compact`, 전체 기능, `--visual`이 통과했다. 전체 기능 검사는 이번 최종 구현에서 첫 실행에 20회 재활성화까지 통과했다. 최종 별도 리뷰에서 남은 조치 사항은 없었다. [실제 캡처·검증·설치 결과](../outputs/verification/clock-styles/README.md)를 저장했다. 설치 파일 8개 및 daemon 일치, 기존 설정 보존, 새 기본값 digital, 서비스 active/enabled를 확인했다. 새 Shell 코드는 로그아웃/로그인 후 로드된다.

## 달력 오늘 숫자 중앙 정렬 — 2026-11-04

오늘 숫자가 고정 높이 label의 위쪽에 그려지는 문제를 실제 GNOME에서 재현했다. 최초 ink-center 검사는 중앙 대비 -4px로 실패했다. 강조 배경은 고정 크기 날짜 칸으로 옮기고 숫자는 자연 크기로 가로·세로 중앙에 배치했다. 폰트에 비례한 작은 여백으로 숫자의 시각적 중심을 보정했으며 일정 점은 숫자 아래에 따로 정렬했다.

`--compact`에 Pango 배치와 실제 screenshot 픽셀 검사를 추가했다. 전자는 resource scale을 환산하고, 후자는 배치를 바꾸지 않고 일정 점만 잠시 숨겨 숫자 픽셀 경계를 측정한다. 다크/라이트, 한국어/영어 UI scale 1.5, 디스플레이 125%에서 최종 중심 오차는 가로·세로 모두 1 logical px 이내였다. [전후 캡처와 측정](../outputs/verification/calendar-alignment/README.md)을 저장했다.

전체 `check.sh`, `--compact`, `--visual`이 통과했고 별도 코드 검토에서 조치할 사항은 없었다. 설치 확장 8개 파일 일치, 설정 보존, 서비스 active/enabled를 확인했다. 새 코드 적용에는 로그아웃/로그인이 필요하다.

## 제목 확대와 내용에 맞는 카드 높이 — 2026-11-04

공통 제목을 약 13px에서 15px로 키우고, 카드 높이를 렌더링된 내용의 실제 preferred height로 계산하도록 바꿨다. 빈 status label은 숨기고 body의 수직 확장을 제거했다. 데이터·연결 상태·언어·테마·크기·시계 변경 뒤 높이를 다시 계산하며, 내용이 같은 높이면 유리 입력 캐시를 유지한다. `computeLayout`의 측정 높이는 이미 UI 배율이 적용된 logical screen px다.

새 레이아웃 단위 검사는 고정 높이와 중복 배율 때문에 먼저 실패했고, 실제 GNOME 검사는 빈 status가 공간을 남기는 상태에서 먼저 실패했다. 구현 후 `./scripts/check.sh` (TypeScript 61개 포함), `--compact`, `--visual`, 전체 기능 검사가 최종 exit 0였다. [캡처와 높이 측정](../outputs/verification/compact-cards/README.md)에 정상/오류/복구, 일정 없음, 6주 달력, 일정 3개, 한국어/영어, UI scale 1.5, 좁은 화면, 디스플레이 125% 결과를 저장했다.

기존 캐시 검사는 시간대/주 시작일 변경에도 모든 카드의 고정 geometry를 전제했다. 내용 높이가 달라져 이동·확대된 카드는 캐시를 갱신하고 geometry가 동일한 카드는 유지하는 실제 요구로 수정했다. 전체 기능 검사에서 기존 재활성화 간헐 실패(`cycle=1 roots=0 state=2`)가 한 번 재현됐고, 제품 lifecycle 수정 없이 이어진 전체 재실행은 20회 모두 통과했다. 코드 검토에서 조치할 사항은 없었다.

굴절 강도 0→20은 실제 픽셀 비교에서 가장자리만 변했고 중앙은 유지됐다. 유리 농도 .05/.24는 GPU 배경의 밝기·색에 반영되며 글자 대비를 유지했다. 이 설정은 blur sigma를 바꾸지 않으며 저전력/fallback은 고정 반투명 CSS 배경을 쓴다. 사용자 설정을 보존해 설치했고 확장 8개 파일 일치와 서비스 active/enabled를 확인했다. 새 JS 적용에는 로그아웃/로그인이 필요하다.

## 카드 내부 체크무늬 수정 — 2026-11-04

실제 Tahoe 배경에서 카드 내부의 반복 잔상을 확인했다. 원인은 5개 blur 샘플 위치를 4배 벌려 중간 입력 픽셀을 건너뛰던 방식이었다. 실제 GNOME에서 얇은 배경 선 하나가 여러 줄로 나뉘는 회귀 검사를 먼저 추가했고, 가로/세로 × 100%/125%에서 모두 실패했다. 샘플 간격만 줄이는 실험으로 잔상이 사라짐을 확인한 뒤, 기존 블러 폭을 유지하도록 입력 texel마다 읽는 정규화 Gaussian으로 수정했다. H/V 각 입력 해상도에 맞춰 sigma 6 logical px를 환산한다.

`./scripts/test-gnome.py --blur`의 반복 밝기 상승은 수정 전 30–36에서 수정 후 네 경우 모두 0으로 감소했다. 선이 사라지거나 블러를 끄는 편법이 통과하지 않도록 대비와 퍼짐 폭도 검사한다. 설치된 이전 bundle을 다시 넣어 같은 실패를 재확인했다. [원본 사진 비교와 측정 자료](../outputs/verification/blur-artifact/README.md)는 개인 일정 없이 격리 세션에서 생성했다.

`./scripts/check.sh`와 `--visual`이 통과했다. 두 테마 가독성, 캐시 재사용·해제·배경 갱신, 가장자리 굴절, 125% 배율을 유지했고 별도 코드 검토에서 조치할 사항은 없었다.

최종 `--benchmark` OFF/ON 3쌍에서 paint p95 증가량은 0.600/0.608/0.473ms, ON p95는 1.337/1.390/1.271ms였다. 소유 offscreen texture는 기존과 같은 3,547,512 bytes다. 이 검사는 캐시 생성 후의 일반 화면 갱신 비용이며, 최초 블러 생성 지연이나 장시간 soak 측정은 아니다. [원시 성능 자료](../outputs/verification/blur-artifact/performance.json)를 저장했다.

패키징·사용자 설치를 완료했고 설치된 확장 8개 파일과 Rust 실행 파일이 배포물과 일치했다. 확장 설정이 바뀌지 않았고 서비스 active/enabled를 확인했다. 현재 로그인 세션은 재시작하지 않았으므로 새 JS/셰이더 적용은 로그아웃 후 로그인해야 한다.

## Liquid Glass 재질 수정 — 2026-11-04

사용자가 승인한 [연구 방향](liquid-glass-rendering-research.md)을 `2623ee6`에서 적용했다. Rust/data/UI 설정은 유지하고 Cogl 입력 캐시 뒤에 반해상도 H/V blur 두 패스를 추가했다. 평평한 중앙, 곡면 법선에 따른 제한된 굴절, 얇은 방향성 가장자리와 밝기 범위 보정을 합성한다. 정상 모드의 진한 CSS 배경을 제거하고 글자·아이콘은 별도 레이어에 유지한다. 기존 최소 alpha 0.68/0.72를 새 재질의 필수 조건으로 사용하지 않는다.

실제 GNOME 검사의 첫 RED는 `wallpaper has no cached two-pass blur`였다. 구현 후 `./scripts/check.sh`가 통과했고 TypeScript 59개, Python 설치 7개, Rust 전체 검사와 fmt/clippy/typecheck/build/GJS IPC를 확인했다. [실제 캡처와 측정](../outputs/verification/glass-material/README.md)을 저장했다.

`--visual`은 CSS 색을 추정하는 대신 글자만 잠시 숨긴 실제 GPU 배경과 정상 캡처를 비교한다. 검정/흰색 배경에서 light/default, explicit-light, dark와 최소/기본 tint를 검사했으며 최소 대비는 4.7667:1이었다. 컬러 격자·레퍼런스 유사 그라데이션, low-power와 125% 배율도 4.5:1 이상을 확인했다. 이는 검사한 화면의 전경색/배경 대비이며 모든 배경·글꼴·사용자 설정의 접근성 인증은 아니다.

굴절 강도 0→20에서 시계 카드 가장자리 652개 픽셀이 변했고 중앙은 변하지 않았다. strength/tint 설정과 시계 텍스트 갱신은 blur를 재계산하지 않으며, 배경 변경·해제 후 재활성화는 갱신하고 low-power는 모든 target을 해제한다. 기본 CSS와 할당 실패 fallback, DING/Blur my Shell 공존 8회 클릭, 창 겹침과 20회 정리 검사를 실제 Shell에서 통과했다.

최초 기능 검사에서 unlock-dialog 복귀 후 반복 활성화 중 root 수 assertion이 한 번 실패했다. 당시 메시지는 실제 수를 포함하지 않아 중복인지 일시적 부재인지 확정할 수 없다. 실제 수·cycle·state 진단을 추가한 재실행은 20회 모두 통과했으며 제품 생명주기 코드는 변경하지 않았다. 별도 `--lifecycle` 실행은 60회 모두 종료 코드 0, root 1개/카드 6개와 RGBA target 3,547,512 bytes를 유지했다. Shell RSS는 시작/20/40/60회에서 447120/498296/493464/502588 KiB였으며, 전체 Shell RSS를 확장 단독 누수 측정으로 해석하지 않는다.

독립 읽기 전용 코드 리뷰는 `93eb024..2623ee6`에서 Critical/Important/Minor 지적을 보고하지 않았다. 소스 출처 검증은 선행 연구, 런타임·배포 검증은 이 세션의 실행 결과를 근거로 한다.

후속 육안 비교에서 라이트 모드가 지나치게 밝아 보여, 같은 구조에서 배경의 최소 밝기를 낮추고 보조 글자색을 더 짙은 단색으로 조정했다. 이 색상 상수 조정은 위 독립 리뷰 뒤에 이루어졌으며, 최종 시각·회귀 검사로 확인한다.

기존 단일 카드 `--spike` 검사기는 밝기를 바꾼 픽셀을 배경 좌표 오류로 판단했다. 새 재질은 명암을 의도적으로 조절하므로, 원본 배경의 격자를 평균낸 뒤 21개 위치의 선형 RGB 색도 구조를 비교하도록 검사기를 수정했다. 실제 캡처의 평균/최대 오차는 약 0.0060/0.0350이었으며 허용치는 0.015/0.06이다. 같은 캡처에서 기준 좌표를 20px 옮기면 평균 0.0278 이상으로 거부됨을 확인했다. 배경 교체는 절대 밝기 대신 빨강/초록 성분 관계의 반전으로 검사한다. 제품 렌더링을 검사기에 맞춰 되돌리지 않았다.

`2623ee6`의 재질 파이프라인으로 OFF/ON 세 쌍을 측정했다. Shell paint p95 증가량은 0.643/0.850/0.759ms로 기존 2ms 목표 안이었다. ON의 서비스 CPU는 약 0.10–0.15%, 소유 RGBA target은 3.38MiB였다. 이 측정은 위 라이트 팔레트 상수 조정 전이며, GPU 완료를 강제하는 측정이나 모든 하드웨어 성능 보장은 아니다. [원본 성능 JSON](../outputs/verification/glass-material/performance.json).

최종 팔레트에서 `./scripts/check.sh`, `--visual`, `--spike`, 전체 위젯 기능 검사가 모두 exit 0였다. 마지막 전체 기능 검사에서도 잠금 모드 복귀와 20회 재활성화를 통과했고, 앞선 root 수 실패는 재현되지 않았다. 최초 실패의 원인을 확정하거나 제품 수정으로 해결했다고 주장하지 않는다.

`python3 scripts/package.py`와 `python3 scripts/install.py`로 기존 사용자 설치를 갱신했다. 이전 설치 백업은 `~/.local/share/liquid-widgets/backups/20261104T041518Z-375ce9f7`이다. 설치된 확장 파일과 두 셰이더, 서비스 바이너리가 배포 산출물과 일치하고 위젯 GSettings가 설치 전후 동일함을 확인했다. 사용자 서비스는 active/enabled다. 현재 사용자 세션은 재시작하지 않았으므로 새 확장 코드는 다음 로그아웃/로그인 때 로드된다.

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

## Task 0 당시 미검증 항목 (후속 결과는 아래 기록 참고)

- 실제 사용자 세션 장시간 사용과 GPU 성능 예산. 단일 카드 렌더링·분수 배율·DING 입력 공존은 아래 Task 1에서 검증했다.
- 실제 사용자 서비스 설치/제거. 격리된 bus에서의 실제 호출·owner 변경·재연결은 아래 Task 2에서 검증했다.
- Google Calendar 실제 비공개 피드, 키링·네트워크·날씨·시스템 측정.
- native 파서의 하드 CPU/메모리 격리. 지금의 입력·회차·iterator 예산과 별개다.

이 항목들은 각각 Task 1 이후의 인수 조건이며 Task 0 성공으로 대신하지 않는다. 재현 명령과 일정 지원 범위는 [개발 환경](setup.md), [캘린더 적합성 검증](calendar-feasibility.md)에 있다.

## Task 0 코드 리뷰

별도 읽기 전용 리뷰에서 중요한 문제 두 건을 확인하고 수정했다. 자정 gap에서 종일 날짜가 전날로 바뀌는 문제, DST가 아닌 offset 후퇴에서 두 번째 시각을 고르는 문제, 존재하지 않는 DTSTART의 잘못된 시각을 회귀 테스트로 재현했다. 시간대가 선언한 offset 후보를 실제 시간 변환과 대조하고 DATE 필드는 그대로 보존하도록 수정했다. gap 안의 DTSTART를 COUNT에 한 번 포함하도록 하는 별도 테스트도 실패 후 통과했다.

경미한 미해결 항목 한 건: `generatedAt` 등의 날짜와 시각 사이에 공백을 넣은 비표준 입력을 Ajv는 허용하고 Rust는 거부한다. 현재 생산하는 시간은 모두 `T` 구분자를 사용한다. 외부 protocol 입력을 넓히기 전에 공통 fixture에 추가해 두 검증기의 허용 범위를 맞출 필요가 있다.

Task 1+ 기능과 native hard CPU/메모리 격리, sanitizer/fuzz 인증은 이번 리뷰의 완료 범위가 아니다.

## Task 1 — 2026-11-03

`./scripts/check.sh`와 `./scripts/test-gnome.py`를 실행했다. 실제 GPU를 사용하는 GNOME Devkit 창에서 굴절·배경 좌표·글자 보존, 카드 클릭, DING 아이콘 선택/드래그, 일반 창 겹침, 125% 배율, 배경 변경과 캐시 분리, overview/workspace, Blur my Shell 공존을 검증했다. 상세 재현 과정과 범위는 [셰이더 검증 기록](shader-spike.md)에 있다. 사용자 세션의 설치·장시간 동작 검증을 대신하지 않는다.

## Task 2 — 2026-11-04

`./scripts/check.sh`는 Rust 46개, TypeScript 31개 테스트와 fmt/clippy/typecheck/build, GJS validator smoke, 실제 Rust–GJS IPC를 검사한다. IPC 테스트는 별도 bus와 임시 XDG 경로를 사용한다. 구독 2개 중 하나 해제, sender 소실·지연 등록, 재시작, 원래 출처의 늦은 결과·이전 캐시 차단, 원자적 파일 교체·권한, native worker 실행 제한을 검증했다.

실제 GJS에서 Rust 실행 파일을 시작하고 provider 신호, 설정 변경, owner 재시작, 마지막 상태 유지, disable 후 공유 bus 유지가 통과했다. GNOME 시각 회귀 검사에서는 한 차례 DING 활성화 직후 카드 클릭이 누락됐다. 재실행에서 actor pick과 클릭 횟수 진단을 추가한 상태로 통과했으며, 재현 원인은 확정하지 못했다. Task 3의 입력·수명 검증에서 계속 확인할 항목으로 남긴다. 서비스 부재 안내와 실제 Rust 서비스 연결 상태의 GNOME 캡처도 확인했다. 최종 실행에서도 DING 클릭·드래그와 GNOME–Rust 연결이 통과했다.

아직 실제 provider 조회/키링 저장과 systemd 설치를 완료한 것은 아니다. 현재 범위와 한계는 [데이터 서비스](data-service.md)에 기록했다.

Task 2 리뷰에서 같은 owner의 일시적 IPC 실패 뒤 자동 재시도가 없던 문제와 초과 응답이 이전 정상 데이터를 지우던 문제를 재현했다. 취소 가능한 최대 30초 backoff, 개별/전체 payload 초과 시 stale 데이터 보존으로 수정했고 회귀 테스트를 추가했다.

## Task 3 — 2026-11-04

시계·월간 달력·날씨·일정·네트워크 기본 카드, 선택적 시스템·음악, 크기·불투명도·굴절 설정과 고정 설정 버튼을 구현했다. 작은 작업 영역에서는 1열과 내부 스크롤로 바뀐다. 실제 서비스가 없으면 연결 대기를 표시하고 시계는 독립적으로 동작한다.

실제 GNOME 50 / NVIDIA Devkit에서 125% 배율, 300×420 작업 영역 주입, 스크롤 하단, 12/24시간 전환, Rust 서비스 연결/종료, DING·Blur my Shell 공존, 카드 8회 클릭과 일반 창 아래 입력, overview 숨김, enable/disable 20회 후 actor·timer·display signal 정리를 검사했다. 시간대는 고정 시각/시간대를 UI에 주입하고, 절전 복귀는 LoginManager 신호를 발생시켜 처리 경로를 검사했다. 실제 OS 시간대 변경이나 하드웨어 절전/모니터 분리는 하지 않았으며 최종 인수 항목으로 남긴다.

캡처에서 발견한 재활성화 후 카드 내용 축소를 실제 allocation assertion으로 재현해 수정했다. Cogl 50의 snippet pointer 기반 캐시를 확인하고 불변 snippet을 공유해 20회 반복 시 50개 이상 shader/program 생성 경고를 없앴다. [Cogl 50.1 소스](https://github.com/GNOME/mutter/blob/50.1/cogl/cogl/cogl-pipeline-snippet.c)를 기준으로 확인했다. 텍스트 갱신은 굴절 입력 캐시를 다시 그리지 않는다.

입력 테스트의 일반 창 겹침 실패는 unmapped/0×0 perf-helper 창을 검사한 테스트 문제였으며 실제 map과 allocation을 기다린 뒤 통과했다. 이전에 관찰한 간헐적인 가상 포인터 클릭 누락은 진단 실행에서 재현되지 않았다. 물리 포인터와 장시간 실제 세션 입력 확인은 Task 7에 남긴다.

재현: `./scripts/check.sh`, 전체 카드 `./scripts/test-gnome.py`, 단일 굴절 회귀 `./scripts/test-gnome.py --spike`. 개인 캡처는 ignored `.superpowers/sdd/liquid-glass-plan/screenshots/`에 보관한다. 실제 계정 데이터 연동과 최종 UI 세부 표현은 Tasks 4–7의 범위다.

최종 Task 3 검증: Rust 46개 + TypeScript 40개, 타입 검사·빌드·실제 GJS IPC가 통과했다. 전체 카드 GUI와 `--spike` 굴절 회귀 모두 exit 0. 별도 GTK4/Adwaita 설정창이 실제 GNOME에 표시되는 캡처를 확인했다. 테스트용 D-Bus activation 환경을 임시 XDG 경로/개발 디스플레이로 명시해 바깥 세션과 분리했다.

## Task 4 — 2026-11-04

Rust 55개 + TypeScript 45개와 fmt/clippy/typecheck/build/GJS IPC가 통과했다. 별도의 실제 Google 공개 iCal 피드 조회·파싱 검사도 통과했다. 실제 private D-Bus와 임시 XDG 경로의 GNOME keyring에서 저장·조회·삭제·잠긴 항목 오류를 검증했다. 개인 비공개 주소와 사용자 키링은 사용하지 않았다.

수집기·서비스 연결 검사는 설정 IPC → source UUID/키링 저장 → HTTP 대역 → 실제 libical 확장 → provider snapshot → 원본 캐시 → 오프라인 시간대 재계산 → 연결 해제·캐시 삭제 → 재시작 순서로 수행했다. HTTP 검사에는 실제 localhost 응답의 크기/403/429/리디렉션/timeout이 포함된다. 확장 한도와 미지원 규칙은 기존 27개 엔진 검사를 그대로 유지한다.

GNOME 화면에서는 테스트 일정 세 개와 오늘의 일정 점, 종료 일정 제외, 현재 UI와 다른 시간대 응답 숨김을 확인했다. 별도 GTK 설정창은 비밀 입력을 마스킹하고 요청 시 즉시 지운다. 카드 클릭의 Google Calendar 홈 URI는 격리된 기본 처리기에 전달됨을 검사했다. 개인 브라우저 로그인/비공개 피드 실사용은 사용자 인수로 남긴다.

## Task 5 — 2026-11-04

전체 검사에서 Rust 62개 + TypeScript 47개와 타입 검사·빌드·GJS IPC가 통과했다. 실제 Open-Meteo 검색·현재/6시간 예보 live probe도 별도로 통과했으며 실제 사용자 지역은 저장하지 않았다. D-Bus 검색/선택/해제, 검색 실패 후 기존 선택 유지, stale 원래 성공 시각, 60초 수동 갱신 제한을 검증했다. 도시 A의 지연 응답이 B를 덮지 않고 B가 빈 loading 상태에서 시작하는 테스트는 실패 후 통과했다.

GNOME 캡처에서 정상·오프라인 예보, 누락값과 0 구분, 데이터 설정 화면과 출처 링크를 확인했다. 도시 교체 시 이전 도시 제목이 남는 문제를 실제 GUI assertion으로 재현한 뒤 기본 카드 제목을 복원하도록 수정했다. 최종 GUI 검사와 수정 후 타입 검사·빌드가 통과했다. 개인 지역 입력은 사용자 단계이며, 실제 GTK 검색/선택 키보드 흐름은 Task 7 인수에서 다룬다.

## Task 6 — 2026-11-04

CPU 첫 표본·guest 중복 제외·카운터 초기화, MemAvailable 기반 RAM, 센서 부재/CPU 패키지 선택, 네트워크 실경과 시간·동일 카운터 0·NIC 전환·60초 history, MPRIS 재생 우선/동률/일시정지/종료와 로컬 artwork 검사를 추가했다. 전체 검사는 Rust 74개 + TypeScript 49개 및 GJS IPC가 통과했고, 추가 FIFO artwork 회귀 테스트를 포함한 media 5개와 clippy/build도 통과했다(최종 Rust 총 75개). FIFO를 일반 파일처럼 열어 worker가 멈추는 실패를 재현한 뒤 nonblocking open과 일반 파일 확인으로 고쳤다.

실제 private D-Bus의 MPRIS 플레이어를 생성·재생·일시정지·종료해 각 변경이 3초 제한 안에 전달됨을 검사했다. 구독이 필요 없는 카드는 수집하지 않고, CPU·네트워크·음악은 재시작 뒤 디스크 상태를 복원하지 않는다.

`cargo test --test network live_metrics_with_active_tailscale -- --ignored --nocapture`를 명시적으로 실행했다. Tailscale Running 상태에서 자동 `enp5s0`의 RX 약 42.7 kB/s, TX 약 5.7 kB/s와 CPU 8.4%, RAM 13,530,468,352/32,951,459,840 bytes, CPU 온도 42°C를 읽었다. 표본 시점의 값이며 부하 목표 측정은 아니다. 일반 공개 HTTPS 트래픽을 사용했고 사설 Tailscale peer에 시험 트래픽을 보내지 않았다. 명시적 `tailscale0` 전환에서 속도와 history가 초기화됐다.

실제 GNOME에서 live CPU/RAM/온도·네트워크 그래프, 재생 카드·기본 음악 아이콘과 숨김을 캡처해 확인했다. 아이콘은 비동기 로딩 완료 후 캡처하도록 검사기를 보완했다. 반복 실행 중 기존 가상 마우스 8회 검사에서 7회만 도달한 사례가 다시 있었다. 매 클릭마다 장치를 제거/추가하던 검사기를 하나의 지속 마우스로 바꾼 최종 실행은 8/8과 20회 cleanup까지 exit 0였다. 이것만으로 물리 입력 문제의 근본 원인이 확정되지는 않는다. 별도 실행의 clock cache assertion도 한 차례 실패했으나 진단을 추가한 후 두 번의 후속 실행에서는 재현되지 않았다. Task 7 장시간·성능 검사에서 계속 관찰한다.

## Task 7 — 배포와 최종 인수, 2026-11-04

설치/제거는 실제 서비스 활성화와 분리한 임시 루트에서도 실행하며, 기존 프로그램 백업·교체·시작 실패 복구·다른 확장 보존·명시적 purge를 검사한다. 키링 삭제 실패는 완료로 처리하지 않고 재시도할 프로그램을 남긴다. 설치된 앱 디렉터리에도 제거 도구를 보관한다. 배포 ZIP에는 읽을 수 있는 JS/GLSL/CSS/schema/metadata만 포함하며 Rust 실행 파일은 별도다.

실제 GTK 설정창에서 가상 키보드로 Tab/Shift+Tab, 모니터·위치·여백·NIC 선택, 지역 검색·선택·해제, 캘린더 입력·저장·해제·오류 안내를 검사했다. 입력 주소는 공개 fixture이고 사용자 키링은 사용하지 않았다. Shell/GTK 전용 import가 서로 섞이지 않는 빌드 검사도 수행한다.

실제 GNOME Devkit의 `unlock-dialog` session mode에서 확장 root가 0개가 되고 일반 모드에서 1개로 복구되는 것을 확인했다. 이는 물리 잠금·비밀번호 인증을 거친 검사와 구분한다. FBO 할당 오류를 주입해 예외 반복 없이 반투명 모드로 바뀌는 경로를 검사했고, 안내문이 카드 밖으로 나가는 회귀도 검증한다. 이 fallback이 모든 GPU 드라이버의 비동기 오류를 감지한다고 주장하지 않는다.

밝은 배경의 작은 글자 대비를 위해 전경에 그림자를 넣었고 불투명도 조절을 제공한다. 최종 디자인 선호는 사용자 확인이 필요하다. 개인 일정은 모든 캡처에서 사용하지 않았다.

### 요구사항별 증거

| 요구 | 구현·검사 증거 | 남은 실제 사용 확인 |
|---|---|---|
| F-01 굴절 | 실제 NVIDIA Devkit `--spike`: 배경 굴절, 정렬, 선명한 텍스트, 배경 교체; 밝음/어두움 캡처 | 사용자의 배경에서 디자인 선호 |
| F-02 시계 | pure clock tests, 실제 12/24시간 전환, 시간대 주입, resume 신호 | 물리 절전과 OS 시간대 변경 |
| F-03 달력 | 월 경계/주 시작/오늘·일정 점, 실제 카드 클릭 URI | 개인 일정 표시 |
| F-04 일정 | 27개 엔진 검사, 실제 공개 Google 피드, 격리 키링/HTTP/IPC, 일정 3개 UI | 개인 비공개 피드·브라우저 로그인 |
| F-05 날씨 | 실제 Open-Meteo probe, 누락/0·도시 교체·오프라인 fixture, GTK 검색 | 사용자 지역 선택 |
| F-06 시스템 | `/proc`·센서 fixture와 실제 CPU/RAM/온도 수집 | 지원 외 센서는 unavailable |
| F-07 네트워크 | 실제 Tailscale 활성 환경의 물리 NIC 측정, 수동 NIC·초기화 검사 | 사설 VPN peer 트래픽은 미시험 |
| F-08 음악 | 실제 private-bus MPRIS 재생/일시정지/종료, UI cover/기본 아이콘 | 사용자의 플레이어에서 실사용 |
| F-09 설정 | 키보드 prefs, 작은 화면 스크롤, 125%, 모니터 소실 주입 | 재로그인 유지·물리 모니터 분리 |
| F-10 복구 | 실제 서비스 재시작/owner loss, 취소·출처 교체·오프라인 캐시·오류 검사 | 실제 인터넷 연결 끊기는 미실행 |
| Q-01 데스크톱 공존 | DING 아이콘 선택/드래그, 8회 카드 클릭, 앱 겹침, overview/workspace, BMS/Dock | 실제 세션 장시간 마우스 사용 |
| Q-02 성능 | 실제 GPU OFF/ON 3쌍, Shell/service CPU·RSS/FBO와 device-global GPU 계측 | 전체 환경의 presentation latency는 미계측 |
| Q-03 수명주기 | 30분 soak·20회 enable/disable 결과는 성능 기록 참조; 실제 서비스 재시작 | 물리 절전·모니터 분리·재로그인 |
| Q-04 비밀 보호 | 실제 임시 keyring CRUD/lock, config·snapshot·cache 권한, disconnect purge | 개인 키링 잠금 해제는 사용자 수행 |
| Q-05 잠금 비노출 | 실제 private Shell unlock-dialog 모드에서 위젯 root 제거 | 실제 잠금/인증 화면 육안 확인 |
| Q-06 가독성/접근 | 밝음/어두움/복잡한 배경·125%, 키보드 입력/선택/저장/해제/오류 | 사용자 취향·실제 디스플레이 가독성 |
| Q-07 되돌리기 | 설치 정책 7개 회귀, 실제 staging 설치/업데이트/제거, keyring purge CLI | 사용자 실제 데이터 purge는 실행하지 않음 |

### 남겨 둔 사용자 단계

설치 후 로그아웃·로그인, 비공개 iCal 주소 입력/필요한 키링 해제, 날씨 도시 선택, 브라우저 계정 로그인, 실제 배경에서 외형 확인이 필요하다. 물리 잠금·절전/복귀·모니터 분리는 사용자가 작업을 저장한 뒤 확인한다. 자동화는 실제 사용자 세션을 강제 종료하거나 개인 캘린더 주소를 가져오지 않는다.

최종 `./scripts/check.sh`: Rust 75개, TypeScript 49개, Python 설치 회귀 7개와 fmt/clippy/typecheck/build, GJS smoke/IPC, metadata/schema/import 검사가 통과했다. 실제 staging 배포본을 두 번 설치해 백업을 확인하고 **설치된 경로의 제거 도구**로 제거했다. `--spike`, `--preferences`, `--benchmark`는 최종 코드에서 exit 0였다. [실제 화면](../outputs/verification/README.md)과 [성능 원본·방법](performance.md)을 보존한다.

환경 경고는 결과와 구분했다. 로컬 전용 UUID의 확장 사이트 조회 404, 임시 GIO local backend의 Ubuntu Dock `trash://` 미지원, private bus 종료 시 EDS/portal 경고가 로그에 있다. 사용자 세션을 보존하는 검사 환경에서 나온 경고이며 제품 예외나 완전 무경고 실행으로 주장하지 않는다. 긴 soak의 제품 actor/FBO 추이와 완료 결과는 성능 기록에 있다.

최종 전체 GUI 검사도 exit 0: 카드 배치·오류 fallback 경계·잠금 모드·8/8 클릭·20회 cleanup을 통과했다. 30분 soak와 뒤이은 20회 재활성화도 exit 0이며 메모리/FBO 추이를 [성능 기록](performance.md)에 기록했다.

20회 이후 Shell RSS 증가를 확인해 60회까지 추가 진단했다. 20→40→60 구간의 추이와 한계는 [성능 기록](performance.md#rss-증가-추가-진단)에 있다.

## 최종 전체 변경 리뷰와 수정

Tasks 3–7(`e482e8d..519b4f6`)을 별도 fresh-context 리뷰어가 한 번 읽기 전용 검토했다. Critical은 없었고 Important 7개를 모두 수용해 한 번의 수정 단계에서 처리했다.

| 발견 사항 | 수정과 실패→성공 증거 |
|---|---|
| 재연결이 기존 키링 삭제 대기를 지움 | pending flag를 성공한 전체 연결 해제까지 유지; 잠금→삭제 실패→재연결/재교체→전체 삭제 Rust 회귀 |
| 일정 날짜 누락 | 날짜·요일·시각 또는 종일을 표시; caption 회귀와 실제 GUI 캡처 |
| 30일 밖의 일정 표시 | 월간 grid와 별도로 [오늘, 오늘+30일) 및 진행 중 일정 필터; 12월4일 회귀 |
| 종일/시간 일정 정렬 오류 | 표시 시간대의 날짜·시간으로 혼합 비교; 서울 11월5일 종일 vs UTC11월4일16시 회귀 |
| UI 42칸과 엔진 조회 범위 불일치 | 최소 완전한 주 단위 grid로 일치; 2027년2월28칸 및 일요일 시작35칸 회귀 |
| 반투명 fallback이 stale/오류를 가림 | 렌더링 안내는 제목 옆, 데이터 상태는 footer 유지; 실제 GNOME 상태/시각/경계 assertion |
| 같은 날 절전 복귀 시 원격 데이터 미갱신 | 활성·설정된 calendar/weather Refresh, loading+기존 성공 시각, 실패 시 취소 가능한60초 재시도; client/실제 resume signal 회귀 |

수정 후 전체 검사 **Rust 76개 + TypeScript 55개 + Python 7개**, fmt/clippy/typecheck/build/GJS/IPC/schema 검사가 통과했다. 실제 전체 GUI도 exit 0로 날짜·fallback stale 안내·resume 연결·8/8 클릭·20회 cleanup을 통과했다. 물리 절전 인수는 여전히 사용자 단계다. 새 Minor는 없었으며 이전 Task0의 Ajv 날짜 구분자 허용 차이는 그대로 문서화했다. 결정과 리뷰 범위 판단은 [전체 결정 기록](implementation-decisions.md)에 보존했다.

## 실제 사용자 영역 설치

2026-11-04에 최종 release 배포본을 사용자 영역에 설치했다. systemd 서비스 active/enabled, 실제 세션 D-Bus GetSettings/GetSnapshot, 서비스 재시작, 설치한 JS/CSS/metadata/실행 파일과 배포본 일치, 개인 디렉터리0700을 확인했다. 다른 GNOME 확장의 활성/비활성 목록을 보존했다. 캘린더는 disabled/unconfigured, 날씨 지역은 null/unconfigured다. 제거 도구는 `~/.local/lib/liquid-widgets/uninstall.py`에 있다.

새 확장 활성화 항목은 저장했으며 코드가 바깥 Wayland Shell에 로드되려면 사용자가 **로그아웃·로그인**해야 한다. 현재 세션을 종료하지 않았다. 실제 외형 확인은 로그인 후 진행한다. 최종 리뷰 수정 뒤 OFF/ON 측정도 exit0이며 [성능 기록](performance.md)의 최신 JSON을 갱신했다. [설치 확인 항목](../outputs/verification/installation.json)을 보존한다.

## 개인 iCal 연결 후 동기화 오류 수정 — 2026-11-04

사용자가 재로그인하고 비공개 iCal을 연결한 뒤 서비스는 `unavailable / INVALID_DATA`였지만 설정창은 저장 직후의 대기 안내만 보여 주었다. HTTP 수신은 정상이었으며, libical이 빈 DESCRIPTION·LOCATION을 제거하며 남긴 진단과 가져온 일정에 이미 들어 있던 같은 X-LIC-ERROR 때문에 달력 전체를 거부했다.

DESCRIPTION·LOCATION·SUMMARY의 정확한 ‘No value’ 진단과 콜론 뒤 문맥만 허용해 해당 경고를 제거한다. 날짜·시간대·반복 규칙 등 다른 오류는 계속 거부한다. 빈 필드, 연속 경고, 접힌 제목, 접미사가 있는 기존 경고, 잘못된 날짜에 대한 합성 회귀 3개를 추가했다. 설정창은 실제 calendar provider를 구독해 동기화 성공·오류·마지막 데이터 표시를 반영하며 닫을 때 구독을 해제한다.

전체 `./scripts/check.sh`가 exit 0: Rust 79개(격리 subprocess 재실행 중복 제외), TypeScript 56개, Python 7개와 fmt/clippy/build/typecheck/GJS/IPC 검사를 통과했다. 실제 GTK `--preferences` 검사도 오류→동기화 완료 전환을 통과했다. 회귀에는 공개 fixture/합성 일정만 사용했다.

release 배포본을 기존 설치에 반영하고 서비스 재시작 후 실제 비공개 피드의 `status=ok`, `errorCode=null`과 연결 설정 유지, service active/enabled, extension ACTIVE, 설치 파일 일치를 확인했다. Shell의 `extension.js`는 기존 파일과 같아 재로그인하지 않았다. 새 설정 화면은 창을 닫고 다시 열면 적용된다. 주소·일정 내용은 로그나 저장소 증거에 포함하지 않았고 일회성 진단 코드는 제거했다. [비식별 상태 확인](../outputs/verification/calendar-sync.json)을 보존한다.

## 한국어·영어 선택 — 2026-11-04

앱 GSettings `language`에 `ko`/`en` 선택을 저장하며 기본값은 `ko`다. 공용 메시지 사전과 locale 매핑으로 설정·위젯·오류·동기화·날씨·접근성 이름 및 날짜/요일/종일을 함께 바꾼다. 외부 일정/음악/도시 이름은 원문이다. 설정창의 문구만 바꾸므로 입력값과 비동기 상태가 유지되며 언어 변경으로 데이터 구독을 재시작하지 않는다.

영어 요청에 한국어가 반환되는 실패를 먼저 확인한 뒤 공용 표시 회귀 3개를 추가했다. 최종 `./scripts/check.sh`는 Rust 79개, TypeScript 59개, Python 7개와 fmt/clippy/typecheck/build/GJS/IPC 검사를 통과했다. 실제 GTK 검사에서 언어 선택 컨트롤 부재→한국어/영어 양방향 전환, iCal·도시 초안 유지, 언어 변경 후 늦게 도착하는 검색 결과, 창 재개방과 저장된 언어 복구를 확인했다. 재개방 검사는 닫힌 창이 GC 전까지 캘린더 구독을 남기는 문제도 발견했다. 정리는 `close-request`와 `destroy` 중 먼저 발생한 시점에 한 번 실행하도록 고쳤으며 구독 2개→1개를 검증했다.

실제 Shell 검사는 언어별 날짜·요일·월, 시스템 시계 tick 이후 언어 유지, 연결된 서비스의 구독 token 유지, provider 갱신 후 영어 표시와 원문 일정 유지, 영어 fallback 경계, 재활성화 20회 후 언어 유지를 포함해 exit 0였다. 설정 선택 검사의 초기 가상 키보드 입력은 popover focus와 경합했다. 검사기가 해당 선택지의 실제 focus를 기다리도록 고쳤으며 제품 선택 코드는 변경하지 않았다. 기존 GNOME 테스트 환경 경고는 남지만 제품 예외나 검사 실패는 없었다.

[한국어 설정](../outputs/verification/language/preferences-korean.png), [영어 설정](../outputs/verification/language/preferences-english.png), [영어 데이터 화면](../outputs/verification/language/preferences-english-data.png), [영어 위젯](../outputs/verification/language/widgets-english-data.png), [영어 fallback](../outputs/verification/language/widgets-english-fallback.png)은 격리된 GNOME 세션의 합성 데이터 캡처다.

별도 fresh-context 리뷰어가 `c906d1b..f65ef11`을 읽기 전용으로 검토했으며 Critical/Important/Minor 모두 없었다. release 배포본을 사용자 영역에 설치하고 JS·실행 파일·컴파일된 schema 일치, `ko`/`en` 선택지, 기본 한국어, 기존 캘린더 동기화 `ok`와 서비스 active를 확인했다. 이번에는 Shell JS가 변경되어 **다음 로그아웃·로그인에 새 위젯 코드가 로드된다**. 현재 사용자 세션은 종료하지 않았다. 새 코드가 로드된 뒤의 언어 변경은 재로그인 없이 반영된다. [설치 검증](../outputs/verification/language/installation.json)을 보존한다.

## 라이트 모드 가독성과 시계 글꼴 — 2026-11-04

기존 위젯은 색상 모드와 무관하게 반투명 흰 글자와 24% 어두운 바탕을 사용했다. `./scripts/test-gnome.py --visual`에서 흰 배경의 제목 대비가 **1.48:1**인 실패를 재현했다. 같은 장면에서 글자만 어둡게 바꾸면 9.22:1, 바탕만 진하게 바꾸면 4.81:1로 개선되는 것을 확인했다. 라이트/다크 모드에 따라 CSS 전경과 유리 바탕을 바꾸고 최소 농도를 유지하도록 수정했다. 설정의 `opacity` 키와 값은 보존하며 UI에서는 실제 동작에 맞게 **유리 농도 / Glass tint**로 표시한다.

`St.Settings`의 색상 모드 신호를 구독해 즉시 적용하고, 확장 해제 시 구독을 정리한다. 네트워크 그래프·오늘 표시·일정 점·설정 버튼에도 모드별 색상을 적용한다. 기존의 강한 글자 그림자를 없애고 시계는 **Noto Sans Display Medium 56px**(기본 배율)로 바꿨다. 숫자 폭을 일정하게 유지하며 좁은 카드에서는 실측한 글자 폭에 맞춰 크기를 줄인다. 좁은 한국어 12시간 시계의 245px > 216px 실패를 확인한 뒤 오전/오후까지 들어오는 것을 검증했다.

최종 전체 검사는 Rust 79개, TypeScript 59개, Python 7개와 fmt/clippy/typecheck/build/GJS/IPC를 통과했다. 실제 GNOME 전체 검사도 8/8 클릭, 시계/언어/구독 유지와 20회 재활성화, 색상 모드 신호 정리를 통과했다. 마지막 브랜드 표시 정리 뒤에는 전체 정적·단위·IPC 검사와 실제 시각 검사를 다시 실행했다.

시각 검사는 `default`, `prefer-light`, `prefer-dark` × 흰색/검은색 배경 × 최소/기본 농도에서 실제 St 테마 색과 바탕 합성을 계산했다. 표시 중인 글자들의 최소 대비는 **4.59:1**, 라이트 모드의 최솟값은 **5.03:1**이었다. 이는 균일한 배경에 대한 색상 계산이며 화면의 모든 안티앨리어싱 픽셀에 대한 인증을 의미하지 않는다. 숫자 폭, 한국어/영어 12시간 좁은 시계, 125% 화면도 통과했다. 테스트용 GTK helper의 Yaru 리소스 경고는 제품 Shell CSS 오류와 구분한다.

[라이트 모드](../outputs/verification/appearance/widgets-light-wallpaper.png), [다크 모드](../outputs/verification/appearance/widgets-dark-wallpaper.png), [흰 배경](../outputs/verification/appearance/widgets-light-bright.png), [좁은 시계](../outputs/verification/appearance/clock-narrow-ko.png), [대비 측정값](../outputs/verification/appearance/contrast.json)을 보존한다. 캡처는 격리된 GNOME 세션의 합성 날씨·네트워크 데이터이며 개인 일정을 포함하지 않는다.

수정 release를 사용자 영역에 설치하고 JS/CSS/prefs 파일 일치, 서비스 active와 기존 캘린더 동기화 `ok`를 확인했다. 현재 세션은 종료하지 않았으며 새 Shell 코드는 다음 로그아웃·로그인에 적용된다. [설치 확인](../outputs/verification/appearance/installation.json)을 보존한다.

## 재생 중 썸네일 비율과 Spotify 표지 — 2026-11-04

정사각형 `St.Icon`이 16:9 이미지를 1:1로 늘리는 실패를 실제 GNOME 픽셀 검사로 재현했다. 비동기 파일 읽기·축소 해석과 원본 비율을 유지하는 `St.ImageContent`로 교체했다. 가로형·정사각형·세로형 이미지, 125% 화면, 없는 파일·깨진 이미지, 빠른 교체와 로딩 중 카드 해제를 검증했다.

Spotify가 제공하는 HTTPS 표지는 Rust 서비스에서 제한된 사용자 전용 캐시로 받아 Shell에는 로컬 URI만 전달한다. 곡·플레이어·소유자 변경으로 다운로드를 취소하고 완료 시 현재 메타데이터를 다시 검사한다. 리뷰에서 발견한 작업 풀 경합 시 표지 유실도 실패 회귀를 추가해 수정했으며 재검토에서 남은 지적은 없었다.

최종 전체 검사는 Rust 94개(격리 subprocess 중복 제외), TypeScript 61개, Python 7개와 fmt/clippy/typecheck/build/GJS/IPC를 통과했다. 실제 GNOME 표지 검사와 전체 기능·20회 재활성화 검사도 통과했다. 실제 Spotify의 HTTPS 이미지가 새 코드로 다운로드·캐시 재사용되고 640×640으로 해석되는 것을 읽기 전용으로 확인했다. URL·재생 제목·실제 표지는 저장소 증거에 포함하지 않았다.

[검증 자료](../outputs/verification/media-artwork/README.md)에 합성 화면과 측정값을 보존한다. release를 설치하고 확장 8개 파일·서비스 실행 파일 일치, 설정 보존과 service active/enabled를 확인했다. 새 Shell 코드는 다음 로그아웃·로그인에 적용된다.

## 좌우 열별 배치와 시계 크기 — 2026-11-04

설정을 왼쪽·오른쪽 목록으로 나누고 열 안의 순서 변경과 반대쪽으로 이동하는 버튼을 추가했다. 두 열은 독립적으로 쌓이며, 좁은 화면에서는 왼쪽 목록 다음 오른쪽 목록이 이어진다. 시계는 날씨 크기에 맞추고 시간 표시를 본문 중앙에 배치한다.

전체 빌드·단위·IPC 검사, 실제 GTK 이동/저장/포커스 검사와 Shell 배치/크기 검사를 통과했다. 기존 설정·내용 크기 검사도 통과했다. 전체 기능 검사는 기존에 기록된 재활성화 간헐 실패가 한 번 발생했고, 코드 변경 없이 재실행하여 20회 재활성화까지 통과했다. 별도 코드 리뷰에 조치할 지적은 없었다.

[화면·검증 기록](../outputs/verification/card-columns/README.md)을 보존한다. 설치 파일 일치와 기존 설정 보존, 서비스 active/enabled를 확인했다. 새 Shell 코드는 다음 로그아웃·로그인에 적용된다.

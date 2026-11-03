# 최종 자동 검증 기록

2026-11-04. Task 7 및 최종 리뷰 수정 뒤 코드.

| 명령 | 결과 |
|---|---|
| `./scripts/check.sh` | exit 0; Rust 76, TS 55, Python 7, GJS IPC + fmt/clippy/type/build/schema |
| `./scripts/test-gnome.py` | exit 0; 전체 기능·fallback·locked mode·8/8 클릭·20 cycles |
| `./scripts/test-gnome.py --spike` | exit 0; 실제 GPU 굴절·배경 정렬·전경 보존·DING 드래그 |
| `./scripts/test-gnome.py --preferences` | exit 0; 실제 GTK 키보드 입력·선택·저장·해제·오류 |
| `./scripts/test-gnome.py --visual` | exit 0; 밝음/어두움·불투명도·125% 캡처 육안 확인 |
| `./scripts/test-gnome.py --benchmark` | exit 0; 최종 코드 OFF/ON 3쌍 |
| `./scripts/test-gnome.py --soak` | exit 0; 외형 미세 조정 전 동일 core, 30분 + 20cycles |
| `./scripts/package.py` | exit 0; 별도 바이너리·읽을 수 있는 extension ZIP |
| 임시 `--destdir` 설치 2회 → 설치 경로 제거 | exit 0; 백업·업데이트·제거 도구 보존 |

개인 계정과 물리 세션 인수는 [검증 기록](../../docs/verification.md)에 남겼다. 원래 실패와 원인·수정도 해당 기록에 구분했다.

최종 리뷰 후 전체 검사와 전체 GUI를 다시 실행해 exit0를 확인했다. 단일 shader/키보드/30분 기록은 해당 로직의 변경 전 검증이며 후속 수정 범위는 [검증 기록](../../docs/verification.md)의 리뷰 표에 있다.

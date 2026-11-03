# 최종 자동 검증 기록

2026-11-04. 제품 Task 7 커밋 직전 코드.

| 명령 | 결과 |
|---|---|
| `./scripts/check.sh` | exit 0; Rust 75, TS 49, Python 7, GJS IPC + fmt/clippy/type/build/schema |
| `./scripts/test-gnome.py` | exit 0; 전체 기능·fallback·locked mode·8/8 클릭·20 cycles |
| `./scripts/test-gnome.py --spike` | exit 0; 실제 GPU 굴절·배경 정렬·전경 보존·DING 드래그 |
| `./scripts/test-gnome.py --preferences` | exit 0; 실제 GTK 키보드 입력·선택·저장·해제·오류 |
| `./scripts/test-gnome.py --visual` | exit 0; 밝음/어두움·불투명도·125% 캡처 육안 확인 |
| `./scripts/test-gnome.py --benchmark` | exit 0; 최종 코드 OFF/ON 3쌍 |
| `./scripts/test-gnome.py --soak` | exit 0; 외형 미세 조정 전 동일 core, 30분 + 20cycles |
| `./scripts/package.py` | exit 0; 별도 바이너리·읽을 수 있는 extension ZIP |
| 임시 `--destdir` 설치 2회 → 설치 경로 제거 | exit 0; 백업·업데이트·제거 도구 보존 |

개인 계정과 물리 세션 인수는 [검증 기록](../../docs/verification.md)에 남겼다. 원래 실패와 원인·수정도 해당 기록에 구분했다.

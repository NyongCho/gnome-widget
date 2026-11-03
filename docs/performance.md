# 실제 GPU 성능 검증

2026-11-04, Ubuntu 26.04.1 / GNOME Shell 50.1 / NVIDIA GeForce RTX 3080의 가시 Mutter Devkit을 사용했다. 소프트웨어 headless 결과가 아니다. 해상도 1280×800, DING·Ubuntu Dock·Blur my Shell을 켜고 같은 420×320 전경 창을 같은 16ms 주기로 이동시킨다. OFF→ON 20초씩을 3번 반복하며 각 구간 전 3.5초를 안정화한다. CPU는 한 논리 코어를 100%로 한 `/proc` 시간 차이, RSS는 해당 프로세스 표본이다.

GNOME `Shell.PerfLog`의 `stagePaintStart`→`stagePaintDone` p95를 비교한다. 가능한 swap 대기를 포함하며 강제 glFinish를 사용하지 않는다. 화면에 실제 표시되기까지의 지연이나 GPU-only 시간을 직접 측정한 값은 아니다. 전경 앱·바깥 사용자 세션은 존재하므로 전용 벤치마크 머신과 동일한 격리는 아니다. 측정 중 다른 자동 GUI 검사는 실행하지 않았다.

ON에서는 시계·달력·날씨·일정·네트워크·시스템 카드가 보인다. 음악은 활성화했지만 재생 플레이어가 없어 숨겨진다. 캘린더/날씨가 미설정인 구간이므로 비공개 피드 파싱의 최대 부하를 뜻하지 않는다. 30분 soak에는 임시 서울 날씨를 사용하며 실제 사용자 지역에는 저장하지 않는다.

FBO 수치는 할당한 RGBA color buffer 합계다. 깊이 버퍼·드라이버 캐시 등 총 GPU 메모리가 아니다. `nvidia-smi`의 장치 전체 메모리/사용률도 보조 자료로 보존하지만 확장만의 사용량으로 간주하지 않는다.

## 측정 기록

최종 OFF/ON 결과와 30분 soak 결과를 별도 JSON으로 보존한다. 최종 글자 그림자와 오류 안내 배치 변경은 짧은 OFF/ON 및 실제 화면·수명 검사에 포함한다. 긴 soak는 해당 외형 조정 직전의 동일 수집기·셰이더·수명 구현으로 수행했다.

최종 외형을 포함한 [원본 JSON](../outputs/verification/performance-final.json):

| 반복 | OFF p95 ms | ON p95 ms | 증가 ms | ON 서비스 CPU | ON 서비스 RSS MiB | Shell CPU OFF/ON | Shell RSS OFF/ON MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.498 | 0.958 | 0.460 | 0.100% | 31.19 | 9.65 / 14.60% | 440.55 / 443.72 |
| 2 | 0.463 | 0.954 | 0.491 | 0.150% | 31.25 | 8.55 / 14.15% | 444.16 / 444.55 |
| 3 | 0.499 | 0.984 | 0.485 | 0.100% | 31.34 | 8.85 / 14.55% | 444.11 / 444.36 |

세 쌍 모두 서비스 CPU ≤1%, RSS ≤100MiB, paint p95 증가 ≤2ms 목표 안에 들었다. ON의 FBO color buffer는 1,898,320 bytes(약 1.81MiB)이며 OFF는 0이다. frame sample 수와 device-global GPU 표본은 JSON에 있다. 이 실행에서 GPU 메모리 표본은 OFF 1,788MiB / ON 1,814–1,815MiB였지만 확장만의 귀속 비용으로 해석하지 않는다.

## 30분과 반복 활성화

[30분 원본 JSON](../outputs/verification/performance-soak.json), [종료 화면](../outputs/verification/widgets-soak-final.png). 실제 실행은 exit 0로 끝났다. 매분 layer 1개/카드 6개, FBO 1,898,320 bytes를 유지했다. 30분 뒤 GC와 20회 enable/disable을 수행했다.

| 시점 | Shell RSS MiB | 서비스 RSS MiB | layer / 카드 | FBO bytes |
|---|---:|---:|---:|---:|
| 시작 (GC 후) | 457.32 | 32.95 | 1 / 6 | 1898320 |
| 30분 (GC 후) | 455.81 | 32.84 | 1 / 6 | 1898320 |
| 추가 20회 (GC 후) | 503.46 | 33.03 | 1 / 6 | 1898320 |

이 구간에서 중복 root/FBO 증가나 제품 예외는 관찰하지 않았다. 전체 Shell RSS에는 DING/BMS/Dock 등과 native allocator 캐시가 포함되므로 변화량만으로 누수 부재를 수학적으로 보장하지 않는다. 정상 시계 갱신은 효과 입력 캐시 재그리기를 늘리지 않는 별도 검사를 통과했다.

## RSS 증가 추가 진단

20회 직후 Shell RSS가 늘어 추가로 같은 세션에서 20·40·60회를 비교했다. 각 구간 뒤 2초 안정화와 GC를 수행했다. [원본 JSON](../outputs/verification/lifecycle-memory.json).

| 누적 활성화 횟수 | Shell RSS MiB | layer / 카드 | FBO bytes |
|---|---:|---:|---:|
| 0 | 441.82 | 1 / 6 | 1898320 |
| 20 | 490.10 | 1 / 6 | 1898320 |
| 40 | 487.48 | 1 / 6 | 1898320 |
| 60 | 493.26 | 1 / 6 | 1898320 |

첫 구간의 증가가 이후 구간에서 같은 비율로 누적되지는 않았다. 이 범위에서는 고정된 native/renderer 할당 여유와 일치하는 추이지만, RSS만으로 특정 allocator/cache를 원인으로 확정하지 않는다. 재현: `./scripts/test-gnome.py --lifecycle`.

## 재현 및 검사기 수정

```sh
./scripts/test-gnome.py --benchmark
./scripts/test-gnome.py --soak
```

첫 장시간 시도는 테스트 창을 만드는 GNOME perf-helper가 30초 무호출 후 종료됐는데 검사기가 사라진 창을 계속 이동시켜 Mutter가 종료됐다. 코어의 native backtrace와 [GNOME 50.1 helper 소스](https://github.com/GNOME/gnome-shell/blob/50.1/src/shell-perf-helper.c)를 대조했다. 검사기는 WaitWindows로 helper를 유지하고 unmanaged 시 이동을 중지하며 창 소실 구간을 거부한다. 제품 코드의 충돌 수정으로 포장하지 않았다.

검사마다 private D-Bus·XDG 설정·runtime을 사용한다. Devkit의 출력만 바깥 Wayland와 PipeWire로 표시한다. 테스트 종료 시 별도 portal mount를 정리한다. 사용자 세션의 로그아웃·잠금 인증·절전·모니터 분리 검증을 대신하지 않는다.

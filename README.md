# GNOME Liquid Glass Widgets

GNOME Shell 50 바탕화면용 유리 위젯이다. 날짜·시계, 월간 달력, 다가오는 일정, 날씨, CPU·RAM·온도, 네트워크, 재생 중 음악을 표시한다. 한국어·영어, 네 가지 시계, 라이트·다크 모드, 좌우 열 배치와 배경화면 굴절을 지원한다.

## 두 에디션

| | 공개용 TypeScript/GJS | 개인용 Rust |
| --- | --- | --- |
| 확장 UUID | `liquid-widgets@nyongcho.github.io` | `liquid-widgets@local` |
| 데이터 처리 | 확장 내부 비동기 수집 + 요청별 GJS 달력 계산 | Rust 사용자 서비스 |
| 추가 런타임 | GNOME/GJS 환경과 달력용 Secret Service | Rust 실행 파일, libical, 사용자 서비스 |
| 설정·캐시 이름 | `liquid-widgets-public` | `liquid-widgets` |
| 빌드 선택 | `--edition gjs` | `--edition rust` |

UI·GLSL·카드 기능은 공유한다. 공개용 실행에는 Rust, Node.js, npm 또는 별도 systemd 서비스 설치가 필요 없다. 두 에디션의 설정과 비밀 주소는 자동으로 복사하지 않는다. 전환할 때 기존 에디션을 비활성화하면 카드가 겹치지 않는다.

## 공개용 설치

아직 extensions.gnome.org에 게시하지 않았다. 프로젝트 라이선스 선택과 최종 배포 검증이 남아 있으며, 개발 검증 ZIP을 제출용으로 사용하지 않는다.

라이선스가 포함된 공개용 ZIP을 받은 경우:

```sh
gnome-extensions install --force liquid-widgets.shell-extension.zip
```

처음 설치하거나 코드를 업데이트했다면 로그아웃 후 다시 로그인한다. 이어서:

```sh
gnome-extensions enable liquid-widgets@nyongcho.github.io
gnome-extensions prefs liquid-widgets@nyongcho.github.io
```

설정의 데이터 탭에서 Google Calendar iCal 주소와 날씨 지역을 연결한다. 달력·일정을 클릭하면 기본 브라우저에서 Google Calendar를 연다. 비밀 주소는 키링에 저장하며 채팅이나 저장소에 넣지 않는다.

[설치·설정·제거 및 Rust판 복귀](docs/setup.md), [Google Calendar](docs/calendar.md), [날씨](docs/weather.md), [시스템·네트워크·음악](docs/live-data.md)을 참고한다.

## 개발

공개용 빌드에는 Node 24 이상, npm, GJS, GLib schema 도구와 GNOME 50 개발 환경을 사용한다. 저장소의 `.tools`가 준비되어 있으면 `scripts/dev`가 해당 도구를 선택한다.

```sh
./scripts/dev npm --prefix extension ci
./scripts/check.sh --edition gjs
python3 scripts/package.py --edition gjs
```

소유자가 라이선스를 선택하기 전에는 마지막 명령이 중단된다. 로컬 검증 전용으로는 `--development`를 추가하며 출력은 `dist/liquid-widgets-public-development/`다. 제출용 기본 출력은 `dist/liquid-widgets-public/liquid-widgets.shell-extension.zip`이다.

개인용은 `python3 scripts/package.py --edition rust`로 기존 `dist/liquid-widgets/` 배포본을 만든다. 이 경로에는 Rust·libical 개발 환경이 필요하다. `package.py`의 기본 선택은 기존 호환성을 위해 Rust이며, `check.sh`의 기본 선택은 두 에디션을 검사하는 `all`이다.

검증 자료:

- [에디션 구조와 수명](docs/data-service.md)
- [공개용 화면·설정 검증](docs/public-edition-verification.md)
- [반응성·CPU·메모리·자식 종료 측정](docs/typescript-performance.md)
- [GNOME Extensions 심사 준비 상태](docs/gnome-extensions-release.md)
- [외부 코드·데이터 고지](THIRD_PARTY_NOTICES.md)

실제 GPU 검사는 격리된 GNOME 세션과 합성 데이터를 사용한다. 개인 Google 계정, 실제 날씨 요청, 물리 로그인·잠금 전환은 별도 확인 항목이다. 현재 개인용 설치를 자동으로 교체하지 않는다.

# 설치와 사용

GNOME Shell 50 / Wayland용이다. 검증 호스트는 Ubuntu 26.04.1, Shell 50.1이다. 다른 주요 버전의 지원은 주장하지 않는다.

## 공개용 ZIP 설치

공개용 UUID는 `liquid-widgets@nyongcho.github.io`다. Rust 실행 파일·libical·Node.js·npm·systemd 서비스를 설치하지 않는다. 소스에서 빌드할 때만 Node/npm을 사용한다. 프로젝트 라이선스는 [GPL-3.0-or-later](../LICENSE)다. 공개 ZIP은 [GitHub Releases](https://github.com/NyongCho/gnome-widget/releases/latest)에서 받으며, extensions.gnome.org에는 아직 게시하지 않았다.

릴리스의 `liquid-widgets.shell-extension.zip`을 내려받은 폴더에서:

```sh
gnome-extensions install --force liquid-widgets.shell-extension.zip
```

새 확장이나 변경된 JS를 적용하려면 로그아웃·로그인이 필요할 수 있다. 다시 로그인한 뒤:

```sh
gnome-extensions enable liquid-widgets@nyongcho.github.io
gnome-extensions prefs liquid-widgets@nyongcho.github.io
```

다운로드나 설치 중 npm 명령·셸 설치 스크립트를 실행하지 않는다. 키링 라이브러리/서비스가 없거나 잠겼으면 달력 연결이 오류 상태를 표시하며 사용자가 데스크톱의 키링 상태를 확인한다. 확장이 패키지를 자동 설치하거나 잠금 해제 창을 반복해서 열지 않는다.

## 사용자 설정


- **카드 배치:** 위젯 → 왼쪽 열·오른쪽 열에서 ↑·↓ 버튼으로 각 열 안의 순서를 바꾸고, ←·→ 버튼으로 반대쪽 열의 마지막으로 옮긴다. 기본 배치는 왼쪽에 날짜와 시계·월간 달력·다가오는 일정, 오른쪽에 날씨·CPU/메모리/온도·네트워크·음악이다. 두 열은 각자 위에서 아래로 쌓인다. 스위치는 표시 여부만 바꾸므로 껐다 켜도 지정한 열과 순서로 돌아온다. 재생 중이 아닌 음악은 빈칸 없이 건너뛰고, 좁은 화면에서는 왼쪽 목록 다음 오른쪽 목록이 한 열로 이어진다. 기존 표시 설정은 유지된다.
- **시계:** 위젯 → 시계 → 시계 스타일에서 **큰 디지털**, **사각 눈금**, **클래식 원형**, **미니멀 아날로그**를 선택한다. 기본값은 큰 디지털이며 선택은 즉시 반영되고 다음 로그인에도 유지된다. 날짜·오전/오후는 선택한 언어를, 시간대와 12/24시간 표시는 시스템 설정을 따른다. 아날로그 초침은 카드가 보일 때만 갱신하며 저전력 모드에서는 초침을 생략한다.
- **언어:** 위젯 → 표시 언어 → **언어 / Language**에서 `한국어` 또는 `English`를 선택한다. 기본값은 한국어이며 선택은 다음 실행에도 유지된다. 위젯·설정 문구와 날짜·요일은 즉시 바뀐다. 시간대·12/24시간·주 시작 요일은 시스템 설정을 따른다. 입력 중인 주소·도시는 유지하고, 일정 제목·곡명·도시 이름은 원문을 표시한다. OS가 제공하는 기본 GTK 버튼/도움말은 시스템 언어를 따른다.
- **캘린더:** 데이터 → Google Calendar에 비공개 iCal 주소를 직접 입력한다. 주소를 채팅이나 일반 설정 파일에 붙여 넣지 않는다. 저장 후 입력 칸은 지워진다. 필요하면 사용자가 키링을 해제한다. [연결 안내와 일정 지원 범위](calendar.md)
- **날씨:** 데이터 → 날씨 지역에서 도시를 검색하고 선택한다. 테스트에 사용한 도시는 실제 사용자 설정으로 저장하지 않는다. [날씨 데이터](weather.md)
- **위치:** 위젯 → 화면과 위치에서 모니터, 왼쪽/오른쪽 위, 여백을 정한다. 화면이 사라지면 주 모니터로 돌아온다. 작은 화면에서는 카드 영역을 스크롤한다. 설정 버튼은 위쪽에 남는다.
- **외형:** GNOME의 라이트/다크 모드를 자동으로 따른다. 라이트 모드는 밝은 유리·짙은 글자, 다크 모드는 어두운 유리·밝은 글자를 사용한다. 크기·굴절·유리 농도를 조절할 수 있으며, 농도를 낮춰도 글자 대비를 위한 바탕색은 유지한다. 기존 `opacity` 설정값은 유리 농도로 이어서 사용한다. 시계는 날씨 카드와 크기를 맞추고 선택한 시계판 아래에 날짜를 표시한다. 날씨를 숨기면 기본 날씨 높이를 사용하며, 내용이 잘리지 않을 만큼의 높이는 항상 확보한다. 디지털 시계는 Noto Sans Display와 일정한 숫자 폭을 사용하며, 오전/오후는 숫자와 분리해 표시한다. 좁은 화면에서는 시계판과 글자를 함께 줄인다. 해당 폰트가 없으면 시스템의 대체 폰트를 사용한다. 저전력·굴절 실패 시 더 불투명한 바탕을 사용하며 실패 안내를 표시한다.
- **네트워크:** 데이터 → 네트워크에서 자동 또는 특정 NIC를 선택하고 저장한다. `tailscale0`을 선택하면 VPN만 표시한다. 자동은 물리 기본 경로 하나를 사용하며 합산하지 않는다.
- **음악:** 음악 카드를 켜 두면 MPRIS 재생 중에만 나타난다. 재생 제어 버튼은 없다. [측정과 플레이어 지원 범위](live-data.md)

설정은 Tab/Shift+Tab, 방향키, Enter로 조작할 수 있다. 달력·일정 카드를 클릭하면 기본 브라우저의 Google Calendar 홈을 연다. 계정 선택과 로그인은 브라우저에서 한다.

## 저장 위치와 에디션 전환

| 항목 | 공개용 | 개인용 Rust |
| --- | --- | --- |
| 확장 디렉터리 이름 | `liquid-widgets@nyongcho.github.io` | `liquid-widgets@local` |
| 앱 설정 | `~/.config/liquid-widgets-public/settings.json` | `~/.config/liquid-widgets/settings.toml` |
| 캐시 | `~/.cache/liquid-widgets-public/` | `~/.cache/liquid-widgets/` |
| 키링 application 속성 | `io.github.NyongCho.LiquidWidgets` | `org.local.LiquidWidgets` |
| GSettings schema | `org.gnome.shell.extensions.liquid-widgets-public` | `org.gnome.shell.extensions.liquid-widgets` |

확장은 `~/.local/share/gnome-shell/extensions/` 아래에 설치한다. 설정·캐시·확장 경로는 각각 XDG_CONFIG_HOME/CACHE_HOME/DATA_HOME을 따른다. 앱 디렉터리는 0700, 파일은 0600이다. 설정·키링·캐시는 자동 이전하지 않는다.

공개용으로 전환하려면 기존 Rust 확장을 끈 뒤 공개용을 켠다. 기존 개인용 서비스는 구독자가 없으면 수집을 멈추며, 원하면 사용자가 중지할 수 있다.

```sh
gnome-extensions disable liquid-widgets@local
gnome-extensions enable liquid-widgets@nyongcho.github.io
```

이미 설치된 Rust판으로 복귀:

```sh
gnome-extensions disable liquid-widgets@nyongcho.github.io
systemctl --user start liquid-widgets.service
gnome-extensions enable liquid-widgets@local
```

## 공개용 제거

비밀 주소까지 지우려면 **제거 전에** 설정 → 데이터 → Google Calendar → 연결 해제/연결 정보 삭제를 실행한다. 삭제 대기가 표시되면 키링을 해제하고 재시도한다. 확장을 꺼 둔 상태에서도 설정창에서 삭제할 수 있다.

```sh
gnome-extensions disable liquid-widgets@nyongcho.github.io
gnome-extensions uninstall liquid-widgets@nyongcho.github.io
```

일반 제거는 앱 설정·캐시·키링을 삭제하지 않는다. 위에서 키링 삭제를 마친 뒤 남은 파일까지 원할 때만 자신의 `liquid-widgets-public` 설정·캐시 디렉터리를 지운다. 외형 설정을 초기화하려면 제거 전에 다음 명령을 사용한다.

```sh
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liquid-widgets@nyongcho.github.io/schemas reset-recursively org.gnome.shell.extensions.liquid-widgets-public
```

개인용 `liquid-widgets` 경로와 다른 앱의 키링 항목은 공개용 삭제의 대상이 아니다.

## 개인용 Rust 설치·제거

Rust 개발 도구, C 컴파일러, pkg-config, libical 개발 파일이 추가로 필요하다. 기존 도구가 준비되어 있으면:

```sh
./scripts/dev npm --prefix extension ci
./scripts/check.sh --edition rust
python3 scripts/package.py --edition rust
./dist/liquid-widgets/install.py
```

런타임에는 배포된 Rust 실행 파일, libical.so.3와 세션 Secret Service가 필요하다. 설치기는 기존 프로그램을 백업하고 사용자 서비스를 시작한다. sudo는 사용하지 않는다. 처음 준비하는 호스트의 개발 도구는 선택적으로 `scripts/bootstrap-dev.py`로 프로젝트 `.tools`에 마련할 수 있다. 공개용 사용자 설치 절차에는 이 도구가 필요 없다.

서비스는 `~/.local/lib/liquid-widgets/`, unit은 `~/.config/systemd/user/liquid-widgets.service`, 백업은 `~/.local/share/liquid-widgets/backups/`에 있다. 설치 중 서비스 시작 실패 시 이전 프로그램 파일을 복원한다. JS 변경 후에는 다시 로그인이 필요할 수 있다.

```sh
systemctl --user status liquid-widgets.service
journalctl --user -u liquid-widgets.service --since today
python3 ~/.local/lib/liquid-widgets/uninstall.py
```

개인용 데이터까지 지우려면 명시적으로 `uninstall.py --purge-data`를 사용한다. 키링 삭제 실패 시 프로그램과 재시도 가능한 설정을 남긴다. `install.py --destdir /tmp/검사경로`는 실제 서비스나 세션 설정을 바꾸지 않는 staging이며 비밀 삭제에는 사용하지 않는다.

## 검증

`./scripts/check.sh --edition all`은 두 에디션의 코드·프로토콜·설정·키링·패키지 정책을 검사한다. `--edition gjs` 경로는 Cargo를 호출하지 않는다. 실제 GPU 검사는 `./scripts/test-gnome.py --edition gjs` 또는 `--edition rust`로 실행한다. `--preferences`, `--clock-styles`, `--dynamic-wallpaper`, `--visual` 등은 독립 화면 검사를 선택한다.

[공개용 검증 기록](public-edition-verification.md), [성능·수명 결과](typescript-performance.md), [배포 준비 상태](gnome-extensions-release.md)를 참고한다. 자동 검사 결과를 실제 개인 계정 연동이나 GNOME Extensions 승인으로 표현하지 않는다.

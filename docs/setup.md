# 설치와 사용

Ubuntu 26.04 / GNOME Shell 50 / Wayland용이다. Rust 서비스와 GNOME 확장을 사용자 영역에 설치하며 sudo가 필요 없다. 다른 GNOME 주요 버전은 지원 대상으로 검증하지 않았다.

## 설치

프로젝트에서 빌드된 배포본이 있으면:

```sh
./dist/liquid-widgets/install.py
```

처음부터 준비하려면 Rust 1.99.1, Node 24.22.2, C 컴파일러, pkg-config, libical 개발 파일, GJS, GNOME 50이 필요하다. 이 호스트의 `.tools` 개발 도구를 사용하거나 같은 Ubuntu x86_64 환경에서 선택적으로 bootstrap할 수 있다.

```sh
./scripts/bootstrap-dev.py
./scripts/dev npm --prefix extension ci
./scripts/check.sh
./scripts/package.py
./dist/liquid-widgets/install.py
```

bootstrap은 도구를 프로젝트의 `.tools/`에 풀며 시스템 패키지와 셸 프로필을 변경하지 않는다. 이미 준비된 도구가 있으면 bootstrap을 생략한다. 서비스 런타임에는 libical.so.3와 세션 Secret Service가 필요하다.

설치기는 기존 확장·실행 파일·service unit을 백업하고 사용자 서비스를 활성화해 시작한다. 새 로컬 확장과 업데이트한 JS는 **로그아웃 후 다시 로그인**해야 적용될 수 있다. 설치기가 세션을 강제로 종료하지 않는다. 시스템의 확장 기능이 전체 비활성 상태라면 GNOME Extensions에서 활성화해야 한다.

로그인 후 바탕화면의 설정 아이콘 또는 다음 명령으로 설정을 연다.

```sh
gnome-extensions prefs liquid-widgets@local
```

## 사용자 설정

- **카드 순서:** 위젯 → 표시할 카드에서 각 항목의 ↑·↓ 버튼으로 목록 순서를 바꾼다. 바탕화면도 목록 순서대로 왼쪽부터 `1 2 / 3 4 / 5 6`으로 배치되며 시계도 한 칸을 차지한다. 스위치는 표시 여부만 바꾸므로 껐다 켜도 지정한 위치로 돌아온다. 재생 중이 아닌 음악은 빈칸 없이 건너뛰고, 좁은 화면에서는 같은 순서의 한 열로 바뀐다. 처음 업데이트할 때 기존에 켠 카드의 순서를 이어받는다.
- **언어:** 위젯 → 표시 언어 → **언어 / Language**에서 `한국어` 또는 `English`를 선택한다. 기본값은 한국어이며 선택은 다음 실행에도 유지된다. 위젯·설정 문구와 날짜·요일은 즉시 바뀐다. 시간대·12/24시간·주 시작 요일은 시스템 설정을 따른다. 입력 중인 주소·도시는 유지하고, 일정 제목·곡명·도시 이름은 원문을 표시한다. OS가 제공하는 기본 GTK 버튼/도움말은 시스템 언어를 따른다.
- **캘린더:** 데이터 → Google Calendar에 비공개 iCal 주소를 직접 입력한다. 주소를 채팅이나 일반 설정 파일에 붙여 넣지 않는다. 저장 후 입력 칸은 지워진다. 필요하면 사용자가 키링을 해제한다. [연결 안내와 일정 지원 범위](calendar.md)
- **날씨:** 데이터 → 날씨 지역에서 도시를 검색하고 선택한다. 테스트에 사용한 도시는 실제 사용자 설정으로 저장하지 않는다. [날씨 데이터](weather.md)
- **위치:** 위젯 → 화면과 위치에서 모니터, 왼쪽/오른쪽 위, 여백을 정한다. 화면이 사라지면 주 모니터로 돌아온다. 작은 화면에서는 카드 영역을 스크롤한다. 설정 버튼은 위쪽에 남는다.
- **외형:** GNOME의 라이트/다크 모드를 자동으로 따른다. 라이트 모드는 밝은 유리·짙은 글자, 다크 모드는 어두운 유리·밝은 글자를 사용한다. 크기·굴절·유리 농도를 조절할 수 있으며, 농도를 낮춰도 글자 대비를 위한 바탕색은 유지한다. 기존 `opacity` 설정값은 유리 농도로 이어서 사용한다. 시계는 Noto Sans Display Medium과 일정한 숫자 폭을 사용하고, 좁은 화면에서는 오전/오후까지 맞도록 크기를 줄인다. 해당 폰트가 없으면 시스템의 대체 폰트를 사용한다. 저전력·굴절 실패 시 더 불투명한 바탕을 사용하며 실패 안내를 표시한다.
- **네트워크:** 데이터 → 네트워크에서 자동 또는 특정 NIC를 선택하고 저장한다. `tailscale0`을 선택하면 VPN만 표시한다. 자동은 물리 기본 경로 하나를 사용하며 합산하지 않는다.
- **음악:** 음악 카드를 켜 두면 MPRIS 재생 중에만 나타난다. 재생 제어 버튼은 없다. [측정과 플레이어 지원 범위](live-data.md)

설정은 Tab/Shift+Tab, 방향키, Enter로 조작할 수 있다. 달력·일정 카드를 클릭하면 기본 브라우저의 Google Calendar 홈을 연다. 계정 선택과 로그인은 브라우저에서 한다.

## 설치 경로와 복구

| 항목 | 기본 경로 |
|---|---|
| 확장 | `~/.local/share/gnome-shell/extensions/liquid-widgets@local/` |
| 서비스·제거 도구 | `~/.local/lib/liquid-widgets/` |
| systemd unit | `~/.config/systemd/user/liquid-widgets.service` |
| 앱 설정 | `~/.config/liquid-widgets/settings.toml` |
| 일정·날씨 캐시 | `~/.cache/liquid-widgets/` |
| 이전 프로그램 백업 | `~/.local/share/liquid-widgets/backups/` |

XDG_CONFIG_HOME/DATA_HOME/CACHE_HOME을 지정한 환경은 해당 경로를 따른다. 비밀 주소는 키링에 보관한다. 위젯 외형은 앱의 GSettings schema에 저장한다. CPU·네트워크·음악은 디스크 캐시를 만들지 않는다.

```sh
systemctl --user status liquid-widgets.service
systemctl --user restart liquid-widgets.service
journalctl --user -u liquid-widgets.service --since today
```

서비스는 graphical-session.target에 연결되며 마지막 구독자가 사라지면 수집을 멈춘다. 확장을 끄면 위젯과 타이머·구독을 정리한다. 설치 도중 서비스 시작에 실패하면 이전 프로그램 파일을 복원한다. 백업 복구 후에도 확장 코드 변경은 다음 로그인에 적용될 수 있다.

## 제거

```sh
python3 ~/.local/lib/liquid-widgets/uninstall.py
```

일반 제거는 앱 설정·캐시·키링 연결 정보를 남긴다. 함께 삭제하려면 **명시적으로** 다음 옵션을 사용한다.

```sh
python3 ~/.local/lib/liquid-widgets/uninstall.py --purge-data
```

이미 일반 제거한 뒤 남은 데이터를 지우려면 배포본의 `./dist/liquid-widgets/uninstall.py --purge-data`를 사용한다. 키링 삭제에 실패하면 완료로 표시하지 않고 재시도할 프로그램과 설정을 남긴다. 잠금을 해제한 뒤 같은 명령을 다시 실행한다. 프로그램 백업은 별도로 남기며 다른 확장·데스크톱 설정은 제거하지 않는다.

`install.py --destdir /tmp/원하는경로`와 같은 staging은 실제 서비스나 세션 설정을 바꾸지 않고 설치 파일을 검사하는 용도다. staging에서 개인 비밀 삭제 옵션은 허용하지 않는다.

## 검증 범위

`./scripts/check.sh`는 Rust·TypeScript·GJS·실제 격리 IPC·키링·설치 정책을 검사한다. `./scripts/test-gnome.py`는 실제 GPU의 격리된 GNOME Devkit에서 동작한다. `--preferences`, `--visual`, `--spike`, `--benchmark`, `--soak`가 각각 키보드·배경·굴절·성능·30분 검사를 실행한다.

최종 결과와 남은 개인 계정/물리 세션 인수는 [검증 기록](verification.md)에 구분한다. 배포 ZIP은 읽을 수 있는 JS·GLSL·CSS·schema·metadata이며 Rust 실행 파일은 별도다. 로컬 사용 배포이며 extensions.gnome.org에 게시하지 않았다. GNOME 참고 저장소는 API 검증에 사용했고 해당 구현 파일을 복사하지 않았다. Rust 종속성의 라이선스 메타데이터는 배포본 `dependency-licenses.json`에 있다.

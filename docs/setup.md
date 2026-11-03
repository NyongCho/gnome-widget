# 개발 환경과 실행

Task 0은 데이터 계약과 일정 파서의 실행 검증까지다. 아직 설치할 GNOME 확장이나 실행할 사용자 서비스는 없다.

## 필요한 도구

- Rust 1.99.1 + rustfmt/clippy (`rust-toolchain.toml`)
- Node.js 24.22.2 (`.node-version`), npm
- C 컴파일러, binutils, libc 개발 헤더, pkg-config
- libical 개발 패키지 3.0.20 이상. 이번 검증 버전은 Ubuntu의 3.0.20이다.
- GJS. GNOME 50 호스트의 실제 JavaScript 런타임 검증에 사용한다.

일반 Ubuntu 개발 환경에서는 `build-essential pkg-config libical-dev gjs` 패키지와 Rust/Node를 준비하면 된다. 사용자 환경에 이미 설치한 도구도 사용할 수 있다.

현재 호스트에서는 관리자 인증 없이 진행하기 위해 GCC·libical 헤더·Rust·Node를 프로젝트의 `.tools/`에 준비했다. 시스템 패키지 설치, 셸 프로필 변경은 하지 않았다. `scripts/dev`는 이 폴더가 있으면 해당 도구를 우선하고, 없으면 원래 PATH를 사용한다.

같은 Ubuntu 26.04 x86_64 환경에서 이 구성을 재현하려면:

```sh
./scripts/bootstrap-dev.py
./scripts/dev npm --prefix extension ci
./scripts/check.sh
```

선택적 bootstrap은 Python 3, apt-get/dpkg-deb, 시스템의 binutils·libc 개발 헤더·GCC 런타임 의존성을 전제로 한다. 현재 호스트를 위한 보조 도구이며 모든 배포판의 설치 관리자 역할은 하지 않는다. Node/Rust는 공식 배포 서버의 SHA-256을 검증하고 Ubuntu 패키지는 설정된 apt 저장소에서 받아 `.tools/sysroot`에 풀기만 한다. `.tools`는 Git에서 제외한다.

## 개별 검사

```sh
./scripts/dev cargo test --locked --manifest-path daemon/Cargo.toml --test calendar
./scripts/dev cargo test --locked --manifest-path daemon/Cargo.toml --test contract
./scripts/dev cargo run --locked --manifest-path tests/calendar-candidates/Cargo.toml
./scripts/dev npm --prefix extension test -- contract.test.ts
./scripts/dev npm --prefix extension run typecheck
./scripts/dev npm --prefix extension run build
gjs -m extension/tests/gjs-smoke.js
```

`check.sh`는 위 검사와 Rust 포맷·Clippy 검사를 모두 실행한다. 실제 계정·비공개 주소·인터넷 조회는 테스트에 필요하지 않다. 최초 의존성 설치에는 네트워크가 필요하다.

TypeScript 검증기는 JSON Schema에서 빌드할 때 생성하고 ESM으로 묶는다. GNOME에서 Ajv 컴파일러나 Node를 실행하지 않는다. `extension/generated/`, `extension/dist/`, `target/`, `node_modules/`는 생성물이다. Cargo/npm lockfile은 커밋한다.

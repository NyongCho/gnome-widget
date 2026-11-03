#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
./scripts/dev cargo fmt --manifest-path daemon/Cargo.toml -- --check
./scripts/dev cargo clippy --locked --manifest-path daemon/Cargo.toml --all-targets -- -D warnings
./scripts/dev cargo build --locked --manifest-path daemon/Cargo.toml
./scripts/dev cargo test --locked --manifest-path daemon/Cargo.toml
./scripts/dev cargo run --locked --manifest-path tests/calendar-candidates/Cargo.toml
./scripts/dev npm --prefix extension run typecheck
./scripts/dev npm --prefix extension test
./scripts/dev npm --prefix extension run build
gjs -m extension/tests/gjs-smoke.js

./scripts/test-ipc.py

python3 scripts/check-build.py
python3 tests/test_install.py

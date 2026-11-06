#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
edition=all
if [ "$#" -gt 0 ]; then
    if [ "$#" -ne 2 ] || [ "$1" != --edition ]; then
        printf '%s\n' 'Usage: ./scripts/check.sh [--edition rust|gjs|all]' >&2
        exit 2
    fi
    edition=$2
fi
case "$edition" in rust|gjs|all) ;; *) printf '%s\n' 'Expected rust, gjs or all' >&2; exit 2 ;; esac
if [ "$edition" != gjs ]; then
    ./scripts/dev cargo fmt --manifest-path daemon/Cargo.toml -- --check
    ./scripts/dev cargo clippy --locked --manifest-path daemon/Cargo.toml --all-targets -- -D warnings
    ./scripts/dev cargo build --locked --manifest-path daemon/Cargo.toml
    ./scripts/dev cargo test --locked --manifest-path daemon/Cargo.toml
    ./scripts/dev cargo run --locked --manifest-path tests/calendar-candidates/Cargo.toml
fi
./scripts/dev npm --prefix extension run typecheck
./scripts/dev npm --prefix extension test
if [ "$edition" != gjs ]; then
    ./scripts/dev npm --prefix extension run build -- --edition rust
    python3 scripts/check-build.py --edition rust
    gjs -m extension/tests/gjs-smoke.js
    ./scripts/test-ipc.py
fi
if [ "$edition" != rust ]; then
    ./scripts/dev npm --prefix extension run build -- --edition gjs
    python3 scripts/check-build.py --edition gjs
    engine=gjs
    if [ "$edition" = all ]; then engine=both; fi
    ./scripts/test-calendar-parity.py --engine "$engine"
    for suite in worker io local-session weather system-network media calendar-feed preferences-data presentation; do
        ./scripts/test-public-backend.py --suite "$suite"
    done
    gjs -m tests/benchmark_io.js
fi
python3 -m unittest discover -s tests -p 'test_*.py'

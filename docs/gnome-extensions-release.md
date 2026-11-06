# GNOME Extensions release preparation

Status: **not submitted and not release-ready**. The owner has not selected the project license. The five-pair performance gate, full checks and clean packaged-install check passed. A passing local test is not GNOME Extensions approval.

The target is GNOME Shell **50**. The public UUID is `liquid-widgets@nyongcho.github.io`; the personal `liquid-widgets@local` installation and its service remain separate.

## Artifact and checks

```sh
./scripts/check.sh --edition all
python3 -m unittest discover -s tests -p 'test_*package.py'
python3 scripts/package.py --edition gjs
```

For local artifact verification without a license selection:

```sh
python3 scripts/package.py --edition gjs --development
LIQUID_GNOME_WORK=outputs/verification/public-package ./scripts/test-gnome.py --edition gjs \
  --package-zip dist/liquid-widgets-public-development/liquid-widgets.shell-extension.zip
```

The normal output is `dist/liquid-widgets-public/liquid-widgets.shell-extension.zip`. Packaging stops before building when `LICENSE` is absent. An explicit `--development` writes to `dist/liquid-widgets-public-development/` for local validation only; it does not grant a license or produce a submission candidate.

The ZIP policy permits readable extension/prefs/worker JavaScript, reachable generated worker chunks (including fixed timezone data), metadata, CSS, schema XML/compiled schema, GLSL and notices. It rejects surplus test output, private settings/calendar input, executable binaries, native libraries, installers, service units and Node runtime imports. It follows local JS imports to keep the calendar engine out of Shell/preferences and checks the Shell/GTK library boundary. The worker begins with `#!@GJS@ -m` and is launched explicitly with `gjs -m`.

`package.py --edition gjs` and `check.sh --edition gjs` do not invoke Cargo. Node/npm compile the source in the development environment; users install the ZIP through GNOME Extensions. No dependency installer runs during extension enable or preferences use.

These checks implement relevant requirements from the [official GNOME review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html), checked on 2026-11-07. The guidelines also require the maintainer to understand and justify submitted code; automation cannot establish that on the maintainer's behalf.

## Reviewer explanation: why a short-lived worker

The only spawned application worker computes a calendar result from already-fetched raw ICS. A prior actual-GNOME experiment found a sparse recurrence's single `next()` call occupied roughly 695–702ms even when parsing and iteration were otherwise divided into short turns. That synchronous call prevented Shell from painting; moving lightweight collectors into a daemon was unnecessary. See [the original experiment and frozen inputs](typescript-shell-feasibility.md).

The submitted architecture keeps weather, system/network, MPRIS, settings and transport in asynchronous GJS modules owned by the extension or preferences window. The recurrence engine and pinned timezone data are loaded only in the child. The child does not fetch URLs, query a keyring, install software or persist data.

Each parent has one active and one latest pending request. A child-owned private session bus name limits actual computation to one child across Shell and all preferences windows. The child enforces a nine-second internal deadline inside recurrence loops, the parent has a ten-second watchdog, cancellation kills and reaps the child, and no worker remains idle between requests. See [protocol and ownership](data-service.md).

Measured lifecycle checks include twenty cancel cycles, twenty real GTK preview windows, two-window slot contention, and twenty GNOME disable/enable cycles while preferences stay open. Parent SIGKILL tests observed child exit/reap at 0.051 seconds while waiting for input and 8.912 seconds during synchronous computation. Actual GTK descriptors were 44 → 44 and Shell descriptors 155 → 154. These are synthetic private-session tests; their detailed evidence and the paired frame/CPU/memory measurements are in [the performance report](typescript-performance.md).

## Data flow and deletion

| Data | Destination / storage |
| --- | --- |
| User-entered Google iCal URL | Secret Service under public application/source UUID; HTTPS requests go only to the validated Google Calendar host |
| Raw calendar and result | Private local calendar cache; worker stdin/stdout; no URL in worker arguments or environment |
| Selected city / coordinates | Local settings and Open-Meteo HTTPS geocoding/forecast requests |
| CPU/RAM/temperature/network | Local `/proc` and `/sys` reads; in-memory samples |
| Playing-track metadata | Local session MPRIS; title/artist stay local |
| Album art | MPRIS-provided local file or HTTPS download, bounded private image cache |

There is no telemetry, clipboard access, remote executable code download or privileged subprocess. Calendar titles and URLs are excluded from the small preferences status bridge. HTTP redirects and oversized decompressed responses are rejected. User-controlled errors are represented by fixed codes rather than raw server/secret contents.

Calendar disconnect disables the source first, removes its local caches and all public-namespace calendar secrets, and retains a deletion-pending state if cleanup fails. Users can retry from preferences while the extension is disabled. Uninstalling extension files alone does not clear private data; [setup instructions](setup.md) explain cleanup before removal. The Rust namespace is untouched.

## License and source publication

The project owner must select GPL-compatible terms and add the complete project `LICENSE`. MPL-2.0 ical.js modifications, original notices, patch and pinned file hashes are in `extension/vendor/ical/`. IANA input/generator/output provenance is in `extension/vendor/timezones/`. The ZIP carries the complete MPL/IANA/Ajv notices. See [third-party notices](../THIRD_PARTY_NOTICES.md).

Before a public submission, publish the exact matching source commit and retain the modified covered source under its license. This work does not push a branch, tag a release or upload to extensions.gnome.org.

## Remaining release evidence

- Owner-selected project license: pending.
- Final five-pair performance gate: PASS; 0/5 p95 regressions and 1/5 additional-stall pairs in each phase. All raw results are retained.
- Complete `check.sh --edition all`: PASS, including Rust fmt/clippy/test, 141 Node tests, 59 calendar cases per engine, nine native public suites and 26 Python tests. Real external-account Rust tests remain intentionally ignored.
- Exact development ZIP install/enable/collect/open production preferences/disable/uninstall in disposable GNOME 50: PASS, with no Rust service. Artifact SHA-256, logs and screenshots: [`outputs/verification/public-package`](../outputs/verification/public-package/).
- Personal Rust distribution build and separate UUID/ELF/service/installer: PASS. Installer preservation tests confirm personal removal leaves public settings and files untouched.
- `run_dispose()` audit: removed the private WallClock. Native reproduction showed its timer and timezone monitor survive `run_dispose()` until GC. The controller now borrows GNOME 50's date-menu clock and disconnects only its own listeners/timer; it never disposes the Shell-owned clock. This preserves immediate realtime/timezone notifications. Twenty retained controllers in each edition left no owned sources/listeners, and both clock-footer regressions passed. The GNOME private field is a version-specific integration point. See [GNOME 50 date menu](https://github.com/GNOME/gnome-shell/blob/gnome-50/js/ui/dateMenu.js) and [WallClock finalization](https://github.com/GNOME/gnome-desktop/blob/44.5/libgnome-desktop/gnome-wall-clock.c).
- Final whole-branch review after implementation: pending.
- Actual private Google account, external Open-Meteo requests and physical login/lock behavior: not represented by the synthetic public-edition tests. Prior personal Rust checks are identified separately in the feature documents.

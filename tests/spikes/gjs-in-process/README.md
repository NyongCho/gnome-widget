# GJS in-process feasibility spike — not production code

This experiment answers whether the current iCal contract can run inside GNOME Shell without a custom data process. It does not implement a complete backend or replace the installed extension. JS is used directly to measure the same GJS runtime that compiled TypeScript would use.

Run from the repository root:

```sh
python3 tests/spikes/gjs-in-process/run.py --shell
```

Omit `--shell` for standalone measurements only. Requirements match the existing development environment: project Rust/libical tools for the **test oracle only**, npm for the pinned `ical.js@2.2.1`, GJS, and the existing GNOME 50 Devkit harness/extension build for `--shell`. A completed command means reports were generated, **not** that the candidate passed the acceptance criteria.

- `make-cases.py` generates 34 synthetic cases from current fixtures and selected Rust regression inputs. `oracle` calls the current Rust engine; its existing 30 calendar tests were run independently before using it as a reference.
- `probe.js` adds small input/unsupported-rule guards, floating timezone assignment, source-local timezone setup, and a minimal incremental parser around public `ICAL.parse.property`. It deliberately leaves upstream time/recurrence semantics visible. It is not hardened against every malformed property/component.
- `run.js` checks semantic output and parser tree parity, then alternates synchronous/cooperative processing five times per workload. Cooperative parsing has a 2ms target; loops yield after up to 128 iterations. Single library calls remain synchronous. Error comparisons check rejection, not exact error-code parity.
- `shell.js` uses the current seven-card UI with synthetic states in a private GNOME Shell. It stops that test extension's Rust client, imports the probe **inside the Shell process**, and measures GLib 5ms heartbeat gaps and Clutter animation-frame intervals. It starts no custom data service. The normal GNOME test environment may start its own desktop services.
- `single-calls.py` confines potentially nonterminating inputs to disposable standalone GJS processes with a 4-second external timeout. They never run on the logged-in desktop Shell. The sparse-but-finite `next()` workload also runs in the nested Shell with an UNTIL bound.

Only three timezone definitions are seeded for this probe. The `zones/` files were exported on 2026-11-06 from local **libical 3.0.20 / system tzdata** via `icaltimezone_get_builtin_timezone`, `icaltimezone_get_component`, and `icalcomponent_as_ical_string`; their TZID property was set to the corresponding IANA name. They contain timezone facts, not personal calendar data. This is test provenance, **not a finished IANA data packaging strategy**. Production requires pinned full timezone data and the relevant notices.

`results/` is ignored and contains synthetic raw reports and transient harness logs. The reviewed measurements are retained under `outputs/verification/gjs-in-process/`. The root `docs/typescript-shell-feasibility.md` records the verdict and limits. No network feed, actual keyring secret, location setting, or logged-in calendar is used.

Limits: partial adapter, sampled fixtures rather than full Rust-suite translation, no live API/Secret integration, no complete provider scheduling or prefs integration, and no full data-to-UI update benchmark. The end-to-end calendar workload measures parse+expansion, not JSON validation/rendering. The pathological recurrence cases already disprove safe drop-in use even without those additional stages.

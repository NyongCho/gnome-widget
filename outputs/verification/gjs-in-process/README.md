# Shell-internal GJS feasibility evidence

2026-11-06; source baseline `8b3b81f`; experiment source is committed alongside this evidence.

- Environment: Ubuntu 26.04, Intel Core i7-12700F / 20 logical CPUs, GNOME Shell 50.1, GJS 1.88.0, ical.js 2.2.1, libical 3.0.20-2build1, tzdata 2026e-0ubuntu0.26.04.1.
- `shell.json`: actual nested GNOME Shell, existing widget UI with synthetic states, no custom data service. Five alternating sync/cooperative trials per workload. `maxFrameGapMs` is a Clutter animation callback interval, **not** GPU paint duration. No row has an empty frame sample.
- `standalone.json`: 34 selected synthetic semantic cases against the current Rust engine, parser tree comparisons, and standalone GJS heartbeat measurements. No personal events. 26 cases matched; error cases compare rejection rather than error-code identity. 33 parseable trees matched, one original-parser error skipped.
- `single-call.json`: disposable GJS process probes. One input exceeded an externally enforced four-second timeout; this is not proof of an infinite loop. Sparse-rule `next()` calls exceeded a normal frame budget even with an UNTIL bound in the Shell workload.
- `oracle.jsonl`: Rust results on the same generated synthetic cases. The existing Rust calendar test target independently passed all 30 tests.

Reports were produced serially with `python3 tests/spikes/gjs-in-process/run.py --shell`. Exit 0 confirms the experiment completed, not that the candidate met requirements. Temporary logs, test extension archives, private D-Bus/XDG files and node_modules are not included. The test Shell/viewer and timeout probes exited after the run. The logged-in desktop and installed Rust extension were not replaced.

Read [the verdict and limitations](../../../docs/typescript-shell-feasibility.md) before interpreting these measurements. This is a failed drop-in feasibility gate, not a production TS backend or a benchmark of every provider.

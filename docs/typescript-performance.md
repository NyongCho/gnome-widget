# TypeScript edition responsiveness and lifecycle

The full five-pair measurement passed the declared comparative gate. Smoke runs are not release evidence.

## Measurement protocol

`scripts/benchmark-editions.py --runs 5 --output outputs/verification/edition-performance` alternates the two editions, reversing order in each pair. Each disposable GNOME 50 session uses the same 1280×800 output, fixed wallpaper, seven-card layout at 0.75 scale, digital clock, English labels, dark theme, glass settings and continuously moving foreground actor. The power profile is recorded and the run aborts if it changes. The Rust fixture executable uses an optimized release build.

There are 30 seconds of warmup, 120 seconds with only the clock visible, and 120 seconds with all cards visible. Four calendar requests occur at 10, 35, 60 and 85 seconds of the all-card phase:

| Input | Components / visible results | Purpose |
| --- | --- | --- |
| `1k` | 1,000 / 1,000 | Ordinary large calendar and UI update |
| `10k` | 10,000 / 1,000 | Large parse with most components outside the visible window |
| `5mib` | One event, exactly 5 MiB | Maximum raw input with a long ignored description |
| `sparse` | One sparse SECONDLY recurrence / zero visible events | Long internal recurrence search |

A 10,000-event *result* exceeds the fixed 512 KiB wire limit. Its rejection is tested in the protocol suite; the successful 10k workload above does not silently increase that limit or discard in-range events.

Both editions run their production providers, scheduling, validation, caches and shared renderer. The Rust development example injects synthetic HTTP and secrets into the actual server. The public test helper injects the same bytes at the existing provider I/O boundary. Local system/network collectors remain real and a private synthetic MPRIS player keeps the media card visible. External network latency and real keyring access are excluded from this comparison and tested separately. The fixture executable and helpers are never part of the public package.

Frame measurements use intervals between consecutive GNOME `clutter.stagePaintStart` timestamps, not the duration of a paint callback. Raw timestamps are retained. Update latency ends at the first compositor paint start after the DTO reaches WidgetHost, so it includes collection, child startup/computation/framing, reply validation, cache writes, state publication and UI application. It is not a GPU fence or display scanout measurement. Cold update measures the first configured calendar request in the fresh data session, rather than GNOME process startup.

CPU is the sum of Shell user/system CPU, reaped child CPU, and the live Rust service CPU; 100% means one logical CPU. An external sampler reads PSS/RSS every 50ms for Shell, Rust and live calendar children. Reported peaks are sampled peaks, which can miss shorter transients. The sampler's CPU is outside the reported application total and its overhead is common to both editions. Memory records include Shell's increase over its idle minimum, service/worker peaks and simultaneous combined peaks. Monotonic phase bounds exclude the transition between idle and all cards from both measurements.

For each phase, release is held if at least three of five pairs show either additional intervals above 50ms, or a p95 increase of at least `max(2ms, 10% of Rust p95)`. Successful workloads must stay below the 9-second worker execution budget. Idle compute children must remain zero.

## Five-pair result (2026-11-07)

**PASS** under the predeclared responsiveness gate. No pair exceeded the p95 regression threshold in either phase. Public had additional >50ms intervals in 1/5 idle pairs and 1/5 all-card pairs; the hold threshold is 3/5. This is a comparative gate, not a claim of zero jank. All successful updates completed below nine seconds; every idle phase had zero calendar children, and active public phases had at most one.

Measured system: GNOME Shell 50.1 / GJS 1.88.0, Linux 7.0.0-42-generic, Intel i7-12700F, NVIDIA RTX 3080 (595.99.02), 1280×800. Power profile stayed `performance`; the recorded intel_pstate governor was `powersave`.

| Pair | Idle p95 Rust / public (ms) | All p95 Rust / public (ms) | Idle >50ms Rust / public | All >50ms Rust / public |
| --- | --- | --- | --- | --- |
| 1 | 19.180 / 19.315 | 19.546 / 19.779 | 0 / 0 | 0 / 0 |
| 2 | 19.330 / 19.351 | 19.908 / 19.596 | 0 / 0 | 0 / 3 |
| 3 | 19.333 / 19.345 | 19.618 / 19.711 | 0 / 0 | 0 / 0 |
| 4 | 19.815 / 20.093 | 21.435 / 20.186 | 1 / 1 | 3 / 0 |
| 5 | 19.704 / 19.612 | 20.077 / 19.644 | 0 / 3 | 2 / 0 |

Medians below summarize five runs; brackets show the full min–max range. MiB uses 1,024 KiB.

| Metric | Rust reference | Public GJS |
| --- | --- | --- |
| Idle p99 (ms) | 32.17 [32.16–32.18] | 32.17 [32.15–32.19] |
| All p99 (ms) | 32.19 [32.18–32.22] | 32.20 [32.17–32.22] |
| Idle total CPU (%) | 2.25 [1.86–2.58] | 2.24 [2.12–2.55] |
| All total CPU (%) | 6.49 [6.21–7.23] | 5.74 [5.68–5.83] |
| All combined peak PSS (MiB) | 319.91 [319.36–323.53] | 341.52 [331.91–343.12] |
| All combined peak RSS (MiB) | 465.31 [464.60–468.98] | 502.81 [492.90–504.62] |
| Shell peak PSS increase over idle (MiB) | 9.31 [6.81–10.51] | 22.16 [21.74–27.68] |
| Shell peak RSS increase over idle (MiB) | 9.32 [6.73–10.29] | 22.16 [21.72–27.62] |
| Service / worker peak PSS (MiB) | 65.42 [62.88–66.37] | 81.64 [69.70–82.96] |
| Service / worker peak RSS (MiB) | 71.37 [70.74–74.23] | 104.71 [92.60–105.90] |
| Cold update (ms) | 283.19 [258.70–315.77] | 281.48 [269.05–302.57] |
| 1k refresh to first paint (ms) | 46.55 [44.19–49.49] | 178.85 [174.93–193.52] |
| 10k refresh to first paint (ms) | 135.89 [130.24–138.17] | 298.22 [286.78–301.99] |
| 5mib refresh to first paint (ms) | 2670.73 [2451.17–2776.36] | 180.91 [178.80–187.67] |
| sparse refresh to first paint (ms) | 1251.51 [1247.72–1256.91] | 2273.12 [2255.38–2308.05] |

The public edition used less total CPU in this workload, but had higher transient memory and slower normal/sparse calendar updates. Its single-description 5 MiB input was faster than the Rust reference. These results are workload-specific and do not imply that either language is always faster. Shell and service shared-page accounting varies as other processes start; sampled PSS is not a fixed allocation counter.

The public pair-2 all-card gaps occurred at approximately 33.75, 43.75 and 103.75 seconds, away from calendar request/publication boundaries. Public pair 5 also had three idle gaps. Rust pair 4 had one idle and three all-card gaps; pair 5 had two all-card gaps. All are retained. Their cause is not established by these data.

Raw timestamps, memory samples, synthetic input bytes, environment hashes and failed pre-measurement startup logs are in [`outputs/verification/edition-performance`](../outputs/verification/edition-performance/). Built test ZIPs, logs, and files over 20 KiB with JSON/ICS content are losslessly gzip-compressed; read them with `gzip -cd` or Python `gzip.open`. `gate.json` and `environment.json` remain plain. `results.json.gz` contains the complete ten-trial measurements, not just this table.

## Lifecycle and correctness gates

On 2026-11-07:

- Calendar semantics: Rust 59/59 and GJS 59/59 cases passed, including internal-loop deadline checks.
- Worker framing/limits, slow/oversized stdout, serial reuse, contention and twenty cancel cycles passed. Normal cancellation remains below one second. With a SIGKILLed parent, input-phase child exit/reap took 0.051 seconds and synchronous-compute exit/reap took 8.912 seconds, within the eleven-second bound.
- Twenty native local sessions left no source/watch/timer/descriptor growth.
- Twenty real GTK preview windows opened and closed with descriptor count 44 → 44. Two windows contended for the same computation slot, and the waiter completed after the first window closed.
- Twenty actual GNOME disable/enable cycles with the production GTK window kept open reattached to new sessions and released the old resources. Shell descriptor count was 155 → 154.

These are separate from the longer paired frame measurements; they are not inferred from a process being absent in a single screenshot.

## Optimization found during measurement

The first smoke run showed gaps at large calendar refreshes. A native GJS regression isolated repeated `Intl.DateTimeFormat` construction inside agenda selection: combined agenda/calendar-dot computation for 1,000 events took a 27.783ms median. Reusing one formatter for the current selection reduced that median to 6.108ms. The formatter is local to the call, so timezone changes cannot reuse another zone's formatter. The existing nine agenda/calendar-format tests still pass. Both editions receive this shared rendering improvement.

Periodic system/network sampling also used to publish a temporary loading state every two seconds, unlike the Rust service. The loading footer changed card heights and invalidated glass backgrounds. Two regressions now require keeping the complete sample until its replacement or failure arrives. Initial/source-change loading and calendar/weather progress remain. The native benchmark rejects these transient nonempty loading states during its all-card phase. Full Node coverage is 141/141 after this fix.

The benchmark fixture selector also needed a correction: synchronous `GLib.file_set_contents` can fsync an existing file and block Shell itself. Instrumentation recorded 12–13ms selector writes in a short run; an earlier long attempt showed four gaps straddling selection, before the timed provider request. Those partial runs are excluded. The selector now uses asynchronous GIO replacement, with a real main-loop regression that fails for synchronous replacement and passes for the asynchronous implementation. See [GLib's blocking-I/O guidance](https://docs.gtk.org/glib/func.file_set_contents_full.html). All production-provider work remains inside the measurement.

Two Rust trials failed during initial preparation, before any measured phase. Calendar expansion used immediate slot acquisition while CPU/network shared the same two blocking-worker slots, so startup could return `SERVICE_UNAVAILABLE` until the next collection. A deterministic occupied-slot test reproduced this failure. Expansion now uses the existing cancellable wait-for-slot path; all Rust tests pass. The comparison deliberately retains the **pre-fix Rust release binary** for every measured trial. It does not mix the repaired executable into the remaining samples. The resumed sequence verifies runtime hashes and environment, accepts only a completed alternating prefix, and refuses to replace any trial that already contains measured phases. Failed startup logs are retained. Hashes were recorded while paused after checking that the built runtime and harness were unchanged across the first seven completed trials.

## Reproduction commands

```sh
CARGO_TARGET_DIR=/path/to/rust-target ./scripts/benchmark-editions.py --runs 5 \
  --output outputs/verification/edition-performance
./scripts/test-public-backend.py --suite worker
./scripts/test-public-backend.py --suite local-session
./scripts/test-public-backend.py --suite preferences-data
./scripts/test-public-backend.py --suite presentation
LIQUID_LIFECYCLE_CYCLES=20 ./scripts/test-gnome.py --edition gjs --editions
./scripts/test-calendar-parity.py --engine both
python3 -m unittest discover -s tests -p test_edition_benchmark.py
gjs -m tests/benchmark_io.js
```

`--smoke --runs 1` uses one-second warmup and 28-second phases. Its report always sets `releaseEligibleRuns: false`. Run the long measurement without other benchmarks/builds and keep the desktop/power state stable.

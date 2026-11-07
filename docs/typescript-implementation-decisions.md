# TypeScript implementation decisions and review record

This preserves every implementation ruling in chronological order, including its reason and practical cost if the assumption is wrong. The binding requirements remain in [the design](superpowers/specs/2026-11-06-typescript-edition-design.md). Performance evidence is in [the measurement report](typescript-performance.md); packaging and distribution conditions are in [the release notes](gnome-extensions-release.md).

## Rulings made during implementation

1. Ruling: use native managed worktree and branch codex/typescript-public — accepted plan requests isolation and current untracked research must stay untouched — final deliverable lives in the returned workspace until integration.
   Cost / limitation: The work stays on a separate branch until the owner integrates it.

2. Ruling: reuse existing ignored development toolchain via .tools symlink and Rust target cache, install an independent extension node_modules — avoids duplicating tools without modifying installed widgets — artifact builds must still prove no Rust runtime requirement.
   Cost / limitation: The development environment is machine-specific; a clean machine must install the documented build dependencies.

3. Task 1 Ruling: source-fixed IANA 2026e via upstream vzic workflow with --pure and explicit aliases; strip LAST-MODIFIED for deterministic data — Outlook compatibility conversion knowingly changes facts — generator is build-only and adds no public runtime binary. All 597 source Zone/Link names are present.
   Cost / limitation: Zone generation mistakes could shift recurring events; pinned provenance and DST fixtures bound this risk.

4. Task 1 Ruling: preserve full IANA alias support required by the design even where current libical rejects US/Eastern — recorded one engine-specific literal expectation instead of pretending parity — public edition accepts this valid alias beyond the old service's accepted identifiers.
   Cost / limitation: The engines intentionally differ for a libical-rejected alias; consumers must not treat rejection parity as universal.

5. Task 1 Ruling: separate GJS test type environment from Node test glob — their runtime globals and GI imports differ — all environments remain independently typechecked.
   Cost / limitation: An environment-specific typing error could escape a single test runner; all five typecheck environments remain required.

6. Task 1 Ruling: vendored ical.js source has narrow budget hooks; original upstream npm ci lock was inconsistent, so development-only upstream tests used npm install in ignored scratch — no dependency updates shipped beyond pinned ical.js 2.2.1; upstream test tooling is not a public runtime dependency.
   Cost / limitation: Upstream test-tool resolution is not perfectly reproducible from its original lock; shipped library source and hashes remain pinned.

7. Task 2 Ruling: add calendar/streams.ts to share bounded framed I/O between parent and worker — avoids divergent limit/UTF-8 handling and permits direct stream boundary tests — additional internal module only.
   Cost / limitation: A shared stream bug could affect both framing sides; native boundary and malformed-input tests are required.

8. Task 3 Ruling: add pure shared/buildPolicy.ts so UI dependency isolation is testable without GI/runtime stubs — it is build-only and uses no platform imports — adds one internal policy module. Task 3 public artifacts are staging builds; public factory is intentionally guarded until Task 5 and UI wiring lands in Task 11, never deployed in this state.
   Cost / limitation: A dependency-isolation policy error could load recurrence work in Shell; emitted graph and package checks remain required.

9. Task 4 Ruling: add pure data/errors.ts and GIO data/async.ts helpers — fixed public error codes and total operation deadlines are shared across file/HTTP/Secret adapters — extra internal modules without new runtime binaries. Private file operations have a 5-second total deadline to bound filesystem stalls.
   Cost / limitation: Very slow local storage may surface a bounded I/O failure rather than complete; fixed public codes preserve privacy.

10. Task 4 Ruling: Secret Item.create/delete can run prompts (official libsecret docs), so keep lazy Secret.Service encrypted session/search but use raw CreateItem/Delete D-Bus calls and reject returned prompts without executing them — enforces no-prompt behavior even if collection locks between checks — test against isolated real keyring.
   Cost / limitation: A locked or unusual Secret Service can refuse noninteractive writes; the UI reports failure and requires the user to unlock it.

11. Task 4 Ruling: split pure IO interfaces into data/contracts.ts — Node business-logic tests must not load or typecheck GI runtime implementations — the GJS implementations re-export their contracts. Pin Secret/Soup typings to 4.9.0 to match the existing GNOME Shell 50 typings; 5.6 introduced duplicate incompatible base GObject/Gio declarations.
   Cost / limitation: Typings can lag runtime APIs; actual GJS integration checks remain the compatibility authority.

12. Task 5 Ruling: add data/runtime.ts as the GI composition point and data-env.d.ts for GI typing — scheduler/state/session remain pure and directly testable, while Shell and prefs share the same concrete services — runtime providers are intentionally wired in Tasks 6–9 before any deployment. Signal providers use the Task 8 start(publish,cancel) interface and are not polled.
   Cost / limitation: A composition error can affect both Shell and preferences; their separate runtime ownership is exercised natively.

13. Task 5 Ruling: extend files.ts fix into this task — real config watch revealed unconditional chmod on every read feeding its own monitor, 15,516 reads in 1.2s and missed new source. Only chmod when mode differs and only notify for settings.json changes — avoids idle I/O storms; real GJS regression preserves read-with-watch and source-switch behavior.
   Cost / limitation: Unexpected monitor events could miss a configuration update; actual write/watch and one-read idle regressions cover the observed loop.

14. Task 6 Ruling: expose searchLocations(query,cancel) on an injected LocationSearch instance — one in-flight request and throttle belong to each Shell/prefs session, not module-global networking state — preferences keeps the exact two-argument public API; no HTTP call during import.
   Cost / limitation: Two independent preferences windows each have their own search throttle; this is not a global service-rate limiter.

15. Task 6 Ruling: fix shared HTTP status access — real GJS/Soup 429 test returned NETWORK_ERROR; direct probe proved get_status throws “429 is not a valid value for enumeration Status” while status_code returns 429 — use the uint property, preserving real HTTP codes outside the Soup enum. The real weather fixture is the regression test.
   Cost / limitation: Future Soup changes can alter status access; the actual 429 fixture must remain valid.

16. Task 7 Ruling: add read-only data/linux.ts and LinuxFiles contract rather than reuse private config files — proc/sysfs must never have modes changed; hardware directory symlinks are legitimate — bounded regular-file reads and directory enumeration use Gio, 2s IO deadline, 64 hwmon devices/256 entries per device/4 parallel device jobs, 128 listed interfaces, and an optional 1.5s temperature deadline.
   Cost / limitation: Unusually large hardware inventories or slow sensors may omit optional temperature; system/network reads stay bounded.

17. Task 7 Ruling: sampler stop resets the baseline, and interface source IDs encode the selection into schema-safe hex — real GJS network state failed existing sourceId validation on the colon, and hiding/reopening needs a null first rate — keeps DTO v1 unchanged. Settings reject interface names outside the same 15-byte ASCII kernel-name policy as the existing Rust reader; hardware aliases remain selectable.
   Cost / limitation: Nonstandard interface names outside the existing policy are not selectable; hiding/reopening deliberately discards the first rate sample.

18. Task 8 Ruling: pure MediaProvider and ArtworkLoader use separate Gio adapters (mpris.ts/artworkFiles.ts), with an ArtworkCache bus lease around disk work only — shares lifecycle-tested logic across Node/GJS, prevents a new session pruning an old session’s live temporary file, and leaves the config lock free of artwork traffic — stricter local file policy rejects final symlinks as abnormal files; an explicit real file remains supported.
   Cost / limitation: Artwork represented only by a symlink is refused; users retain the track details and placeholder artwork.

19. Task 8 Ruling: extract the existing asynchronous GdkPixbuf scaling into widgets/artworkDecode.ts, shared by the real widget and GJS tests — verifies actual 16:9/square decoding without importing St into data code — renderer still owns its cancellable and discards results after actor destruction.
   Cost / limitation: Image decode failures retain fallback artwork; pending results must never target destroyed actors.

20. Task 9 Ruling: re-read config revision under the mutation lock and fence calendar writes by enabled/source UUID; accept an unrelated weather/network revision — every calendar URL replacement already creates a fresh UUID, while rejecting unrelated edits would leave a valid calendar job canceled without a scheduler restart — same-source data remains safe and no extra HTTP is triggered by unrelated settings.
   Cost / limitation: If source UUIDs were reused in a future mutation path, stale results could be accepted; every replacement must create a fresh UUID.

21. Task 9 Ruling: raw cache metadata carries SHA-256 and is bounded at 16 KiB; parsed cache is independently schema-checked — separate atomic files can be interrupted between renames, and a digest prevents mixed raw/timestamp pairs from being recomputed — one bounded native checksum is added per fresh write/cache read; Task 12 measures its Shell impact. Preview shares this provider with writeCache=false and retains data only in its own memory.
   Cost / limitation: Checksum work costs one bounded pass over raw ICS; torn cache files are discarded rather than trusted.

22. Task 9 Ruling: make the existing bus/worker CancelledError extend the common DataCancelled — real overlapping worker test returned SERVICE_UNAVAILABLE and could start a stale-cache computation after supersession — cancellation must cross the adapter boundary without being converted into a provider failure; existing public message and worker API are unchanged.
   Cost / limitation: Incorrect cancellation classification could hide a real failure or start fallback work; supersession tests distinguish them.

23. Task 10 Ruling: Status1 watch tokens are UUID strings (WatchCalendar returns (ss)) — unique Shell bus owner can remain the same across disable/enable, so counters restarted at 1 could let a late old Unwatch remove a new subscription — UUID tokens avoid cross-instance reuse; the existing Rust D-Bus contract stays unchanged. Token capacity includes pending registrations to bound sender-disappearance races.
   Cost / limitation: A client retaining an obsolete token cannot cancel a new subscription; capacity limits may reject excessive windows.

24. Task 10 Ruling: expose async listNetworkInterfaces on PreferencesDataSession as well as the listed methods — the plan explicitly removes the synchronous /sys enumeration from GTK, so both adapters must own its cancellation — one additive internal API, no Rust D-Bus change.
   Cost / limitation: Adding this internal interface requires both adapters to keep cancellation behavior consistent.

25. Task 10 Ruling: keep calendar status core/registry/client separate from Gio bridge/transport, and implement a window-owned read-only preview session with a 60s local day/timezone check plus the normal 300s collection interval — no Shell clock import into GTK and no periodic worker when the window is gone — at most one cheap additional timer per active preview. Summary validation reuses existing DTO state invariants without materializing event contents.
   Cost / limitation: An off-Shell preview may notice a local day/timezone change up to 60 seconds later; no preview timer survives window closure.

26. Task 10 Ruling: extend the private test harness to isolate XDG_RUNTIME_DIR and GNOME_KEYRING_CONTROL while using an absolute outer Wayland socket — GTK/Adwaita can activate portal helpers on the private bus, which must never discover the live keyring control socket — portal/PipeWire warnings are test-environment limitations, not application failures; private FUSE mounts are rechecked after optional unmount to handle shutdown races.
   Cost / limitation: Test portals still emit isolated-session warnings and use the outer PipeWire server for display; live secrets/settings remain isolated.

27. Task 11 Ruling: add a build-only --tests switch for public GNOME fixture bundles and let test-gnome.py select edition metadata/UUID/schema/output — production public builds remain fixture-free and default Rust behavior is preserved — integration artifacts use LIQUID_GNOME_WORK under this plan workspace rather than writing to the older plan’s workspace.
   Cost / limitation: A test build is unsuitable for distribution; the public package policy rejects every surplus fixture.

28. Task 11 Ruling: allow an optional PreferencesDataSession injection into fillSettingsWindow for the real GTK fixture — tests drive production controls and the actual public adapter/worker while replacing only HTTP and Secret with synthetic endpoints — production defaults still create exactly one window-owned session; no user keyring/network feed is used.
   Cost / limitation: Test injection must stay optional and preserve the default per-window session; actual production preferences are separately exercised.

29. Task 11 Ruling: destroy rather than stop detached data sessions in visual fixtures, and test public provider failure separately from Rust daemon owner loss — public has no daemon owner to lose, and stop intentionally preserves configuration/status ownership — fixture assertions retain the same rendered UI behavior while lifecycle suites verify live cleanup.
   Cost / limitation: Visual fixtures do not simulate a nonexistent public daemon; separate lifecycle tests must cover real public failures.

30. Task 11 Ruling: wait for three consecutive stable 100ms wallpaper samples (bounded at 3s) before the compact fixture's clock-only cache assertion — repeated failure had identical card geometry but 9 input/18 blur paints in 150ms during the native light/dark background crossfade — demanding cache reuse during a content animation contradicts the dynamic-wallpaper requirement; the test still fails if input never settles or a subsequent tick invalidates it.
   Cost / limitation: Waiting for background animation completion excludes its expected redraws from the cache-reuse assertion; a bounded timeout still rejects nonsettling input.

31. Task 11 Ruling: reuse the same bounded material-settle helper before the analog clock cache assertion — Rust reproduced the identical native theme-crossfade/cache precondition failure, while public had passed depending on capture timing — no production rendering behavior changes; both fixtures now test after content animations settle.
   Cost / limitation: The analog cache assertion has the same bounded settle precondition; animation-time redraws are not treated as a regression.

32. Task 12 Ruling: benchmark the actual production Rust providers/server through a release-only development example with synthetic HTTP/Secret adapters, and inject the same fixture bytes at the public provider IO boundary — isolates network/account variability while including actual scheduling, worker/framing, validation, cache serialization, D-Bus/store and rendered UI — absolute latency excludes real external network and keyring costs. The fixture executable is never packaged.
   Cost / limitation: Reported calendar latency excludes real network/keyring delay; absolute end-to-end Internet performance is unmeasured.

33. Task 12 Ruling: the 10k input has 10,000 components but only 1,000 events in the display window — 10,000 serialized result events necessarily violate the unchanged 512 KiB reply limit — this measures large-input parsing successfully while existing protocol tests separately verify oversize-result rejection. Exact 5 MiB and sparse recurrence remain successful fixtures.
   Cost / limitation: The successful 10k-input benchmark is not a successful 10k-visible-result benchmark; the fixed reply limit still rejects excessive output.

34. Task 12 Ruling: retain the last system/network state while a periodic sample is in flight, and publish its result or failure on completion — inspection during the first long run found public emits loading every 2s while Rust retains the complete state; loading adds/removes a footer, forcing layout/material work and risking visible flicker — initial/source-change loading, calendar/weather progress and stale/error results remain. Two scheduler regressions reproduced the transient state/UI publication RED before the change. Aborted the first long-run attempt early; its incomplete measurements are not release evidence.
   Cost / limitation: The previous sample remains visible during collection; it is replaced by success or marked stale on failure rather than hidden by a loading footer.

35. Task 12 Ruling: replace the benchmark selector through asynchronous Gio.replace_contents_bytes_async — synchronous existing-file GLib writes may fsync, contaminating compositor intervals before the provider request; instrumented short run showed 12.784–13.051ms blocking writes — removes test-induced disk blocking only, retains all actual provider/cache/UI work and first-paint latency. Native main-loop regression fails with synchronous selector and passes with async replacement; 4 Python measurement tests PASS. First probe used a stale sparse selection and failed the cold fixture assertion, then reran with 1k to obtain the timing evidence.
   Cost / limitation: The selector correction excludes harness fsync overhead only; all real provider/cache work stays measured.

36. Task 13 Ruling: prepare packaging policy/tests/docs while the fixed-artifact benchmark runs — these files cannot change the measured runtime, and waiting ~45 minutes would add avoidable idle time — no builds, native suites or heavy checks during measurements; Task 12 completion/commit and all release gates still precede packaging validation/commit. Task 13 base includes Task 12 range because preparation overlaps; final file-scoped commits remain separate.
   Cost / limitation: Concurrent preparation could contaminate performance if runtime files or heavy workloads changed; hashes and the no-build rule protect these trials.

37. Task 13 Ruling: an unanswered license choice blocks public distribution readiness, not implementation/validation — the binding design explicitly says license selection does not block implementation or testing and the task says not to mark release-ready if absent — finish independent code checks and validate an explicitly labeled development ZIP; never invent owner consent, add an unchosen LICENSE, claim submission readiness or upload it. The normal public package command remains fail-closed until LICENSE exists. Report this remaining owner decision clearly.
   Cost / limitation: Implementation is complete without legal release permission; normal public packaging/submission remains blocked until an owner-selected license exists.

38. Task 12 Ruling: retain the existing pre-fix Rust release binary as the comparison reference and resume only unfinished pre-measurement trials — preserves the seven already completed alternating trials and their real gaps without mixing measured binaries or selecting favorable measurements; the personal Rust startup bug is separately fixed/tested — document that the reference predates this admission fix, and keep startup-failure logs. --resume requires --skip-build, exact runtime/environment hashes and a completed alternating prefix; it refuses to replace a trial containing measured phases. Hashes were pinned while paused after verifying no runtime/build changes occurred during the seven completed runs. Five resume/order measurement unit tests PASS.
   Cost / limitation: The measured Rust reference predates its startup admission fix; results compare runtime workloads, not a post-fix cold-start reliability claim.

39. Task 13 Ruling: replace the proposed standalone timezone monitor with a borrowed GNOME 50 date-menu WallClock — native ownership probe proves private WallClock disposal is insufficient, while a plain minute timer loses immediate realtime-clock changes; the Shell-owned clock preserves timezone/realtime signals without new native resources — disconnect only extension listeners, never dispose the shared clock. Targeted GNOME 50 API dependency is documented and tested; another extension replacing the date-menu internals could require adaptation.
   Cost / limitation: Another extension replacing GNOME 50 date-menu internals could break the borrowed clock; support is intentionally limited to the tested GNOME version.

40. Task 13 Ruling: parse emitted imports with the existing esbuild compiler rather than regular expressions — actual Ajv bundles retain require(...) inside non-executable helper metadata, and regex lexing mistakes quotes in regular expressions — a regression accepts literals/comments while real Node/GI/cross-entry imports remain rejected. No new runtime or development dependency is added. TypeScript 7 package has no legacy JS compiler API, so use already-installed esbuild input metadata; parser helper stays outside the ZIP.
   Cost / limitation: Artifact import policy relies on the pinned build parser; readable bundles and explicit package allowlists are still required.

41. Final: Ruling: deletion-pending settings changes invalidate the existing calendar status notification, and preferences reload settings on each accepted summary. A separate settings subscription would duplicate an existing window-owned channel; collector source identity stays unchanged, so no calendar computation is restarted.
   Cost / limitation: each calendar status update can cause a small settings read. The summary remains content-private and its wire schema is unchanged. Native GTK, two-window integration and session tests cover both sides.

## Final review

An independent `gpt-6-astra` reviewer inspected the whole branch from `d641dc7` to `15f4af2`, in several passes, without modifying the checkout. The reviewer reran 54 targeted Node tests, verified every pinned vendor hash and independently recomputed all ten frame summaries and the five-pair PASS gate. No Critical finding was reported; three Important findings were accepted based on their user-visible effects. Nothing was declined as outside the spec.

| Finding | Correction and regression |
| --- | --- |
| Initial read or monitor failure permanently prevented recovery | A cancellable initialization retry uses 1s exponential backoff capped at 30s. Read and monitor failures recover; healthy sessions have no retry timer; destruction cancels recovery. The production session regression failed before the fix and passes after it. |
| An old settings snapshot or error overwrote a newer connection | GTK settings loads carry a request epoch, also invalidated at mutation start. Only the latest response may change success/failure state. Real GTK regressions reproduced both reversed outcomes before the fix and pass after it. |
| Cleanup warnings stayed stale in another window when source ID did not change | Pending-flag changes emit settings invalidation through the existing status channel without restarting the collector. GTK reloads even for the same source. Session and GTK regressions failed before the fix; two actual public preferences sessions now observe failed cleanup and successful same-null-source retry. |

The final `check.sh --edition all` passed: Rust fmt/clippy/test and actual IPC, 143 Node tests, both 59-case calendar engines, nine native public suites and 26 Python tests. The rebuilt development ZIP installed, enabled, collected local data, opened production GTK preferences, disabled and uninstalled on disposable GNOME 50 without a Rust service. The personal Rust distribution rebuilt successfully. [Final logs, artifact hash and screenshot](../outputs/verification/public-package-final/) are retained. No second reviewer is used for this fix pass; regressions and the complete suite verify the corrections.

## Deferred minors

The implementation-plan checkboxes for Tasks 8–11 lag the completed commits and evidence. This documentation reconciliation is deferred. At the final implementation review, the owner-license item was deliberately pending; the later owner decision below resolves it. No implementation feature is deferred by this finding.

## License decision after implementation — 2026-11-07

The owner explicitly selected GPL-3.0-or-later. The repository now includes the version-3-or-later grant and complete GPLv3 text in `LICENSE`; npm and Cargo package metadata carry the same SPDX identifier. Third-party source, patches and notices retain their original licenses. This resolves the license-selection gate recorded in ruling 37 without changing the historical development-ZIP evidence. Normal public packaging includes the project license. Publishing the matching source commit and submitting to GNOME Extensions remain separate actions.

# 구현 중 결정과 남은 경미한 사항

단계별 기록을 시간순으로 보존한다. 초기 단계에서 미룬 사항은 후속 검증 기록과 함께 읽는다. 현재 사용자 단계와 최종 결과는 [검증 기록](verification.md)에 있다.

## 결정 기록

- Ruling: preserve /home/nyong/projet/gnome-widget as requested; this was a new directory with no repository or other code, so initialize a dedicated codex/task-0-contract-calendar branch in place instead of relocating into a worktree — no existing implementation branch is exposed.

- Ruling: Git identity is not configured. Use command-local Codex <codex@localhost> attribution for local checkpoints; do not change the user's global or repository identity.

- Ruling: sudo requires interactive authentication. Prepare development tools under ignored .tools using official downloads and Ubuntu package extraction, without modifying shell profiles or system packages.

- Task 0: Ruling: select libical 3.0.20 via a narrow native adapter after executable ical/rrule probes; pure Rust rrule cannot resolve arbitrary VTIMEZONE. Cost: native build/runtime dependency; does not change the Rust service/TypeScript UI architecture.

- Task 0: Ruling: reject RANGE=THISANDFUTURE, EXRULE, PERIOD RDATE and conflicting duplicate components explicitly in the first engine. Cost: those calendars become unsupported/stale rather than partially displayed; actual Google feed compatibility remains Task 4.

- Task 0: Ruling: iterator budget and native query horizon bound expansion, but do not promise a hard native-call CPU deadline. Task 2 must isolate work from the async executor; a hard kill deadline needs a process boundary.

- Final: Ruling: review set aside Task 1+ UI/input/lifecycle/privacy and service/cache/keyring/account/install behavior — these remain explicit later milestones; Task 0 does not claim runtime acceptance. Cost if mistaken: source tests alone cannot establish desktop safety/usability.

- Final: Ruling: focused review is not sanitizer/fuzz certification; explicit unsupported features remain errors and undefined DTSTART/RRULE pattern mismatches are outside this fixture gate. Cost if mistaken: unusual feeds may still fail and must not be presented as complete.

- Task 1: Ruling: use a visible Mutter Devkit on a private bus with temporary XDG settings instead of installing into the live user shell — proves the actual NVIDIA/GNOME path without restarting the live Wayland session. Long-running live installation, multi-monitor/hotplug and full lifecycle remain Task 3/7 gates.

- Task 1: Ruling: resource scale comes from Clutter, not the caller logical scale; 125% uses a 2x FBO on this host. Report color-buffer bytes only, not a total GPU memory claim.

- Task 1 final Ruling: defer live-session installation/prolonged use to later acceptance; this step proves a visible actual-GPU nested session only. Cost if mistaken: live-shell integration may expose additional conflicts.

- Task 1 final Ruling: defer multiple monitors/hotplug/arbitrary layout and 20-cycle lifecycle stress to Tasks 3/7. Cost if mistaken: fixed-card evidence does not cover dynamic placement or repeated teardown.

- Task 1 final Ruling: defer lock/suspend, animated wallpaper and varied DING/BMS configurations as documented. Cost if mistaken: unsupported transitions can leave stale or misplaced surfaces.

- Task 1 final Ruling: defer CPU/GPU budgets and total GPU memory accounting to Task 7. Only bounded RGBA FBO bytes are measured here.

- Task 1 final Ruling: final UI, Rust service/calendar/weather/providers remain Tasks 2–7; unchanged Task 0 was not re-reviewed, but its checks passed. Preserve this plan workspace because the full product is not yet complete.

- Task 2: Ruling: calendar secret storage/clear and location search return explicit NotSupported until Tasks 4/5; no silent stub success or secret persistence. Current collector reports unavailable, not fabricated measurements.

- Task 2: Ruling: do not cancel a side-effecting Subscribe after disable; consume a late token and unsubscribe its original unique owner. Snapshot requests are cancellable. A transport timeout after server-side registration can defer cleanup until sender/service loss, documented in docs/data-service.md.

- Task 2 final Ruling: slow-storage serialization under Tokio mutex is accepted for coherence; blocking I/O runs off-executor. Cost: disk latency delays IPC, with bounded client retry recovery now implemented.

- Task 2 final Ruling: actual collectors, secret storage/search, final cards, live installation, performance and multiple monitors remain Tasks 3–7. Unchanged Task 0/1 implementation is not reopened. Task 1 click flake remains documented, with subsequent diagnostic and final GUI runs passing; no unsupported root-cause claim.

- Task 3: Ruling: month-grid pure helper moved forward from Task 4 because the basic calendar card requires it; event dots and agenda semantics remain Task 4.

- Task 3: Ruling: physical suspend/logout/hotplug and OS-wide timezone changes are disruptive human acceptance gates. Exercise injected workarea/timezone and LoginManager resume event now, record hardware paths unverified. Cost: adapter wiring and injected events do not prove physical transitions.

- Task 4: Ruling: keyring items are staged under fresh source UUIDs so a failed replacement cannot alter the previous source. Background reads never request unlock; locked keyring returns a static error. Connection/disconnection only exposes status to preferences; personal URL remains user input.

- Task 4: Ruling: Google Calendar home URI is the first-version click target, matching the user request. Verify GIO routing with an isolated default handler; private browser login and actual private feed remain user-only. Cost: account selection/deep date navigation is not proven by this test.

- Task 4: Ruling: calendar fetch adapter lives in providers/calendar_feed.rs beside the already-tested engine; calendar/agenda rendering remains in WidgetHost with pure shared helpers. No new parser or range semantics.

- Task 5: Ruling: request timeformat=unixtime + 7 hours, then select 6 timestamps >= now and format with the selected IANA zone. Open-Meteo documents fixed-offset ISO responses ignoring DST transitions; Unix timestamps avoid that ambiguity. Cost: no historical/recent-past hourly column is shown.

- Task 6: Ruling: persist calendar/weather only. CPU/network/media are live measurements, not useful offline disk snapshots; remove legacy live caches at startup and avoid 2-second atomic fsync writes. Prior IPC restart expectation updated from stale CPU to unavailable/empty, covered by a new write/restore regression test. Cost: last live measurement does not survive service restart.

- Task 6: Ruling: temperature is refreshed when its age reaches 5 seconds on the shared 2-second sampling cadence (normally every 6 seconds). Only labeled coretemp package/core and k10temp Tdie/Tctl are accepted; unknown hardware reports no sensor. Automatic NIC uses one default-route interface, excluding loopback/Tailscale; explicit tailscale0 is supported. No interface aggregation.

- Task 6: Ruling: MPRIS collection subscribes before querying and waits for property/owner events; stream and bus lifetimes belong to the cancellable collection future. Up to 32 sorted players, 8 concurrent 2-second property queries. No steady polling or remote artwork fetch. Accepted service state is the comparison baseline so fenced results cannot suppress a later valid update.

- Task 7: Ruling: benchmark uses GNOME's actual stagePaintStart→stagePaintDone timings without forced glFinish, which includes possible swap time and is not a presentation-latency/GPU-only measurement. Actual 1280×800 NVIDIA Devkit, same animated/moving foreground window, DING/BMS/Ubuntu Dock. Device-global nvidia-smi memory is supplementary, not extension-owned allocation.

- Task 7: Ruling: new/updated local extension code may need logout/login because GNOME 50 discovers local extensions at session start and caches imported code. Installer records only this UUID in enabled/disabled lists, starts the user service, and reports next-login activation honestly. Do not restart the user's Wayland session. Cost: live outer-shell visual acceptance remains a human session gate.

## 남은 경미한 사항

- Final: minor (deferred): Ajv accepts a space separator in date-time while Rust rejects it; engine emits canonical T timestamps. Align this peripheral invalid-input syntax before broader protocol inputs are supported.

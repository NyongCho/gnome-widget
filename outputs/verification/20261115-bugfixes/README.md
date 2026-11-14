# Bug fixes verified on 2026-11-15

Base commit: `48166a5`. The three reported regressions were reproduced before editing their implementations.

- Glass effects now use edition-specific GTypes. The native regression loads both real effect implementations in both orders; the old implementation failed with an already-registered type.
- Calendar replacement commits cleanup intent with the new source. Cancellation after an atomic rename cannot silently leave an obsolete secret. Only confirmed cleanup clears this operation's temporary marker; an earlier deletion warning survives until explicit disconnect. Tests cover cancellation before/after commit, failed subsequent writes, failed secret removal, reconnect and a queued disconnect.
- Validator generation and artifact linking convert file URLs to filesystem paths. Generation, type checking, all Node tests and both extension builds work from a checkout containing spaces and Korean characters. Both old URL conversions were independently reproduced as failures.

## Verification

- `CARGO_TARGET_DIR=/home/nyong/projet/gnome-widget/daemon/target ./scripts/check.sh --edition all` passed: Rust formatting/clippy/build/tests, 163 Node tests, 59 calendar cases per engine, nine native public backend suites and 30 Python tests. Three external-account Rust tests remain intentionally ignored.
- After the additional calendar recovery fix, `./scripts/check.sh --edition gjs` passed with **167 Node tests**, all type/format/build checks, 59 GJS calendar cases, nine native public backend suites and **30 Python tests**. Rust code and the glass/build fixes were unchanged after the full all-edition run.
- `python3 scripts/package.py --edition gjs` produced the ZIP identified in [artifact.json](artifact.json).
- `LIQUID_GNOME_WORK=/tmp/liquid-bugfixes-20261115 ./scripts/test-gnome.py --edition gjs --package-zip dist/liquid-widgets-public/liquid-widgets.shell-extension.zip` passed. The exact ZIP installed, rendered widgets, collected local metrics, opened preferences, processed synthetic Seoul calendar data, destroyed 28 actors, released callbacks/timers, and uninstalled. See [results](package.json) and [capture](public-package-installed.png).
- Shexli 0.2.1 reports only the existing `EGO-P-007` warning for the separately launched calendar worker and its exclusive dependencies. See [analyzer output](shexli.json) and the [worker explanation](../../../docs/readable-public-modules.md#remaining-analyzer-result).

## Independent review

Three agents started with `fork_turns: "none"`, receiving only repository location, requirements and assigned review scope. They used isolated copies or synthetic fixtures and did not change the shared source or the user's extension settings.

1. **Glass/runtime:** both actual production builds ran together in disposable GNOME Shell 50.1, in both registration orders over three enable/disable cycles each. Painting, repainting, resource release and reactivation passed; no actionable finding. The committed lightweight GJS regression does not itself exercise native painting; this independent check supplements it. Logs: [Rust first](glass-rust-first.log), [GJS first](glass-gjs-first.log).
2. **Calendar settings:** found a failed follow-up marker write and a queued-disconnect race in the initial fix. Both were reproduced, fixed with atomic cleanup intent, and rechecked. Additional cases covered newer connections, existing warnings, failed old-secret removal and marker-reset failure/cancellation. No remaining finding in the reviewed scope.
3. **Build/package:** generation, five type-check configurations, full Node tests, both extension builds, build policy checks, 15 packaging tests and an actual 130-file ZIP passed from a space/Unicode path. No actionable finding.

Review policy is recorded in [AGENTS.md](../../../AGENTS.md).

## Limits

Private Google data, external weather service behavior, physical login/lock transitions and long desktop performance/leak runs were not tested. The remaining worker warning and EGO acceptance require human review. This candidate has not been uploaded to EGO or published as a new GitHub release.

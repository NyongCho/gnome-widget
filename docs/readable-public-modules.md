# Readable public modules

The owner's EGO version 2 was rejected for unreadable transpilation and monolithic output. This candidate changes the public build and source layout for review. It is **not an approved or submitted EGO version**. Published GitHub release assets remain unchanged.

## Package layout

The public build preserves source module boundaries. Its entry points contain the extension, preferences and worker entry code; application modules remain under `src/`. `extension.js` exposes `enable()` and `disable()` directly. The installed extension requires neither Node nor Rust.

| Entry | Previous rebuilt bytes | Candidate bytes |
| --- | ---: | ---: |
| `extension.js` | 715,429 | 4,505 |
| `prefs.js` | 663,795 | 370 |
| `calendar-worker.js` | 94,483 | 3,517 |

The ZIP contains 74 first-party modules under `src/`, separate Ajv validator files and readable ical.js modules. The approximately 1 MB pinned timezone dataset remains JSON, loaded only by the worker after acquiring its computing lease. It is no longer expanded into JavaScript. GLSL string exports preserve the original shader text exactly.

The artifact is 371,405 bytes with 130 entries; its uncompressed contents total 2,533,419 bytes. More files and readable indentation slightly increase compressed size compared with the prior 361,246-byte corrected ZIP. This work prioritizes reviewability. SHA-256 and exact counts are in [artifact.json](../outputs/verification/readable-public-modules/artifact.json).

## Review map

- Lifecycle: [`extension.ts`](../extension/src/extension.ts), [`WidgetHost`](../extension/src/widgets/host.ts), [`GlassSurface`](../extension/src/effects/background.ts).
- Public composition: [`runtime.ts`](../extension/src/data/runtime.ts), [`LocalWidgetSession`](../extension/src/data/localSession.ts), [`preferences data session`](../extension/src/prefs/dataSession.ts).
- Calendar process boundary: [`workerClient.ts`](../extension/src/calendar/workerClient.ts), [`worker entry`](../extension/src/calendar-worker/main.ts), [`protocol schemas`](../protocol/calendar-worker.schema.json).
- Build: [`public-modules.mjs`](../extension/scripts/public-modules.mjs), [`validator generator`](../extension/scripts/generate-validators.mjs), [`package policy`](../scripts/package_policy.py).

Ajv's compiler runs only during development. Validators still use Ajv-generated function names and include third-party format expressions; those are identified by provenance comments and license notices. They are not hand-written application logic. Reference inlining is disabled to reduce repeated definitions, and standalone runtime helpers are shared. No schema, format rule, input limit or error policy was weakened. The personal-only snapshot validator and Rust transport do not enter the public package.

## Verification

- `check.sh --edition all`: Rust formatting/clippy/build/tests, TypeScript checks, 160 Node tests, 59 calendar cases per engine, nine native public backend suites and 29 Python tests passed. Three external-account Rust tests remain intentionally ignored.
- Fifteen validator interfaces are compared with the original Ajv options using valid fixtures, nested mutations, extra/missing fields, Unicode lengths, date/URI/UUID formats and numeric boundaries. Generated-size checks use identical formatting on both sides and fail with the old inlining configuration.
- Public artifact tests resolve all emitted exports, enforce short first-party lines and small entry points, preserve shader text and reject personal implementations. Package tests cover safe parent-relative paths, missing/escaping/unused modules and Shell/preferences/worker separation.
- The exact ZIP installed, enabled, collected local metrics, opened production preferences, disabled and uninstalled in disposable GNOME Shell 50 without Rust. The installed worker processed synthetic ICS using `Asia/Seoul` from its separate JSON data. Cleanup destroyed 28 owned actors, stopped the clock timer and disconnected retained glass failure callbacks. See [native results](../outputs/verification/readable-public-modules/package.json) and [capture](../outputs/verification/readable-public-modules/public-package-installed.png).
- The exact-ZIP test exposed a missing `getEdition` export in the first modular build. The public edition override now preserves that helper's interface. A static module-link regression reproduces the missing export before the fix and passes afterward.

Logs and analyzer output are under [`outputs/verification/readable-public-modules`](../outputs/verification/readable-public-modules/).

## Independent review

A fresh reviewer inspected the complete change from `5836fc6` through `6bdfd90` and reported no Critical, Important or Minor findings. The reviewer independently ran 17 validator tests and 15 package tests, checked module linking with tree shaking disabled and verified that the worker graph excludes unrelated validators. Normalizing source with the pinned formatter confirmed that runtime edits are limited to the intended import/extraction changes and equivalent XML/weather construction. No minor findings were deferred.

EGO acceptance and maintainer understanding remain human judgments; automated evidence cannot replace them. Private-account integrations, physical session transitions and repeated desktop benchmarks were explicitly left outside this build/readability review, so those conditions are not newly verified.

## Remaining analyzer result

Shexli 0.2.1 reports **one warning category, EGO-P-007**: the separately launched `calendar-worker.js` and its exclusive dependencies are not reachable through extension/preferences imports. Those imports must remain separate so recurrence work cannot run on Shell's main thread. The package validator follows the worker as a third entry point and rejects unreachable JavaScript. Its lifetime and lease are checked in both worker tests and the exact installed ZIP.

The previous lifecycle-warning categories no longer appear after restoring module boundaries. Their disappearance is an analyzer observation, not proof of cleanup; the native lifecycle assertions supply that evidence. The earlier [warning analysis](shexli-review.md) remains a historical record.

## Implementation decisions and limits

1. Work in an isolated public-branch checkout under the existing execution approval. The live personal installation is not replaced; testing uses disposable sessions.
2. Emit a worker-only adjacent JSON loader because the installed GJS rejects JSON import attributes. The loader is covered by an actual timezone-dependent worker result; future GJS changes may allow a simpler import.
3. Use the installed TypeScript 7 CLI and Prettier's Babel parser for import offsets because the legacy TypeScript compiler API is unavailable. Compiler/parser upgrades may require build-tool adjustments; artifact linking and native tests cover the current versions.
4. Keep real entry code at the ZIP root instead of adding forwarding files. Other source paths are preserved; a path mistake fails package/link checks.
5. Compare generated size after identical formatting, with a separate budget for the personal snapshot validator. Budgets prevent regression and do not imply EGO acceptance.
6. Keep per-schema standalone validators and shared runtime helpers. Combining every generated validator made esbuild retain unrelated validators through initialization side effects. Some schema code remains duplicated; avoiding that would require a custom compiler transformation outside this change.
7. Run Node test files sequentially because artifact tests regenerate shared outputs. This adds a few seconds to tests and prevents imports racing with generator cleanup; installed behavior is unaffected.

Private Google account access, external weather requests, physical login/lock transitions and the five-pair desktop performance benchmark were not repeated. Generated-code readability and the worker exception remain reviewer judgments. Maintainer understanding cannot be established by these automated checks. No EGO upload, reviewer comment or new GitHub release was performed.

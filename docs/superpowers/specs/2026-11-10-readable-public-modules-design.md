# Readable public modules

The owner approved the Ponytail review's sequence: preserve modules in public JavaScript output, separate generated validation and data, update packaging checks, then format the original source. EGO rejected version 2 for unreadable transpiled code and monolithic files. This work addresses the artifact, not the maintainer's understanding or reviewer approval.

Keep all widgets, settings, public/personal namespaces, JSON schemas, validation semantics, worker deadlines and cleanup. Do not rewrite the calendar engine or replace Ajv. Rust packaging stays supported. Do not post review comments or submit a new ZIP automatically.

The public package will retain `src/`, `generated/validators/`, and `vendor/ical/` modules with readable filenames. Root entry points delegate to their corresponding source modules. Only modules reachable from the extension, preferences or worker entries are shipped. Factory/edition selection remains a build-time decision. Shared cancellation is separated from the Rust-only transport so importing cancellation does not import the personal backend.

GJS 1.88 rejects JSON import attributes (verified locally). The public build therefore provides an adjacent JavaScript loader for the worker-only timezone JSON; the original JSON remains a data file. Shaders remain readable GLSL assets with small generated text exports. Neither loader fetches remote data. The worker dependency graph must stay outside Shell and preferences.

Ajv remains the schema compiler. Named standalone validator modules use non-inlined references and readable formatting; boundary behavior is compared against the previous generated validators. Source imports select individual validator files instead of a runtime barrel that would load every validator. Long third-party patterns must remain semantically identical, with original notices retained.

The existing bundler can continue to build personal/test artifacts. The public emitter uses the installed TypeScript/esbuild tools and a pinned development-only formatter. Prettier is justified for consistent source and emitted-code formatting across the project; no formatter/compiler is shipped to users.

Alternative approaches considered: changing only minify/whitespace leaves giant entry points; a custom replacement validator would risk schema behavior and expand scope. Preserving the existing modules is the smallest complete correction.

Acceptance: all existing tests pass; actual public entry points stay small and import readable modules; no Rust implementation, test fixtures, Node imports or compiled schema enters the public ZIP; safe relative imports cannot escape the package; actual GJS loads the emitted worker and timezone data; the final ZIP installs, enables, opens preferences, disables and uninstalls in disposable GNOME 50. Review readiness is reported separately from approval.

# ical.js 2.2.1

Readable source from upstream commit `277d52c8db379f133a88957793e03997a65307f4`,
licensed under MPL-2.0; see `LICENSE` and each original file's header.
`manifest.json` records provenance and each JavaScript file's SHA-256.

The only upstream modification is `budget.patch`: calls inside parser,
recurrence, time and timezone loops to the small `budget.js` callback. This
allows a synchronous worker to enforce its deadline even while a single
recurrence iterator call is searching. The hook is a no-op outside a job and
is reset in a `finally` block. Upstream unit tests run against these patched
files. The application owns event normalization and timezone resolution in
`src/calendar-worker/`; these semantic changes are not hidden library patches.

`module.d.ts` reuses the pinned npm package's declarations for build-time
checking. npm/Node/Ajv are not runtime dependencies. Only the separate worker
may import this library; the Shell and GTK bundles exclude it.

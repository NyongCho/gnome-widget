# Readable Public Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected monolithic public bundles with readable modules while preserving behavior.

**Architecture:** Keep source module boundaries and explicit public entry points. Compile only reachable runtime modules, select edition/factories during build, and keep validators and timezone data separate. Preserve the personal/test bundling path.

**Tech Stack:** TypeScript, esbuild, Ajv, pinned Prettier (development only), Python packaging, GJS/GNOME 50.

**Spec:** `docs/superpowers/specs/2026-11-10-readable-public-modules-design.md`

## Global Constraints

- Keep all widgets, settings, public/personal namespaces, JSON schemas, validation semantics, worker deadlines and cleanup.
- Do not rewrite the calendar engine or replace Ajv. Rust packaging stays supported.
- Do not post review comments or submit a new ZIP automatically.
- Preserve licenses, safe package paths, process separation and trust-boundary validation.

## Review Focus

- Parent-relative imports must resolve inside the ZIP; escaping paths remain rejected.
- Cancellation/validator imports must not pull the personal backend or unrelated validators into the worker.
- Emitted JSON/GLSL loading must work in GJS, not just Node.
- Validator factoring must preserve invalid-input rejection, Unicode lengths and date/URI formats.
- Moving files must preserve disable/worker shutdown and both editions' settings namespaces.

### Task 1: Emit and package source modules

**Files:** `extension/scripts/build.mjs`, new `extension/scripts/public-modules.mjs`, `extension/src/shared/{cancellation,validation,snapshot}.ts`, cancellation/validation callers, `scripts/{package_policy,package,check-build}.py`, `extension/tests/backendEdition.test.ts`, `tests/test_public_package.py`, formatter config/package manifests.

**Interfaces:** Public emitter `buildPublicModules(edition, outdir)` writes root entry points plus reachable `src/`, `generated/`, `vendor/` and asset modules. `validate_public(files, release)` retains its API while resolving normalized relative module imports and checking the process graph. Existing edition factories and protocol signatures stay unchanged.

- [ ] Add failing artifact tests for small entry points, named source modules, safe parent-relative dependencies, missing/escaping/unused modules and public worker isolation.
- [ ] Run the focused tests and record expected failures against the old bundles/policy.
- [ ] Implement the public emitter, build-time factory/edition selection and asset loading; separate shared cancellation and snapshot-only parsing, updating all callers.
- [ ] Permit only reachable production modules/data in packaging and retain existing binary/private-data/fixture checks.
- [ ] Run Node tests, public packaging tests, both build checks and direct GJS imports/worker execution; commit the task.

### Task 2: Factor generated validation and verify behavior

**Files:** `extension/scripts/generate-validators.mjs`, generator consumers, new `extension/tests/validatorParity.test.ts`, artifact regressions.

**Interfaces:** Existing validator names continue to return boolean and consume unknown values. Generate per-validator declaration files for direct imports; retain the development barrel for tests where needed. No schema or validation option affecting accepted data changes.

- [ ] Capture the previous standalone validators and add a behavior comparison using valid fixtures and invalid structural/boundary mutations.
- [ ] Add a failing size/readability check establishing generated code does not return to giant entry points or excessive duplicated inlined definitions.
- [ ] Disable reference inlining, format standalone modules, and preserve shared initialization/format helpers.
- [ ] Run the parity regression, all Node tests and actual GJS contract/worker suites; commit the task.

### Task 3: Format source and validate the final distribution

**Files:** `extension/src/**/*.ts`, relevant scripts/formatter config, package/native checks, `tests/gnome/package.js`, release/readiness documentation and verification receipts.

**Interfaces:** Runtime interfaces remain unchanged; formatting checks and exact-package tests become the acceptance evidence.

- [ ] Format first-party TypeScript and build scripts, expanding dense control flow without changing behavior. Inspect remaining long lines and dependency code.
- [ ] Extend the exact-ZIP native test to execute the actual emitted calendar worker with synthetic ICS and timezone data.
- [ ] Run `CARGO_TARGET_DIR=/home/nyong/projet/gnome-widget/daemon/target ./scripts/check.sh --edition all`, package checks, Shexli, and the disposable GNOME exact-ZIP lifecycle test.
- [ ] Obtain one fresh read-only whole-change review, address material findings with regressions, and record any limitations.
- [ ] Commit and push the authorized source changes, preserve published release assets, and deliver the tested ZIP and accurate review notes.

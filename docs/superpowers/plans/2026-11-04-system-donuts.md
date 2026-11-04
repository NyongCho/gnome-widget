# System Donuts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single UI task.

**Goal:** Show CPU and RAM as the rounded monochrome donut gauges in the user's macOS reference.

**Architecture:** Keep the Rust SystemData contract and sampling unchanged. Draw two Cairo rings in St.DrawingArea, with ordinary centered St labels for percentages, CPU/RAM captions, and the existing memory/temperature details below. Host content measurement determines card height.

**Tech Stack:** TypeScript/GJS, St/Clutter/Cairo, existing GNOME 50 test harness.

**Spec / design:** User requests donut-style system metrics matching the previously supplied reference. Use two side-by-side 80px rings (scaled by widget scale), a 7px rounded stroke, faint monochrome track, clockwise fill from noon, percentage centered inside and CPU/RAM beneath. Foreground follows light/dark theme. Unknown CPU or zero memory total shows an empty track and em dash, distinct from 0%. Temperature stays numeric because no meaningful shared percentage scale was requested. Existing memory-used/total and unavailable-temperature text remain visible. These layout details are implementation choices within the requested change.

**Approaches:** Two separate rings preserve immediate CPU/RAM comparison and fit the existing card; concentric rings make labels harder to associate; a temperature ring would need an arbitrary scale. Choose two separate rings and retain temperature text.

## Task 1: System gauges

Files: new `extension/src/widgets/system.ts`; update `widgets/live.ts`, `widgets/host.ts`, `extension/stylesheet.css`, `extension/scripts/build.mjs` (GJS built-in Cairo stays external); new `tests/gnome/system.js` and runner flag.

Interface: `renderSystem(card: GlassCard, data: SystemData, scale: number, language: Language): void`. Each drawing area's repaint uses its allocated size, current theme color and bounded data ratio. No timers or global signals.

Review focus: unknown versus zero, correct RAM denominator, 100% closed ring, theme contrast, fractional/UI scaling and lifecycle cleanup.

- [x] Verify in the actual card that two rings are absent before implementation.
- [x] Implement rings, centered text, proportional sizing and retained details.
- [x] Verify rendered quadrant fill for 0/25/50/100%, null and zero total; dark/light, widget scale 1.5, display scale 125%, update and teardown.
- [x] Run full checks and compact-card regression, inspect screenshots, obtain independent review.
- [x] Package/install preserving settings, save verification evidence, commit locally.

Result: [screenshots and verification](../../../outputs/verification/system-donuts/README.md). No review findings. Full checks and both GNOME suites passed, installed files match and settings are preserved. New Shell code loads at next login.

Reference: the user's [macOS clear widget screenshot](https://preview.redd.it/always-liquid-glass-for-widgets-on-macos-v0-6aq1tytuzl3g1.png?width=700&format=png&auto=webp&s=67843b26ff19f1f55461b42df7b9443bd09c1c55), visually inspected. Its battery rings provide the visual treatment; it does not show CPU/RAM semantics.

# Glass Material Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Match the supplied macOS widget reference with calm translucent surfaces, thin curved edges and legible monochrome content.

**Architecture:** Keep the existing Rust data service and wallpaper-only Cogl input. Cache a separable blur alongside the source, then render a rounded bevel with restrained refraction, directional rim and theme-aware luminance mapping. Draw text independently with a transparent foreground button; retain an opaque fallback.

**Tech Stack:** GNOME 50, TypeScript/GJS, Cogl GLSL, existing private-session integration harness.

**Spec:** [Research and proposed direction accepted in the user's request](../../liquid-glass-rendering-research.md).

## Global Constraints

- Preserve calendars, English/Korean settings, click actions, lock-screen behavior and existing user configuration.
- Keep the current feature branch and workspace; the requested change continues the installed app, with no unrelated edits present.
- No external code copied; use the researched principles in a small renderer suited to wallpaper inputs.
- Never capture private calendar data; test screenshots use a separate D-Bus session and fixtures.
- No per-frame CPU readback; no idle blur recalculation. Retain low-power and allocation-failure fallback.

## Review Focus

- Extreme white/black wallpaper: actual rendered text contrast remains at least 4.5 in light and dark modes.
- GPU passes: queued nodes preserve texture ordering, pipelines do not change under already queued draws.
- Cached frames: tone/strength/text changes reuse blur, while wallpaper/size/scale changes refresh it.
- Fractional scaling: logical blur/refraction sizes and texture memory accounting remain correct.
- Fallback and repeated disable/enable: all targets are released; the text and click targets remain usable.

### Task 1: Cached glass material

**Files:** `extension/src/effects/glass.ts`, `extension/src/effects/background.ts`, `extension/shaders/glass.glsl`, new `extension/shaders/blur.glsl`, `extension/src/widgets/card.ts`, `extension/stylesheet.css`, `tests/gnome/visual.js`.

**Interfaces:** Keep `GlassSurface.setStrength`, geometry and fallback; add `setMaterial(opacity:number,dark:boolean)` and `blurPaints` diagnostics. Opacity controls subtle tint and readable tone mapping, not a dense foreground fill.

- [x] Extend actual GNOME visual test to verify blur cache refresh/reuse, target release, and screenshot-backed text contrast (the old CSS-only contrast calculation cannot see GPU material).
- [x] Run baseline/red visual checks; record the missing blur-cache behavior before changing production code.
- [x] Add full-resolution input and two half-resolution H/V blur targets, shared snippets, per-target pipelines and bounded logical-coordinate sampling.
- [x] Implement smooth bevel normals, bounded single-boundary refraction, subtle rim, and theme-aware luminance bounds; make normal foreground fill transparent. Retain explicit readable low-power/failure colors.
- [x] Run typecheck, build, TypeScript suite, GNOME visual and functional checks; inspect screenshots and tune only within the accepted direction.
- [x] Commit the renderer and its validation after passing checks.

### Task 2: Validate and install the revision

**Files:** `docs/verification.md`, `outputs/verification/glass-material/`, this plan.

**Interfaces:** Consume Task 1's actual screenshots and diagnostics; the user's service/settings remain intact.

- [x] Verify light/dark, black/white, colorful/detailed wallpaper, 125% scaling, narrow clock and fallback. Confirm blur/foreground changes do not break clicks, wallpaper updates or repeated enable/disable.
- [x] Run the project's existing build/test checks and a focused lifecycle/benchmark run for the added GPU targets.
- [x] Request one independent review of the change and fix material findings.
- [x] Record evidence, package and update the existing user installation with backup; verify installed artifact hashes and service health. Explain any required logout/login without restarting the user's session.

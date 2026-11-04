# Selectable Clock Styles Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the renderer; superpowers:dispatching-parallel-agents for the independent GTK settings work.

**Goal:** Ship the selected large digital clock by default and keep the other three reviewed faces as persistent options.

**Architecture:** A constrained GSettings `clock-style` string chooses `digital`, `square`, `classic`, or `minimal`. A persistent native St/Cairo `ClockFace` owns the foreground, localized time/date and an analog-only second timer, while the existing GlassCard continues to own material and layout. Host time stays anchored to ClockController's timezone/resume updates; second redraws never rebuild calendar/agenda or shader textures.

**Tech Stack:** TypeScript/GJS, St/Cairo/Pango, GTK4/libadwaita, GSettings.

**Spec:** User selected sample 1 (large digital) and asked to retain the remaining three as options. See `outputs/prototypes/clock/` and `docs/clock-design-references.md`. Preserve matched weather size and independent columns. No extra confirmation is needed to implement the selected design.

## Constraints and review focus

- Default digital; instant settings changes and persistence; Korean/English choice labels.
- Actual timezone and 12/24-hour preferences, midnight/noon and locale-specific AM/PM.
- Match approved geometry at UI scales .75–1.5 and fit narrow screens.
- Analog hands advance every second only while mapped and outside low-power mode; stop on hide, removal, style change and extension disable. Low-power omits the second hand.
- Reuse foreground actors across ticks, avoid analog seconds rerendering other cards or invalidating wallpaper blur.
- Preserve all preexisting GSettings, provider data and private account setup during installation.

## Task 1: Preferences (settings agent)

Own `extension/src/prefs/clock.ts`, integration in `prefs/pages.ts`, new clock messages in `shared/i18n.ts`, and the private GTK harness `extension/tests/gnome/card-order.js`.

- [x] Add `addClockSettings(window,page,settings,ui)` with a translated ComboRow named `clock-style`, four choices in the above order, external-change handling and close cleanup.
- [x] Harness State exposes `clockStyle: {value,title,selected,labels}` (null if absent); `FocusClock()` focuses the actual ComboRow. Retain current column methods and tests.

## Task 2: Native faces (parent)

- [x] Add failing real timezone/format/hand-angle tests in `extension/tests/clockValues.test.ts`; implement `clockFaceValues(now,zone,hour12,locale)` and second-boundary scheduling in shared code.
- [x] Add schema choices/default and `widgets/clock.ts`; use a stable clock view in host with explicit lifecycle cleanup. Preserve the approved digital perimeter ticks, the three analog faces and date footer.
- [x] Actual GNOME/GTK test: default, keyboard selection of all four, persistence/reopening/translation, live face changes, time/scale/theme, timer cleanup and cached blur reuse. Update legacy assertions that assumed the old clock subtree.
- [x] Run full checks and relevant GNOME regressions; independent review; package/install, verify file and settings preservation; capture evidence and local commit.

## Prototype retention

Preserve the source and sample gallery on `prototype/clock-faces` before retiring the throwaway renderer from the active branch. Keep the sample images as historical design evidence; production uses the new typed renderer, not the prototype script.

## Outcome

Implemented and installed all four native faces with large digital selected by default. Full checks, native clock/GTK, column, compact, functional and visual suites passed. Independent review found the fractional timeout issue; the regression now passes after rounding up. Final review found no remaining actionable issues. All previous widget settings were preserved and installed artifacts verified. Evidence: [clock styles](../../../outputs/verification/clock-styles/README.md). Shell code loads on the next logout/login.

# Public edition UI verification

Target: GNOME Shell 50, Wayland, 1280×800 nested Devkit session on the development desktop. The Rust and public editions use the same WidgetHost, preferences, stylesheet and shaders. Every run uses a private D-Bus, temporary XDG configuration/cache/data/runtime, keyfile GSettings and an isolated HTTP/HTTPS URI handler. The installed personal edition and its secrets are not used.

## Reproduce

```sh
./scripts/dev npm --prefix extension run build -- --edition rust
./scripts/dev npm --prefix extension run build -- --edition gjs --tests
./scripts/test-gnome.py --edition gjs --editions
./scripts/test-gnome.py --edition rust --editions
# Repeat these suites with --edition rust and --edition gjs:
./scripts/test-gnome.py --edition gjs --preferences
./scripts/test-gnome.py --edition gjs --clock-styles
./scripts/test-gnome.py --edition gjs --clock-footer
./scripts/test-gnome.py --edition gjs --dynamic-wallpaper
./scripts/test-gnome.py --edition gjs --media-art
./scripts/test-gnome.py --edition gjs --system
./scripts/test-gnome.py --edition gjs --compact
./scripts/test-gnome.py --edition gjs --card-order
./scripts/test-gnome.py --edition gjs --visual
./scripts/test-gnome.py --edition gjs
```

`--tests` adds build-only GTK fixtures. Normal public builds omit these fixtures. Without `--edition`, the GNOME harness retains its Rust default. `CARGO_TARGET_DIR` selects an existing Rust build cache; `LIQUID_GNOME_WORK` selects where logs/screenshots are kept. Never run the Node build tests while a GNOME suite is using their output directories.

## Coverage and evidence

On 2026-11-07, all 11 suites passed in each edition (22 edition/suite combinations). The final pass matrix is recorded in `outputs/verification/public-edition/results.json`.

- Actual extension factory selection, public preferences demand with all data cards hidden, disable cleanup, fresh enable instance and rejection of a late old watch token.
- Four clock styles, 12/24 hours, Korean/English, 0.75–1.50 widget scale, 125% display scale, stable date footer, analog second hand and timer cleanup.
- Independent left/right columns, moves between columns, ordering, visibility, keyboard focus and preferences reopening.
- Light/dark palette, real GPU material text contrast of at least 4.5:1, refraction edge changes, unchanged center and allocation-failure fallback.
- All seven cards follow timed XML wallpaper endpoints and intermediate crossfade frames, retain static caches and catch up after being hidden.
- Compact card heights, space added only for errors and removed on recovery, calendar numeral centering, event dots and empty agenda.
- 16:9, square and portrait artwork; replacement, missing/broken artwork and fractional scaling; CPU/RAM donuts including unknown/zero/full states.
- Actual GTK keyboard city search/select/clear, calendar connect/error/success/stale/clear, draft preservation across language changes and window reopening. Public preferences use the actual adapter and calendar child with synthetic HTTP/Secret adapters; Rust uses its fixture D-Bus service.
- Functional suite uses live local CPU/memory/network counters; Google Calendar clicks reach only the isolated URI recorder. It checks DING/Blur My Shell input, window overlap, lock/overview visibility, resume and 20 enable/disable cycles. Public provider failure and Rust daemon owner loss are tested according to their different architectures.

The real GTK window also remained open across extension disable, attached to the new Shell instance after enable, and released its watch when closed.

Representative native screenshots: [compact dark](../outputs/verification/public-edition/gjs-compact-dark.png), [compact light](../outputs/verification/public-edition/gjs-compact-light.png), [light glass](../outputs/verification/public-edition/gjs-light-wallpaper.png), [dark glass](../outputs/verification/public-edition/gjs-dark-wallpaper.png), [wide artwork](../outputs/verification/public-edition/gjs-media-wide.png), [live local metrics](../outputs/verification/public-edition/gjs-live-metrics.png), [preview stale status](../outputs/verification/public-edition/gjs-preferences-stale.png). The visible grid belongs to the deliberate wallpaper fixture, not to a generated overlay. Contrast, card dimensions and timed wallpaper samples are kept next to the images.

## Issues found in this pass

The public build was still constructing the legacy DataClient at the actual Shell entry point. The factory regression failed before wiring `createWidgetDataSession`; it passes after the change. `disable()` now destroys all session-owned resources, while hiding the last data card only stops card demand.

Live network collection exposed a gap in synthetic filesystem tests: sysfs reports `st_size=4096` for short text attributes. Rejecting that metadata against a 128-byte counter limit prevented network reads and also affected temperature attributes. A regression reading the real loopback counter failed with `PAYLOAD_TOO_LARGE`. The adapter now enforces the limit on bytes actually read, while retaining its file-type, deadline and oversized-stream checks.

Two old rendering assertions sampled caches during native light/dark wallpaper crossfades. A repeated failure showed unchanged card geometry but nine fresh background paints in 150ms. The fixtures now require three consecutive stable 100ms samples, bounded at three seconds, before checking clock-only cache reuse. The separate dynamic-wallpaper suite continues to require repainting throughout every crossfade.

## Limits

These tests do not validate a user's private Google feed, real weather endpoints, Spotify credentials or every hardware sensor. Provider HTTP/MPRIS/worker/secret behavior has separate native fixture suites. Temperature remains optional on unsupported hardware. This UI report is not a performance gate, final ZIP installation report or GNOME Extensions review approval; those require the subsequent performance and packaging checks.

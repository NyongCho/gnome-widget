# Selectable clock faces — 2026-11-04

Large digital is the default. Preferences → Widgets → Clock → Clock style also offers Square dial, Classic round and Minimal analog. Changes apply immediately and persist across reopening and login. Korean and English labels/date/AM–PM follow the widget language; timezone and 12/24-hour format follow the desktop.

These are actual GNOME 50.1 St/Cairo captures using synthetic data and wallpaper:

| Face | Dark | Light |
| --- | --- | --- |
| Large digital (default) | [Capture](clock-digital-dark.png) | [Capture](clock-digital-light.png) |
| Square dial | [Capture](clock-square-dark.png) | [Capture](clock-square-light.png) |
| Classic round | [Capture](clock-classic-dark.png) | [Capture](clock-classic-light.png) |
| Minimal analog | [Capture](clock-minimal-dark.png) | [Capture](clock-minimal-light.png) |

Additional captures: [Korean preferences](clock-settings-korean.png), [English preferences](clock-settings-english.png), [125% display](clock-minimal-125.png), [low-power mode](clock-low-power.png), [injected GPU failure](clock-fallback.png). The preferences captures use the existing calibration-grid wallpaper. No personal desktop/account data is included.

The clock retains the matched ready-weather dimensions and independent columns. Its face has a no-clipping minimum; the date footer follows the allocated bottom. A shorter loading/unconfigured weather placeholder can remain shorter, as before. Every UI scale from .75 through 1.50 in .05 steps was checked with both languages and all four faces; narrow layout and 125% display scale were also checked.

Analog seconds repaint only the existing clock foreground. They do not recreate the calendar or invalidate cached glass. The timer stops when unmapped, removed, switched to digital, in low-power mode, or when the extension is disabled. Low-power mode omits the second hand. Timezone/midnight/noon and quarter-hour zones are covered by unit checks; the functional GUI suite covers clock/resume event handling without changing the OS clock or suspending the machine.

Verification:

- `./scripts/check.sh`: Rust formatting/clippy/tests, TypeScript type checks and 68 tests, build, GJS/IPC and seven installer tests passed.
- `./scripts/test-gnome.py --clock-styles`: actual GTK keyboard selection of all four faces, live Shell updates, persistence, translation, external changes, time/scale/theme, seconds, stable actors/blur and timer cleanup passed.
- `./scripts/test-gnome.py --card-order`: existing column assignment/order/visibility, focus, language, clock/weather sizes and 125% display passed.
- `./scripts/test-gnome.py --compact`: content fit, error/recovery, empty agenda, calendar alignment, scale, languages, narrow layout and glass cache passed.
- `./scripts/test-gnome.py`: input, timezone/resume path, service loss, fractional scale and 20 enable/disable cycles passed on the final implementation's first run.
- `./scripts/test-gnome.py --visual`: rendered light/dark text contrast, tabular digits, narrow 12-hour format and 125% display passed.

The new display-value and actual preferences assertions failed before implementation. Review identified fractional-millisecond timeouts being truncated to zero by GLib; a regression test failed before rounding the next-second delay up. Final independent read-only review found no remaining actionable issues. Native fitting checks also caught locale/font rounding differences; the expanding body and bottom-pinned date resolve those without enlarging weather placeholders.

The original comparison renderer remains on branch `prototype/clock-faces` at `47bedba`; the historical [prototype gallery](../../prototypes/clock/index.html) is unchanged. Production uses the typed renderer.

Packaged and installed for the current user. [Installation checks](installation.json) confirm all eight extension files and the daemon match the distribution, all preexisting widget settings are preserved, the new style is digital, and the service is active/enabled. The user's desktop session was not restarted; updated Shell code loads after logout/login.

# Independent card columns — 2026-11-04

The settings page has separate left/right lists, each with up/down controls, a transfer arrow and visibility switches. A transfer appends the card to the other column, retaining keyboard focus. Both lists are persisted atomically in `card-columns`. The old `card-order` setting is retained unchanged for rollback; existing visibility and other settings are preserved.

The requested defaults are clock/calendar/agenda on the left and weather/system/network/media on the right. Each column stacks independently, without row-height gaps from the other column. Hidden or paused cards keep their assignment without reserving height. A narrow workarea places the left list before the right list in one column. An individual column can be empty.

The clock matches the weather card's width and height, with its own natural content height as a no-clipping minimum for unusually short weather placeholders. Hidden weather uses a 230px ready-state baseline, adjusted for UI scale. The time is centered in the clock body. Actual ready-state measurements are 232×230 logical pixels for both cards.

Actual private GNOME 50.1 captures: [settings](columns-settings-left.png), [light](columns-grid.png), [dark](columns-grid-dark.png), [weather transferred to the left](columns-transferred.png), and [125% display](columns-grid-125.png). All provider content and the wallpaper are synthetic. The wallpaper deliberately contains a calibration grid. [Layout coordinates](columns.json) record actual ready-state placements.

Before implementation, five layout assertions failed on independent column positions and clock height, and the actual GTK test failed because separate lists were absent. The final focused tests cover normalization, duplicate/unknown IDs, an empty side, hidden/re-enabled cards, both transfer directions, within-column boundaries, focus restoration, translation, external changes, reopening and rollback-key preservation. Actual Shell assertions cover actor order, independent heights, centered time, matching clock/weather dimensions, stale weather, hidden/reappearing media, UI scale, narrow layout and fractional display scale.

Verification completed:

- `./scripts/check.sh`: Rust tests, formatting/clippy, all TypeScript configurations, 66 TypeScript tests, build, GJS/IPC checks and 7 installer tests passed.
- `./scripts/test-gnome.py --card-order`: actual GTK keyboard operations and Shell geometry passed.
- `./scripts/test-gnome.py --preferences`: existing data/settings keyboard flows passed.
- `./scripts/test-gnome.py --compact`: content fit, error/recovery, empty agenda, scale, languages, narrow layout and glass cache passed.
- `./scripts/test-gnome.py`: complete input/lifecycle suite passed on rerun, including 20 enable/disable cycles. Its first run encountered the previously recorded intermittent lifecycle failure (`cycle=0 roots=0 state=2`). No lifecycle product code or assertions were changed; the underlying intermittent cause is not claimed resolved.
- Independent code review against `b835dcf` found no actionable issues. `git diff --check` passed.

The release is installed. [Installation checks](installation.json) confirm eight matching extension files, matching daemon, the new schema key, preserved existing settings and active/enabled service. The user's desktop session was not restarted; new Shell code loads after logout/login.

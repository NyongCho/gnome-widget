# Card ordering — 2026-11-04

Preferences now has a list of all seven cards with up/down buttons and visibility switches. Order is stored separately in `card-order`; enabling a card no longer sends it to the end. The first initialization preserves the existing visible sequence and appends disabled known cards. Both GTK rows and Shell keyboard actors follow the saved order.

All cards, including the clock, occupy one grid slot. Two-column placement is left-to-right by row (`1 2 / 3 4 / 5 6`), with each next row below its tallest card. Small workareas use one column. Paused media is omitted without reserving a slot; the clock's existing text fitting keeps it inside its new column.

Actual private GNOME 50.1 captures: [Korean settings](order-settings-korean.png), [English settings](order-settings-english.png), [grid](order-grid.png), [reordered grid](order-grid-reordered.png), and [125% display](order-grid-125.png). All provider content is synthetic. [Layout coordinates](layout.json) show the final six-card order.

Before implementation, five layout assertions failed on the clock's old full-row width/row positions, and the GTK test failed with `card list needs move controls`. The new behavior is verified with actual virtual-keyboard activation, actual GTK row order, saved values, and Shell actor geometry. The test covers migration, moving disabled cards, off/on restoration, top/bottom button sensitivity, focus when a moved button becomes disabled, localization, external changes, reopening, immediate desktop reorder, hidden/reappearing media, keyboard actor order, narrow screens and 125% scaling.

Independent review found two repair cases: resetting an empty order with preferences closed temporarily differed from opening preferences, and joining IDs with commas could mistake a malformed ID for a normalized array. Both were reproduced together in the GNOME test before repair. The Shell now initializes order on order-setting changes, and persistence comparison checks length and individual elements. The same test then passed with both cases included.

Final `./scripts/check.sh` passed: 94 Rust tests (duplicate private-bus child runs excluded, 3 existing live probes ignored), 65 TypeScript tests, 7 installer tests, formatting/clippy/type checks/build/GJS/IPC. `./scripts/test-gnome.py --card-order` passed after the review fixes. The unchanged preferences/data flows (`--preferences`), content fit (`--compact`), and complete Shell input/lifecycle suite (including 20 enable/disable cycles) also passed.

The release is installed. [Installation checks](installation.json) confirm eight matching extension files, matching service binary, the new schema key, all existing settings preserved and service active/enabled. The new order initializes from visible cards when the new preferences/Shell code first runs. The user's session was not restarted; new Shell code loads after logout/login.

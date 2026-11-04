# Card Order Implementation Plan

> **For agentic workers:** UI settings and Shell layout are independent ownership areas dispatched through superpowers:dispatching-parallel-agents. Keep the interfaces below stable.

**Goal:** Reorder cards in preferences and lay them out left-to-right, row-by-row (1 2 / 3 4 / 5 6).

**Architecture:** Persist a complete `card-order` string array separately from the existing enabled `visible` array. Initialize the new key from the user's existing visible order, appending disabled known cards. Use the same normalized order in GTK and Shell. All cards, including the clock, occupy one column; narrow screens still use one column.

**Tech Stack:** TypeScript/GJS, GTK4/libadwaita, GNOME St/Clutter, GSettings.

**Spec / chosen details:** User explicitly requests a reorderable settings list and row-major placement. Up/down icon buttons move rows immediately and work from the keyboard; the row switch controls only visibility. Disabled cards keep their place. Paused media is skipped without a reserved hole. Settings changes update an already-running new extension; initial installation still needs logout/login for new Shell imports. Existing visible preferences are preserved during initialization.

## Shared interfaces (parent owns)

- `shared/cards.ts`: `CARD_IDS`, `CardId`; `normalizeCardOrder(order: readonly string[]): CardId[]`; `orderedVisibleCards(order: readonly string[], visible: readonly string[]): CardId[]`; `moveCard(order: readonly string[], id: CardId, direction: -1|1): CardId[]`.
- `cardSettings.ts`: `initializeCardOrder(settings: Gio.Settings): CardId[]`, persist normalized order only if different; empty order seeds from visible.
- GSettings `card-order` type `as`, default `[]` for migration. `visible` remains the enabled set; enable sequence no longer decides placement.

## Task 1: Preferences list (settings agent)

Files: new `extension/src/prefs/cards.ts`, modify `prefs/pages.ts`; new private GTK harness `extension/tests/gnome/card-order.js`. Parent owns shared helpers, i18n, build and outer test runner.

Interface: `addCardSettings(window, page, settings, ui): void`. Render all seven translated rows in persisted order, visibility switches, keyboard-accessible move buttons, correct disabled boundaries; update external settings live and disconnect listeners on window close.

- [x] Implement list with move controls and stable visibility positions.
- [x] Add actual GTK harness for parent-driven keyboard/order/persistence tests; typecheck.

## Task 2: Persistence and row-major layout (parent)

Files: shared cards helper, settings initializer/schema, extension.ts, widgets/host.ts, shared/layout.ts; focused unit tests, `tests/gnome/card-order.js`, runner/build integration.

Review focus: migration, disabled/re-enabled cards, duplicate/unknown saved IDs, clock in arbitrary position, hidden media, focus order, language/window lifecycle.

- [x] Write failing order and layout behavior tests; implement normalization, movement, initialization and row-major placement.
- [x] Verify real GTK keyboard move/toggle, external changes, saved order after reopening; verify Shell positions, instant reorder, hidden media, small-screen layout, and scale.
- [x] Run full checks and relevant GNOME regressions, review, package/install while preserving existing settings, record evidence and commit.

Result: [verification evidence](../../../outputs/verification/card-order/README.md). Review found external-empty-reset inconsistency and a comma-joined comparison collision. Both were reproduced in a failing real GNOME test, fixed, and passed alongside the full checks. External order changes now run initialization too, and saved order equality is element-wise. Existing settings are preserved; new Shell code loads after logout/login.

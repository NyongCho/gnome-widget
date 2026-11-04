# Independent Card Columns Implementation Plan

> **For agentic workers:** Settings and Shell changes use superpowers:dispatching-parallel-agents with the interfaces below.

**Goal:** Configure left/right card stacks independently and match the clock card to the weather card's size.

**Architecture:** One atomic GSettings `card-columns` (`aas`) stores both ordered columns. Default left: clock/calendar/agenda; right: weather/system/network/media, matching the user's example. Existing `visible` toggles are preserved. The old `card-order` key remains only for rollback compatibility. Shell stacks each column independently; a narrow workarea shows the left list followed by the right list in one column. Clock height follows weather's displayed height when present, with its own natural height as the no-clipping lower bound; when weather is hidden, use its 230px ready-state baseline. Center the clock time in its body.

**Tech Stack:** TypeScript/GJS, GTK4/libadwaita, St/Clutter, GSettings.

**Spec:** The user replaces row-major ordering with separate left/right lists, movable across columns and within each column. Existing visibility, localization and responsive layout remain. Both empty columns together normalize to defaults; a genuinely empty individual column remains empty when all cards are assigned elsewhere. Hidden and paused cards keep their saved assignment without reserving height.

## Shared interfaces (parent owns)

- `shared/cards.ts`: existing `CARD_IDS`, `CardId`; new `CardSide = 'left'|'right'`, `CardColumns = {left: CardId[]; right: CardId[]}`, `DEFAULT_CARD_COLUMNS`.
- `normalizeCardColumns(columns: {left: readonly string[]; right: readonly string[]}): CardColumns`: remove unknowns/duplicates (left wins), append missing IDs to their default side. Never mutate inputs.
- `visibleCardColumns(columns, visible: readonly string[]): CardColumns`: normalized column membership filtered by visibility.
- `moveCard(columns: CardColumns, id: CardId, direction: -1|1): CardColumns`: swap neighbors within the owning column only.
- `transferCard(columns: CardColumns, id: CardId, target: CardSide): CardColumns`: append to target, removing from origin; no-op if already in target.
- `cardSettings.ts`: `initializeCardColumns(settings: Gio.Settings): CardColumns`, normalize/persist `card-columns`; `saveCardColumns(settings, columns): void` writes both sides together with one GLib.Variant('aas', [left,right]). Old initializer/order helpers are removed.
- `LayoutConfig.cardColumns?: CardColumns`; absence uses the requested default columns.

## Task 1: Two settings lists (settings agent)

Own `extension/src/prefs/cards.ts` and existing `extension/tests/gnome/card-order.js` GTK harness. Parent owns i18n, shared APIs, schema, outer test/build/runner.

- [x] Show translated left/right groups, all card rows, visibility switch, up/down and transfer button. Preserve focus after moving/reparenting. Persist immediately and reflect external settings changes; clean up listeners on close.
- [x] Update private GTK harness State to report columns and per-column rows, Focus(id, up/down/toggle/transfer), Seed(left:as,right:as,visible:as), Reopen. Add boundary/target tooltip data for assertions; no actual user settings/service access.

## Task 2: Independent placement and clock size (parent)

Own helper/schema/settings adapter, extension.ts, widgets/host.ts, shared/layout.ts, clock presentation, pure/outer GUI tests and docs.

Review focus: cross-column duplication/loss, empty column, hidden/re-enabled card positions, reset/malformed values, keyboard focus, independent heights, responsive restoration, clock/weather size including missing data/fallbacks.

- [x] Write failing column/layout tests; implement atomic normalization and independent packing.
- [x] Verify actual GTK moves in both directions, within-column order, persistence, language, boundaries, external changes and focus; actual Shell stack geometry and clock/weather size at theme/scale variants.
- [x] Full checks and relevant GNOME regressions, independent review, package/install preserving existing settings, evidence and local commit.

## Outcome

Implemented and installed with existing settings preserved. Focused GTK/Shell checks, the full build/test suite and existing preferences/compact regressions passed. The full functional suite passed on rerun after one occurrence of its previously recorded intermittent reactivation failure; no lifecycle code was changed. Independent review found no actionable issues. See [captures and verification record](../../../outputs/verification/card-columns/README.md).
